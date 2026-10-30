"""Bringing an existing organization over, and switching between the classic and new UI."""

import pytest_asyncio
from sqlalchemy import insert, select

from api.db import models, product_models
from api.product.definition import build_definition
from api.tests.product.support import bearer, make_client, signup
from api.utils.auth import decode_jwt_token, hash_password


@pytest_asyncio.fixture
async def client(monkeypatch):
    async with make_client(monkeypatch) as c:
        yield c


async def make_old_account(client, email="old@x.com", role="admin", org_name="Swarvo Clinic", org=None):
    """An account that existed before the new product: a user, an organization, and some agents."""
    async with client.session_factory() as s:
        u = models.UserModel(provider_id=f"old_{email}", email=email, password_hash=hash_password("old-password"), role=role)
        s.add(u)
        if org is None:
            org = models.OrganizationModel(provider_id=f"org_{org_name}", name=org_name)
            s.add(org)
        await s.flush()
        await s.execute(insert(models.organization_users_association).values(user_id=u.id, organization_id=org.id))
        await s.commit()
        return u.id, org.id


async def login(client, email, password="old-password"):
    r = await client.post("/product/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json(), r.cookies.get("vocalis_session")


def seed_agent(client, org_id, name, extra=None):
    d = build_definition(name=name, prompt=f"You are {name}.", greeting="Hi")
    d["nodes"][0]["data"].update({"document_uuids": ["live-doc"], "tool_uuids": ["live-tool"], **(extra or {})})
    d["nodes"].append({"id": "trig", "type": "trigger", "position": {"x": 0, "y": 0}, "data": {"name": "API", "trigger_path": "abc"}})
    d["edges"].append({"id": "t", "source": "trig", "target": "start", "data": {"label": "x", "condition": "y"}})
    i = len(client.fake.published) + 100
    client.fake.published[(org_id, i)] = d
    client.fake.names[(org_id, i)] = name
    return i


async def test_existing_account_logs_in_to_a_setup_screen_then_imports_in_place(client):
    uid, org_id = await make_old_account(client)
    a1, a2, archived = seed_agent(client, org_id, "Front desk"), seed_agent(client, org_id, "Bookings"), seed_agent(client, org_id, "Old one")
    client.fake.archived.add((org_id, archived))

    body, tok = await login(client, "old@x.com")
    assert body["setup_required"] is True and body["user"]["email"] == "old@x.com"
    h = bearer(tok)
    assert (await client.get("/product/me", headers=h)).json()["detail"]["code"] == "no_workspace"

    cands = (await client.get("/product/import/candidates", headers=h)).json()
    assert [(c["name"], c["agents"]) for c in cands] == [("Swarvo Clinic", 2)]  # archived agents aren't counted
    r = await client.post("/product/import", json={"organization_id": cands[0]["id"]}, headers=h)
    assert r.status_code == 201 and (r.json()["imported"], r.json()["skipped"]) == (2, 1)

    me = (await client.get("/product/me", headers=h)).json()
    assert me["current_workspace"]["role"] == "owner" and me["current_workspace"]["name"] == "Swarvo Clinic"
    agents = (await client.get("/product/agents", headers=h)).json()
    assert {a["name"] for a in agents} == {"Front desk", "Bookings"} and all(a["status"] == "live" and a["prompt_mode"] == "custom" for a in agents)

    async with client.session_factory() as s:
        ws = (await s.execute(select(product_models.ProductWorkspaceModel))).scalar_one()
        rows = (await s.execute(select(product_models.ProductAgentModel))).scalars().all()
    assert ws.live_org_id == org_id and ws.adopted and ws.test_org_id != org_id  # the old organization is the Live side, in place
    assert {r.live_workflow_id for r in rows} == {a1, a2}  # live agents were not moved or copied
    copy = client.fake.published[(ws.test_org_id, rows[0].test_workflow_id)]
    assert all(not n["data"].get("document_uuids") and not n["data"].get("tool_uuids") for n in copy["nodes"])  # no links into the live org
    assert not any(n["type"] == "trigger" for n in copy["nodes"]) and all(e["source"] != "trig" for e in copy["edges"])
    assert client.fake.published[(org_id, a1)]["nodes"][-1]["type"] == "trigger"  # the live original is untouched

    again = await client.post("/product/import", json={"organization_id": cands[0]["id"]}, headers=h)
    assert again.status_code == 409 and again.json()["detail"]["code"] == "already_imported"
    assert (await client.get("/product/import/candidates", headers=h)).json() == []


async def test_import_is_limited_to_your_own_organization_and_admins(client):
    _, org_a = await make_old_account(client, "a@x.com", org_name="A Co")
    await make_old_account(client, "b@x.com", org_name="B Co")
    _, tok_b = await login(client, "b@x.com")
    from api.product.ids import encode_id

    r = await client.post("/product/import", json={"organization_id": encode_id("org", org_a)}, headers=bearer(tok_b))
    assert r.status_code == 404 and r.json()["detail"]["code"] == "organization_not_found"
    assert (await client.post("/product/import", json={"organization_id": "org_bogus"}, headers=bearer(tok_b))).status_code == 404

    _, org_c = await make_old_account(client, "c@x.com", org_name="C Co")
    await make_old_account(client, "viewer@x.com", role="client", org=await _org(client, org_c))
    _, tok_v = await login(client, "viewer@x.com")
    cands = (await client.get("/product/import/candidates", headers=bearer(tok_v))).json()
    assert cands == []  # a non-admin is never offered the import
    assert (await client.post("/product/import", json={"organization_id": encode_id("org", org_c)}, headers=bearer(tok_v))).status_code == 403


async def _org(client, org_id):
    async with client.session_factory() as s:
        return await s.get(models.OrganizationModel, org_id)


async def test_other_members_come_over_with_matching_roles_and_adopted_billing_is_left_alone(client):
    _, org_id = await make_old_account(client, "boss@x.com")
    await make_old_account(client, "mate@x.com", role="admin", org=await _org(client, org_id))
    await make_old_account(client, "staff@x.com", role="client", org=await _org(client, org_id))
    async with client.session_factory() as s:
        o = await s.get(models.OrganizationModel, org_id)
        o.wallet_enabled, o.billing_rate, o.billing_currency = False, 3.5, "USD"
        await s.commit()
    _, tok = await login(client, "boss@x.com")
    cid = (await client.get("/product/import/candidates", headers=bearer(tok))).json()[0]["id"]
    await client.post("/product/import", json={"organization_id": cid}, headers=bearer(tok))
    async with client.session_factory() as s:
        roles = {u.email: m.role for m, u in (await s.execute(
            select(product_models.ProductMembershipModel, models.UserModel).join(models.UserModel, models.UserModel.id == product_models.ProductMembershipModel.user_id))).all()}
        before = await s.get(models.OrganizationModel, org_id)
        rate_before = before.billing_rate
    assert roles == {"boss@x.com": "owner", "mate@x.com": "admin", "staff@x.com": "viewer"}
    await client.get("/product/billing/summary", headers=bearer(tok))
    async with client.session_factory() as s:
        after = await s.get(models.OrganizationModel, org_id)
    assert (after.wallet_enabled, after.billing_rate, after.billing_currency) == (False, rate_before, "USD")  # their billing was not rewritten


# ---------- switching between the two UIs ----------
async def test_handoff_to_the_new_ui_is_single_use_and_not_a_session(client):
    _, tok = await signup(client, "a@x.com")
    client.cookies.clear()
    code = (await client.post("/product/auth/handoff", json={"to": "product"}, headers=bearer(tok))).json()["code"]
    assert (await client.get("/product/me", headers=bearer(code))).status_code == 401  # a code is never a session
    assert (await client.post("/product/auth/handoff/redeem", json={"code": code, "to": "classic"})).status_code == 400  # wrong destination
    ok = await client.post("/product/auth/handoff/redeem", json={"code": code, "to": "product"})
    assert ok.status_code == 200 and (await client.get("/product/me")).json()["user"]["email"] == "a@x.com"  # cookie set
    client.cookies.clear()
    assert (await client.post("/product/auth/handoff/redeem", json={"code": code, "to": "product"})).status_code == 400  # used once
    assert (await client.post("/product/auth/handoff/redeem", json={"code": "junk", "to": "product"})).status_code == 400
    assert (await client.post("/product/auth/handoff", json={"to": "product"})).status_code == 401  # needs a session to start


async def test_handoff_to_the_classic_ui_returns_a_platform_session(client):
    me, tok = await signup(client, "a@x.com")
    client.cookies.clear()
    code = (await client.post("/product/auth/handoff", json={"to": "classic"}, headers=bearer(tok))).json()["code"]
    r = (await client.post("/product/auth/handoff/redeem", json={"code": code, "to": "classic"})).json()
    claims = decode_jwt_token(r["token"])
    assert claims["email"] == "a@x.com" and r["user"]["email"] == "a@x.com" and r["user"]["organizationId"]
    assert (await client.post("/product/auth/handoff/redeem", json={"code": code, "to": "classic"})).status_code == 400
