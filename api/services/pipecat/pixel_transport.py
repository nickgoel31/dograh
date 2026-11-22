"""Runs one conversation of a Swarvo Pixel (an ESP32 voice device) on the platform's normal agent pipeline.

The device keeps ONE WebSocket open for good and holds many conversations over it. So the pipeline never talks to the real socket: it gets a
``PixelSocket`` (a stand-in that the device handler feeds with the microphone audio and that sends audio and control messages back), and closing
it only ends the conversation, never the connection.

Wire format (see the Pixel guide): microphone audio in, and speech audio out, are raw 16 kHz 16-bit mono PCM in binary messages. Control messages are
small JSON texts. Everything else (listening, thinking, the AI model, the voice, knowledge, tools, recording, billing) is the same pipeline that
runs browser and phone calls.
"""

from __future__ import annotations

import asyncio
import json

from loguru import logger
from starlette.websockets import WebSocketState

from api.db import db_client
from api.services.pipecat.audio_config import AudioConfig
from pipecat.frames.frames import CancelFrame, EndFrame, Frame, InputAudioRawFrame, InterruptionFrame, OutputAudioRawFrame
from pipecat.serializers.base_serializer import FrameSerializer
from pipecat.transports.websocket.fastapi import FastAPIWebsocketParams, FastAPIWebsocketTransport

RATE = 16000
MAX_CHUNK = 4096  # the device drops larger audio messages
END_SESSION = json.dumps({"type": "end_session"})


class PixelSocket:
    """The slice of a FastAPI WebSocket that the pipecat transport uses, over the device's real (shared) socket."""

    def __init__(self, real, *, queue_limit: int = 800):
        self._real = real
        self._in: asyncio.Queue = asyncio.Queue(maxsize=queue_limit)  # ~16 s of 20 ms packets: a stalled pipeline cannot grow without limit
        self.headers: dict = {}
        self._closed = False

    # --- what the transport reads
    @property
    def client_state(self):
        return WebSocketState.DISCONNECTED if self._closed else WebSocketState.CONNECTED

    application_state = client_state

    async def receive(self) -> dict:
        item = await self._in.get()
        if item is None:
            return {"type": "websocket.disconnect", "code": 1000}
        if isinstance(item, bytes):
            return {"type": "websocket.receive", "bytes": item}
        return {"type": "websocket.receive", "text": item}

    # --- what the transport writes
    async def send_bytes(self, data: bytes) -> None:
        if not self._closed:
            await self._real.send_bytes(data)

    async def send_text(self, data: str) -> None:
        if not self._closed:
            await self._real.send_text(data)

    async def close(self, code: int = 1000, reason: str | None = None) -> None:
        self._closed = True  # the conversation is over; the device's connection stays open

    # --- what the device handler feeds in
    def feed_audio(self, pcm: bytes) -> None:
        try:
            self._in.put_nowait(pcm)
        except asyncio.QueueFull:
            pass  # drop rather than lag behind

    def feed_interrupt(self) -> None:
        try:
            self._in.put_nowait("interrupt")
        except asyncio.QueueFull:
            pass

    def finish(self) -> None:
        """Tell the pipeline the caller is gone: it wraps up the call (recording, summary, billing numbers) the normal way."""
        try:
            self._in.put_nowait(None)
        except asyncio.QueueFull:
            self._in.get_nowait()
            self._in.put_nowait(None)


class PixelFrameSerializer(FrameSerializer):
    """Binary PCM in and out; the pipeline's end becomes {"type":"end_session"}; a text "interrupt" becomes an interruption."""

    async def serialize(self, frame: Frame) -> str | bytes | None:
        if isinstance(frame, OutputAudioRawFrame):
            audio = frame.audio
            return audio[: len(audio) // 2 * 2] if audio else None
        if isinstance(frame, (EndFrame, CancelFrame)):
            return END_SESSION
        return None

    async def deserialize(self, data: str | bytes) -> Frame | None:
        if isinstance(data, (bytes, bytearray)):
            if len(data) < 2 or len(data) % 2:
                return None  # the device's rule: odd-sized audio is dropped
            return InputAudioRawFrame(audio=bytes(data), sample_rate=RATE, num_channels=1)
        if data == "interrupt":
            return InterruptionFrame()
        return None


def create_pixel_transport(socket: PixelSocket) -> FastAPIWebsocketTransport:
    return FastAPIWebsocketTransport(
        websocket=socket,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            audio_in_sample_rate=RATE,
            audio_out_sample_rate=RATE,
            serializer=PixelFrameSerializer(),
            allowed_origins=[],  # the device authenticates with its activation code, not with a browser origin
        ),
    )


async def run_pipeline_pixel(socket: PixelSocket, *, workflow_id: int, workflow_run_id: int, user_id: int) -> None:
    """Run the agent's pipeline for one Pixel conversation, like run_pipeline_telephony does for a phone call."""
    from api.services.configuration.resolve import resolve_effective_config
    from api.services.pipecat.run_pipeline import _run_pipeline
    from pipecat.utils.run_context import set_current_org_id, set_current_run_id

    set_current_run_id(workflow_run_id)
    workflow = await db_client.get_workflow_by_id(workflow_id)
    if workflow:
        set_current_org_id(workflow.organization_id)
    workflow_run = await db_client.get_workflow_run_by_id(workflow_run_id)
    user_config = await db_client.get_user_configurations(user_id, organization_id=getattr(workflow, "organization_id", None))
    run_configs = (workflow_run.definition.workflow_configurations or {}) if workflow_run else {}
    user_config = resolve_effective_config(user_config, run_configs.get("model_overrides"))
    audio_config = AudioConfig(transport_in_sample_rate=RATE, transport_out_sample_rate=RATE, vad_sample_rate=RATE, pipeline_sample_rate=RATE)
    logger.info(f"[run {workflow_run_id}] Pixel conversation starting")
    await _run_pipeline(
        create_pixel_transport(socket), workflow_id, workflow_run_id, user_id,
        audio_config=audio_config, workflow_run=workflow_run, resolved_user_config=user_config,
    )
