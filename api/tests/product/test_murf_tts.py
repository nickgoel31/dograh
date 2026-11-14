"""Murf Falcon 2.1: the streaming client, the voice catalogue and the agent overrides."""

import base64
import json
from unittest.mock import AsyncMock

import pytest
from aiohttp import web

from api.services.configuration.options.murf import MURF_INDIAN_VOICES
from api.services.pipecat import murf_tts
from api.services.pipecat.murf_tts import MurfTTSService, murf_rate_for, stream_host, stream_url, voice_config
from pipecat.frames.frames import ErrorFrame, TTSAudioRawFrame


def test_addresses_and_rates():
    assert stream_host("in") == "in.api.murf.ai" and stream_host("global") == "global.api.murf.ai" and stream_host(" US-East ") == "us-east.api.murf.ai"
    u = stream_url("in", 8000)
    assert u.startswith("wss://in.api.murf.ai/v1/speech/stream-input?") and "model=falcon-2.1" in u and "format=PCM" in u and "sample_rate=8000" in u and "api" not in u.split("?")[1].replace("channel", "")
    assert (murf_rate_for(8000), murf_rate_for(24000), murf_rate_for(16000), murf_rate_for(44100)) == (8000, 24000, 24000, 44100)


def test_voice_settings_only_carry_what_was_changed():
    assert voice_config("Aarav", "hi-IN", 0, 0, 0) == {"voice_id": "Aarav", "style": "Conversational", "locale": "hi-IN"}
    assert voice_config("Priya", "en-IN", 5, -3, 15) == {"voice_id": "Priya", "style": "Conversational", "locale": "en-IN", "rate": 5, "pitch": -3, "volume_offset": 15}


def _service(**kw):
    svc = MurfTTSService(api_key="KEY-MURF", settings=MurfTTSService.Settings(model="falcon-2.1", voice="Priya", language="hi-IN"), **kw)
    svc._sample_rate = 24000
    svc.start_tts_usage_metrics = AsyncMock()
    svc.stop_ttfb_metrics = AsyncMock()
    return svc


async def _serve(handler, port):
    app = web.Application()
    app.router.add_get("/v1/speech/stream-input", handler)
    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, "127.0.0.1", port).start()
    return runner


@pytest.mark.asyncio
async def test_it_sends_voice_then_text_with_the_key_in_a_header_and_streams_audio(unused_tcp_port, monkeypatch):
    seen = {"frames": []}

    async def handler(request):
        seen["key"] = request.headers.get("api_key")
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        voice = json.loads(await ws.receive_str())
        text = json.loads(await ws.receive_str())
        seen["frames"] = [voice, text]
        cid = text["context_id"]
        odd = b"\x01\x00" * 4 + b"\x07"  # an audio chunk that ends in the middle of a sample
        await ws.send_str(json.dumps({"audio": base64.b64encode(odd).decode(), "context_id": cid, "trace_id": "t"}))
        await ws.send_str(json.dumps({"audio": base64.b64encode(b"\x00\x02" + b"\x03\x00" * 2).decode(), "context_id": cid}))
        await ws.send_str(json.dumps({"warning": "w", "warning_code": "INVALID_BUFFER_SIZE", "context_id": cid}))
        await ws.send_str(json.dumps({"final": True, "context_id": cid}))
        await ws.receive()
        return ws

    runner = await _serve(handler, unused_tcp_port)
    monkeypatch.setattr(murf_tts, "stream_url", lambda region, rate: f"ws://127.0.0.1:{unused_tcp_port}/v1/speech/stream-input?rate={rate}")
    try:
        svc = _service(rate=4)
        frames = [f async for f in svc.run_tts("नमस्ते, कैसे हैं?", "ctx-1")]
        await svc._close()
    finally:
        await runner.cleanup()
    audio = [f for f in frames if isinstance(f, TTSAudioRawFrame)]
    assert seen["key"] == "KEY-MURF"
    voice, text = seen["frames"]
    assert voice["voice_config"] == {"voice_id": "Priya", "style": "Conversational", "locale": "hi-IN", "rate": 4} and voice["context_id"] == text["context_id"]
    assert text["text"] == "नमस्ते, कैसे हैं?" and text["end"] is True
    # the odd byte at the end of one chunk is joined to the next chunk, not dropped
    assert b"".join(f.audio for f in audio) == b"\x01\x00" * 4 + b"\x07\x00\x02\x03\x00\x03"
    assert all(len(f.audio) % 2 == 0 and f.sample_rate == 24000 for f in audio)
    assert not [f for f in frames if isinstance(f, ErrorFrame)]


@pytest.mark.asyncio
async def test_a_fatal_error_from_murf_becomes_an_error_frame(unused_tcp_port, monkeypatch):
    async def handler(request):
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        await ws.receive_str()
        await ws.receive_str()
        await ws.send_str(json.dumps({"error": "bad voice", "error_code": "INVALID_VOICE", "fatal": True}))
        await ws.receive()
        return ws

    runner = await _serve(handler, unused_tcp_port)
    monkeypatch.setattr(murf_tts, "stream_url", lambda region, rate: f"ws://127.0.0.1:{unused_tcp_port}/v1/speech/stream-input")
    try:
        svc = _service()
        frames = [f async for f in svc.run_tts("hello", "c")]
        await svc._close()
    finally:
        await runner.cleanup()
    assert any(isinstance(f, ErrorFrame) and "INVALID_VOICE" in f.error for f in frames)


@pytest.mark.asyncio
async def test_a_rate_murf_does_not_offer_is_converted_once(unused_tcp_port, monkeypatch):
    async def handler(request):
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        await ws.receive_str()
        t = json.loads(await ws.receive_str())
        pcm = (b"\x10\x00\x20\x00") * 600  # 1200 samples at 24 kHz
        await ws.send_str(json.dumps({"audio": base64.b64encode(pcm).decode(), "context_id": t["context_id"]}))
        await ws.send_str(json.dumps({"final": True, "context_id": t["context_id"]}))
        await ws.receive()
        return ws

    runner = await _serve(handler, unused_tcp_port)
    asked = {}
    monkeypatch.setattr(murf_tts, "stream_url", lambda region, rate: asked.setdefault("rate", rate) and f"ws://127.0.0.1:{unused_tcp_port}/v1/speech/stream-input")
    try:
        svc = _service()
        svc._sample_rate = 16000
        frames = [f async for f in svc.run_tts("hello", "c")]
        await svc._close()
    finally:
        await runner.cleanup()
    audio = b"".join(f.audio for f in frames if isinstance(f, TTSAudioRawFrame))
    assert asked["rate"] == 24000 and all(f.sample_rate == 16000 for f in frames if isinstance(f, TTSAudioRawFrame))
    assert abs(len(audio) / 2 - 800) < 40  # 1200 samples at 24 kHz are about 800 at 16 kHz


# ---------- the product side ----------
def test_the_catalogue_lists_every_indian_voice_with_its_languages():
    from api.product import voices

    got = [v for v in voices.MurfAdapter().list()]
    assert len(got) == len(MURF_INDIAN_VOICES) == 37
    by = {v.name: v for v in got}
    assert by["Aarav"].language == "Hindi" and by["Aarav"].engine == "murf" and by["Aarav"].tts["locales"][0] == "hi-IN"
    assert by["Debarati"].language == "Bengali" and by["Nimisha"].language == "English (India)"
    assert by["Anisha"].gender == "Female" and by["Aarav"].gender == "Male" and by["Priya"].gender == "Female"
    assert by["Harman"].gender is None and by["Harpreet"].gender is None  # used by everyone: left empty, not guessed
    assert sum(1 for v in got if v.gender) == 35
    assert all(v.tts["description"].startswith("Natural, conversational voice for phone calls. Speaks ") for v in got)
    assert "Hindi" in (by["Priya"].tts["description"] or "") and "English" in by["Priya"].tts["description"]
    assert len({v.id for v in got}) == len(got)


def test_a_voice_speaks_the_agents_first_language_it_supports():
    from api.product import models_config as mc

    assert mc.murf_locale(("hi-IN", "en-IN", "ta-IN"), ["Tamil", "English"]) == "ta-IN"
    assert mc.murf_locale(("hi-IN", "en-IN"), ["Tamil", "English"]) == "en-IN"  # the voice has no Tamil: the next language
    assert mc.murf_locale(("hi-IN", "en-IN"), ["Tamil"]) == "hi-IN"  # none of them: the voice's own main language
    assert mc.murf_locale(("bn-IN",), None) == "bn-IN"


# ---------- through the API: list, pick, publish ----------
import pytest_asyncio  # noqa: E402

from api.db import models  # noqa: E402
from api.tests.product.support import bearer, make_client, signup  # noqa: E402
from api.tests.product.test_swarvo_tts import INWORLD, LLM, STT  # noqa: E402


@pytest_asyncio.fixture
async def client(monkeypatch):
    async with make_client(monkeypatch, seed_profiles=False) as c:
        monkeypatch.setenv("PRODUCT_VOICE_ENGINES", "inworld,murf")
        monkeypatch.setenv("PRODUCT_PROFILES", json.dumps({"default": "inworld", "inworld": "inworld"}))
        async with c.session_factory() as s:
            s.add(models.ModelProfileModel(slug="inworld", display_name="Inworld", config=INWORLD, is_active=True))
            s.add(models.ModelProfileModel(slug="murf", display_name="Murf", is_active=True, config={
                "is_realtime": False, "llm": LLM, "stt": STT,
                "tts": {"provider": "murf_tts", "api_key": "KEY-MURF", "model": "falcon-2.1", "voice": "Aarav", "language": "hi-IN", "region": "in"}}))
            await s.commit()
        yield c


@pytest.mark.asyncio
async def test_a_murf_voice_is_listed_picked_and_published_with_the_agents_language(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    rows = [v for v in (await client.get("/product/voices", headers=h)).json() if v["provider"] == "Falcon"]
    assert len(rows) == 37 and all(v["available"] for v in rows) and "KEY-MURF" not in json.dumps(rows)
    anisha = next(v for v in rows if v["name"] == "Anisha")
    assert anisha["language"] == "Hindi" and "Tamil" in anisha["description"] and anisha["has_sample"] is True
    aid = (await client.post("/product/agents", json={"name": "P", "template": "receptionist"}, headers=h)).json()["id"]
    await client.patch(f"/product/agents/{aid}", json={"voice_id": anisha["id"], "style": {"languages": ["Tamil", "English"]}}, headers=h)
    assert (await client.post(f"/product/agents/{aid}/publish", headers=h)).status_code == 200
    ov = [o for o in client.fake.overrides.values() if o][-1]
    assert ov["is_realtime"] is False and ov["tts"]["provider"] == "murf_tts" and ov["tts"]["voice"] == "Anisha" and ov["tts"]["language"] == "ta-IN"
    assert ov["tts"]["api_key"] == "KEY-MURF" and ov["stt"]["provider"] == "assemblyai" and ov["llm"]["provider"] == "inworld_llm"
    assert "speed" not in ov["tts"]


def test_the_provider_is_registered_for_the_classic_app_and_the_call_pipeline():
    from types import SimpleNamespace

    from api.schemas.user_configuration import UserConfiguration
    from api.services.pipecat.service_factory import create_tts_service

    c = UserConfiguration.model_validate({"tts": {"provider": "murf_tts", "api_key": "k", "model": "falcon-2.1", "voice": "Priya", "language": "en-IN", "region": "global", "rate": 3}})
    svc = create_tts_service(c, SimpleNamespace())
    assert isinstance(svc, MurfTTSService) and svc._region == "global" and svc._rate == 3
    from api.services.pricing.tts import TTS_PRICING
    from api.services.configuration.registry import ServiceProviders

    from decimal import Decimal

    assert TTS_PRICING[ServiceProviders.MURF_TTS]["default"].calculate_cost(1000) == Decimal("0.01")
