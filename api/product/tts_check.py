"""Check what swarvo-tts sends over its streaming connection, compared with the same text sent in one go.

    sudo docker exec dograh-api-1 python -m api.product.tts_check

Uses the key and address already saved in the 'swarvo' profile (nothing to paste). For a short Hindi sentence it asks the
service for the audio both ways (and in both "read" and "chat" modes) and prints, for each: how many seconds of audio came
back, what the service says it made, and an "echo score": how much of the sound repeats itself 40-400 ms later. A clean
voice scores clearly lower than the same voice doubled on top of itself. What to look at: the stream and the one-go version of the
same text should have about the same length and about the same echo score. Nothing is saved or played.
"""

import asyncio
import io
import json
import sys
import wave

import aiohttp
import numpy as np

TEXT = "नमस्ते, मैं आपकी कैसे मदद कर सकती हूँ? आप बताइए, आपको किस चीज़ की जानकारी चाहिए?"
SR = 24000


def echo_score(pcm: np.ndarray, sr: int = SR) -> float:
    """Largest normalised self-similarity at delays of 40-400 ms (0 = none, 1 = an exact copy a moment later)."""
    x = pcm.astype(np.float64)
    if len(x) < sr // 2 or not np.any(x):
        return 0.0
    x = x - x.mean()
    n = 1 << (len(x) * 2 - 1).bit_length()
    f = np.fft.rfft(x, n)
    ac = np.fft.irfft(f * np.conj(f), n)[: len(x)]
    ac = ac / ac[0]
    lo, hi = int(0.04 * sr), min(int(0.4 * sr), len(ac) - 1)
    return float(np.max(ac[lo:hi])) if hi > lo else 0.0


def wav_to_pcm(data: bytes) -> tuple[np.ndarray, int]:
    with wave.open(io.BytesIO(data)) as w:
        return np.frombuffer(w.readframes(w.getnframes()), dtype="<i2"), w.getframerate()


async def one(base: str, key: str, mode: str) -> dict:
    out = {"mode": mode}
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=240)) as s:
        async with s.post(f"{base}/v1/speak", headers={"Authorization": f"Bearer {key}"}, json={"text": TEXT, "voice": "Ritvik", "lang": "hi", "mode": mode}) as r:
            body = await r.read()
            if r.status != 200:
                return {**out, "error": f"speak {r.status}: {body[:150]!r}"}
            pcm, sr = wav_to_pcm(body)
            out["speak"] = {"seconds": round(len(pcm) / sr, 2), "service_says": r.headers.get("X-Audio-Seconds"), "echo": round(echo_score(pcm, sr), 3)}
        ws_url = base.replace("https://", "wss://", 1).replace("http://", "ws://", 1) + "/v1/stream"
        async with s.ws_connect(ws_url, max_msg_size=0) as ws:
            await ws.send_str(json.dumps({"api_key": key, "text": TEXT, "voice": "Ritvik", "lang": "hi", "format": "pcm16", "mode": mode}))
            chunks, end = [], {}
            async for m in ws:
                if m.type == aiohttp.WSMsgType.BINARY:
                    chunks.append(m.data)
                elif m.type == aiohttp.WSMsgType.TEXT:
                    info = json.loads(m.data)
                    if info.get("type") in ("end", "error"):
                        end = info
                        break
            raw = b"".join(chunks)
            pcm = np.frombuffer(raw[: len(raw) // 2 * 2], dtype="<i2")
            out["stream"] = {"seconds": round(len(pcm) / SR, 2), "frames": len(chunks), "service_says": end.get("audio_seconds"), "echo": round(echo_score(pcm), 3)}
    return out


async def main() -> int:
    from sqlalchemy import select  # noqa: F401

    from api.db import db_client

    prof = next((p for p in await db_client.list_model_profiles() if p.slug == "swarvo"), None)
    tts = ((prof.config or {}).get("tts") or {}) if prof else {}
    if not tts.get("api_key") or not tts.get("base_url"):
        print("No swarvo profile with a key and address yet. Run setup_voices.sh first.")
        return 1
    base = tts["base_url"].rstrip("/")
    print(f"Asking {len(TEXT)} characters of Hindi, voice Ritvik. The first call may take a minute if the service is asleep.\n")
    for mode in ("read", "chat"):
        r = await one(base, tts["api_key"], mode)
        print(f"mode={mode}")
        if "error" in r:
            print("  ", r["error"])
            continue
        for k in ("speak", "stream"):
            print(f"   {k:6} {r[k]}")
        ratio = r["stream"]["seconds"] / r["speak"]["seconds"] if r["speak"]["seconds"] else 0
        print(f"   stream/speak length ratio: {ratio:.2f}  (about 1.0 is right; near 2.0 means the stream repeats its audio)\n")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
