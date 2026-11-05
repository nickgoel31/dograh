"""Realtime voices: Inworld voices use Brain levels, Google voices a single model; keys never leave the server."""

import json

import pytest_asyncio

from api.db import models
from api.tests.product.support import bearer, make_client, signup
from sqlalchemy import select
from api.db import product_models

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
    _, tok = await signup(client, "a@twjlabs.com")
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
    _, tok = await signup(client, "a@twjlabs.com")
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
    _, tok = await signup(client, "a@twjlabs.com")
    h = bearer(tok)
    seen = (await client.get("/product/voices", headers=h)).text + (await client.get("/product/me", headers=h)).text
    assert not any(k in seen for k in ("KEY-", "inworld", "Inworld", "assemblyai", "google_realtime"))


async def test_human_feel_settings_reach_the_voice_and_the_call(client):
    _, tok = await signup(client, "a@twjlabs.com")
    h = bearer(tok)
    seema = await voice(client, h, "Seema")
    aid = (await client.post("/product/agents", json={"name": "P", "template": "receptionist"}, headers=h)).json()["id"]
    bad = await client.patch(f"/product/agents/{aid}", json={"style": {"pace": 9}}, headers=h)
    assert bad.status_code == 400 and bad.json()["detail"]["code"] == "bad_style"
    style = {"pace": 1.25, "patience": "patient", "turns": "smart", "steadiness": "expressive", "fillers": True, "vocabulary": "Dr. Rao, Koregaon Park",
             "max_minutes": 20, "silence_seconds": 15, "interruptions": False}
    a = (await client.patch(f"/product/agents/{aid}", json={"voice_id": seema["id"], "style": style}, headers=h)).json()
    assert a["style"]["pace"] == 1.25
    assert (await client.post(f"/product/agents/{aid}/publish", headers=h)).status_code == 200
    rt = live_overrides(client)["realtime"]
    assert (rt["tts_speed"], rt["stt_eagerness"], rt["turn_detection"], rt["delivery_mode"], rt["conversational"]) == (1.25, "low", "semantic_vad", "CREATIVE", True)
    assert rt["transcription_prompt"] == "Dr. Rao, Koregaon Park"
    assert list(client.fake.settings.values())[-1] == {"max_call_duration": 1200, "max_user_idle_timeout": 15.0}
    ws = await workspace(client)
    start = next(n for n in client.fake.published[(ws.live_org_id, next(k[1] for k in client.fake.published if k[0] == ws.live_org_id))]["nodes"] if n["type"] == "startCall")
    assert start["data"]["allow_interrupt"] is False


async def workspace(client):
    async with client.session_factory() as s:
        return (await s.execute(select(product_models.ProductWorkspaceModel))).scalars().first()


async def test_voice_samples_come_from_the_engine_and_are_kept(client, monkeypatch, tmp_path):
    import base64
    import httpx

    from api.product import voice_samples

    monkeypatch.setattr(voice_samples, "CACHE", tmp_path)
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json={"audioContent": base64.b64encode(b"MP3DATA").decode()})

    real = httpx.AsyncClient
    monkeypatch.setattr(voice_samples.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **{k: v for k, v in kw.items() if k != "transport"}))
    _, tok = await signup(client, "a@twjlabs.com")
    h = bearer(tok)
    seema, zephyr = await voice(client, h, "Seema"), await voice(client, h, "Zephyr")
    assert seema["has_sample"] is True and zephyr["has_sample"] is False
    r = await client.get(f"/product/voices/{seema['id']}/sample", headers=h)
    assert r.status_code == 200 and r.content == b"MP3DATA" and r.headers["content-type"] == "audio/mpeg"
    assert (await client.get(f"/product/voices/{seema['id']}/sample", headers=h)).content == b"MP3DATA" and len(calls) == 1  # the second play comes from disk
    assert "KEY-IW" in calls[0].headers["authorization"] and (await client.get(f"/product/voices/{zephyr['id']}/sample", headers=h)).status_code == 404


async def test_exact_ai_model_can_be_chosen(client):
    _, tok = await signup(client, "a@twjlabs.com")
    h = bearer(tok)
    models = (await client.get("/product/agents/models", headers=h)).json()
    ids = {m["id"]: m for m in models}
    assert ids["google-ai-studio/gemini-3.1-flash-lite"]["label"] == "Gemini 3.1 Flash Lite" and ids["google-ai-studio/gemini-3.1-flash-lite"]["level"] == "balanced"
    assert "openai/gpt-4.1-mini" in ids
    seema = await voice(client, h, "Seema")
    aid = (await client.post("/product/agents", json={"name": "P", "template": "receptionist"}, headers=h)).json()["id"]
    assert (await client.patch(f"/product/agents/{aid}", json={"style": {"model": "made-up/model"}}, headers=h)).status_code == 400
    await client.patch(f"/product/agents/{aid}", json={"voice_id": seema["id"], "brain": "fast", "style": {"model": "openai/gpt-4.1-mini"}}, headers=h)
    await client.post(f"/product/agents/{aid}/publish", headers=h)
    assert live_overrides(client)["realtime"]["model"] == "openai/gpt-4.1-mini"  # beats the Fast level
    await client.patch(f"/product/agents/{aid}", json={"style": {"model": ""}}, headers=h)
    await client.post(f"/product/agents/{aid}/publish", headers=h)
    assert live_overrides(client)["realtime"]["model"] == "google-ai-studio/gemini-2.5-flash-lite"  # back to the level
