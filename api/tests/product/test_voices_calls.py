"""Voices catalogue and browser test-call authorisation.

    DATABASE_URL=postgresql+asyncpg://x/x REDIS_URL=redis://x \
    python -m pytest api/tests/product --noconftest
"""

import pytest_asyncio
from sqlalchemy import select

from api.db import models, product_models
from api.product import calls_router, config, voices
from api.tests.product.support import bearer, make_client, signup


@pytest_asyncio.fixture
async def client(monkeypatch):
    async with make_client(monkeypatch) as c:
        yield c


class FakeWS:
    """Just enough of a WebSocket for the authorisation + hand-off logic."""

    def __init__(self, origin="http://app.test", host="app.test", token=None):
        self.headers = {k: v for k, v in {"origin": origin, "host": host}.items() if v}
        self.cookies = {config.SESSION_COOKIE_NAME: token} if token else {}
        self.closed: tuple[int, str] | None = None
        self.accepted = False
        self.sent: list[dict] = []

    async def close(self, code=1000, reason=""):
        self.closed = (code, reason)

    async def accept(self):
        self.accepted = True

    async def send_json(self, data):
        self.sent.append(data)


async def agent_for(client, tok, **hdr):
    r = await client.post(
        "/product/agents", json={"name": "Priya", "template": "receptionist"}, headers=bearer(tok, **hdr)
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


# ---------- voices ----------
def test_catalogue_is_unique_and_hides_the_vendor(monkeypatch):
    monkeypatch.setenv("PRODUCT_VOICE_ENGINES", "sarvam")
    cat = voices.catalogue()
    assert len(cat) == len({v.id for v in cat}) > 100
    assert {v.provider for v in cat} == {"Engine A"}


def test_new_engines_have_real_voices_and_neutral_names(monkeypatch):
    monkeypatch.setenv("PRODUCT_VOICE_ENGINES", "inworld,google")
    cat = voices.catalogue()
    assert len(cat) == len({v.id for v in cat}) > 300
    assert {v.provider for v in cat} == {"Studio", "Gemini"}
    seema = next(v for v in cat if v.name == "Seema")
    assert seema.language.startswith("Hindi") and seema.gender == "Female" and seema.age
    assert next(v for v in cat if v.name == "Zephyr").style == "Bright" and next(v for v in cat if v.name == "Zephyr").gender is None
    assert all(v.id.startswith("vc_") for v in cat)


def test_unknown_metadata_is_not_invented(monkeypatch):
    monkeypatch.setenv("PRODUCT_VOICE_ENGINES", "sarvam")  # this engine publishes no gender/age/accent
    v = voices.catalogue()[0]
    assert v.gender is None and v.age is None and v.accent is None


async def test_voice_list_filters_and_never_leaks_routing(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    allv = (await client.get("/product/voices", headers=h)).json()
    hindi = (await client.get("/product/voices?language=hindi", headers=h)).json()
    assert len(allv) > len(hindi) > 0 and all(v["language"] == "Hindi" for v in hindi)
    assert "tts" not in allv[0] and "sarvam" not in str(allv).lower()
    q = (await client.get("/product/voices?q=aayan", headers=h)).json()
    assert q and all("aayan" in v["name"].lower() for v in q)


async def test_favourites_are_per_user(client):
    _, tok_a = await signup(client, "a@x.com")
    _, tok_b = await signup(client, "b@x.com")
    client.cookies.clear()
    vid = (await client.get("/product/voices", headers=bearer(tok_a))).json()[0]["id"]
    assert (await client.put(f"/product/voices/{vid}/favorite", headers=bearer(tok_a))).json()["favorite"] is True
    mine = (await client.get("/product/voices", headers=bearer(tok_a))).json()
    theirs = (await client.get("/product/voices", headers=bearer(tok_b))).json()
    assert [v["id"] for v in mine if v["favorite"]] == [vid]
    assert not any(v["favorite"] for v in theirs)
    await client.delete(f"/product/voices/{vid}/favorite", headers=bearer(tok_a))
    assert not any(v["favorite"] for v in (await client.get("/product/voices", headers=bearer(tok_a))).json())
    assert (await client.put("/product/voices/vc_nope/favorite", headers=bearer(tok_a))).status_code == 404


async def test_agent_voice_must_exist_in_catalogue(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    aid = await agent_for(client, tok)
    vid = (await client.get("/product/voices", headers=h)).json()[0]["id"]
    ok = await client.patch(f"/product/agents/{aid}", json={"voice_id": vid}, headers=h)
    assert ok.status_code == 200 and ok.json()["voice_id"] == vid
    bad = await client.patch(f"/product/agents/{aid}", json={"voice_id": "vc_made_up"}, headers=h)
    assert bad.status_code == 400 and bad.json()["detail"]["code"] == "unknown_voice"


# ---------- test calls ----------
def test_origin_rules():
    ok = calls_router.origin_allowed
    assert ok("http://app.test", "app.test", set())
    assert not ok(None, "app.test", set())
    assert not ok("http://evil.test", "app.test", set())
    assert ok("http://localhost:5174", "localhost:8000", {"http://localhost:5174"})


async def test_ice_endpoint_needs_sign_in_and_returns_servers(client):
    assert (await client.get("/product/call/ice")).status_code == 401
    _, tok = await signup(client, "a@x.com")
    r = await client.get("/product/call/ice", headers=bearer(tok))
    assert r.status_code == 200 and r.json()["ice_servers"][0]["urls"]


async def _run(client, ws, agent_id, workspace=None):
    async with client.session_factory() as s:
        await calls_router.test_call(ws, agent_id, workspace, s, client.fake)


async def test_call_runs_in_test_org_and_hands_off(client):
    me, tok = await signup(client, "a@x.com")
    aid = await agent_for(client, tok)
    ws = FakeWS(token=tok)
    await _run(client, ws, aid)
    async with client.session_factory() as s:
        w = (await s.execute(select(product_models.ProductWorkspaceModel))).scalar_one()
    assert ws.accepted and ws.closed == (1000, "")  # normal close by the hand-off, not a rejection
    assert [r[0] for r in client.fake.runs] == [w.test_org_id]  # never the live org
    assert client.fake.served and client.fake.served[0][0] == w.test_org_id


async def test_call_rejections_carry_a_reason(client):
    me_a, tok_a = await signup(client, "a@x.com")
    me_b, tok_b = await signup(client, "b@x.com")
    aid = await agent_for(client, tok_a, **{config.WORKSPACE_HEADER: me_a["current_workspace"]["id"]})
    cases = {
        "origin_not_allowed": FakeWS(origin="http://evil.test", token=tok_a),
        "not_signed_in": FakeWS(token=None),
        "session_expired": FakeWS(token="garbage"),
        "agent_not_found": FakeWS(token=tok_b),  # B can't see A's agent
    }
    for reason, ws in cases.items():
        await _run(client, ws, aid)
        assert ws.closed == (1008, reason), (reason, ws.closed)
        assert ws.accepted  # accepted only so the browser can read the reason
    other = FakeWS(token=tok_b)
    await _run(client, other, aid, workspace=me_a["current_workspace"]["id"])
    assert other.closed == (1008, "workspace_not_found")
    assert client.fake.runs == [] and client.fake.served == []


async def test_viewer_cannot_start_a_call(client):
    me_a, tok_a = await signup(client, "a@x.com")
    _, tok_b = await signup(client, "b@x.com")
    aid = await agent_for(client, tok_a)
    async with client.session_factory() as s:
        w = (await s.execute(select(product_models.ProductWorkspaceModel).where(
            product_models.ProductWorkspaceModel.public_id == me_a["current_workspace"]["id"]))).scalar_one()
        b = (await s.execute(select(models.UserModel).where(models.UserModel.email == "b@x.com"))).scalar_one()
        s.add(product_models.ProductMembershipModel(workspace_id=w.id, user_id=b.id, role="viewer"))
        await s.commit()
    ws = FakeWS(token=tok_b)
    await _run(client, ws, aid, workspace=me_a["current_workspace"]["id"])
    assert ws.closed == (1008, "not_allowed") and client.fake.runs == []
