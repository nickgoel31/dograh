"""Short audio samples so customers can hear a voice before choosing it. Made once per voice by the voice engine, then kept."""

import base64
import hashlib
import os
from pathlib import Path

import httpx

CACHE = Path(os.getenv("PRODUCT_SAMPLE_DIR", "/tmp/voice_samples"))
TEXT = {
    "hi": "नमस्ते, कॉल करने के लिए धन्यवाद। बताइए, मैं आपकी कैसे मदद कर सकती हूँ?",
    "en": "Hello, thanks for calling. How can I help you today?",
}


def sample_text(language_code: str) -> str:
    return TEXT.get((language_code or "en").split("-")[0].lower(), TEXT["en"])


async def make_swarvo(base_url: str | None, api_key: str, voice: str, transport=None) -> bytes | None:
    """WAV bytes of a swarvo-tts voice, kept on disk after the first time. The first call can be slow while the speech engine wakes up."""
    base = (base_url or os.getenv("SWARVO_TTS_BASE_URL", "")).strip().rstrip("/")
    text = sample_text("hi")
    path = CACHE / ("sw_" + hashlib.sha256(f"{voice}:{text}".encode()).hexdigest()[:24] + ".wav")
    if path.exists():
        return path.read_bytes()
    if not base:
        return None
    try:
        async with httpx.AsyncClient(timeout=180, transport=transport) as c:
            r = await c.post(f"{base}/v1/speak", headers={"Authorization": f"Bearer {api_key}"}, json={"text": text, "voice": voice, "lang": "hi", "mode": "chat"})
        audio = r.content if r.status_code == 200 else None
    except Exception:  # noqa: BLE001
        return None
    if audio:
        try:
            CACHE.mkdir(parents=True, exist_ok=True)
            path.write_bytes(audio)
        except OSError:
            pass
    return audio


async def make(api_key: str, voice: str, language_code: str, transport=None) -> bytes | None:
    """MP3 bytes for the voice, from disk if already made. None when the engine can't produce one."""
    path = CACHE / (hashlib.sha256(f"{voice}:{sample_text(language_code)}".encode()).hexdigest()[:24] + ".mp3")
    if path.exists():
        return path.read_bytes()
    try:
        async with httpx.AsyncClient(timeout=30, transport=transport) as c:
            r = await c.post("https://api.inworld.ai/tts/v1/voice", headers={"Authorization": f"Basic {api_key}"},
                             json={"text": sample_text(language_code), "voiceId": voice, "modelId": "inworld-tts-2", "audioConfig": {"audioEncoding": "MP3"}})
        audio = base64.b64decode(r.json()["audioContent"]) if r.status_code == 200 else None
    except Exception:  # noqa: BLE001
        return None
    if audio:
        try:
            CACHE.mkdir(parents=True, exist_ok=True)
            path.write_bytes(audio)
        except OSError:
            pass
    return audio
