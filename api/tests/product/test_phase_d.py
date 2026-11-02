"""A slab you reach is kept, old calls keep their price, questions and answers go into the global prompt."""

from datetime import UTC, datetime

import pytest_asyncio
from sqlalchemy import select

from api.db import models, product_models
from api.product import definition as defn
from api.product import pricing, rates
from api.tests.product.support import bearer, make_client, signup
from api.tests.product.test_billing import add_usage
from api.tests.product.test_platform import add_run, make_agent, workspace


@pytest_asyncio.fixture
async def client(monkeypatch):
    async with make_client(monkeypatch) as c:
        yield c


async def set_balance(client, org_id, amount):
    async with client.session_factory() as s:
        org = await s.get(models.OrganizationModel, org_id)
        org.balance = amount
        await s.commit()


async def test_a_slab_once_reached_is_kept_when_the_balance_falls(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    await client.get("/product/billing/summary", headers=h)  # turns billing on for the workspace
    ws = await workspace(client)
    await set_balance(client, ws.live_org_id, 100000)
    best = (await client.get("/product/billing/summary", headers=h)).json()["price_per_min"]
    assert best == pricing.rate_for_balance(100000) and best < 6.75
    await set_balance(client, ws.live_org_id, 1000)  # spent most of it
    again = (await client.get("/product/billing/summary", headers=h)).json()
    assert again["price_per_min"] == best
    async with client.session_factory() as s:
        assert (await s.get(product_models.ProductBillingSettingsModel, ws.id)).locked_rate == best
        assert (await s.get(models.OrganizationModel, ws.live_org_id)).billing_rate == best


async def test_calls_keep_the_price_they_were_charged_at(client):
    me, tok = await signup(client, "a@x.com")
    h = {**bearer(tok), "X-Environment": "live"}
    ws = await workspace(client)
    agent_id, _ = await make_agent(client, h)
    live_wf = 4242
    old = await add_run(client, ws.live_org_id, live_wf)
    new = await add_run(client, ws.live_org_id, live_wf)
    await add_usage(client, ws.live_org_id, datetime.now(UTC), 60, rate=6.75, run=old)
    await add_usage(client, ws.live_org_id, datetime.now(UTC), 60, rate=5.0, run=new)
    await set_balance(client, ws.live_org_id, 100000)  # today's price is lower than both
    calls = {c["id"]: c["cost"] for c in (await client.get("/product/conversations", headers=h)).json()["calls"]}
    from api.product.ids import encode_call_id

    assert calls[encode_call_id(old)] == 6.75 and calls[encode_call_id(new)] == 5.0
    async with client.session_factory() as s:
        assert (await rates.run_rates(s, ws))[old] == 6.75


def test_questions_and_answers_become_one_global_node():
    g = defn.build_definition(name="Bot", prompt="You help callers.", greeting="Hi")
    out = defn.with_qa(g, [{"q": "Opening hours?", "a": "9 to 6."}, {"q": "", "a": "skipped"}])
    node = next(n for n in out["nodes"] if n["id"] == defn.QA_NODE)
    assert node["type"] == "globalNode" and "Q: Opening hours?" in node["data"]["prompt"] and "A: 9 to 6." in node["data"]["prompt"] and "skipped" not in node["data"]["prompt"]
    assert next(n for n in out["nodes"] if n["type"] == "startCall")["data"]["add_global_prompt"] is True
    assert not any(n["id"] == defn.QA_NODE for n in defn.with_qa(out, [])["nodes"])  # emptying the list removes it


async def test_saving_questions_updates_the_agent_graph_and_rejects_bad_input(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    agent_id, wf = await make_agent(client, h)
    r = await client.patch(f"/product/agents/{agent_id}", json={"style": {"qa": [{"q": "Do you open on Sunday?", "a": "No, we are closed."}, {"q": " ", "a": "x"}]}}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["style"]["qa"] == [{"q": "Do you open on Sunday?", "a": "No, we are closed."}]
    graph = await client.fake.working_definition((await workspace(client)).test_org_id, wf)
    assert any(n["id"] == defn.QA_NODE and "closed" in n["data"]["prompt"] for n in graph["nodes"])
    assert (await client.patch(f"/product/agents/{agent_id}", json={"style": {"qa": "nope"}}, headers=h)).status_code == 400
