"""Workspace model profiles, Brain presets and voice overrides.

    DATABASE_URL=postgresql+asyncpg://x/x REDIS_URL=redis://x \
    python -m pytest api/tests/product --noconftest
"""

import pytest
import pytest_asyncio
from sqlalchemy import select

from api.db import models, product_models
from api.product import voices
from api.tests.product.support import PRESET_MAP, PROFILES, bearer, make_client, signup
from api.tests.product.test_voices_calls import FakeWS, _run


@pytest_asyncio.fixture
async def client(monkeypatch):
    async with make_client(monkeypatch) as c:
        yield c


@pytest_asyncio.fixture
async def bare_client(monkeypatch):
    """No operator profiles configured."""
    async with make_client(monkeypatch, seed_profiles=False) as c:
        yield c


async def mk_agent(client, tok):
    r = await client.post("/product/agents", json={"name": "P", "template": "receptionist"}, headers=bearer(tok))
    return r.json()["id"]


async def rows(client, agent_id):
    async with client.session_factory() as s:
        ws = (await s.execute(select(product_models.ProductWorkspaceModel))).scalar_one()
        ag = (await s.execute(select(product_models.ProductAgentModel).where(
            product_models.ProductAgentModel.public_id == agent_id))).scalar_one()
        profs = {p.slug: p.id for p in (await s.execute(select(models.ModelProfileModel))).scalars()}
        orgs = {o.id: o.model_profile_id for o in (await s.execute(select(models.OrganizationModel))).scalars()}
    return ws, ag, profs, orgs


async def test_new_workspace_orgs_use_the_default_profile(client):
    _, tok = await signup(client, "a@x.com")
    aid = await mk_agent(client, tok)
    ws, _, profs, orgs = await rows(client, aid)
    assert orgs[ws.test_org_id] == orgs[ws.live_org_id] == profs["std"]


async def test_without_profiles_calls_are_blocked_with_a_friendly_reason(bare_client):
    client = bare_client
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    aid = await mk_agent(client, tok)
    checks = {c["id"]: c for c in (await client.get(f"/product/agents/{aid}/readiness", headers=h)).json()}
    assert checks["models"]["level"] == "blocker" and "contact support" in checks["models"]["hint"]
    r = await client.post(f"/product/agents/{aid}/publish", headers=h)
    assert r.status_code == 400 and r.json()["detail"]["code"] == "not_ready"
    ws = FakeWS(token=tok)
    await _run(client, ws, aid)
    assert ws.closed == (1008, "calls_not_set_up") and client.fake.runs == []


async def test_workspace_created_before_profiles_is_repaired(bare_client, monkeypatch):
    client = bare_client
    _, tok = await signup(client, "a@x.com")
    aid = await mk_agent(client, tok)
    async with client.session_factory() as s:
        for slug, cfg in PROFILES.items():
            s.add(models.ModelProfileModel(slug=slug, display_name=slug, config=cfg, is_active=True))
        await s.commit()
    monkeypatch.setenv("PRODUCT_PROFILES", PRESET_MAP)
    checks = {c["id"]: c["level"] for c in (await client.get(f"/product/agents/{aid}/readiness", headers=bearer(tok))).json()}
    assert checks["models"] == "ok"
    ws, _, profs, orgs = await rows(client, aid)
    assert orgs[ws.test_org_id] == orgs[ws.live_org_id] == profs["std"]


async def test_brain_presets_map_to_profile_llms(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    aid = await mk_agent(client, tok)
    ws, ag, _, _ = await rows(client, aid)
    key = (ws.test_org_id, ag.test_workflow_id)

    await client.patch(f"/product/agents/{aid}", json={"brain": "smartest"}, headers=h)
    assert client.fake.overrides[key] == {"llm": PROFILES["pro"]["llm"]}
    await client.patch(f"/product/agents/{aid}", json={"brain": "fast"}, headers=h)
    assert client.fake.overrides[key] == {"llm": PROFILES["lite"]["llm"]}
    await client.patch(f"/product/agents/{aid}", json={"brain": "balanced"}, headers=h)
    assert client.fake.overrides[key] is None  # the default profile already fits


async def test_voice_override_keeps_keys_and_sets_language(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    aid = await mk_agent(client, tok)
    ws, ag, _, _ = await rows(client, aid)
    key = (ws.test_org_id, ag.test_workflow_id)
    pick = next(v for v in voices.catalogue() if v.language == "Gujarati")
    await client.patch(f"/product/agents/{aid}", json={"voice_id": pick.id}, headers=h)
    tts = client.fake.overrides[key]["tts"]
    assert tts["voice"] == pick.tts["voice"] and tts["language"] == "gu-IN"
    assert tts["api_key"] == "KEY-TTS" and tts["provider"] == "sarvam"
    # A mixed-language persona has no single language code: the profile's language is kept.
    mixed = next(v for v in voices.catalogue() if v.language == "English + Hindi")
    await client.patch(f"/product/agents/{aid}", json={"voice_id": mixed.id}, headers=h)
    assert client.fake.overrides[key]["tts"]["language"] == "hi-IN"


async def test_go_live_carries_overrides_to_the_live_copy(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    aid = await mk_agent(client, tok)
    await client.patch(f"/product/agents/{aid}", json={"brain": "smartest"}, headers=h)
    assert (await client.post(f"/product/agents/{aid}/publish", headers=h)).status_code == 200
    ws, ag, _, _ = await rows(client, aid)
    assert client.fake.overrides[(ws.live_org_id, ag.live_workflow_id)] == {"llm": PROFILES["pro"]["llm"]}


async def test_keys_never_reach_the_browser(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    aid = await mk_agent(client, tok)
    await client.patch(f"/product/agents/{aid}", json={"brain": "smartest"}, headers=h)
    await client.post(f"/product/agents/{aid}/publish", headers=h)
    seen = ""
    for path in (f"/product/agents/{aid}", "/product/agents", f"/product/agents/{aid}/readiness", "/product/voices", "/product/me"):
        seen += (await client.get(path, headers=h)).text
    assert not any(k in seen for k in ("KEY-", "std-llm", "pro-llm", "sarvam", "deepgram", "openai"))


def test_bad_preset_json_is_ignored(monkeypatch):
    from api.product import models_config

    monkeypatch.setenv("PRODUCT_PROFILES", "{not json")
    assert models_config.profile_slugs() == {}
    monkeypatch.setenv("PRODUCT_PROFILES", '["list"]')
    assert models_config.profile_slugs() == {}
