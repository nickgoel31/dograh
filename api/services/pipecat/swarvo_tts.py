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

from pipecat.frames.frames import ErrorFrame, Frame, TTSAudioRawFrame
from pipecat.services.settings import TTSSettings, assert_given
from pipecat.services.tts_service import TTSService
from pipecat.utils.tracing.service_decorators import traced_tts

SAMPLE_RATE = 24000
# SWARVO_TTS_PACE_LEAD=1.5 hands audio to the call at normal playback speed (keeping that many seconds of head start), the way a streaming voice
# does, instead of all of a sentence at once. 0 (the default) keeps the old "everything at once" behaviour.
try:
    PACE_LEAD = float(os.getenv("SWARVO_TTS_PACE_LEAD", "0") or 0)
except ValueError:
    PACE_LEAD = 0.0
PREOPEN = os.getenv("SWARVO_TTS_PREOPEN", "0") == "1"  # keeps one idle connection open per call; it may count towards the key's simultaneous-streams limit
COLD_START_WAIT = 180  # seconds to wait for the first audio when the GPU container is starting


def stream_url(base_url: str) -> str:
    base = (base_url or "").strip().rstrip("/")
    if not base:
        raise ValueError("swarvo-tts needs its service address (SWARVO_TTS_BASE_URL)")
    return base.replace("https://", "wss://", 1).replace("http://", "ws://", 1) + "/v1/stream"


def resample_once(pcm: bytes, from_rate: int, to_rate: int) -> bytes:
    """Convert 16-bit mono audio to another sample rate in one go (no running state between pieces)."""
    pcm = pcm[: len(pcm) // 2 * 2]
    if from_rate == to_rate or not pcm:
        return pcm
    import numpy as np
    import soxr

    return soxr.resample(np.frombuffer(pcm, dtype="<i2"), from_rate, to_rate, quality="VHQ").astype("<i2").tobytes()


def _score(pcm: bytes, rate: int) -> float:
    """How much of the sound repeats itself 40-400 ms later (see tts_check). Never raises: this is only for the log."""
    try:
        import numpy as np

        from api.product.tts_check import echo_score

        return echo_score(np.frombuffer(pcm[: len(pcm) // 2 * 2], dtype="<i2"), rate)
    except Exception:  # noqa: BLE001
        return 0.0


@dataclass
class SwarvoTTSSettings(TTSSettings):
    """Settings for SwarvoTTSService. ``model`` is only a label; the service has one model."""

    pass


class SwarvoTTSService(TTSService):
    Settings = SwarvoTTSSettings
    _settings: Settings

    def __init__(self, *, api_key: str, base_url: str | None = None, speed: float = 1.0, mode: str = "chat", chat_level: str = "normal", settings: Settings | None = None, **kwargs):
        default_settings = self.Settings(model="swarvo-tts-2.5", voice="Ritvik", language="hi")
        if settings is not None:
            default_settings.apply_update(settings)
        super().__init__(push_start_frame=True, push_stop_frames=True, settings=default_settings, **kwargs)
        self._api_key = api_key
        self._url = stream_url(base_url or os.getenv("SWARVO_TTS_BASE_URL", ""))
        self._speed = min(1.5, max(0.7, float(speed or 1.0)))
        self._mode = mode if mode in ("read", "chat") else "chat"
        self._chat_level = chat_level if chat_level in ("light", "normal", "heavy") else "normal"
        self._http: aiohttp.ClientSession | None = None
        self._warm_task: asyncio.Task | None = None
        self._spare: asyncio.Task | None = None  # next sentence's connection, opened while the current one plays (SWARVO_TTS_PREOPEN=1)
        try:  # connect to the service as soon as the call is being set up, so the first sentence (the greeting) does not wait for the connection
            asyncio.get_running_loop()
            self._spare = asyncio.create_task(self._open())
        except RuntimeError:  # no running loop (only in tests that build the service outside one)
            pass
        self._inflight = 0  # sentences being generated right now: more than 1 means two are overlapping
        self._count = 0

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
        if PREOPEN and self._spare is None:
            self._spare = asyncio.create_task(self._open())

    async def _close(self):
        if self._warm_task and not self._warm_task.done():
            self._warm_task.cancel()
        if self._spare is not None:
            self._spare.cancel()
            self._spare = None
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
        body = {"api_key": self._api_key, "text": text, "voice": voice, "lang": str(lang).split("-")[0].lower(), "format": "pcm16", "mode": self._mode}
        if self._mode == "chat" and self._chat_level != "normal":  # normal is the service's own default; read mode adds no fillers, so the level would do nothing
            body["chat_level"] = self._chat_level
        # Speed is NEVER sent for swarvo-tts. The service changes any speed other than 1.0 with signal processing, which smeared the voice (echo) and made it
        # wait for the whole sentence before sending anything (slow). Normal speed keeps true streaming and the cleanest voice.
        self._inflight += 1
        self._count += 1
        n, t0 = self._count, time.monotonic()
        logger.info(f"swarvo-tts #{n} start (in flight: {self._inflight}, voice {body.get('voice')}, speed not sent, mode {body.get('mode')}, chat level {body.get('chat_level', 'normal')}): {text[:40]!r}")
        try:
            async for chunk in self._stream(body, text, n, t0):
                yield chunk
        finally:
            self._inflight -= 1

    async def _open(self):
        return await self._session().ws_connect(self._url, heartbeat=20, max_msg_size=0)

    async def _connection(self):
        """A connection for the next sentence: the spare one opened earlier if there is one, else a new one."""
        ws = None
        if self._spare is not None:
            task, self._spare = self._spare, None
            try:
                ws = await task
                if ws.closed:
                    ws = None
            except Exception:  # noqa: BLE001 - the spare never worked: open a fresh one below
                ws = None
        if ws is None:
            ws = await self._open()
        if PREOPEN:  # open the one for the sentence after this while this one plays
            self._spare = asyncio.create_task(self._open())
        return ws

    async def _stream(self, body: dict, text: str, n: int, t0: float) -> AsyncIterator[bytes]:
        first, total, raw = None, 0, bytearray()
        ws = await self._connection()
        async with ws:
            connected = time.monotonic() - t0
            await ws.send_str(json.dumps(body))
            async for msg in ws:
                if msg.type == aiohttp.WSMsgType.BINARY:
                    if first is None:
                        first = time.monotonic() - t0
                    total += len(msg.data)
                    raw.extend(msg.data)
                    yield msg.data
                elif msg.type == aiohttp.WSMsgType.TEXT:
                    info = json.loads(msg.data)
                    if info.get("type") == "end":
                        self._raw_score = _score(bytes(raw), SAMPLE_RATE)
                        logger.info(f"swarvo-tts #{n} done: {len(text)} chars, connect {int(connected * 1000)} ms, time to first audio {int((first or 0) * 1000)} ms from the request start ({int(((first or 0) - connected) * 1000)} ms after sending the text), "
                                    f"{total / (2 * SAMPLE_RATE):.1f}s of audio, service says first audio {info.get('server_first_audio_ms')} ms, total {int((time.monotonic() - t0) * 1000)} ms")
                        return
                    if info.get("type") == "error":
                        raise RuntimeError(f"swarvo-tts error {info.get('code')}: {info.get('message')}")
                elif msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.CLOSING, aiohttp.WSMsgType.ERROR):
                    return

    @traced_tts
    async def run_tts(self, text: str, context_id: str) -> AsyncGenerator[Frame, None]:
        logger.debug(f"{self}: swarvo-tts [{text}]")
        emitted, frames, n, started, first_frame = bytearray(), 0, self._count + 1, time.monotonic(), None
        try:
            await self.start_tts_usage_metrics(text)
            # The service hands over a sentence's audio in one lump, so take all of it and convert it ONCE to the call's rate, in a single
            # pass, then pass it on in small pieces. (Converting piece by piece with a running converter was the suspect for the doubled voice.)
            raw = bytearray()
            async for chunk in self._audio(text):
                raw.extend(chunk)
            rate = self.sample_rate or SAMPLE_RATE
            audio = resample_once(bytes(raw), SAMPLE_RATE, rate)
            step = max(2, (rate // 10) * 2)  # 100 ms pieces
            t_first = time.monotonic()
            for i in range(0, len(audio), step):
                if PACE_LEAD > 0:  # wait until this piece is due: its start time in the audio, minus the head start
                    wait = i / (2 * rate) - PACE_LEAD - (time.monotonic() - t_first)
                    if wait > 0:
                        await asyncio.sleep(wait)
                await self.stop_ttfb_metrics()
                if first_frame is None:
                    first_frame = time.monotonic() - started
                piece = audio[i : i + step]
                emitted.extend(piece)
                frames += 1
                yield TTSAudioRawFrame(piece, rate, 1, context_id=context_id)
        except Exception as e:  # noqa: BLE001 - a failed sentence must not end the call
            logger.error(f"{self} exception: {e}")
            yield ErrorFrame(error=f"swarvo-tts failed: {e}")
        finally:
            await self.stop_ttfb_metrics()
            if emitted and self.sample_rate:  # what leaves this component towards the call: the same sentence at the call's rate
                logger.info(f"swarvo-tts #{n} handed on {len(emitted) / (2 * self.sample_rate):.1f}s of audio at {self.sample_rate} Hz in {frames} frames, first audio handed on after {int((first_frame or 0) * 1000)} ms, "
                            f"echo score {_score(bytes(emitted), self.sample_rate):.3f} (as received from the service: {getattr(self, '_raw_score', 0.0):.3f})")
