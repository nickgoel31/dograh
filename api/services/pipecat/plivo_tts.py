"""Plivo Koyal as a voice provider for the live call pipeline.

One WebSocket stays open for the whole call. Each piece of text is its own *context*: the first (and only) ``text`` message carries the voice and
options with ``finish: true``, and audio frames come back until Plivo sends ``done``. Audio is requested as 16-bit PCM at the call's own sample rate
when Plivo offers it (8, 16 or 24 kHz); any other rate is converted once, as a stream.

Audio arrives as binary frames: a 2-byte little-endian length, that many bytes of context id, then the audio. Pieces of one call are spoken strictly
one after another, so a reply that is interrupted is cancelled and its late frames are ignored by context id.
"""

from __future__ import annotations

import asyncio
import base64
import json
import struct
import time
from collections.abc import AsyncGenerator
from dataclasses import dataclass

import aiohttp
from loguru import logger

from api.services.configuration.options.plivo import PLIVO_SAMPLE_RATES
from pipecat.frames.frames import ErrorFrame, Frame, TTSAudioRawFrame
from pipecat.services.settings import TTSSettings, assert_given
from pipecat.services.tts_service import TTSService
from pipecat.utils.tracing.service_decorators import traced_tts

DEFAULT_RATE = 24000
CONNECT_TIMEOUT = 15
FIRST_AUDIO_TIMEOUT = 30
MAX_CHARS = 5000  # Plivo's limit for one text message


def realtime_url(auth_id: str) -> str:
    return f"wss://api.plivo.com/v1/Account/{auth_id}/TTS/Realtime/"


def batch_url(auth_id: str) -> str:
    return f"https://api.plivo.com/v1/Account/{auth_id}/TTS/"


def auth_header(auth_id: str, token: str) -> dict:
    # Plivo uses HTTP Basic (Auth ID and Auth Token); the credentials go in a header, never in the address, so they stay out of logs.
    return {"Authorization": "Basic " + base64.b64encode(f"{auth_id}:{token}".encode()).decode()}


def plivo_rate_for(call_rate: int) -> int:
    """Plivo's own sample rate for a call at this rate: the same when Plivo offers it, else 24 kHz (then converted)."""
    return call_rate if call_rate in PLIVO_SAMPLE_RATES else DEFAULT_RATE


def text_message(ctx: str, voice: str, text: str, language: str, rate: int, pace: float, volume: float) -> dict:
    msg: dict = {
        "type": "text", "context_id": ctx, "voice_id": voice, "text": text[:MAX_CHARS], "finish": True,
        "output_format": {"container": "raw", "encoding": "pcm_s16le", "sample_rate": rate},
    }
    if language:
        msg["language"] = language
    if pace and abs(pace - 1.0) > 1e-6:
        msg["pace"] = pace
    if volume and abs(volume - 1.0) > 1e-6:
        msg["volume"] = volume
    return msg


def parse_audio_frame(data: bytes) -> tuple[str, bytes] | None:
    """(context id, audio) from a binary frame, or None when it is too short to be one."""
    if len(data) < 2:
        return None
    (n,) = struct.unpack_from("<H", data, 0)
    if len(data) < 2 + n:
        return None
    return data[2 : 2 + n].decode("utf-8", errors="replace"), data[2 + n :]


@dataclass
class PlivoTTSSettings(TTSSettings):
    """``model`` is koyal, ``voice`` a Plivo voice id, ``language`` a code such as hi or en-IN."""

    pass


class PlivoKoyalTTSService(TTSService):
    Settings = PlivoTTSSettings
    _settings: Settings

    def __init__(self, *, auth_id: str, api_key: str, pace: float = 1.0, volume: float = 1.0, settings: Settings | None = None, **kwargs):
        default_settings = self.Settings(model="koyal", voice="vGOW5Fzss7kzS9IxCObo", language="en-IN")
        if settings is not None:
            default_settings.apply_update(settings)
        super().__init__(push_start_frame=True, push_stop_frames=True, settings=default_settings, **kwargs)
        self._auth_id, self._token = auth_id, api_key
        self._pace, self._volume = pace, volume
        self._http: aiohttp.ClientSession | None = None
        self._ws: aiohttp.ClientWebSocketResponse | None = None
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
        t0 = time.monotonic()
        self._ws = await self._session().ws_connect(realtime_url(self._auth_id), headers=auth_header(self._auth_id, self._token), max_msg_size=0)
        logger.info(f"plivo-koyal connected in {int((time.monotonic() - t0) * 1000)} ms")
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
        self._warm_task = asyncio.create_task(self._warm())  # open the socket as the call is set up, so the greeting does not wait for it

    async def _warm(self):
        try:
            async with self._lock:
                await self._connect()
        except Exception as e:  # noqa: BLE001 - only a head start; the first sentence connects again
            logger.warning(f"plivo-koyal early connect failed: {e}")

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
        logger.debug(f"{self}: plivo-koyal [{text}]")
        voice = assert_given(self._settings.voice) or "vGOW5Fzss7kzS9IxCObo"
        language = assert_given(self._settings.language) or ""
        out_rate = self.sample_rate or DEFAULT_RATE
        rate = plivo_rate_for(out_rate)
        self._count += 1
        n, t0, first = self._count, time.monotonic(), None
        ctx = f"c{n}-{context_id}"[:60]
        stream = None
        leftover = b""
        try:
            await self.start_tts_usage_metrics(text)
            async with self._lock:
                ws = await self._connect()
                if rate != out_rate:  # not a rate Plivo offers: convert the stream once, with a running converter
                    import soxr

                    stream = soxr.ResampleStream(rate, out_rate, 1, dtype="int16", quality="HQ")
                await ws.send_str(json.dumps(text_message(ctx, voice, text, language, rate, self._pace, self._volume)))
                try:
                    while True:
                        msg = await asyncio.wait_for(ws.receive(), timeout=FIRST_AUDIO_TIMEOUT)
                        if msg.type == aiohttp.WSMsgType.BINARY:
                            frame = parse_audio_frame(msg.data)
                            if frame is None or frame[0] != ctx:
                                continue  # a leftover from an earlier, cancelled piece
                            pcm = leftover + frame[1]
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
                        elif msg.type == aiohttp.WSMsgType.TEXT:
                            data = json.loads(msg.data)
                            kind = data.get("type")
                            if data.get("context_id") not in (None, ctx):
                                continue
                            if kind == "warning":
                                logger.warning(f"plivo-koyal warning: {data}")
                            elif kind == "error":
                                logger.error(f"plivo-koyal error {data.get('code')}: {data.get('message')}")
                                yield ErrorFrame(error=f"plivo-koyal failed: {data.get('code') or data.get('message')}")
                                return
                            elif kind == "done":
                                break
                        elif msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSING, aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                            code = getattr(ws, "close_code", None)
                            await self._drop()
                            hint = " (the credentials were not accepted)" if code == 1008 else " (try again)" if code == 1013 else ""
                            yield ErrorFrame(error=f"plivo-koyal connection closed{hint}")
                            return
                except asyncio.CancelledError:
                    # The caller interrupted: cancel this reply so Plivo stops generating and billing for it.
                    try:
                        await ws.send_str(json.dumps({"type": "cancel", "context_id": ctx}))
                    except Exception:  # noqa: BLE001
                        await self._drop()
                    raise
                if stream is not None:
                    import numpy as np

                    tail = stream.resample_chunk(np.zeros(0, dtype="<i2"), last=True)
                    if len(tail):
                        yield TTSAudioRawFrame(tail.astype("<i2").tobytes(), out_rate, 1, context_id=context_id)
            logger.info(f"plivo-koyal #{n} done: {len(text)} chars, first audio {int((first or 0) * 1000)} ms, total {int((time.monotonic() - t0) * 1000)} ms")
        except asyncio.TimeoutError:
            await self._drop()
            yield ErrorFrame(error="plivo-koyal did not answer in time")
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001 - a failed sentence must not end the call
            logger.error(f"{self} exception: {e}")
            await self._drop()
            yield ErrorFrame(error=f"plivo-koyal failed: {e}")
        finally:
            await self.stop_ttfb_metrics()
