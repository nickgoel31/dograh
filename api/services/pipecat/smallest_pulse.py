import asyncio
import json
from collections.abc import AsyncGenerator
from typing import Any
from urllib.parse import urlencode

from loguru import logger

from pipecat.frames.frames import (
    CancelFrame,
    EndFrame,
    ErrorFrame,
    Frame,
    InterimTranscriptionFrame,
    StartFrame,
    TranscriptionFrame,
    VADUserStartedSpeakingFrame,
    VADUserStoppedSpeakingFrame,
)
from pipecat.processors.frame_processor import FrameDirection
from pipecat.services.settings import STTSettings
from pipecat.services.stt_latency import SMALLEST_TTFS_P99
from pipecat.services.stt_service import WebsocketSTTService
from pipecat.utils.time import time_now_iso8601
from pipecat.utils.tracing.service_decorators import traced_stt

try:
    from websockets.asyncio.client import connect as websocket_connect
    from websockets.protocol import State
except ModuleNotFoundError as e:
    logger.error(f"Exception: {e}")
    logger.error("In order to use Smallest Pulse STT, you need to have `websockets` installed.")
    raise ImportError(f"Missing module: {e}") from e


class SmallestPulseTranscriber(WebsocketSTTService):
    """Smallest AI real-time speech-to-text service using the Pulse WebSocket API."""

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str = "wss://api.smallest.ai",
        language: str = "en",
        sample_rate: int = 16000,
        encoding: str = "linear16",
        eou_timeout_ms: int = 800,
        ttfs_p99_latency: float | None = SMALLEST_TTFS_P99,
        **kwargs,
    ):
        settings = STTSettings(
            model="pulse",
            language=language,
        )

        super().__init__(
            sample_rate=sample_rate,
            ttfs_p99_latency=ttfs_p99_latency,
            keepalive_timeout=10,
            keepalive_interval=5,
            settings=settings,
            **kwargs,
        )

        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._encoding = encoding
        self._eou_timeout_ms = eou_timeout_ms
        self._receive_task = None
        self._connected_event = asyncio.Event()
        self._connected_event.set()

    def can_generate_metrics(self) -> bool:
        return True

    async def start(self, frame: StartFrame):
        await super().start(frame)
        await self._connect()

    async def stop(self, frame: EndFrame):
        await super().stop(frame)
        await self._disconnect()

    async def cancel(self, frame: CancelFrame):
        await super().cancel(frame)
        await self._disconnect()

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, VADUserStartedSpeakingFrame):
            await self.start_processing_metrics()
        elif isinstance(frame, VADUserStoppedSpeakingFrame):
            # To force an end-of-utterance without closing: send {"type": "finalize"}
            if self._websocket and self._websocket.state is State.OPEN:
                try:
                    await self._websocket.send(json.dumps({"type": "finalize"}))
                except Exception as e:
                    logger.warning(f"{self} failed to send finalize: {e}")

    async def run_stt(self, audio: bytes) -> AsyncGenerator[Frame | None, None]:
        await self._connected_event.wait()

        if not self._websocket or self._websocket.state is State.CLOSED:
            await self._connect()

        if self._websocket and self._websocket.state is State.OPEN:
            try:
                await self._websocket.send(audio)
            except Exception as e:
                yield ErrorFrame(error=f"Smallest Pulse STT error: {e}")
                return

        yield None

    async def _update_settings(self, delta: STTSettings) -> dict[str, Any]:
        changed = await super()._update_settings(delta)
        if changed:
            await self._disconnect()
            await self._connect()
        return changed

    async def _connect(self):
        self._connected_event.clear()
        try:
            await self._connect_websocket()
            await super()._connect()

            if self._websocket and not self._receive_task:
                self._receive_task = self.create_task(
                    self._receive_task_handler(self._report_error)
                )
        finally:
            self._connected_event.set()

    async def _disconnect(self):
        await super()._disconnect()

        if self._receive_task:
            await self.cancel_task(self._receive_task)
            self._receive_task = None

        await self._disconnect_websocket()

    async def _connect_websocket(self):
        try:
            if self._websocket and self._websocket.state is State.OPEN:
                return

            logger.debug("Connecting to Smallest Pulse STT")

            query_params = {
                "language": self._settings.language,
                "sample_rate": str(self.sample_rate),
                "encoding": self._encoding,
                "word_timestamps": "true",
                "eou_timeout_ms": str(self._eou_timeout_ms),
                "punctuate": "true",
                "format": "true",
                "diarize": "false",
            }

            ws_url = f"{self._base_url}/waves/v1/pulse/get_text?{urlencode(query_params)}"

            self._websocket = await websocket_connect(
                ws_url,
                additional_headers={
                    "Authorization": f"Bearer {self._api_key}",
                },
            )
            await self._call_event_handler("on_connected")
            logger.debug("Connected to Smallest Pulse STT")
        except Exception as e:
            await self.push_error(error_msg=f"Smallest Pulse STT connection error: {e}", exception=e)
            self._websocket = None
            await self._call_event_handler("on_connection_error", f"{e}")

    async def _disconnect_websocket(self):
        try:
            if self._websocket and self._websocket.state is State.OPEN:
                logger.debug("Disconnecting from Smallest Pulse STT")
                # To end the session: send {"type": "close_stream"}
                await self._websocket.send(json.dumps({"type": "close_stream"}))
                await self._websocket.close()
        except Exception as e:
            logger.error(f"{self} error closing websocket: {e}")
        finally:
            self._websocket = None
            await self._call_event_handler("on_disconnected")

    def _get_websocket(self):
        if self._websocket:
            return self._websocket
        raise Exception("Websocket not connected")

    async def _receive_messages(self):
        async for message in self._get_websocket():
            try:
                data = json.loads(message)
                await self._process_response(data)
            except json.JSONDecodeError:
                logger.warning(f"{self} received non-JSON message: {message}")
            except Exception as e:
                logger.error(f"{self} error processing message: {e}")

    async def _process_response(self, data: dict):
        is_final = data.get("is_final", False)
        text = data.get("transcript", "").strip()

        if not text:
            # Handle session close when is_last: true is received
            if data.get("is_last"):
                logger.debug("Smallest Pulse STT session marked as last, disconnecting")
                await self._disconnect()
            return

        if is_final:
            await self.stop_processing_metrics()
            logger.debug(f"Smallest Pulse final transcript: [{text}]")
            await self._handle_transcription(text, True, data.get("language"))
            await self.push_frame(
                TranscriptionFrame(
                    text,
                    self._user_id,
                    time_now_iso8601(),
                    data.get("language"),
                    result=data,
                )
            )
        else:
            logger.trace(f"Smallest Pulse interim transcript: [{text}]")
            await self.push_frame(
                InterimTranscriptionFrame(
                    text,
                    self._user_id,
                    time_now_iso8601(),
                    data.get("language"),
                    result=data,
                )
            )

        if data.get("is_last"):
            logger.debug("Smallest Pulse STT session marked as last, disconnecting")
            await self._disconnect()

    @traced_stt
    async def _handle_transcription(
        self, transcript: str, is_final: bool, language: str | None = None
    ):
        pass
