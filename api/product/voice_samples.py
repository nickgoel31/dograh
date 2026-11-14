"""Short audio samples so customers can hear a voice before choosing it. Made once per voice by the voice engine, then kept."""

import base64
import hashlib
import json
import os
from pathlib import Path

import httpx

CACHE = Path(os.getenv("PRODUCT_SAMPLE_DIR", "/tmp/voice_samples"))
TEXT = {
    "hi": "नमस्ते, कॉल करने के लिए धन्यवाद। बताइए, मैं आपकी कैसे मदद कर सकती हूँ?",
    "en": "Hello, thanks for calling. How can I help you today?",
    "mr": "नमस्कार, कॉल केल्याबद्दल धन्यवाद. मी तुम्हाला कशी मदत करू शकते?",
    "gu": "નમસ્તે, કૉલ કરવા બદલ આભાર. હું તમને કેવી રીતે મદદ કરી શકું?",
    "ta": "வணக்கம், அழைத்ததற்கு நன்றி. நான் உங்களுக்கு எப்படி உதவ முடியும்?",
    "te": "నమస్కారం, కాల్ చేసినందుకు ధన్యవాదాలు. నేను మీకు ఎలా సహాయం చేయగలను?",
    "kn": "ನಮಸ್ಕಾರ, ಕರೆ ಮಾಡಿದ್ದಕ್ಕಾಗಿ ಧನ್ಯವಾದಗಳು. ನಾನು ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?",
    "ml": "നമസ്കാരം, വിളിച്ചതിന് നന്ദി. ഞാൻ നിങ്ങളെ എങ്ങനെ സഹായിക്കണം?",
    "bn": "নমস্কার, ফোন করার জন্য ধন্যবাদ। আমি কীভাবে আপনাকে সাহায্য করতে পারি?",
    "pa": "ਸਤ ਸ੍ਰੀ ਅਕਾਲ, ਕਾਲ ਕਰਨ ਲਈ ਧੰਨਵਾਦ। ਮੈਂ ਤੁਹਾਡੀ ਕਿਵੇਂ ਮਦਦ ਕਰ ਸਕਦੀ ਹਾਂ?",
    "or": "ନମସ୍କାର, କଲ୍ କରିଥିବାରୁ ଧନ୍ୟବାଦ। ମୁଁ ଆପଣଙ୍କୁ କିପରି ସାହାଯ୍ୟ କରିପାରିବି?",
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


async def make_murf(api_key: str, region: str, voice: str, locale: str) -> bytes | None:
    """WAV bytes of a Murf Falcon voice, kept on disk after the first time. Uses the same streaming socket as calls."""
    import io
    import wave

    import aiohttp

    from api.services.pipecat.murf_tts import stream_url

    text = sample_text(locale)
    path = CACHE / ("mu_" + hashlib.sha256(f"{voice}:{locale}:{text}".encode()).hexdigest()[:24] + ".wav")
    if path.exists():
        return path.read_bytes()
    pcm = bytearray()
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=40)) as s, s.ws_connect(stream_url(region, 24000), headers={"api_key": api_key}, max_msg_size=0) as ws:
            await ws.send_str(json.dumps({"voice_config": {"voice_id": voice, "locale": locale, "style": "Conversational"}, "context_id": "sample"}))
            await ws.send_str(json.dumps({"text": text, "end": True, "context_id": "sample"}))
            async for msg in ws:
                if msg.type != aiohttp.WSMsgType.TEXT:
                    break
                d = json.loads(msg.data)
                if d.get("audio"):
                    pcm.extend(base64.b64decode(d["audio"]))
                if d.get("error") and d.get("fatal"):
                    return None
                if d.get("final"):
                    break
    except Exception:  # noqa: BLE001
        return None
    if len(pcm) < 2000:
        return None
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(bytes(pcm[: len(pcm) // 2 * 2]))
    audio = buf.getvalue()
    try:
        CACHE.mkdir(parents=True, exist_ok=True)
        path.write_bytes(audio)
    except OSError:
        pass
    return audio
