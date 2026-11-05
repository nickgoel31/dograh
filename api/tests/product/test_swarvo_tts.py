"""swarvo-tts 2.5 as a voice provider: its voices, the profile it needs, the call settings it produces, and the streaming client."""

import json

import aiohttp
import pytest
import pytest_asyncio
from aiohttp import web

from api.db import models
from api.product import voices
from api.services.pipecat.swarvo_tts import SwarvoTTSService, stream_url
from api.tests.product.support import bearer, make_client, signup

LLM = {"provider": "openai", "api_key": "KEY-LLM", "model": "x-llm"}
STT = {"provider": "deepgram", "api_key": "KEY-STT", "model": "nova-3"}
INWORLD = {"is_realtime": True, "llm": LLM, "realtime": {"provider": "inworld_realtime", "api_key": "KEY-IW", "model": "google-ai-studio/gemini-3.1-flash-lite", "voice": "Seema",
                                                          "stt_model": "assemblyai/universal-3-5-pro", "tts_model": "inworld-tts-2", "language": "auto", "turn_detection": "server_vad", "stt_eagerness": "medium", "tts_speed": 1.5}}


def swarvo_profile(key="KEY-SW"):
    return {"is_realtime": False, "llm": LLM, "stt": STT, "tts": {"provider": "swarvo_tts", "api_key": key, "model": "swarvo-tts-2.5", "voice": "Ritvik", "language": "hi", "base_url": "https://tts.example.test"}}


@pytest_asyncio.fixture
async def client(monkeypatch):
    async with make_client(monkeypatch, seed_profiles=False) as c:
        monkeypatch.setenv("PRODUCT_VOICE_ENGINES", "inworld,swarvo")
        monkeypatch.setenv("PRODUCT_PROFILES", json.dumps({"default": "inworld", "inworld": "inworld"}))  # no mapping for swarvo: its profile is found by name
        async with c.session_factory() as s:
            s.add(models.ModelProfileModel(slug="inworld", display_name="Inworld", config=INWORLD, is_active=True))
            await s.commit()
        yield c


async def add_swarvo(client, key="KEY-SW"):
    async with client.session_factory() as s:
        s.add(models.ModelProfileModel(slug="swarvo", display_name="swarvo", config=swarvo_profile(key), is_active=True))
        await s.commit()


def test_the_twenty_built_in_voices_are_listed_with_gender_and_hindi(monkeypatch):
    monkeypatch.setenv("PRODUCT_VOICE_ENGINES", "swarvo")
    vs = voices.catalogue()
    assert len(vs) == 20 and len({v.id for v in vs}) == 20
    assert sorted(v.name for v in vs if v.gender == "Female") == sorted(voices.SWARVO_FEMALE)
    assert sorted(v.name for v in vs if v.gender == "Male") == sorted(voices.SWARVO_MALE)
    assert all(v.language == "Hindi" and v.provider == "Swarvo" and v.engine == "swarvo" for v in vs)
    assert {"Ritvik", "Ahana"} <= {v.name for v in vs}  # names keep their capital letters: the service is case sensitive


async def test_without_a_profile_the_voices_show_but_cannot_be_picked(client):
    _, tok = await signup(client, "a@twjlabs.com")
    h = bearer(tok)
    rows = [v for v in (await client.get("/product/voices", headers=h)).json() if v["provider"] == "Swarvo"]
    assert len(rows) == 20 and all(v["available"] is False for v in rows)
    aid = (await client.post("/product/agents", json={"name": "P", "template": "receptionist"}, headers=h)).json()["id"]
    ahana = next(v for v in rows if v["name"] == "Ahana")
    await client.patch(f"/product/agents/{aid}", json={"voice_id": ahana["id"]}, headers=h)
    checks = {c["id"]: c["level"] for c in (await client.get(f"/product/agents/{aid}/readiness", headers=h)).json()}
    assert checks["voice_ready"] == "blocker"


async def test_a_swarvo_voice_runs_the_normal_listen_think_speak_pipeline(client):
    await add_swarvo(client)
    _, tok = await signup(client, "a@twjlabs.com")
    h = bearer(tok)
    rows = [v for v in (await client.get("/product/voices", headers=h)).json() if v["provider"] == "Swarvo"]
    ahana = next(v for v in rows if v["name"] == "Ahana")
    assert ahana["available"] is True and ahana["has_sample"] is True and ahana["brain_levels"] is False  # one fixed thinking model
    assert "KEY-SW" not in json.dumps(rows)
    aid = (await client.post("/product/agents", json={"name": "P", "template": "receptionist"}, headers=h)).json()["id"]
    a = (await client.patch(f"/product/agents/{aid}", json={"voice_id": ahana["id"]}, headers=h)).json()
    assert a["brain_applies"] is False
    assert (await client.post(f"/product/agents/{aid}/publish", headers=h)).status_code == 200
    ov = [o for o in client.fake.overrides.values() if o][-1]
    assert ov["is_realtime"] is False and ov["llm"]["model"] == "x-llm" and ov["stt"]["model"] == "nova-3"
    assert ov["tts"]["provider"] == "swarvo_tts" and ov["tts"]["voice"] == "Ahana" and ov["tts"]["language"] == "hi" and ov["tts"]["api_key"] == "KEY-SW"
    # an incomplete profile (no listening model) is not offered
    async with client.session_factory() as s:
        from sqlalchemy import select

        p = (await s.execute(select(models.ModelProfileModel).where(models.ModelProfileModel.slug == "swarvo"))).scalar_one()
        p.config = {k: v for k, v in p.config.items() if k != "stt"}
        await s.commit()
    again = next(v for v in (await client.get("/product/voices", headers=h)).json() if v["name"] == "Ahana")
    assert again["available"] is False


def test_the_provider_config_and_service_address(monkeypatch):
    from api.schemas.user_configuration import UserConfiguration

    c = UserConfiguration.model_validate({"tts": swarvo_profile()["tts"]})
    assert c.tts.provider == "swarvo_tts" and c.tts.speed == 1.0 and c.tts.mode == "chat"
    with pytest.raises(Exception):
        UserConfiguration.model_validate({"tts": {**swarvo_profile()["tts"], "speed": 3}})  # the service accepts 0.7 to 1.5
    assert stream_url("https://x.modal.run/") == "wss://x.modal.run/v1/stream"
    with pytest.raises(ValueError):
        stream_url("")


@pytest.mark.parametrize("fail", [False, True])
async def test_the_streaming_client_sends_the_key_in_the_first_message_and_reads_audio(fail, unused_tcp_port):
    seen = {}

    async def stream(request):
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        seen["first"] = json.loads(await ws.receive_str())
        if fail:
            await ws.send_str(json.dumps({"type": "error", "code": 429, "message": "slow down"}))
        else:
            await ws.send_bytes(b"\x01\x00" * 100)
            await ws.send_bytes(b"\x02\x00" * 50)
            await ws.send_str(json.dumps({"type": "end", "stopped": False, "audio_seconds": 0.1}))
        await ws.close()
        return ws

    app = web.Application()
    app.router.add_get("/v1/stream", stream)
    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, "127.0.0.1", unused_tcp_port).start()
    try:
        svc = SwarvoTTSService(api_key="KEY-SW", base_url=f"http://127.0.0.1:{unused_tcp_port}", speed=1.2, mode="read",
                               settings=SwarvoTTSService.Settings(model="swarvo-tts-2.5", voice="Ahana", language="hi-IN"))
        got = []
        if fail:
            with pytest.raises(RuntimeError, match="429"):
                async for chunk in svc._audio("नमस्ते"):
                    got.append(chunk)
        else:
            got = [chunk async for chunk in svc._audio("नमस्ते")]
            assert b"".join(got) == b"\x01\x00" * 100 + b"\x02\x00" * 50
        f = seen["first"]
        assert f["api_key"] == "KEY-SW" and f["voice"] == "Ahana" and f["lang"] == "hi" and f["format"] == "pcm16" and f["speed"] == 1.2 and f["mode"] == "read" and f["text"] == "नमस्ते"
    finally:
        await runner.cleanup()


def test_the_call_pipeline_builds_the_service_from_the_profile():
    from types import SimpleNamespace

    from api.schemas.user_configuration import UserConfiguration
    from api.services.pipecat.service_factory import create_tts_service

    c = UserConfiguration.model_validate({"tts": swarvo_profile()["tts"]})
    svc = create_tts_service(c, SimpleNamespace())
    assert isinstance(svc, SwarvoTTSService) and svc._url == "wss://tts.example.test/v1/stream"
