"""A fake Swarvo Pixel, to test the server without the hardware.

    pip install websockets
    python scripts/pixel_fake_device.py --device SWARVO-0001 --code XXXX-XXXX-XXXX-XXXX [--wav speech_16k_mono.wav] [--out reply.wav]

It connects, says hello, "touches" the pad, and behaves like the device: it streams the WAV (16 kHz, 16-bit, mono) in 20 ms packets only while the
server says `listening`, stops on `thinking`, and saves everything the agent says to the output WAV. Without --wav it streams silence.
"""

import argparse
import asyncio
import json
import time
import wave

import websockets

RATE = 16000
PACKET = 640  # 20 ms of 16 kHz 16-bit mono


def read_wav(path: str) -> bytes:
    with wave.open(path, "rb") as w:
        assert w.getframerate() == RATE and w.getnchannels() == 1 and w.getsampwidth() == 2, "the WAV must be 16 kHz, 16-bit, mono"
        return w.readframes(w.getnframes())


async def main(a) -> None:
    mic = read_wav(a.wav) if a.wav else bytes(PACKET * 50 * 3)  # 3 s of silence
    pos, state, heard = 0, "idle", bytearray()
    t0 = time.monotonic()
    async with websockets.connect(a.url, ping_interval=15, max_size=None) as ws:
        await ws.send(json.dumps({"type": "hello", "device_id": a.device, "token": a.code, "fw": "fake"}))
        await ws.send(json.dumps({"type": "touch_start"}))
        print("touch_start sent")

        async def stream_mic():
            nonlocal pos
            while True:
                await asyncio.sleep(0.02)
                if state == "listening" and pos < len(mic):
                    await ws.send(mic[pos : pos + PACKET])
                    pos += PACKET

        mic_task = asyncio.create_task(stream_mic())
        try:
            async for msg in ws:
                if isinstance(msg, bytes):
                    heard.extend(msg)
                    continue
                m = json.loads(msg)
                print(f"{time.monotonic() - t0:6.1f}s  {m}")
                if m.get("type") == "state":
                    state = m["value"]
                elif m.get("type") in ("end_session", "error"):
                    break
                if time.monotonic() - t0 > a.seconds:
                    print("time is up")
                    break
        finally:
            mic_task.cancel()
    if a.out and heard:
        with wave.open(a.out, "wb") as w:
            w.setnchannels(1), w.setsampwidth(2), w.setframerate(RATE)
            w.writeframes(bytes(heard))
        print(f"saved {len(heard) / 2 / RATE:.1f} s of speech to {a.out}")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--url", default="wss://app.swarvoai.com/api/v1/ws/device")
    p.add_argument("--device", required=True)
    p.add_argument("--code", required=True)
    p.add_argument("--wav")
    p.add_argument("--out", default="reply.wav")
    p.add_argument("--seconds", type=int, default=90)
    asyncio.run(main(p.parse_args()))
