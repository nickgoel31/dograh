"""Plivo Koyal: the streaming client, the voice catalogue, the agent overrides and the 15% off."""

import json
import struct
from decimal import Decimal
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from aiohttp import web

from api.db import models
from api.services.billing import voice_discount
from api.services.configuration.options.plivo import PLIVO_VOICES
from api.services.pipecat import plivo_tts
from api.services.pipecat.plivo_tts import PlivoKoyalTTSService, auth_header, parse_audio_frame, plivo_rate_for, text_message
from api.tests.product.support import bearer, make_client, signup
from api.tests.product.test_swarvo_tts import INWORLD, LLM, STT
from pipecat.frames.frames import ErrorFrame, TTSAudioRawFrame


def frame(ctx: str, audio: bytes) -> bytes:
    c = ctx.encode()
    return struct.pack("<H", len(c)) + c + audio


def test_basic_auth_rates_and_message_shape():
    assert auth_header("MA123", "tok")["Authorization"] == "Basic TUExMjM6dG9r"
    assert (plivo_rate_for(8000), plivo_rate_for(16000), plivo_rate_for(24000), plivo_rate_for(44100)) == (8000, 16000, 24000, 24000)
    m = text_message("c1", "voiceX", "hi", "hi", 8000, 1.0, 1.0)
    assert m == {"type": "text", "context_id": "c1", "voice_id": "voiceX", "text": "hi", "finish": True, "language": "hi",
                 "output_format": {"container": "raw", "encoding": "pcm_s16le", "sample_rate": 8000}}
    m = text_message("c1", "voiceX", "x" * 9000, "", 24000, 1.1, 1.5)
    assert len(m["text"]) == 5000 and m["pace"] == 1.1 and m["volume"] == 1.5 and "language" not in m


def test_audio_frames_are_split_into_context_and_audio():
    assert parse_audio_frame(frame("c1-x", b"\x01\x02")) == ("c1-x", b"\x01\x02")
    assert parse_audio_frame(b"\x05") is None and parse_audio_frame(struct.pack("<H", 9) + b"ab") is None


def _service(**kw):
    svc = PlivoKoyalTTSService(auth_id="MAID", api_key="TOKEN", settings=PlivoKoyalTTSService.Settings(model="koyal", voice="vGOW5Fzss7kzS9IxCObo", language="en-IN"), **kw)
    svc._sample_rate = 24000
    svc.start_tts_usage_metrics = AsyncMock()
    svc.stop_ttfb_metrics = AsyncMock()
    return svc


async def _serve(handler, port):
    app = web.Application()
    app.router.add_get("/v1/Account/MAID/TTS/Realtime/", handler)
    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, "127.0.0.1", port).start()
    return runner


@pytest.mark.asyncio
async def test_it_sends_one_text_message_with_basic_auth_and_streams_audio(unused_tcp_port, monkeypatch):
    seen = {}

    async def handler(request):
        seen["auth"] = request.headers.get("Authorization")
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        msg = json.loads(await ws.receive_str())
        seen["msg"] = msg
        cid = msg["context_id"]
        await ws.send_bytes(frame("old-context", b"\x09\x09"))  # a late frame from a cancelled reply: ignored
        await ws.send_bytes(frame(cid, b"\x01\x00" * 4 + b"\x07"))  # ends in the middle of a sample
        await ws.send_bytes(frame(cid, b"\x00\x02" + b"\x03\x00" * 2))
        await ws.send_str(json.dumps({"type": "done", "context_id": cid, "reason": "complete", "characters": 5}))
        await ws.receive()
        return ws

    runner = await _serve(handler, unused_tcp_port)
    monkeypatch.setattr(plivo_tts, "realtime_url", lambda auth_id: f"ws://127.0.0.1:{unused_tcp_port}/v1/Account/{auth_id}/TTS/Realtime/")
    try:
        svc = _service()
        frames = [f async for f in svc.run_tts("hello", "ctx-1")]
        await svc._close()
    finally:
        await runner.cleanup()
    audio = [f for f in frames if isinstance(f, TTSAudioRawFrame)]
    assert seen["auth"] == auth_header("MAID", "TOKEN")["Authorization"]
    m = seen["msg"]
    assert m["type"] == "text" and m["voice_id"] == "vGOW5Fzss7kzS9IxCObo" and m["text"] == "hello" and m["finish"] is True and m["language"] == "en-IN"
    assert m["output_format"] == {"container": "raw", "encoding": "pcm_s16le", "sample_rate": 24000}
    assert b"".join(f.audio for f in audio) == b"\x01\x00" * 4 + b"\x07\x00\x02\x03\x00\x03"  # the odd byte is joined to the next chunk
    assert all(len(f.audio) % 2 == 0 and f.sample_rate == 24000 for f in audio)
    assert not [f for f in frames if isinstance(f, ErrorFrame)]


@pytest.mark.asyncio
async def test_an_error_event_becomes_an_error_frame(unused_tcp_port, monkeypatch):
    async def handler(request):
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        msg = json.loads(await ws.receive_str())
        await ws.send_str(json.dumps({"type": "error", "code": "language_not_supported", "message": "no", "context_id": msg["context_id"]}))
        await ws.receive()
        return ws

    runner = await _serve(handler, unused_tcp_port)
    monkeypatch.setattr(plivo_tts, "realtime_url", lambda auth_id: f"ws://127.0.0.1:{unused_tcp_port}/v1/Account/{auth_id}/TTS/Realtime/")
    try:
        svc = _service()
        frames = [f async for f in svc.run_tts("hello", "c")]
        await svc._close()
    finally:
        await runner.cleanup()
    assert any(isinstance(f, ErrorFrame) and "language_not_supported" in f.error for f in frames)


@pytest.mark.asyncio
async def test_a_call_rate_plivo_does_not_offer_is_converted_once(unused_tcp_port, monkeypatch):
    async def handler(request):
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        t = json.loads(await ws.receive_str())
        assert t["output_format"]["sample_rate"] == 24000
        await ws.send_bytes(frame(t["context_id"], (b"\x10\x00\x20\x00") * 600))  # 1200 samples at 24 kHz
        await ws.send_str(json.dumps({"type": "done", "context_id": t["context_id"]}))
        await ws.receive()
        return ws

    runner = await _serve(handler, unused_tcp_port)
    monkeypatch.setattr(plivo_tts, "realtime_url", lambda auth_id: f"ws://127.0.0.1:{unused_tcp_port}/v1/Account/{auth_id}/TTS/Realtime/")
    try:
        svc = _service()
        svc._sample_rate = 44100
        frames = [f async for f in svc.run_tts("hello", "c")]
        await svc._close()
    finally:
        await runner.cleanup()
    audio = b"".join(f.audio for f in frames if isinstance(f, TTSAudioRawFrame))
    assert all(f.sample_rate == 44100 for f in frames if isinstance(f, TTSAudioRawFrame))
    assert abs(len(audio) / 2 - 2205) < 80  # 1200 samples at 24 kHz are about 2200 at 44.1 kHz


# ---------- the product side ----------
def test_the_catalogue_lists_all_33_koyal_voices():
    from api.product import voices

    got = voices.PlivoAdapter().list()
    assert len(got) == len(PLIVO_VOICES) == 33 and len({v.id for v in got}) == 33
    by = {v.name: v for v in got}
    assert by["Meera"].language == "Hindi" and by["Meera"].gender == "Female" and by["Meera"].tts["lang"] == "hi" and by["Meera"].provider == "Koyal"
    assert by["Aarav"].language == "English (India)" and by["Aarav"].tts["voice"] == "vGOW5Fzss7kzS9IxCObo"
    assert by["Kathir"].language == "Tamil" and by["Hiren"].gender == "Male"


def test_the_discount_is_15_percent_for_koyal_and_nothing_for_other_engines(monkeypatch):
    monkeypatch.delenv("KOYAL_DISCOUNT_PERCENT", raising=False)
    assert voice_discount.multiplier_for_usage({"tts": {"PlivoKoyalTTSService": 120}}) == 0.85
    assert voice_discount.multiplier_for_usage({"tts": {"MurfTTSService": 120}}) == 1.0
    monkeypatch.setenv("KOYAL_DISCOUNT_PERCENT", "0")
    assert voice_discount.multiplier_for_usage({"tts": {"PlivoKoyalTTSService": 120}}) == 1.0


def test_the_provider_is_registered_for_the_classic_app_and_the_call_pipeline():
    from types import SimpleNamespace

    from api.schemas.user_configuration import UserConfiguration
    from api.services.configuration.registry import ServiceProviders
    from api.services.pipecat.service_factory import create_tts_service
    from api.services.pricing.tts import TTS_PRICING

    c = UserConfiguration.model_validate({"tts": {"provider": "plivo_tts", "api_key": "tok", "auth_id": "MAID", "model": "koyal", "voice": "6uWzc4xFj31t4jNJUaED", "language": "hi", "pace": 1.1}})
    svc = create_tts_service(c, SimpleNamespace())
    assert isinstance(svc, PlivoKoyalTTSService) and svc._auth_id == "MAID" and svc._pace == 1.1
    assert TTS_PRICING[ServiceProviders.PLIVO_TTS]["default"].calculate_cost(1000) == Decimal("0.0072")


# ---------- through the API: list, pick, publish ----------
@pytest_asyncio.fixture
async def client(monkeypatch):
    async with make_client(monkeypatch, seed_profiles=False) as c:
        monkeypatch.setenv("PRODUCT_VOICE_ENGINES", "inworld,plivo")
        monkeypatch.setenv("PRODUCT_PROFILES", json.dumps({"default": "inworld", "inworld": "inworld"}))
        async with c.session_factory() as s:
            s.add(models.ModelProfileModel(slug="inworld", display_name="Inworld", config=INWORLD, is_active=True))
            s.add(models.ModelProfileModel(slug="plivo", display_name="Plivo", is_active=True, config={
                "is_realtime": False, "llm": LLM, "stt": STT,
                "tts": {"provider": "plivo_tts", "api_key": "TOKEN", "auth_id": "MAID", "model": "koyal", "voice": "vGOW5Fzss7kzS9IxCObo", "language": "en-IN"}}))
            await s.commit()
        yield c


@pytest.mark.asyncio
async def test_a_koyal_voice_is_listed_picked_and_published(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    rows = [v for v in (await client.get("/product/voices", headers=h)).json() if v["provider"] == "Koyal"]
    assert len(rows) == 33 and all(v["available"] and v["has_sample"] for v in rows) and "TOKEN" not in json.dumps(rows)
    meera = next(v for v in rows if v["name"] == "Meera")
    aid = (await client.post("/product/agents", json={"name": "P", "template": "receptionist"}, headers=h)).json()["id"]
    await client.patch(f"/product/agents/{aid}", json={"voice_id": meera["id"]}, headers=h)
    assert (await client.post(f"/product/agents/{aid}/publish", headers=h)).status_code == 200
    ov = [o for o in client.fake.overrides.values() if o][-1]
    assert ov["is_realtime"] is False and ov["tts"]["provider"] == "plivo_tts" and ov["tts"]["voice"] == "6uWzc4xFj31t4jNJUaED" and ov["tts"]["language"] == "hi"
    assert ov["tts"]["api_key"] == "TOKEN" and ov["tts"]["auth_id"] == "MAID" and ov["stt"]["provider"] == "assemblyai"
    assert "speed" not in ov["tts"] and "mode" not in ov["tts"]


@pytest.mark.asyncio
async def test_koyal_needs_its_auth_id_to_count_as_ready_and_the_discount_shows_on_billing(client):
    _, tok = await signup(client, "b@x.com")
    h = bearer(tok)
    discounts = (await client.get("/product/billing/pricing", headers=h)).json()["voice_discounts"]
    assert {"id": "koyal", "label": "Koyal voices", "percent": 15, "available": True} in discounts
    async with client.session_factory() as s:
        from sqlalchemy import select

        p = await s.scalar(select(models.ModelProfileModel).where(models.ModelProfileModel.slug == "plivo"))
        cfg = dict(p.config)
        cfg["tts"] = {k: v for k, v in cfg["tts"].items() if k != "auth_id"}
        p.config = cfg
        await s.commit()
    rows = [v for v in (await client.get("/product/voices", headers=h)).json() if v["provider"] == "Koyal"]
    assert rows and not any(v["available"] for v in rows)
