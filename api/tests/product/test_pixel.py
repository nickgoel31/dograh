"""Swarvo Pixel: activation codes and sign-in, the device list, and the device's WebSocket protocol."""

import asyncio
import json
from types import SimpleNamespace

import pytest
import pytest_asyncio
from sqlalchemy import select

from api.db import models
from api.db.models import UserModel
from api.db.product_models import ProductAgentModel, ProductPixelModel, ProductPixelSessionModel
from api.product import pixel_ws, pixels, pixels_router
from api.tests.product.support import bearer, make_client, signup


# ---------- codes ----------
def test_codes_are_readable_and_only_their_hash_is_kept():
    c = pixels.new_code()
    assert len(c) == 19 and c.count("-") == 3 and not set(c.replace("-", "")) & set("01OIL")
    assert pixels.clean_code(c.lower().replace("-", " ")) == c.replace("-", "")
    assert pixels.hash_code(c) == pixels.hash_code(c.lower()) != pixels.hash_code(pixels.new_code())
    assert c.replace("-", "") not in pixels.hash_code(c)
    assert pixels.clean_device_id(" swarvo-0001 ") == "SWARVO-0001"


# ---------- through the API ----------
@pytest_asyncio.fixture
async def client(monkeypatch):
    async with make_client(monkeypatch) as c:
        c._app_routes = None
        from api.tests.product import support

        # the two routers are mounted on the test app the same way main.py mounts them
        app = c._transport.app  # type: ignore[attr-defined]
        app.include_router(pixels_router.router)
        app.include_router(pixels_router.admin)
        c.mp = monkeypatch
        yield c


async def _admin(client):
    h = bearer((await signup(client, "boss@twjlabs.com"))[1])  # an admin address cannot be signed up once it is set as admin, so this comes first
    client.mp.setenv("PRODUCT_ADMIN_EMAILS", "boss@twjlabs.com")
    async with client.session_factory() as s:
        u = (await s.execute(select(UserModel).where(UserModel.email == "boss@twjlabs.com"))).scalar_one()
        u.is_superuser = True
        await s.commit()
    return h


@pytest.mark.asyncio
async def test_the_owner_makes_devices_and_a_device_signs_in_to_its_own_account(client):
    admin = await _admin(client)
    assert (await client.post("/product/admin/pixels", json={"count": 2}, headers=bearer((await signup(client, "cust@x.com"))[1]))).status_code == 403
    made = (await client.post("/product/admin/pixels", json={"count": 3, "batch": "Expo"}, headers=admin)).json()
    assert [m["device_id"] for m in made] == ["SWARVO-0001", "SWARVO-0002", "SWARVO-0003"]
    nxt = (await client.post("/product/admin/pixels", json={"count": 1}, headers=admin)).json()
    assert nxt[0]["device_id"] == "SWARVO-0004"  # numbering carries on
    one = made[0]
    # nothing is stored in the clear
    async with client.session_factory() as s:
        row = (await s.execute(select(ProductPixelModel).where(ProductPixelModel.device_id == "SWARVO-0001"))).scalar_one()
        assert one["code"].replace("-", "") not in row.code_hash and row.status == "ready" and row.workspace_id is None
    # a wrong code, an unknown device
    assert (await client.post("/product/auth/pixel", json={"device_id": "SWARVO-0001", "code": "AAAA-BBBB-CCCC-DDDD"})).status_code == 401
    assert (await client.post("/product/auth/pixel", json={"device_id": "NOPE-0001", "code": one["code"]})).status_code == 401
    # the first sign-in creates the account; the code can be typed in any case, with or without dashes
    r = await client.post("/product/auth/pixel", json={"device_id": "swarvo-0001", "code": one["code"].lower().replace("-", "")})
    assert r.status_code == 200, r.text
    me = r.json()
    assert me["user"]["email"] == "swarvo-0001@devices.swarvoai.com" and me["current_workspace"]["name"] == "Swarvo Pixel SWARVO-0001" and me["current_workspace"]["role"] == "owner"
    token = r.cookies.get("swarvo_session") or next(iter(r.cookies.values()))
    h = bearer(token)
    # a device account is not a person signing up: no WhatsApp check, no welcome bonus, and the app knows to hide phone lines
    client.mp.setenv("PRODUCT_REQUIRE_PHONE_VERIFY", "1")
    assert (await client.get("/product/verify", headers=h)).json()["required"] is False
    assert (await client.get("/product/me", headers=h)).json()["device"] is True
    person = bearer((await signup(client, "person@x.com"))[1])
    assert (await client.get("/product/me", headers=person)).json()["device"] is False
    assert (await client.get("/product/verify", headers=person)).json()["required"] is True  # the check is really on: a person still gets asked
    mine = (await client.get("/product/pixels", headers=h)).json()
    assert len(mine) == 1 and mine[0]["id"] == "SWARVO-0001" and mine[0]["status"] == "active" and mine[0]["online"] is False and mine[0]["agent_id"] is None
    # signing in again is the same account, not a second one
    again = await client.post("/product/auth/pixel", json={"device_id": "SWARVO-0001", "code": one["code"]})
    assert again.json()["user"]["id"] == me["user"]["id"] and again.json()["current_workspace"]["id"] == me["current_workspace"]["id"]
    # the device's account picks which agent it talks to, and only from its own workspace
    aid = (await client.post("/product/agents", json={"name": "Stall", "template": "receptionist"}, headers=h)).json()["id"]
    other = bearer((await signup(client, "other@x.com"))[1])
    other_aid = (await client.post("/product/agents", json={"name": "Not yours", "template": "receptionist"}, headers=other)).json()["id"]
    assert (await client.patch("/product/pixels/SWARVO-0001", json={"agent_id": other_aid}, headers=h)).status_code == 404
    ch = await client.patch("/product/pixels/SWARVO-0001", json={"agent_id": aid, "name": "Front stall"}, headers=h)
    assert ch.status_code == 200 and ch.json()["agent_name"] == "Stall" and ch.json()["name"] == "Front stall"
    assert (await client.patch("/product/pixels/SWARVO-0001", json={"clear_agent": True}, headers=h)).json()["agent_id"] is None
    # somebody else cannot see or change it
    assert (await client.get("/product/pixels", headers=other)).json() == []
    assert (await client.patch("/product/pixels/SWARVO-0001", json={"name": "mine now"}, headers=other)).status_code == 404


@pytest.mark.asyncio
async def test_switching_a_device_off_and_giving_it_a_new_code(client):
    admin = await _admin(client)
    d = (await client.post("/product/admin/pixels", json={"count": 1}, headers=admin)).json()[0]
    assert (await client.post("/product/auth/pixel", json={"device_id": d["device_id"], "code": d["code"]})).status_code == 200
    await client.post(f"/product/admin/pixels/{d['device_id']}/off", headers=admin)
    off = await client.post("/product/auth/pixel", json={"device_id": d["device_id"], "code": d["code"]})
    assert off.status_code == 403 and off.json()["detail"]["code"] == "device_off"
    await client.post(f"/product/admin/pixels/{d['device_id']}/on", headers=admin)
    new = (await client.post(f"/product/admin/pixels/{d['device_id']}/new-code", headers=admin)).json()
    assert new["code"] != d["code"]
    assert (await client.post("/product/auth/pixel", json={"device_id": d["device_id"], "code": d["code"]})).status_code == 401  # the old code is dead
    assert (await client.post("/product/auth/pixel", json={"device_id": d["device_id"], "code": new["code"]})).status_code == 200
    listing = (await client.get("/product/admin/pixels", headers=admin)).json()
    assert listing[0]["device_id"] == d["device_id"] and listing[0]["claimed"] is True and "code" not in json.dumps(listing)


# ---------- the device's connection ----------
class FakeWS:
    """What the device handler needs from a WebSocket: it records everything sent to the device."""

    def __init__(self):
        self.sent: list = []
        self.closed = None

    async def send_text(self, t):
        self.sent.append(json.loads(t))

    async def send_bytes(self, b):
        self.sent.append(b)

    async def close(self, code=1000, reason=""):
        self.closed = (code, reason)

    def texts(self):
        return [m for m in self.sent if isinstance(m, dict)]


@pytest_asyncio.fixture
async def rig(monkeypatch):
    """A workspace with an agent and a device, the real device handler, and a stand-in for the voice pipeline."""
    async with make_client(monkeypatch) as c:
        c.mp = monkeypatch
        app = c._transport.app  # type: ignore[attr-defined]
        app.include_router(pixels_router.router)
        app.include_router(pixels_router.admin)
        admin = await _admin(c)
        dev = (await c.post("/product/admin/pixels", json={"count": 1}, headers=admin)).json()[0]
        r = await c.post("/product/auth/pixel", json={"device_id": dev["device_id"], "code": dev["code"]})
        h = bearer(next(iter(r.cookies.values())))
        aid = (await c.post("/product/agents", json={"name": "Stall", "template": "receptionist"}, headers=h)).json()["id"]
        await c.patch(f"/product/pixels/{dev['device_id']}", json={"agent_id": aid}, headers=h)
        runs, calls = [], {}

        async def start_run(org_id, user_id, workflow_id, ctx):
            runs.append((org_id, user_id, workflow_id, ctx))
            return 100 + len(runs)

        class Pipeline:
            """Stands in for the real pipeline: it reads what the device sends and can be told to speak, so the protocol is tested on its own."""

            def __init__(self):
                self.heard: list = []
                self.socket = None
                self.stop = asyncio.Event()

            async def __call__(self, socket, *, workflow_id, workflow_run_id, user_id):
                self.socket = socket
                calls["run"] = workflow_run_id
                while True:
                    m = await socket.receive()
                    if m["type"] == "websocket.disconnect":
                        break
                    self.heard.append(m.get("bytes") if "bytes" in m else m.get("text"))
                await socket.send_text(json.dumps({"type": "end_session"}))
                await socket.close()

        pipe = Pipeline()

        class W:
            async def summary(self, org_id):
                return {"balance": 50.0, "minutes_available": 10.0}

        strict = __import__('sqlalchemy.ext.asyncio', fromlist=['async_sessionmaker']).async_sessionmaker(c.session_factory.kw['bind'], expire_on_commit=True)  # like production: a row cannot be read after a commit without a refresh
        monkeypatch.setattr(pixel_ws, "deps", SimpleNamespace(session_factory=strict, start_run=start_run, runner=pipe, wallet=lambda: W()))
        monkeypatch.setattr(pixel_ws, "GREETING_GRACE_SECONDS", 0.2)
        c.rig = SimpleNamespace(dev=dev, h=h, runs=runs, pipe=pipe, calls=calls, W=W)
        yield c


async def _connect(rig):
    async with rig.session_factory() as s:
        row = (await s.execute(select(ProductPixelModel))).scalar_one()
        pk, did = row.id, row.device_id
    ws = FakeWS()
    return pixel_ws.PixelConnection(ws, pk, did), ws


@pytest.mark.asyncio
async def test_a_touch_starts_a_conversation_and_the_device_is_told_what_to_do(rig):
    conn, ws = await _connect(rig)
    await conn.on_text(json.dumps({"type": "touch_start"}))
    assert ws.texts() == [{"type": "state", "value": "listening"}]
    org, user, wf, ctx = rig.rig.runs[0]
    assert ctx == {"pixel": "SWARVO-0001"}
    s = conn.session
    # while the agent is saying its greeting the microphone is ignored
    conn.on_audio(b"\x01\x00" * 320)
    await asyncio.sleep(0.05)
    assert rig.rig.pipe.heard == []
    # the agent starts and finishes speaking: the device is told, and audio flows from then on
    await s.on_feedback({"type": "rtf-bot-started-speaking"})
    assert ws.texts()[-1] == {"type": "state", "value": "speaking"}
    conn.on_audio(b"\x01\x00" * 320)  # not listening: dropped
    await s.on_feedback({"type": "rtf-bot-stopped-speaking"})
    assert ws.texts()[-1] == {"type": "state", "value": "listening"}
    conn.on_audio(b"\x02\x00" * 320)
    conn.on_audio(b"\x03")  # an odd size: dropped
    await asyncio.sleep(0.05)
    assert rig.rig.pipe.heard == [b"\x02\x00" * 320]
    # the person stops talking: the device shows thinking and stops sending
    await s.on_turn("user_stopped")
    assert ws.texts()[-1] == {"type": "state", "value": "thinking"}
    conn.on_audio(b"\x04\x00" * 320)
    await asyncio.sleep(0.05)
    assert len(rig.rig.pipe.heard) == 1
    # a touch while it thinks or speaks is an interrupt: back to listening at once
    await conn.on_text(json.dumps({"type": "interrupt"}))
    assert ws.texts()[-1] == {"type": "state", "value": "listening"}
    await asyncio.sleep(0.05)
    assert "interrupt" in rig.rig.pipe.heard
    # the device ends it
    await conn.on_text(json.dumps({"type": "touch_end"}))
    await asyncio.wait_for(s.ended.wait(), 3)
    await asyncio.sleep(0.05)
    assert conn.session is None and ws.texts()[-1] == {"type": "state", "value": "idle"} and {"type": "end_session"} in ws.texts()
    # the conversation was recorded against the device
    async with rig.session_factory() as db:
        row = (await db.execute(select(ProductPixelSessionModel))).scalar_one()
        assert row.run_id == 101 and row.ended_at is not None and row.end_reason == "touch_end"
    u = (await rig.get("/product/pixels", headers=rig.rig.h)).json()[0]
    assert u["sessions"] == 1


@pytest.mark.asyncio
async def test_a_device_without_an_agent_or_balance_is_told_why(rig):
    conn, ws = await _connect(rig)
    await rig.patch("/product/pixels/SWARVO-0001", json={"clear_agent": True}, headers=rig.rig.h)
    await conn.on_text('{"type":"touch_start"}')
    assert ws.texts()[0]["type"] == "error" and ws.texts()[0]["code"] == "no_agent" and ws.texts()[-1] == {"type": "end_session"} and conn.session is None
    aid = (await rig.get("/product/agents", headers=rig.rig.h)).json()[0]["id"]
    await rig.patch("/product/pixels/SWARVO-0001", json={"agent_id": aid}, headers=rig.rig.h)

    async with rig.session_factory() as db:  # the wallet rule only applies to a workspace whose Live organization has a wallet
        from api.db.models import OrganizationModel
        from api.db.product_models import ProductWorkspaceModel

        w = (await db.execute(select(ProductWorkspaceModel))).scalars().all()[-1]
        (await db.get(OrganizationModel, w.live_org_id)).wallet_enabled = True
        await db.commit()

    class Broke:
        async def summary(self, org_id):
            return {"balance": 0, "minutes_available": 0}

    pixel_ws.deps.wallet = lambda: Broke()
    ws.sent.clear()
    await conn.on_text('{"type":"touch_start"}')
    assert ws.texts()[0]["code"] == "no_balance" and rig.rig.runs == []  # no run was even started


@pytest.mark.asyncio
async def test_a_conversation_is_capped_and_ended_when_nobody_talks(rig, monkeypatch):
    conn, ws = await _connect(rig)
    monkeypatch.setattr(pixel_ws, "IDLE_SECONDS", 0.3)
    await conn.on_text('{"type":"touch_start"}')
    s = conn.session
    await s.on_feedback({"type": "rtf-bot-stopped-speaking"})  # the greeting is over and nobody answers
    await asyncio.wait_for(s.ended.wait(), 5)
    await asyncio.sleep(0.05)
    async with rig.session_factory() as db:
        assert (await db.execute(select(ProductPixelSessionModel))).scalar_one().end_reason == "idle"
    assert {"type": "end_session"} in ws.texts()
    # and the length cap
    monkeypatch.setattr(pixel_ws, "MAX_SESSION_SECONDS", 0.5)
    monkeypatch.setattr(pixel_ws, "IDLE_SECONDS", 99)
    await conn.on_text('{"type":"touch_start"}')
    s2 = conn.session
    await asyncio.wait_for(s2.ended.wait(), 5)
    await asyncio.sleep(0.05)
    async with rig.session_factory() as db:
        reasons = [r.end_reason for r in (await db.execute(select(ProductPixelSessionModel).order_by(ProductPixelSessionModel.id))).scalars()]
    assert reasons == ["idle", "limit"]


@pytest.mark.asyncio
async def test_a_new_touch_ends_the_old_conversation_first_and_unknown_messages_are_ignored(rig):
    conn, ws = await _connect(rig)
    await conn.on_text('{"type":"touch_start"}')
    first = conn.session
    await conn.on_text("not json")
    await conn.on_text('{"type":"banana"}')
    await conn.on_text('{"type":"touch_start"}')
    assert first.ended.is_set() and conn.session is not first and len(rig.rig.runs) == 2
    await conn.close()
    assert conn.session is None or conn.session.ended.is_set()


@pytest.mark.asyncio
async def test_the_stand_in_socket_never_closes_the_devices_connection():
    from api.services.pipecat.pixel_transport import PixelFrameSerializer, PixelSocket
    from pipecat.frames.frames import CancelFrame, EndFrame, InputAudioRawFrame, InterruptionFrame, OutputAudioRawFrame, TextFrame

    real = FakeWS()
    sock = PixelSocket(SimpleNamespace(send_bytes=real.send_bytes, send_text=real.send_text))
    sock.feed_audio(b"\x01\x00")
    sock.feed_interrupt()
    sock.finish()
    assert (await sock.receive())["bytes"] == b"\x01\x00" and (await sock.receive())["text"] == "interrupt" and (await sock.receive())["type"] == "websocket.disconnect"
    await sock.send_bytes(b"\x05\x00")
    await sock.close()
    assert real.closed is None  # the device's connection is still open
    await sock.send_bytes(b"\x06\x00")
    assert real.sent == [b"\x05\x00"]  # and nothing more is sent for the finished conversation
    ser = PixelFrameSerializer()
    assert await ser.serialize(OutputAudioRawFrame(b"\x01\x00\x02", 16000, 1)) == b"\x01\x00"  # always an even number of bytes
    assert json.loads(await ser.serialize(EndFrame())) == {"type": "end_session"} and json.loads(await ser.serialize(CancelFrame())) == {"type": "end_session"}
    assert await ser.serialize(TextFrame("x")) is None
    f = await ser.deserialize(b"\x00\x00" * 320)
    assert isinstance(f, InputAudioRawFrame) and f.sample_rate == 16000 and f.num_channels == 1
    assert await ser.deserialize(b"\x00") is None and isinstance(await ser.deserialize("interrupt"), InterruptionFrame) and await ser.deserialize("hi") is None


# ---------- the real endpoint, over a real WebSocket ----------
def test_the_endpoint_checks_hello_and_runs_a_conversation_end_to_end(monkeypatch, tmp_path):
    """A device connects to /api/v1/ws/device (and /ws/device), says hello, touches, hears 'listening', and is rejected with a wrong code."""
    from fastapi import FastAPI
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from sqlalchemy.pool import NullPool
    from starlette.testclient import TestClient

    from api.tests.product.support import TABLES

    loop = asyncio.new_event_loop()
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'pixel.db'}", poolclass=NullPool)  # a file, because the app runs on its own thread and loop

    async def setup():
        async with engine.begin() as conn:
            for t in TABLES:
                t.indexes.clear()
                for c in t.columns:
                    c.server_default = None
            await conn.run_sync(lambda c: models.Base.metadata.create_all(c, tables=TABLES))
        Session = async_sessionmaker(engine, expire_on_commit=False)
        async with Session() as s:
            made = await pixels.create_batch(s, count=1)
            u = await pixels.sign_in(s, made[0][0])
            ws_row = (await s.execute(select(ProductPixelModel))).scalar_one()
            await s.commit()
            return Session, made[0][1], ws_row.device_id

    Session, code, device_id = loop.run_until_complete(setup())
    started = []

    async def start_run(org_id, user_id, workflow_id, ctx):
        started.append(ctx)
        return 7

    async def pipeline(socket, **kw):
        while True:
            m = await socket.receive()
            if m["type"] == "websocket.disconnect":
                break

    # a device with no agent chosen yet: it connects, and is told so when touched
    monkeypatch.setattr(pixel_ws, "deps", SimpleNamespace(session_factory=Session, start_run=start_run, runner=pipeline, wallet=lambda: None))

    async def _no_limit(*a, **k):
        return None

    monkeypatch.setattr("api.utils.rate_limit.enforce", _no_limit)
    app = FastAPI()
    app.include_router(pixel_ws.router)
    with TestClient(app) as tc:
        with tc.websocket_connect("/api/v1/ws/device") as ws:  # switched on: hello only. No conversation, no call, nothing started
            ws.send_text(json.dumps({"type": "hello", "device_id": device_id, "token": code, "fw": "0.1"}))
            ws.send_bytes(b"\x00\x00" * 320)  # even a stray microphone packet starts nothing
        assert started == []
        for path in ("/api/v1/ws/device", "/ws/device"):
            with tc.websocket_connect(path) as ws:
                ws.send_text(json.dumps({"type": "hello", "device_id": device_id, "token": "WRONG-WRONG-WRONG-WRONG", "fw": "0.1"}))
                with pytest.raises(Exception):
                    ws.receive_text()  # closed: bad credentials
            with tc.websocket_connect(path) as ws:
                ws.send_text(json.dumps({"type": "hello", "device_id": device_id.lower(), "token": code.lower(), "fw": "0.1"}))
                ws.send_text(json.dumps({"type": "touch_start"}))
                err = json.loads(ws.receive_text())
                assert err["type"] == "error" and err["code"] == "no_agent"
                assert json.loads(ws.receive_text()) == {"type": "end_session"}
                ws.send_bytes(b"\x00\x00" * 320)  # audio while not in a conversation is simply ignored
                ws.send_text(json.dumps({"type": "touch_end"}))
    async def seen():
        async with Session() as s:
            return (await s.execute(select(ProductPixelModel))).scalar_one()

    row = loop.run_until_complete(seen())
    assert row.fw == "0.1" and row.last_seen_at is not None  # the device was seen, with its firmware version
    loop.run_until_complete(engine.dispose())
    loop.close()


@pytest.mark.asyncio
async def test_the_pipecat_transport_reads_microphone_audio_and_sends_speech_through_the_stand_in_socket():
    """The real pipecat WebSocket transport, over the stand-in socket: mic audio reaches the pipeline, speech reaches the device, and ending
    the conversation tells the device without closing its connection."""
    from api.services.pipecat.pixel_transport import PixelSocket, create_pixel_transport
    from pipecat.frames.frames import InputAudioRawFrame, OutputAudioRawFrame
    from pipecat.pipeline.pipeline import Pipeline
    from pipecat.pipeline.runner import PipelineRunner
    from pipecat.pipeline.task import PipelineParams, PipelineTask
    from pipecat.processors.frame_processor import FrameProcessor

    real = FakeWS()
    sock = PixelSocket(SimpleNamespace(send_bytes=real.send_bytes, send_text=real.send_text))
    transport = create_pixel_transport(sock)
    heard = []

    class Tap(FrameProcessor):
        async def process_frame(self, frame, direction):
            await super().process_frame(frame, direction)
            if isinstance(frame, InputAudioRawFrame):
                heard.append(frame)
            await self.push_frame(frame, direction)

    task = PipelineTask(Pipeline([transport.input(), Tap(), transport.output()]), params=PipelineParams(audio_in_sample_rate=16000, audio_out_sample_rate=16000))
    runner = PipelineRunner(handle_sigint=False)
    run = asyncio.create_task(runner.run(task))
    await asyncio.sleep(0.6)
    sock.feed_audio(b"\x01\x00" * 320)
    sock.feed_audio(b"\x01")  # odd: dropped by the serializer
    await asyncio.sleep(0.3)
    assert len(heard) >= 1 and heard[0].sample_rate == 16000 and heard[0].num_channels == 1
    try:
        await task.queue_frame(OutputAudioRawFrame(b"\x07\x00" * 3200, 16000, 1))  # 200 ms of speech (shorter bits wait for more)
        await asyncio.sleep(0.8)
        audio = [m for m in real.sent if isinstance(m, bytes)]
        assert audio and all(len(a) % 2 == 0 and len(a) <= 4096 for a in audio)
    finally:
        await task.cancel()
        await asyncio.wait_for(run, 15)
    assert {"type": "end_session"} in real.texts()  # the agent's end reaches the device
    assert real.closed is None  # and the connection is still open for the next touch
