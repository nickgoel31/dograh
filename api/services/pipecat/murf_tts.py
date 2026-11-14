"""Murf Falcon 2.1 as a voice provider for the live call pipeline.

One WebSocket is kept open for the whole call (Murf recommends this: it saves the DNS, TCP and TLS set-up on every sentence). Each piece of
text is its own *context*: we send the voice settings and the text with ``end: true`` and read audio until Murf says ``final``. Audio is
requested as headerless 16-bit PCM at the call's own sample rate when Murf offers it (8, 24, 44.1 or 48 kHz); other rates are converted once, as a stream.

Murf allows few speaking-at-once contexts (5 on us-east, 2 elsewhere), so pieces of one call are spoken strictly one after another. The socket closes
after 3 minutes without use; it is simply opened again the next time something is said.
"""

from __future__ import annotations

import asyncio
import base64
import json
import time
from collections.abc import AsyncGenerator
from dataclasses import dataclass

import aiohttp
from loguru import logger

from api.services.configuration.options.murf import MURF_SAMPLE_RATES
from pipecat.frames.frames import ErrorFrame, Frame, TTSAudioRawFrame
from pipecat.services.settings import TTSSettings, assert_given
from pipecat.services.tts_service import TTSService
from pipecat.utils.tracing.service_decorators import traced_tts

DEFAULT_RATE = 24000
CONNECT_TIMEOUT = 15
FIRST_AUDIO_TIMEOUT = 30


def stream_host(region: str) -> str:
    region = (region or "in").strip().lower()
    return "global.api.murf.ai" if region == "global" else f"{region}.api.murf.ai"


def stream_url(region: str, sample_rate: int) -> str:
    # The key goes in a header, not in the address, so it never shows up in logs.
    return f"wss://{stream_host(region)}/v1/speech/stream-input?model=falcon-2.1&sample_rate={sample_rate}&channel_type=MONO&format=PCM"


def murf_rate_for(call_rate: int) -> int:
    """Murf's own sample rate for a call at this rate: the same when Murf offers it, else 24 kHz (then converted)."""
    return call_rate if call_rate in MURF_SAMPLE_RATES else DEFAULT_RATE


def voice_config(voice: str, locale: str, rate: int, pitch: int, volume_offset: int) -> dict:
    cfg: dict = {"voice_id": voice, "style": "Conversational"}
    if locale:
        cfg["locale"] = locale
    if rate:
        cfg["rate"] = int(rate)
    if pitch:
        cfg["pitch"] = int(pitch)
    if volume_offset:
        cfg["volume_offset"] = int(volume_offset)
    return cfg


@dataclass
class MurfTTSSettings(TTSSettings):
    """``model`` is falcon-2.1, ``voice`` a Murf voice name, ``language`` a locale such as hi-IN."""

    pass


class MurfTTSService(TTSService):
    Settings = MurfTTSSettings
    _settings: Settings

    def __init__(self, *, api_key: str, region: str = "in", rate: int = 0, pitch: int = 0, volume_offset: int = 0, settings: Settings | None = None, **kwargs):
        default_settings = self.Settings(model="falcon-2.1", voice="Aarav", language="hi-IN")
        if settings is not None:
            default_settings.apply_update(settings)
        super().__init__(push_start_frame=True, push_stop_frames=True, settings=default_settings, **kwargs)
        self._api_key = api_key
        self._region = region or "in"
        self._rate, self._pitch, self._volume = rate, pitch, volume_offset
        self._http: aiohttp.ClientSession | None = None
        self._ws: aiohttp.ClientWebSocketResponse | None = None
        self._ws_rate = DEFAULT_RATE
        self._lock = asyncio.Lock()  # one spoken piece at a time on this call
        self._warm_task: asyncio.Task | None = None
        self._count = 0

    # ---- connection -------------------------------------------------------------------------------------------------------------
    def _session(self) -> aiohttp.ClientSession:
        if self._http is None or self._http.closed:
            self._http = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=None, sock_connect=CONNECT_TIMEOUT, sock_read=None))
        return self._http

    async def _connect(self) -> aiohttp.ClientWebSocketResponse:
        if self._ws is not None and not self._ws.closed:
            return self._ws
        rate = murf_rate_for(self.sample_rate or DEFAULT_RATE)
        t0 = time.monotonic()
        self._ws = await self._session().ws_connect(stream_url(self._region, rate), headers={"api_key": self._api_key}, max_msg_size=0)
        self._ws_rate = rate
        logger.info(f"murf-tts connected ({stream_host(self._region)}, {rate} Hz) in {int((time.monotonic() - t0) * 1000)} ms")
        return self._ws

    async def _drop(self):
        ws, self._ws = self._ws, None
        if ws is not None and not ws.closed:
            await ws.close()

    async def _close(self):
        if self._warm_task and not self._warm_task.done():
            self._warm_task.cancel()
        await self._drop()
        if self._http and not self._http.closed:
            await self._http.close()

    async def start(self, frame):
        await super().start(frame)
        # Open the socket as the call is set up, so the greeting does not wait for it.
        self._warm_task = asyncio.create_task(self._warm())

    async def _warm(self):
        try:
            async with self._lock:
                await self._connect()
        except Exception as e:  # noqa: BLE001 - only a head start; the first sentence connects again
            logger.warning(f"murf-tts early connect failed: {e}")

    async def stop(self, frame):
        await super().stop(frame)
        await self._close()

    async def cancel(self, frame):
        await super().cancel(frame)
        await self._close()

    def can_generate_metrics(self) -> bool:
        return True

    # ---- speaking ---------------------------------------------------------------------------------------------------------------
    @traced_tts
    async def run_tts(self, text: str, context_id: str) -> AsyncGenerator[Frame, None]:
        logger.debug(f"{self}: murf-tts [{text}]")
        voice = assert_given(self._settings.voice) or "Aarav"
        locale = assert_given(self._settings.language) or "hi-IN"
        out_rate = self.sample_rate or DEFAULT_RATE
        self._count += 1
        n, t0, first = self._count, time.monotonic(), None
        ctx = f"c{n}-{context_id}"[:60]
        stream = None
        leftover = b""
        try:
            await self.start_tts_usage_metrics(text)
            async with self._lock:
                ws = await self._connect()
                if self._ws_rate != out_rate:  # not a rate Murf offers: convert the stream once, with a running converter
                    import soxr

                    stream = soxr.ResampleStream(self._ws_rate, out_rate, 1, dtype="int16", quality="HQ")
                await ws.send_str(json.dumps({"voice_config": voice_config(voice, locale, self._rate, self._pitch, self._volume), "context_id": ctx}))
                await ws.send_str(json.dumps({"text": text, "end": True, "context_id": ctx}))
                try:
                    while True:
                        msg = await asyncio.wait_for(ws.receive(), timeout=FIRST_AUDIO_TIMEOUT)
                        if msg.type == aiohttp.WSMsgType.TEXT:
                            data = json.loads(msg.data)
                            if data.get("context_id") not in (None, ctx):
                                continue  # a leftover from an earlier, interrupted piece
                            if data.get("audio"):
                                pcm = leftover + base64.b64decode(data["audio"])
                                keep = len(pcm) % 2
                                pcm, leftover = (pcm[: len(pcm) - keep], pcm[len(pcm) - keep :]) if keep else (pcm, b"")
                                if stream is not None and pcm:
                                    import numpy as np

                                    pcm = stream.resample_chunk(np.frombuffer(pcm, dtype="<i2")).astype("<i2").tobytes()
                                if pcm:
                                    if first is None:
                                        first = time.monotonic() - t0
                                        await self.stop_ttfb_metrics()
                                    yield TTSAudioRawFrame(pcm, out_rate, 1, context_id=context_id)
                            if data.get("warning"):
                                logger.warning(f"murf-tts warning {data.get('warning_code')}: {data.get('warning')}")
                            if data.get("error"):
                                logger.error(f"murf-tts error {data.get('error_code')}: {data.get('error')}")
                                if data.get("fatal") or data.get("error_code") == "ACTIVE_CONTEXT_LIMIT_EXCEEDED":
                                    await self._drop()
                                    yield ErrorFrame(error=f"murf-tts failed: {data.get('error_code')}")
                                    return
                            if data.get("final"):
                                break
                        elif msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSING, aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                            code = getattr(ws, "close_code", None)
                            await self._drop()
                            hint = " (the key was not accepted)" if code == 1008 else " (too many voices speaking at once for this key)" if code == 4029 else ""
                            yield ErrorFrame(error=f"murf-tts connection closed{hint}")
                            return
                except asyncio.CancelledError:
                    # The caller interrupted: tell Murf to drop this piece, or its slot stays busy until it finishes.
                    try:
                        await ws.send_str(json.dumps({"clear": True, "context_id": ctx}))
                    except Exception:  # noqa: BLE001
                        await self._drop()
                    raise
                if stream is not None:
                    import numpy as np

                    tail = stream.resample_chunk(np.zeros(0, dtype="<i2"), last=True)
                    if len(tail):
                        yield TTSAudioRawFrame(tail.astype("<i2").tobytes(), out_rate, 1, context_id=context_id)
            logger.info(f"murf-tts #{n} done: {len(text)} chars, first audio {int((first or 0) * 1000)} ms, total {int((time.monotonic() - t0) * 1000)} ms")
        except asyncio.TimeoutError:
            await self._drop()
            yield ErrorFrame(error="murf-tts did not answer in time")
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001 - a failed sentence must not end the call
            logger.error(f"{self} exception: {e}")
            await self._drop()
            yield ErrorFrame(error=f"murf-tts failed: {e}")
        finally:
            await self.stop_ttfb_metrics()
