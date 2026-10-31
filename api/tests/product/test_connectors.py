"""Connected services, bring-your-own number, network allow-list, company sign-in, unanswered questions."""

import httpx
import pytest_asyncio
from sqlalchemy import select

from api.db import product_models
from api.product import connectors, connectors_router, insights, numbers_router
from api.tests.product.support import bearer, make_client, signup


@pytest_asyncio.fixture
async def client(monkeypatch):
    async with make_client(monkeypatch) as c:
        yield c


def _settings_base(s: dict) -> dict:
    return {k: s[k] for k in ("record_calls", "redact_pii", "retention_days", "widget_origins", "summary_emails")}


async def test_catalog_lists_every_service_and_checks_required_fields(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    ids = {c["id"] for c in (await client.get("/product/connectors", headers=h)).json()}
    assert {"slack", "hubspot", "shopify", "google_calendar", "calendly", "whatsapp", "google_sheets", "razorpay_links", "salesforce", "zoho"} <= ids
    bad = await client.put("/product/connectors/slack", json={"config": {}}, headers=h)
    assert bad.status_code == 400 and "Incoming webhook" in bad.json()["detail"]["message"]
    assert (await client.put("/product/connectors/nope", json={"config": {}}, headers=h)).status_code == 404


async def test_each_connector_client_talks_to_its_service():
    calls = []

    def handler(req: httpx.Request) -> httpx.Response:
        calls.append((req.method, str(req.url)))
        u = str(req.url)
        if "contacts/search" in u:
            return httpx.Response(200, json={"results": []})
        if u.endswith("/crm/v3/objects/contacts") and req.method == "POST":
            return httpx.Response(201, json={"id": "7"})
        if "orders.json" in u:
            return httpx.Response(200, json={"orders": [{"name": "#1001", "financial_status": "paid", "fulfillment_status": "fulfilled", "total_price": "499", "currency": "INR",
                                                         "fulfillments": [{"tracking_number": "T1", "tracking_url": "https://t/1"}]}]})
        return httpx.Response(200, json={"id": "plink_1"})

    async with connectors.client(httpx.MockTransport(handler)) as http:
        ev = {"name": "Asha", "phone": "+919999999999", "summary": "Wants a refund.", "mood": "upset", "when": "2026-12-23 10:00", "link": "https://app/x"}
        await connectors.REGISTRY["hubspot"].push({"token": "t"}, http, ev)
        await connectors.REGISTRY["slack"].push({"webhook_url": "https://hooks.slack.com/x"}, http, ev)
        order = await connectors.REGISTRY["shopify"].actions[0].run({"shop": "s.myshopify.com", "token": "t"}, http, {"order_number": "1001"})
        link = await connectors.REGISTRY["razorpay_links"].actions[0].run({"key_id": "k", "key_secret": "s"}, http, {"amount": "499", "phone": "+919999999999"})
    assert order["found"] and order["shipping"] == "fulfilled" and order["tracking"] == "T1"
    assert link["sent"]
    urls = [u for _, u in calls]
    assert any("objects/notes" in u for u in urls) and any("hooks.slack.com" in u for u in urls)


async def test_connect_registers_tools_and_the_secret_address_runs_the_action(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)

    def handler(req):
        if "orders.json" in str(req.url):
            return httpx.Response(200, json={"orders": [{"name": "#1", "financial_status": "paid", "fulfillment_status": None, "total_price": "10", "currency": "INR", "fulfillments": []}]})
        return httpx.Response(200, json={})

    client._transport.app.dependency_overrides[connectors_router.get_transport] = lambda: httpx.MockTransport(handler)
    r = await client.put("/product/connectors/shopify", json={"config": {"shop": "s.myshopify.com", "token": "shpat_secret"}}, headers=h)
    assert r.status_code == 200, r.text
    tools = [t for ts in client.tools.items.values() for t in ts]
    assert "Shopify: Look up an order" in [t["name"] for t in tools]
    shown = next(c for c in (await client.get("/product/connectors", headers=h)).json() if c["id"] == "shopify")
    assert shown["connected"] and next(f for f in shown["fields"] if f["key"] == "token")["value"] == connectors_router.MASK
    path = next(t["definition"]["config"]["url"] for t in tools).split("/api/v1")[1]
    out = await client.post(path, json={"order_number": "1"})
    assert out.status_code == 200 and out.json()["found"] is True
    assert (await client.post(path.rsplit("/", 1)[0] + "/nope", json={})).status_code == 404
    assert (await client.delete("/product/connectors/shopify", headers=h)).status_code == 204


async def test_network_allow_list_cannot_lock_you_out_and_blocks_others(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    base = _settings_base((await client.get("/product/team/settings", headers=h)).json())
    r = await client.put("/product/team/settings", json={**base, "ip_allowlist": ["10.0.0.0/8"]}, headers=h)
    assert r.status_code == 400 and r.json()["detail"]["code"] == "would_lock_out"
    assert (await client.put("/product/team/settings", json={**base, "ip_allowlist": ["bogus"]}, headers=h)).status_code == 400
    ok = await client.put("/product/team/settings", json={**base, "ip_allowlist": ["127.0.0.0/8", "::1"]}, headers=h)
    assert ok.status_code == 200, ok.text
    async with client.session_factory() as s:
        row = (await s.scalars(select(product_models.ProductSettingsModel))).first()
        row.ip_allowlist = ["10.0.0.0/8"]
        await s.commit()
    blocked = await client.get("/product/me", headers=h)
    assert blocked.status_code == 403 and blocked.json()["detail"]["code"] == "network_not_allowed"


async def test_company_sign_in_blocks_passwords_for_that_domain(client):
    _, tok = await signup(client, "boss@acme.com")
    h = bearer(tok)
    base = _settings_base((await client.get("/product/team/settings", headers=h)).json())
    assert (await client.put("/product/team/settings", json={**base, "sso_required": True}, headers=h)).status_code == 400
    ok = await client.put("/product/team/settings", json={**base, "sso_domain": "acme.com", "sso_required": True}, headers=h)
    assert ok.status_code == 200 and ok.json()["sso_required"] is True
    r = await client.post("/product/auth/login", json={"email": "boss@acme.com", "password": "password123"})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "sso_required"


async def test_bring_your_own_number(client, monkeypatch):
    _, tok = await signup(client, "a@x.com")
    live = {**bearer(tok), "X-Environment": "live"}

    class Carrier:
        async def link_existing(self, number, webhook_url):
            if number.endswith("0000"):
                raise numbers_router.providers.NumberError("That number isn't on this Plivo account.")

    monkeypatch.setattr(numbers_router, "make_carrier", lambda *a: Carrier())
    body = {"carrier": "plivo", "number": "+14155550123", "details": {"auth_id": "MA123", "auth_token": "tok123"}}
    r = await client.post("/product/numbers/bring", json=body, headers=live)
    assert r.status_code == 201, r.text
    assert (await client.post("/product/numbers/bring", json=body, headers=live)).status_code == 409
    assert (await client.post("/product/numbers/bring", json={**body, "number": "+14155550000"}, headers=live)).status_code == 400
    assert (await client.post("/product/numbers/bring", json=body, headers=bearer(tok))).status_code == 400  # practice mode
    assert (await client.post("/product/numbers/bring", json={"carrier": "vobiz", "number": "+14155550199", "details": {}}, headers=live)).status_code == 400  # missing details
    other = await client.post("/product/numbers/bring", json={"carrier": "vonage", "number": "+14155550188", "details": {"api_key": "k", "api_secret": "s", "application_id": "a", "private_key": "p"}}, headers=live)
    assert other.status_code == 201, other.text
    names = [c["id"] for c in (await client.get("/product/numbers/carriers", headers=live)).json()]
    assert {"twilio", "plivo", "vobiz", "telnyx", "vonage", "cloudonix", "ari"} <= set(names)
    assert (await client.delete(f"/product/numbers/{r.json()['id']}", headers=live)).status_code == 204


def test_unanswered_questions_are_read_from_the_summary():
    raw = '{"summary": "x", "sentiment": 3, "unanswered": ["Do you open on Sunday?", " ", "Is parking free?"]}'
    assert insights.unanswered_of(raw) == ["Do you open on Sunday?", "Is parking free?"]
    assert insights.unanswered_of("nonsense") == []
