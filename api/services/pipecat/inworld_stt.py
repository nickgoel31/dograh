"""Inworld speech-to-text as a stand-alone listening service (not the realtime service).

Streams the caller's audio over Inworld's STT WebSocket (``wss://api.inworld.ai/stt/v1/transcribe:streamBidirectional``):
the first message is ``transcribeConfig`` (model, 16-bit PCM, sample rate, language hint, vocabulary), then raw PCM goes as
binary frames. Inworld ends a turn by itself and sends ``result.transcription`` messages: interim ones replace each other,
and one with ``isFinal`` is the finished text of the turn. The key is sent as ``Authorization: Basic <key>`` exactly as
saved (it is already Base64 from the Inworld portal).
"""

import json
from collections.abc import AsyncGenerator
from dataclasses import dataclass, field
from typing import Any

from loguru import logger
from websockets.asyncio.client import connect as websocket_connect
from websockets.protocol import State

from pipecat.frames.frames import (
    CancelFrame,
    EndFrame,
    Frame,
    InterimTranscriptionFrame,
    StartFrame,
    TranscriptionFrame,
)
from pipecat.services.settings import NOT_GIVEN, STTSettings, _NotGiven, assert_given
from pipecat.services.stt_service import WebsocketSTTService
from pipecat.utils.time import time_now_iso8601
from pipecat.utils.tracing.service_decorators import traced_stt

URL = "wss://api.inworld.ai/stt/v1/transcribe:streamBidirectional"
DEFAULT_MODEL = "assemblyai/universal-3-5-pro"
_PROMPT_OK = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,'():!?;-")


def clean_prompts(words: list[str] | str | None) -> list[str]:
    """Vocabulary hints Inworld will accept: only letters, digits, spaces and . , ' ( ) : ! ? ; - (anything else rejects the whole request)."""
    if isinstance(words, str):
        words = [w for w in (p.strip() for p in words.split(",")) if w]
    out = []
    for w in words or []:
        w = "".join(ch for ch in str(w) if ch in _PROMPT_OK).strip()
        if w:
            out.append(w[:60])
    return out[:100]


def language_hint(language: Any) -> str | None:
    """'hi-IN' -> 'hi'. Empty, 'auto' or anything unknown means no hint (Inworld detects the language)."""
    if language is None:
        return None
    code = str(getattr(language, "value", language)).strip().lower()
    return None if code in ("", "auto", "none", "null") else code.split("-")[0]


@dataclass
class InworldSTTSettings(STTSettings):
    """Settings for InworldSTTService."""

    prompts: list[str] | None | _NotGiven = field(default_factory=lambda: NOT_GIVEN)
    end_of_turn_confidence: float | None | _NotGiven = field(default_factory=lambda: NOT_GIVEN)
    max_turn_silence_ms: int | None | _NotGiven = field(default_factory=lambda: NOT_GIVEN)


class InworldSTTService(WebsocketSTTService):
    Settings = InworldSTTSettings
    _settings: Settings

    def __init__(self, *, api_key: str, url: str = URL, sample_rate: int | None = None, settings: Settings | None = None, **kwargs):
        default_settings = self.Settings(model=DEFAULT_MODEL, language=None, prompts=None, end_of_turn_confidence=None, max_turn_silence_ms=None)
        if settings is not None:
            default_settings.apply_update(settings)
        super().__init__(sample_rate=sample_rate, settings=default_settings, **kwargs)
        self._api_key = api_key
        self._url = url
        self._receive_task = None

    def can_generate_metrics(self) -> bool:
        return True

    def config_message(self) -> dict:
        s = self._settings
        model = assert_given(s.model) or DEFAULT_MODEL
        cfg: dict = {"modelId": model, "audioEncoding": "LINEAR16", "sampleRateHertz": int(self.sample_rate), "numberOfChannels": 1}
        hint = language_hint(assert_given(s.language))
        if hint:
            cfg["language"] = hint
        prompts = clean_prompts(assert_given(s.prompts))
        if prompts:
            cfg["prompts"] = prompts
        if assert_given(s.end_of_turn_confidence) is not None:
            cfg["endOfTurnConfidenceThreshold"] = float(assert_given(s.end_of_turn_confidence))
        if assert_given(s.max_turn_silence_ms) is not None and model.startswith("inworld/"):  # these two only exist on Inworld's own model
            cfg["inworldSttV1Config"] = {"maxTurnSilence": int(assert_given(s.max_turn_silence_ms))}
        return {"transcribeConfig": cfg, "audioProtocol": "BINARY"}

    async def start(self, frame: StartFrame):
        await super().start(frame)
        await self._connect()

    async def stop(self, frame: EndFrame):
        await super().stop(frame)
        await self._send_close()
        await self._disconnect()

    async def cancel(self, frame: CancelFrame):
        await super().cancel(frame)
        await self._disconnect()

    async def run_stt(self, audio: bytes) -> AsyncGenerator[Frame | None, None]:
        if self._websocket and self._websocket.state is State.OPEN:
            try:
                await self._websocket.send(audio)
            except Exception as e:  # noqa: BLE001
                logger.warning(f"{self}: send failed: {e}")
        yield None

    @traced_stt
    async def _handle_transcription(self, transcript: str, is_final: bool, language=None):
        pass

    async def _send_close(self):
        if self._websocket and self._websocket.state is State.OPEN:
            try:
                await self._websocket.send(json.dumps({"closeStream": {}}))
            except Exception:  # noqa: BLE001
                pass

    async def _connect(self):
        await self._connect_websocket()
        await super()._connect()
        if self._websocket and not self._receive_task:
            self._receive_task = self.create_task(self._receive_task_handler(self._report_error))

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
            logger.debug("Connecting to Inworld STT")
            self._websocket = await websocket_connect(self._url, additional_headers={"Authorization": f"Basic {self._api_key}"})
            await self._websocket.send(json.dumps(self.config_message()))
            await self._call_event_handler("on_connected")
        except Exception as e:  # noqa: BLE001
            self._websocket = None
            await self.push_error(error_msg=f"Unable to connect to Inworld STT: {e}", exception=e)

    async def _disconnect_websocket(self):
        try:
            if self._websocket:
                await self._websocket.close()
        except Exception as e:  # noqa: BLE001
            await self.push_error(error_msg=f"Error closing Inworld STT: {e}", exception=e)
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
                content = json.loads(message)
            except json.JSONDecodeError:
                logger.warning(f"{self}: non-JSON message ignored")
                continue
            if content.get("error"):
                await self.push_error(error_msg=f"Inworld STT error: {content['error']}")
                continue
            tr = (content.get("result") or {}).get("transcription")
            if not tr:
                continue
            text = (tr.get("transcript") or "").strip()
            if not text:
                continue
            if tr.get("isFinal"):
                await self.push_frame(TranscriptionFrame(text=text, user_id=self._user_id, timestamp=time_now_iso8601(), language=None, result=tr, finalized=True))
                await self._handle_transcription(text, is_final=True)
                await self.stop_processing_metrics()
            else:
                await self.push_frame(InterimTranscriptionFrame(text=text, user_id=self._user_id, timestamp=time_now_iso8601(), language=None, result=tr))
