"""Realtime voices: Inworld voices use Brain levels, Google voices a single model; keys never leave the server."""

import json

import pytest_asyncio

from api.db import models
from api.tests.product.support import bearer, make_client, signup

LLM = {"provider": "openai", "api_key": "KEY-LLM", "model": "x-llm"}
INWORLD = {"is_realtime": True, "llm": LLM, "realtime": {
    "provider": "inworld_realtime", "api_key": "KEY-IW", "model": "google-ai-studio/gemini-3.1-flash-lite", "voice": "Seema",
    "stt_model": "assemblyai/universal-3-5-pro", "tts_model": "inworld-tts-2", "language": "auto", "turn_detection": "server_vad",
    "stt_eagerness": "medium", "tts_speed": 1.5}}
GOOGLE = {"is_realtime": True, "llm": LLM, "realtime": {
    "provider": "google_realtime", "api_key": "", "model": "gemini-3.1-flash-live-preview", "voice": "Zephyr", "language": "en-hi"}}


@pytest_asyncio.fixture
async def client(monkeypatch):
    async with make_client(monkeypatch, seed_profiles=False) as c:
        monkeypatch.setenv("PRODUCT_VOICE_ENGINES", "inworld,google")
        monkeypatch.setenv("PRODUCT_PROFILES", json.dumps({"default": "inworld", "inworld": "inworld", "google": "google"}))
        async with c.session_factory() as s:
            s.add_all([models.ModelProfileModel(slug="inworld", display_name="Inworld", config=INWORLD, is_active=True),
                       models.ModelProfileModel(slug="google", display_name="Google", config=GOOGLE, is_active=True)])
            await s.commit()
        yield c


async def voice(client, h, name):
    return next(v for v in (await client.get("/product/voices", headers=h)).json() if v["name"] == name and v["provider"])


def live_overrides(client):
    return [o for o in client.fake.overrides.values() if o][-1]


async def test_inworld_voice_follows_the_brain_level(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    seema = await voice(client, h, "Seema")
    assert seema["available"] is True and seema["gender"] == "Female" and seema["language"].startswith("Hindi")
    aid = (await client.post("/product/agents", json={"name": "P", "template": "receptionist"}, headers=h)).json()["id"]
    for brain, model in (("fast", "google-ai-studio/gemini-2.5-flash-lite"), ("balanced", "google-ai-studio/gemini-3.1-flash-lite"), ("smartest", "google-ai-studio/gemini-3.8-flash")):
        a = (await client.patch(f"/product/agents/{aid}", json={"voice_id": seema["id"], "brain": brain}, headers=h)).json()
        assert a["brain_applies"] is True
        assert (await client.post(f"/product/agents/{aid}/publish", headers=h)).status_code == 200
        rt = live_overrides(client)["realtime"]
        assert rt["model"] == model and rt["voice"] == "Seema" and rt["provider"] == "inworld_realtime" and rt["stt_model"] == "assemblyai/universal-3-5-pro"
        assert live_overrides(client)["is_realtime"] is True


async def test_google_voice_has_no_brain_levels_and_waits_for_a_key(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    zephyr = await voice(client, h, "Zephyr")
    assert zephyr["available"] is False  # no key yet
    aid = (await client.post("/product/agents", json={"name": "P", "template": "receptionist"}, headers=h)).json()["id"]
    a = (await client.patch(f"/product/agents/{aid}", json={"voice_id": zephyr["id"], "brain": "smartest"}, headers=h)).json()
    assert a["brain_applies"] is False
    checks = {c["id"]: c["level"] for c in (await client.get(f"/product/agents/{aid}/readiness", headers=h)).json()}
    assert checks["voice_ready"] == "blocker"
    assert (await client.post(f"/product/agents/{aid}/publish", headers=h)).status_code == 400

    async with client.session_factory() as s:  # the operator adds the key
        from sqlalchemy import select
        p = (await s.execute(select(models.ModelProfileModel).where(models.ModelProfileModel.slug == "google"))).scalar_one()
        p.config = {**p.config, "realtime": {**p.config["realtime"], "api_key": "KEY-G"}}
        await s.commit()
    assert (await voice(client, h, "Zephyr"))["available"] is True
    assert (await client.post(f"/product/agents/{aid}/publish", headers=h)).status_code == 200
    rt = live_overrides(client)["realtime"]
    assert rt["provider"] == "google_realtime" and rt["voice"] == "Zephyr" and rt["model"] == "gemini-3.1-flash-live-preview"


async def test_no_keys_or_vendor_names_in_responses(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    seen = (await client.get("/product/voices", headers=h)).text + (await client.get("/product/me", headers=h)).text
    assert not any(k in seen for k in ("KEY-", "inworld", "Inworld", "assemblyai", "google_realtime"))
