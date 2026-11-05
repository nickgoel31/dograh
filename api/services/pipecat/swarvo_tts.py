"""swarvo-tts 2.5 as a voice provider for the live call pipeline.

The service streams audio over a WebSocket: connect to ``<base>/v1/stream``, send ONE JSON message (the key goes inside it as
``api_key``), then read raw 16-bit mono PCM frames at 24 kHz, followed by a JSON ``{"type": "end"}`` (or ``{"type": "error"}``).
One connection per sentence. The service scales to zero, so the first connection after a quiet period can take a minute or two;
the connect and first-audio waits are generous for that reason. Stopping a turn (a caller interrupting) just closes the socket.
"""

import asyncio
import json
import os
import time
from collections.abc import AsyncGenerator, AsyncIterator
from dataclasses import dataclass

import aiohttp
from loguru import logger

from pipecat.frames.frames import ErrorFrame, Frame
from pipecat.services.settings import TTSSettings, assert_given
from pipecat.services.tts_service import TTSService
from pipecat.utils.text.base_text_aggregator import Aggregation, AggregationType
from pipecat.utils.text.simple_text_aggregator import SimpleTextAggregator
from pipecat.utils.tracing.service_decorators import traced_tts

SAMPLE_RATE = 24000
COLD_START_WAIT = 180  # seconds to wait for the first audio when the GPU container is starting


def stream_url(base_url: str) -> str:
    base = (base_url or "").strip().rstrip("/")
    if not base:
        raise ValueError("swarvo-tts needs its service address (SWARVO_TTS_BASE_URL)")
    return base.replace("https://", "wss://", 1).replace("http://", "ws://", 1) + "/v1/stream"


FIRST_CHUNK_BREAKS = ",;:\u2014\u0964"  # comma, semicolon, colon, dash and the Hindi danda
FIRST_CHUNK_MIN_CHARS = 12


class FastStartAggregator(SimpleTextAggregator):
    """Sentence aggregation that lets the FIRST piece of each reply go out at the first natural pause (a comma, for example)
    instead of waiting for the whole first sentence. Waiting for a full sentence was the biggest delay before the voice started."""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self._first_sent = False

    async def aggregate(self, text: str):
        if self._aggregation_type == AggregationType.TOKEN:
            async for a in super().aggregate(text):
                yield a
            return
        for char in text:
            self._text += char
            if not self._first_sent and char in FIRST_CHUNK_BREAKS and len(self._text.strip()) >= FIRST_CHUNK_MIN_CHARS and len(self._text.split()) >= 2:
                piece, self._text, self._needs_lookahead, self._first_sent = self._text.strip(" "), "", False, True
                yield Aggregation(text=piece, type=AggregationType.SENTENCE)
                continue
            result = await self._check_sentence_with_lookahead(char)
            if result:
                self._first_sent = True
                yield result

    async def flush(self):
        out = await super().flush()
        self._first_sent = False  # the reply is over: the next one gets a fast start again
        return out

    async def handle_interruption(self):
        await super().handle_interruption()
        self._first_sent = False


@dataclass
class SwarvoTTSSettings(TTSSettings):
    """Settings for SwarvoTTSService. ``model`` is only a label; the service has one model."""

    pass


class SwarvoTTSService(TTSService):
    Settings = SwarvoTTSSettings
    _settings: Settings

    def __init__(self, *, api_key: str, base_url: str | None = None, speed: float = 1.0, mode: str = "chat", settings: Settings | None = None, **kwargs):
        default_settings = self.Settings(model="swarvo-tts-2.5", voice="Ritvik", language="hi")
        if settings is not None:
            default_settings.apply_update(settings)
        super().__init__(push_start_frame=True, push_stop_frames=True, settings=default_settings, **kwargs)
        self._text_aggregator = FastStartAggregator(aggregation_type=self._text_aggregation_mode)
        self._api_key = api_key
        self._url = stream_url(base_url or os.getenv("SWARVO_TTS_BASE_URL", ""))
        self._speed = min(1.5, max(0.7, float(speed or 1.0)))
        self._mode = mode if mode in ("read", "chat") else "chat"
        self._http: aiohttp.ClientSession | None = None
        self._warm_task: asyncio.Task | None = None

    def _session(self) -> aiohttp.ClientSession:
        if self._http is None or self._http.closed:
            self._http = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=None, sock_connect=COLD_START_WAIT, sock_read=COLD_START_WAIT))
        return self._http

    async def _warm(self):
        """The service sleeps when idle, and the first request after a quiet spell can take a minute or two. Wake it as the call starts."""
        t0 = time.monotonic()
        try:
            async with self._session().get(self._url.replace("wss://", "https://", 1).replace("ws://", "http://", 1).rsplit("/v1/stream", 1)[0] + "/health", timeout=aiohttp.ClientTimeout(total=COLD_START_WAIT)) as r:
                logger.info(f"swarvo-tts wake-up: HTTP {r.status} after {int((time.monotonic() - t0) * 1000)} ms")
        except Exception as e:  # noqa: BLE001 - only a courtesy call
            logger.warning(f"swarvo-tts wake-up failed after {int((time.monotonic() - t0) * 1000)} ms: {e}")

    async def start(self, frame):
        await super().start(frame)
        self._warm_task = asyncio.create_task(self._warm())

    async def _close(self):
        if self._warm_task and not self._warm_task.done():
            self._warm_task.cancel()
        if self._http and not self._http.closed:
            await self._http.close()

    async def stop(self, frame):
        await super().stop(frame)
        await self._close()

    async def cancel(self, frame):
        await super().cancel(frame)
        await self._close()

    def can_generate_metrics(self) -> bool:
        return True

    async def _audio(self, text: str) -> AsyncIterator[bytes]:
        voice = assert_given(self._settings.voice) or "Ritvik"
        lang = assert_given(self._settings.language) or "hi"
        body = {"api_key": self._api_key, "text": text, "voice": voice, "lang": str(lang).split("-")[0].lower(), "format": "pcm16", "speed": self._speed, "mode": self._mode}
        t0, first, total = time.monotonic(), None, 0
        async with self._session().ws_connect(self._url, heartbeat=20, max_msg_size=0) as ws:
            connected = time.monotonic() - t0
            await ws.send_str(json.dumps(body))
            async for msg in ws:
                if msg.type == aiohttp.WSMsgType.BINARY:
                    if first is None:
                        first = time.monotonic() - t0
                    total += len(msg.data)
                    yield msg.data
                elif msg.type == aiohttp.WSMsgType.TEXT:
                    info = json.loads(msg.data)
                    if info.get("type") == "end":
                        logger.info(f"swarvo-tts: {len(text)} chars, connect {int(connected * 1000)} ms, first audio {int((first or 0) * 1000)} ms, "
                                    f"{total / (2 * SAMPLE_RATE):.1f}s of audio, service says first audio {info.get('server_first_audio_ms')} ms, total {int((time.monotonic() - t0) * 1000)} ms")
                        return
                    if info.get("type") == "error":
                        raise RuntimeError(f"swarvo-tts error {info.get('code')}: {info.get('message')}")
                elif msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.CLOSING, aiohttp.WSMsgType.ERROR):
                    return

    @traced_tts
    async def run_tts(self, text: str, context_id: str) -> AsyncGenerator[Frame, None]:
        logger.debug(f"{self}: swarvo-tts [{text}]")
        try:
            await self.start_tts_usage_metrics(text)
            async for frame in self._stream_audio_frames_from_iterator(self._audio(text), in_sample_rate=SAMPLE_RATE, context_id=context_id):
                await self.stop_ttfb_metrics()
                yield frame
        except Exception as e:  # noqa: BLE001 - a failed sentence must not end the call
            logger.error(f"{self} exception: {e}")
            yield ErrorFrame(error=f"swarvo-tts failed: {e}")
        finally:
            await self.stop_ttfb_metrics()
