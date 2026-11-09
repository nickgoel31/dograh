"""Agents: prompt compiler, lifecycle, versioning, tenant isolation, roles.

    DATABASE_URL=postgresql+asyncpg://x/x REDIS_URL=redis://x \
    python -m pytest api/tests/product --noconftest
"""

import pytest_asyncio
from sqlalchemy import select

from api.db import product_models
from api.product import config, prompt
from api.product.definition import build_definition, get_prompt, with_prompt
from api.product.templates import TEMPLATES
from api.tests.product.support import bearer, make_client, signup


@pytest_asyncio.fixture
async def client(monkeypatch):
    async with make_client(monkeypatch) as c:
        yield c


async def new_agent(client, tok, **kw):
    body = {"name": "Priya", "template": "receptionist", "business": "Sunrise Dental", **kw}
    r = await client.post("/product/agents", json=body, headers=bearer(tok))
    assert r.status_code == 201, r.text
    return r.json()


# ---------- pure logic ----------
def test_prompt_is_deterministic_and_uses_inputs():
    a = prompt.compile_prompt(business="Sunrise Dental", what_you_do="Dental clinic", role="book visits", tone="Playful")
    b = prompt.compile_prompt(business="Sunrise Dental", what_you_do="Dental clinic", role="book visits", tone="Playful")
    assert a == b
    assert "Sunrise Dental" in a and "book visits" in a and "Dental clinic" in a
    assert prompt.TONES["Playful"] in a


def test_prompt_handles_blank_and_unknown_tone():
    p = prompt.compile_prompt(business=" ", what_you_do="", role="", tone="Weird")
    assert "the business" in p and prompt.TONES[prompt.DEFAULT_TONE] in p
    assert "About the business" not in p


def test_with_prompt_only_touches_start_node():
    d = build_definition(name="A", prompt="old", greeting="hi")
    d2 = with_prompt(d, prompt="new")
    assert get_prompt(d2) == "new" and get_prompt(d) == "old"
    assert d2["nodes"][1] == d["nodes"][1] and d2["edges"] == d["edges"]


def test_templates_are_unique_grouped_and_have_scripts():
    from api.product.templates import INDUSTRIES

    assert len({t.key for t in TEMPLATES}) == len(TEMPLATES) >= 25
    assert all(t.industry in INDUSTRIES and len(t.script) > 150 and t.what_you_do and t.blurb for t in TEMPLATES)
    assert all(t.tone in prompt.TONES for t in TEMPLATES)


# ---------- API ----------
async def test_create_from_template_lives_in_test_org_only(client):
    _, tok = await signup(client, "a@x.com")
    a = await new_agent(client, tok)
    assert a["id"].startswith("agt_") and a["status"] == "draft" and a["emoji"] == "💁"
    async with client.session_factory() as s:
        ws = (await s.execute(select(product_models.ProductWorkspaceModel))).scalar_one()
    assert [k[0] for k in client.fake.published] == [ws.test_org_id]


async def test_list_and_templates(client):
    _, tok = await signup(client, "a@x.com")
    await new_agent(client, tok)
    assert len((await client.get("/product/agents", headers=bearer(tok))).json()) == 1
    t = (await client.get("/product/agents/templates", headers=bearer(tok))).json()
    assert len(t) == len(TEMPLATES) and all(x["industry"] and x["script"] for x in t)


async def test_generate_draft_uses_the_ai_and_cleans_its_answer(client):
    _, tok = await signup(client, "a@x.com")
    r = await client.post("/product/agents/generate", json={"usecase": "dental", "description": "Dental clinic in Pune"}, headers=bearer(tok))
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["generated"] is True and d["name"] == "Asha" and d["tone"] == "Friendly" and d["script"].startswith("1.")


async def test_generate_draft_falls_back_to_the_template_when_the_ai_is_down(client):
    _, tok = await signup(client, "a@x.com")
    client.llm.draft = "not json at all"
    d = (await client.post("/product/agents/generate", json={"usecase": "salon", "description": "Glow Salon. Open daily."}, headers=bearer(tok))).json()
    assert d["generated"] is False and d["business"] == "Glow Salon" and "1." in d["script"]


async def test_template_script_and_emoji_carry_into_the_new_agent(client):
    _, tok = await signup(client, "a@x.com")
    a = await new_agent(client, tok, template="dental", emoji="🪥")
    assert a["emoji"] == "🪥" and "dental" in a["script"].lower() or "pain" in a["script"].lower()


async def test_other_workspace_cannot_touch_agent(client):
    _, tok_a = await signup(client, "a@x.com")
    _, tok_b = await signup(client, "b@x.com")
    a = await new_agent(client, tok_a)
    client.cookies.clear()
    hb = bearer(tok_b)
    assert (await client.get("/product/agents", headers=hb)).json() == []
    for method, path in [
        ("get", f"/product/agents/{a['id']}"),
        ("patch", f"/product/agents/{a['id']}"),
        ("post", f"/product/agents/{a['id']}/publish"),
        ("post", f"/product/agents/{a['id']}/duplicate"),
        ("post", f"/product/agents/{a['id']}/pause"),
        ("get", f"/product/agents/{a['id']}/readiness"),
    ]:
        r = await getattr(client, method)(path, headers=hb, **({"json": {}} if method == "patch" else {}))
        assert r.status_code == 404, (method, path, r.status_code)
        assert r.json()["detail"]["code"] == "agent_not_found"


async def test_viewer_cannot_create_or_edit(client):
    me_a, tok_a = await signup(client, "a@x.com")
    _, tok_b = await signup(client, "b@x.com")
    a = await new_agent(client, tok_a)
    client.cookies.clear()
    async with client.session_factory() as s:
        ws = (await s.execute(select(product_models.ProductWorkspaceModel))).scalars().first()
        from api.db.models import UserModel

        b = (await s.execute(select(UserModel).where(UserModel.email == "b@x.com"))).scalar_one()
        s.add(product_models.ProductMembershipModel(workspace_id=ws.id, user_id=b.id, role="viewer"))
        await s.commit()
    hb = bearer(tok_b, **{config.WORKSPACE_HEADER: me_a["current_workspace"]["id"]})
    assert (await client.get("/product/agents", headers=hb)).status_code == 200
    assert (await client.post("/product/agents", json={"name": "x"}, headers=hb)).status_code == 403
    assert (await client.patch(f"/product/agents/{a['id']}", json={"name": "y"}, headers=hb)).status_code == 403
    assert (await client.post(f"/product/agents/{a['id']}/publish", headers=hb)).status_code == 403


async def test_simple_mode_recompiles_and_custom_prompt_sticks(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    a = await new_agent(client, tok)
    r = await client.patch(f"/product/agents/{a['id']}", json={"tone": "Professional"}, headers=h)
    assert prompt.TONES["Professional"] in r.json()["prompt"]
    r = await client.patch(f"/product/agents/{a['id']}", json={"prompt": "Only say hello."}, headers=h)
    assert r.json()["prompt"] == "Only say hello." and r.json()["prompt_mode"] == "custom"
    r = await client.patch(f"/product/agents/{a['id']}", json={"tone": "Playful"}, headers=h)
    assert r.json()["prompt"] == "Only say hello."


async def test_etag_conflict_is_friendly(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    a = await new_agent(client, tok)
    ok = await client.patch(f"/product/agents/{a['id']}", json={"name": "P2"}, headers={**h, "If-Match": str(a["version"])})
    assert ok.status_code == 200 and ok.json()["version"] == a["version"] + 1
    stale = await client.patch(f"/product/agents/{a['id']}", json={"name": "P3"}, headers={**h, "If-Match": str(a["version"])})
    assert stale.status_code == 409 and stale.json()["detail"]["code"] == "edited_elsewhere"


async def test_go_live_creates_live_copy_once_then_updates(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    a = await new_agent(client, tok)
    live1 = await client.post(f"/product/agents/{a['id']}/publish", headers=h)
    assert live1.status_code == 200 and live1.json()["status"] == "live"
    assert len({k[0] for k in client.fake.published}) == 2  # test org + live org
    count = len(client.fake.published)
    await client.patch(f"/product/agents/{a['id']}", json={"prompt": "Updated words."}, headers=h)
    await client.post(f"/product/agents/{a['id']}/publish", headers=h)
    assert len(client.fake.published) == count  # updated in place, no second live copy
    live_prompts = [get_prompt(d) for (org, _), d in client.fake.published.items()]
    assert live_prompts.count("Updated words.") == 2


async def test_pause_resume_rules(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    a = await new_agent(client, tok)
    assert (await client.post(f"/product/agents/{a['id']}/pause", headers=h)).status_code == 400
    await client.post(f"/product/agents/{a['id']}/publish", headers=h)
    assert (await client.post(f"/product/agents/{a['id']}/pause", headers=h)).json()["status"] == "paused"
    assert (await client.post(f"/product/agents/{a['id']}/resume", headers=h)).json()["status"] == "live"
    assert (await client.post(f"/product/agents/{a['id']}/resume", headers=h)).status_code == 400


async def test_readiness_blocks_go_live_when_prompt_empty(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    a = await new_agent(client, tok, business="")
    checks = {c["id"]: c["level"] for c in (await client.get(f"/product/agents/{a['id']}/readiness", headers=h)).json()}
    assert checks == {"models": "ok", "prompt": "ok", "business": "warn", "voice": "warn"}
    await client.patch(f"/product/agents/{a['id']}", json={"prompt": ""}, headers=h)
    checks = {c["id"]: c["level"] for c in (await client.get(f"/product/agents/{a['id']}/readiness", headers=h)).json()}
    assert checks["prompt"] == "blocker"
    r = await client.post(f"/product/agents/{a['id']}/publish", headers=h)
    assert r.status_code == 400 and r.json()["detail"]["code"] == "not_ready"


async def test_duplicate_makes_independent_draft(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    a = await new_agent(client, tok)
    await client.post(f"/product/agents/{a['id']}/publish", headers=h)
    d = (await client.post(f"/product/agents/{a['id']}/duplicate", headers=h)).json()
    assert d["id"] != a["id"] and d["status"] == "draft" and d["name"].endswith("(copy)")


async def test_validation_and_no_platform_names(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    assert (await client.post("/product/agents", json={"name": ""}, headers=h)).status_code == 422
    assert (await client.post("/product/agents", json={"name": "x", "template": "nope"}, headers=h)).status_code == 400
    a = await new_agent(client, tok)
    assert (await client.patch(f"/product/agents/{a['id']}", json={"brain": "huge"}, headers=h)).status_code == 400
    assert "dograh" not in (await client.get(f"/product/agents/{a['id']}", headers=h)).text.lower()


def test_language_paragraph_is_swapped_in_a_hand_edited_prompt():
    from api.product import style as st

    one = "Be kind.\n\n" + st.language_rule(["English"])
    two = st.with_language_rule(one, ["English", "Hindi"])
    assert two.startswith("Be kind.") and "You speak English and Hindi" in two and two.count("Languages:") == 1
    assert "Languages:" not in st.with_language_rule(two, [])


async def test_saving_languages_updates_a_hand_edited_prompt(client):
    _, tok = await signup(client, "a@x.com")
    a = await new_agent(client, tok)
    h = bearer(tok)
    await client.patch(f"/product/agents/{a['id']}", json={"prompt": "Custom text."}, headers=h)
    r = await client.patch(f"/product/agents/{a['id']}", json={"style": {"languages": ["English", "Hindi"]}}, headers=h)
    assert r.status_code == 200, r.text
    p = r.json()["prompt"]
    assert p.startswith("Custom text.") and "English and Hindi" in p


async def test_voicemail_detection_is_a_per_agent_setting(client):
    from api.product import style as st

    assert st.workflow_settings({"voicemail_detect": True})["voicemail_detection"] == {"enabled": True, "use_workflow_llm": True}
    assert st.workflow_settings({"voicemail_detect": False})["voicemail_detection"]["enabled"] is False
    assert "voicemail_detection" not in st.workflow_settings({})
    _, tok = await signup(client, "a@x.com")
    a = await new_agent(client, tok)
    r = await client.patch(f"/product/agents/{a['id']}", json={"style": {"voicemail_detect": True}}, headers=bearer(tok))
    assert r.status_code == 200 and r.json()["style"]["voicemail_detect"] is True
