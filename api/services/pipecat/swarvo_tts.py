"""swarvo-tts 2.5 as a voice provider for the live call pipeline.

The service streams audio over a WebSocket: connect to ``<base>/v1/stream``, send ONE JSON message (the key goes inside it as
``api_key``), then read raw 16-bit mono PCM frames at 24 kHz, followed by a JSON ``{"type": "end"}`` (or ``{"type": "error"}``).
One connection per sentence. The service scales to zero, so the first connection after a quiet period can take a minute or two;
the connect and first-audio waits are generous for that reason. Stopping a turn (a caller interrupting) just closes the socket.
"""

import json
import os
from collections.abc import AsyncGenerator, AsyncIterator
from dataclasses import dataclass

import aiohttp
from loguru import logger

from pipecat.frames.frames import ErrorFrame, Frame
from pipecat.services.settings import TTSSettings, assert_given
from pipecat.services.tts_service import TTSService
from pipecat.utils.tracing.service_decorators import traced_tts

SAMPLE_RATE = 24000
COLD_START_WAIT = 180  # seconds to wait for the first audio when the GPU container is starting


def stream_url(base_url: str) -> str:
    base = (base_url or "").strip().rstrip("/")
    if not base:
        raise ValueError("swarvo-tts needs its service address (SWARVO_TTS_BASE_URL)")
    return base.replace("https://", "wss://", 1).replace("http://", "ws://", 1) + "/v1/stream"


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
        super().__init__(push_start_frame=True, push_stop_frames=True, sample_rate=SAMPLE_RATE, settings=default_settings, **kwargs)
        self._api_key = api_key
        self._url = stream_url(base_url or os.getenv("SWARVO_TTS_BASE_URL", ""))
        self._speed = min(1.5, max(0.7, float(speed or 1.0)))
        self._mode = mode if mode in ("read", "chat") else "chat"

    def can_generate_metrics(self) -> bool:
        return True

    async def _audio(self, text: str) -> AsyncIterator[bytes]:
        voice = assert_given(self._settings.voice) or "Ritvik"
        lang = assert_given(self._settings.language) or "hi"
        body = {"api_key": self._api_key, "text": text, "voice": voice, "lang": str(lang).split("-")[0].lower(), "format": "pcm16", "speed": self._speed, "mode": self._mode}
        timeout = aiohttp.ClientTimeout(total=None, sock_connect=COLD_START_WAIT, sock_read=COLD_START_WAIT)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.ws_connect(self._url, heartbeat=20, max_msg_size=0) as ws:
                await ws.send_str(json.dumps(body))
                async for msg in ws:
                    if msg.type == aiohttp.WSMsgType.BINARY:
                        yield msg.data
                    elif msg.type == aiohttp.WSMsgType.TEXT:
                        info = json.loads(msg.data)
                        if info.get("type") == "end":
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
