"""The live connection of a Swarvo Pixel device.

A device opens one WebSocket, says hello with its id and activation code, and keeps it open. Each touch of its pad is a conversation: the agent
the owner picked answers on the platform's normal voice pipeline (AI model, voice, knowledge, tools). This file is the thin layer that speaks the
device's protocol and keeps the rules: who may connect, one connection per device, a cap on how long a conversation can run, and minutes that
are counted and charged like any other call.

Protocol (full text in docs/swarvo-pixel/): device to server, JSON text: hello, touch_start, interrupt, touch_end; binary: 16 kHz 16-bit mono
PCM while listening. Server to device, JSON text: {"type":"state","value":"listening|thinking|speaking|idle"}, {"type":"end_session"},
{"type":"error","code":...}; binary: 16 kHz 16-bit mono PCM speech.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace

from fastapi import APIRouter, WebSocket
from loguru import logger
from sqlalchemy import select

from api.db.models import OrganizationModel
from api.db.product_models import ProductAgentModel, ProductPixelModel, ProductPixelSessionModel, ProductWorkspaceModel
from api.product import models_config, pixels

router = APIRouter()

MAX_SESSION_SECONDS = int(os.getenv("PRODUCT_PIXEL_MAX_SECONDS", "300"))  # a conversation never runs longer than this
IDLE_SECONDS = float(os.getenv("PRODUCT_PIXEL_IDLE_SECONDS", "25"))  # nobody speaks after the greeting: end it
SILENT_SECONDS = float(os.getenv("PRODUCT_PIXEL_SILENT_SECONDS", "60"))  # nothing at all happening: end it
HELLO_SECONDS = 10.0
HEARTBEAT_SECONDS = 20.0
GREETING_GRACE_SECONDS = 8.0  # the microphone is ignored until the greeting is done, or this long

_LIVE: dict[str, "PixelConnection"] = {}  # device id -> its connection on this server (an older one is closed when a new one says hello)


def _real_deps() -> SimpleNamespace:
    from api.db import db_client
    from api.product.payments import get_wallet

    async def start_run(org_id: int, user_id: int, workflow_id: int, context: dict) -> int:
        run = await db_client.create_workflow_run(
            f"PIXEL-{int(time.time())}", workflow_id, "smallwebrtc", user_id, initial_context=context, use_draft=True, organization_id=org_id)
        return run.id

    async def runner(socket, *, workflow_id: int, workflow_run_id: int, user_id: int) -> None:
        from api.services.pipecat.pixel_transport import run_pipeline_pixel

        await run_pipeline_pixel(socket, workflow_id=workflow_id, workflow_run_id=workflow_run_id, user_id=user_id)

    return SimpleNamespace(session_factory=db_client.async_session, start_run=start_run, runner=runner, wallet=get_wallet)


# Replaced in tests. Built on first use so importing this file needs no database.
deps: SimpleNamespace | None = None


def D() -> SimpleNamespace:
    global deps
    if deps is None:
        deps = _real_deps()
    return deps


def _now() -> datetime:
    return datetime.now(UTC)


class PixelSession:
    """One conversation: the run on the platform, the stand-in socket the pipeline reads, and the timers that keep it bounded."""

    def __init__(self, conn: "PixelConnection", run_id: int, row_id: int, workflow_id: int, owner_id: int):
        from api.services.pipecat.pixel_transport import PixelSocket

        self.conn, self.run_id, self.row_id, self.workflow_id, self.owner_id = conn, run_id, row_id, workflow_id, owner_id
        self.socket = PixelSocket(conn.real)
        self.started = time.monotonic()
        self.last_activity = self.started
        self.accepting_audio = False  # the microphone is ignored until the greeting has been spoken
        self.reason = ""
        self.task: asyncio.Task | None = None
        self.watch_task: asyncio.Task | None = None
        self.ended = asyncio.Event()

    async def on_feedback(self, message: dict) -> None:
        """Real-time events from the pipeline: when the agent starts and stops speaking."""
        kind = message.get("type")
        self.last_activity = time.monotonic()
        if kind == "rtf-bot-started-speaking":
            await self.conn.set_state("speaking")
        elif kind == "rtf-bot-stopped-speaking":
            self.accepting_audio = True
            await self.conn.set_state("listening")

    async def on_turn(self, what: str) -> None:
        self.last_activity = time.monotonic()
        if what == "user_stopped" and self.conn.state == "listening":
            await self.conn.set_state("thinking")

    def request_end(self, reason: str) -> None:
        if not self.reason:
            self.reason = reason
        self.socket.finish()  # the pipeline wraps the call up the normal way (recording, summary, usage)

    async def watch(self) -> None:
        """Keeps a conversation bounded: a length cap, an idle cap, and a fallback if the greeting never plays."""
        while not self.ended.is_set():
            await asyncio.sleep(1.0)
            now = time.monotonic()
            if now - self.started > MAX_SESSION_SECONDS:
                self.request_end("limit")
            elif not self.accepting_audio and now - self.started > GREETING_GRACE_SECONDS:
                self.accepting_audio = True
            elif self.conn.state == "listening" and now - self.last_activity > IDLE_SECONDS:
                self.request_end("idle")
            elif now - self.last_activity > SILENT_SECONDS:
                self.request_end("timeout")

    async def run(self) -> None:
        from api.services.pipecat.ws_sender_registry import register_turn_hook, register_ws_sender, unregister_turn_hook, unregister_ws_sender

        register_ws_sender(self.run_id, self.on_feedback)
        register_turn_hook(self.run_id, self.on_turn)
        try:
            await D().runner(self.socket, workflow_id=self.workflow_id, workflow_run_id=self.run_id, user_id=self.owner_id)
        except Exception as e:  # noqa: BLE001 - the device must hear that it is over, never hang
            logger.error(f"[pixel {self.conn.device_id}] conversation failed: {e}")
            self.reason = self.reason or "error"
        finally:
            unregister_ws_sender(self.run_id)
            unregister_turn_hook(self.run_id)
            self.ended.set()
            await self.conn.session_over(self)


class PixelConnection:
    def __init__(self, ws: WebSocket, pixel_pk: int, device_id: str):
        self.ws, self.pixel_pk, self.device_id = ws, pixel_pk, device_id
        self.conn_id = uuid.uuid4().hex
        self.state = "idle"
        self.session: PixelSession | None = None
        self.end_sent = False
        self.closed = False
        self._send_lock = asyncio.Lock()
        self.real = SimpleNamespace(send_bytes=self._send_bytes, send_text=self._send_text)

    # ---- sending
    async def _send_bytes(self, data: bytes) -> None:
        if not self.closed:
            await self.ws.send_bytes(data)

    async def _send_text(self, data: str) -> None:
        if '"end_session"' in data:
            self.end_sent = True
        if not self.closed:
            await self.ws.send_text(data)

    async def send_json(self, obj: dict) -> None:
        try:
            async with self._send_lock:
                await self._send_text(json.dumps(obj, separators=(",", ":")))
        except Exception:  # noqa: BLE001 - the device is gone; the receive loop notices
            self.closed = True

    async def set_state(self, value: str) -> None:
        if self.state != value:
            self.state = value
            await self.send_json({"type": "state", "value": value})

    # ---- what the device says
    async def on_text(self, text: str) -> None:
        try:
            msg = json.loads(text)
        except ValueError:
            return
        kind = msg.get("type") if isinstance(msg, dict) else None
        if kind == "touch_start":
            await self.start_session()
        elif kind == "interrupt" and self.session is not None:
            self.session.socket.feed_interrupt()  # stop speaking at once; late audio is discarded by the pipeline
            self.session.accepting_audio = True
            self.session.last_activity = time.monotonic()
            await self.set_state("listening")
        elif kind == "touch_end" and self.session is not None:
            self.session.request_end("touch_end")
        # anything else: ignored

    def on_audio(self, pcm: bytes) -> None:
        s = self.session
        if s is None or self.state != "listening" or not s.accepting_audio or len(pcm) % 2:
            return  # not listening: dropped, never queued
        s.socket.feed_audio(pcm)

    # ---- conversations
    async def start_session(self) -> None:
        if self.session is not None:  # a new touch while one is running: the old one ends first
            old = self.session
            old.request_end("restart")
            try:
                await asyncio.wait_for(old.ended.wait(), 15)
            except asyncio.TimeoutError:
                pass
        why = await self._open()
        if isinstance(why, str):
            await self.send_json({"type": "error", "code": why, "message": REASONS.get(why, "This device can't talk right now.")})
            await self.send_json({"type": "end_session"})
            self.state = "idle"
            return
        self.session = why
        self.end_sent = False
        self.state = "idle"
        await self.set_state("listening")
        why.task = asyncio.create_task(why.run())
        why.watch_task = asyncio.create_task(why.watch())

    async def _open(self) -> "PixelSession | str":
        """Checks, then the run. A short reason code when the device can't talk (not activated, no agent, no money)."""
        async with D().session_factory() as s:
            dev = await s.get(ProductPixelModel, self.pixel_pk)
            if dev is None or dev.status == "revoked":
                return "device_off"
            if dev.workspace_id is None:
                return "not_activated"
            ws = await s.get(ProductWorkspaceModel, dev.workspace_id)
            agent = await s.get(ProductAgentModel, dev.agent_id) if dev.agent_id else None
            if ws is None or agent is None:
                return "no_agent"
            if not await models_config.ensure_org_profiles(s, ws.test_org_id):
                return "not_set_up"
            live = await s.get(OrganizationModel, ws.live_org_id)
            if live is not None and live.wallet_enabled and not ws.adopted:  # the same rule as a practice call: you need minutes or money
                w = await D().wallet().summary(live.id)
                if float(w.get("balance", 0) or 0) <= 0 and float(w.get("minutes_available", 0) or 0) <= 0:
                    return "no_balance"
            owner_id, test_org, workflow_id = ws.owner_user_id, ws.test_org_id, agent.test_workflow_id
            workspace_id, pixel_pk = ws.id, dev.id
            await s.commit()
            run_id = await D().start_run(test_org, owner_id, workflow_id, {"pixel": self.device_id})
            row = ProductPixelSessionModel(pixel_id=pixel_pk, workspace_id=workspace_id, run_id=run_id, started_at=_now())
            s.add(row)
            await s.commit()
            return PixelSession(self, run_id, row.id, workflow_id, owner_id)

    async def session_over(self, session: PixelSession) -> None:
        """The pipeline finished (the person left, a cap was hit, or the agent hung up): record it and tell the device."""
        if session.watch_task:
            session.watch_task.cancel()
        seconds = int(time.monotonic() - session.started)
        try:
            async with D().session_factory() as s:
                row = await s.get(ProductPixelSessionModel, session.row_id)
                if row is not None:
                    row.ended_at, row.seconds, row.end_reason = _now(), seconds, session.reason or "done"
                    await s.commit()
        except Exception as e:  # noqa: BLE001
            logger.warning(f"[pixel {self.device_id}] could not save the session: {e}")
        if self.session is session:
            self.session = None
            if not self.end_sent:
                await self.send_json({"type": "end_session"})
            await self.set_state("idle")

    async def close(self, code: int = 1000, reason: str = "") -> None:
        if self.session is not None:
            self.session.request_end("disconnect")
            try:
                await asyncio.wait_for(self.session.ended.wait(), 15)
            except asyncio.TimeoutError:
                if self.session.task:
                    self.session.task.cancel()
        if not self.closed:
            self.closed = True
            try:
                await self.ws.close(code=code, reason=reason)
            except Exception:  # noqa: BLE001
                pass


REASONS = {
    "not_activated": "This device has not been activated yet. Sign in with its id and activation code on the website.",
    "no_agent": "No agent has been chosen for this device yet.",
    "no_balance": "This account has no balance left.",
    "device_off": "This device has been switched off.",
    "not_set_up": "Calls are not set up for this account yet.",
}


async def _heartbeat(conn: PixelConnection) -> None:
    """Every few seconds: say the device is alive, and give up the connection if another one took over or the device was switched off."""
    while not conn.closed:
        await asyncio.sleep(HEARTBEAT_SECONDS)
        try:
            async with D().session_factory() as s:
                dev = await s.get(ProductPixelModel, conn.pixel_pk)
                if dev is None or dev.status == "revoked" or dev.conn_id != conn.conn_id:
                    await conn.close(1008, "replaced" if dev is not None and dev.status != "revoked" else "device_off")
                    return
                dev.last_seen_at = _now()
                await s.commit()
        except Exception as e:  # noqa: BLE001
            logger.warning(f"[pixel {conn.device_id}] heartbeat failed: {e}")


async def _hello(ws: WebSocket) -> tuple[int, str, str] | None:
    """(pixel id, device id, firmware) once the device has proved who it is, else None."""
    try:
        first = await asyncio.wait_for(ws.receive_text(), HELLO_SECONDS)
        msg = json.loads(first)
    except Exception:  # noqa: BLE001
        return None
    if not isinstance(msg, dict) or msg.get("type") != "hello":
        return None
    ip = ws.client.host if ws.client else "unknown"
    try:
        from api.utils import rate_limit

        await rate_limit.enforce(f"ppixelws:{ip}", 60, 300, "slow down")
    except Exception:  # noqa: BLE001
        return None
    async with D().session_factory() as s:
        dev = await pixels.authenticate(s, str(msg.get("device_id") or ""), str(msg.get("token") or ""))
        if dev is None or dev.status == "revoked":
            logger.warning(f"[pixel] rejected hello for {str(msg.get('device_id'))[:40]!r} from {ip}")
            return None
        return dev.id, dev.device_id, str(msg.get("fw") or "")[:24]


async def pixel_socket(ws: WebSocket) -> None:
    await ws.accept()
    who = await _hello(ws)
    if who is None:
        await ws.close(code=1008, reason="bad_credentials")
        return
    pixel_pk, device_id, fw = who
    conn = PixelConnection(ws, pixel_pk, device_id)
    older = _LIVE.get(device_id)
    _LIVE[device_id] = conn
    if older is not None:  # one connection per device: the older one closes
        asyncio.create_task(older.close(1008, "replaced"))
    async with D().session_factory() as s:
        dev = await s.get(ProductPixelModel, pixel_pk)
        dev.conn_id, dev.fw, dev.last_seen_at = conn.conn_id, fw, _now()
        await s.commit()
    logger.info(f"[pixel {device_id}] online (fw {fw or '?'})")
    beat = asyncio.create_task(_heartbeat(conn))
    try:
        while not conn.closed:
            msg = await ws.receive()
            if msg["type"] == "websocket.disconnect":
                break
            if msg.get("bytes") is not None:
                conn.on_audio(msg["bytes"])
            elif msg.get("text") is not None:
                await conn.on_text(msg["text"])
    except Exception as e:  # noqa: BLE001
        logger.info(f"[pixel {device_id}] connection ended: {e.__class__.__name__}")
    finally:
        beat.cancel()
        await conn.close()
        if _LIVE.get(device_id) is conn:
            _LIVE.pop(device_id, None)
        try:
            async with D().session_factory() as s:
                dev = await s.get(ProductPixelModel, pixel_pk)
                if dev is not None and dev.conn_id == conn.conn_id:
                    dev.conn_id = None
                    await s.commit()
        except Exception:  # noqa: BLE001
            pass
        logger.info(f"[pixel {device_id}] offline")


# The same socket on two paths: /api/v1/ws/device goes through the existing proxy rules; /ws/device is the short address from the device guide.
router.add_api_websocket_route("/ws/device", pixel_socket)
router.add_api_websocket_route("/api/v1/ws/device", pixel_socket)
