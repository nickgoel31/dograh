"""A fake Tata Smartflo, to test the Swarvo side without a Smartflo account.

    pip install websockets aiohttp
    python scripts/smartflo_fake.py --endpoint https://app.swarvoai.com/api/v1/telephony/smartflo/dynamic/<KEY> --to +918000000001 [--from +919800000001] [--wav speech_8k_mono.wav] [--seconds 25]

It does what Smartflo does for an inbound call, following Smartflo's published streaming spec:
  1. posts the call (callId, fromNumber, toNumber, status) to the dynamic endpoint and checks the answer is {"success": true, "wss_url": ...} within 2 seconds;
  2. opens the wss_url, sends `connected`, then `start` (mu-law, 8000 Hz), then `media` every 100 ms (your WAV, or silence);
  3. prints everything the agent sends back (`media`, `mark`, `clear`), checks each audio message is a whole number of 160-byte frames, saves the agent's speech to reply.wav;
  4. sends `stop`.
The number must be a Smartflo number brought in on the Phone Numbers page, with an agent assigned. Outbound calls are not simulated (they need a waiting call).
"""

import argparse
import asyncio
import base64
import json
import time
import wave

import aiohttp
import websockets

try:
    import audioop  # removed in Python 3.13; without it the fake streams silence and cannot save the reply as a WAV
except ImportError:  # pragma: no cover
    audioop = None

RATE = 8000
FRAME = 800  # 100 ms of 8 kHz mu-law, what Smartflo sends


def mulaw_from_wav(path: str) -> bytes:
    with wave.open(path, "rb") as w:
        assert w.getframerate() == RATE and w.getnchannels() == 1 and w.getsampwidth() == 2, "the WAV must be 8 kHz, 16-bit, mono"
        pcm = w.readframes(w.getnframes())
    assert audioop, "audioop is needed to read a WAV (use Python 3.12 or older)"
    return audioop.lin2ulaw(pcm, 2)


async def main(a) -> None:
    mic = mulaw_from_wav(a.wav) if a.wav else b"\xff" * (FRAME * 10 * a.seconds)  # \xff is mu-law silence
    call_id = f"c-{int(time.time())}"
    t0 = time.monotonic()
    async with aiohttp.ClientSession() as s:
        async with s.post(a.endpoint, json={"callId": call_id, "fromNumber": a.sender, "toNumber": a.to, "status": "ringing"}, timeout=aiohttp.ClientTimeout(total=10)) as r:
            body, took = await r.json(content_type=None), time.monotonic() - t0
            print(f"dynamic endpoint: HTTP {r.status} in {took * 1000:.0f} ms (Smartflo needs < 2000): {body if r.status != 200 else 'wss_url received'}")
            if r.status != 200 or set(body) != {"success", "wss_url"} or not body["wss_url"].startswith("wss://"):
                print("FAIL: Smartflo would hang the call up here")
                return
    stream_sid, heard, sizes, first_audio = "MZ" + call_id.replace("-", ""), bytearray(), [], None
    seq = 0
    async with websockets.connect(body["wss_url"], max_size=None) as ws:
        await ws.send(json.dumps({"event": "connected"}))
        await ws.send(json.dumps({"event": "start", "sequenceNumber": "1", "start": {
            "accountSid": "ACfake", "streamSid": stream_sid, "callSid": call_id, "from": a.sender, "to": a.to, "direction": "inbound",
            "mediaFormat": {"encoding": "audio/x-mulaw", "sampleRate": RATE, "bitRate": 64, "bitDepth": 8}, "customParameters": {}}, "streamSid": stream_sid}))
        print("stream opened, call is live")
        t_start = time.monotonic()

        async def send_mic():
            nonlocal seq
            pos = 0
            while time.monotonic() - t_start < a.seconds:
                chunk = mic[pos:pos + FRAME] if pos < len(mic) else b"\xff" * FRAME
                pos += FRAME
                seq += 1
                await ws.send(json.dumps({"event": "media", "sequenceNumber": str(seq + 1), "media": {"chunk": str(seq), "timestamp": str(seq * 100), "payload": base64.b64encode(chunk).decode()}, "streamSid": stream_sid}))
                await asyncio.sleep(0.1)

        mic_task = asyncio.create_task(send_mic())
        try:
            async with asyncio.timeout(a.seconds + 3):
                async for raw in ws:
                    m = json.loads(raw)
                    ev = m.get("event")
                    if ev == "media":
                        data = base64.b64decode(m["media"]["payload"])
                        sizes.append(len(data))
                        heard.extend(data)
                        if first_audio is None:
                            first_audio = time.monotonic() - t_start
                            print(f"agent audio started after {first_audio:.1f} s")
                    elif ev in ("mark", "clear"):
                        print(f"agent sent {ev}: {m}")
                    else:
                        print(f"agent sent {ev}: {str(m)[:120]}")
        except (TimeoutError, websockets.ConnectionClosed) as e:
            print(f"stream ended: {e.__class__.__name__} {getattr(e, 'code', '')}")
        finally:
            mic_task.cancel()
            try:
                await ws.send(json.dumps({"event": "stop", "sequenceNumber": str(seq + 2), "stop": {"accountSid": "ACfake", "callSid": call_id, "reason": "The caller disconnected the call"}, "streamSid": stream_sid}))
            except Exception:  # noqa: BLE001
                pass
    bad = [n for n in sizes if n % 160]
    print(f"agent audio: {len(heard) / RATE:.1f} s in {len(sizes)} messages; every message a whole number of 160-byte frames: {'yes' if not bad else f'NO ({len(bad)} bad)'}")
    if heard and audioop:
        with wave.open(a.out, "wb") as w:
            w.setnchannels(1), w.setsampwidth(2), w.setframerate(RATE)
            w.writeframes(audioop.ulaw2lin(bytes(heard), 2))
        print(f"saved the agent's speech to {a.out}")
    print("RESULT:", "agent spoke" if heard else "FAIL: no audio came back")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--endpoint", required=True, help="the dynamic endpoint address Swarvo gave you")
    p.add_argument("--to", required=True, help="the Smartflo number being called (as stored on Phone Numbers)")
    p.add_argument("--from", dest="sender", default="+919800000001")
    p.add_argument("--wav")
    p.add_argument("--out", default="reply.wav")
    p.add_argument("--seconds", type=int, default=25)
    asyncio.run(main(p.parse_args()))
