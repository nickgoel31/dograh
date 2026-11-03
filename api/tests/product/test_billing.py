"""Billing: summary, spend limit, top-ups (idempotent), GST invoices, scoping."""

import json
from datetime import UTC, datetime

import pytest_asyncio
from sqlalchemy import select

from api.db import models, product_models
from api.product import billing, payments
from api.tests.product.support import bearer, make_client, signup


@pytest_asyncio.fixture
async def client(monkeypatch):
    async with make_client(monkeypatch) as c:
        yield c


class FakePay:
    name, public_key = "fake", "key_x"

    async def create_order(self, amount, currency, receipt):
        return f"order_{receipt}"

    def verify_checkout(self, order_id, payment_id, signature):
        return signature == "good"

    def verify_webhook(self, body, signature):
        return signature == "sig"


async def ws_of(client):
    async with client.session_factory() as s:
        return (await s.execute(select(product_models.ProductWorkspaceModel))).scalars().first()


async def add_usage(client, org_id, when, seconds, rate=6.0, charged=None, run=None):
    async with client.session_factory() as s:
        s.add(models.WalletLedgerModel(
            organization_id=org_id, entry_type="usage", workflow_run_id=run, billed_seconds=seconds, rate_snapshot=rate,
            money_delta=-(charged if charged is not None else seconds / 60 * rate), created_at=when))
        await s.commit()


def test_limit_state_thresholds():
    assert [billing.limit_state(100, v) for v in (0, 79.9, 80, 99.9, 100)] == ["ok", "ok", "warn", "warn", "limit"]
    assert billing.limit_state(None, 1e9) == "ok" and billing.limit_state(0, 5) == "ok"


def test_gst_split_by_state(monkeypatch):
    monkeypatch.setenv("PRODUCT_GST_RATE", "18")
    same = billing.compute_tax(1000.0, "29", "29")
    assert same == {"rate": 18.0, "cgst": 90.0, "sgst": 90.0, "igst": 0.0}
    assert billing.compute_tax(1000.0, "29", "27")["igst"] == 180.0
    assert billing.compute_tax(1000.0, "29", None)["igst"] == 180.0  # unknown customer state => IGST


async def test_summary_enables_live_billing_and_gives_free_minutes_once(client, monkeypatch):
    monkeypatch.setenv("PRODUCT_FREE_MINUTES", "20")
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    s = (await client.get("/product/billing/summary", headers=h)).json()
    assert s["price_per_min"] == 6.75 and s["free_mode"] is False and s["minutes_available"] == 20
    await client.get("/product/billing/summary", headers=h)
    assert client.wallet.minutes == 20  # not granted twice
    ws = await ws_of(client)
    async with client.session_factory() as s2:
        live = await s2.get(models.OrganizationModel, ws.live_org_id)
        test = await s2.get(models.OrganizationModel, ws.test_org_id)
    assert live.wallet_enabled and live.billing_rate == 6.75 and not test.wallet_enabled  # Test never bills
    assert (await client.get("/product/billing/summary", headers={**h, "X-Environment": "live"})).json()["free_mode"] is False


async def test_spend_limit_alerts_and_usage(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    ws = await ws_of(client)
    now = datetime.now(UTC)
    await add_usage(client, ws.live_org_id, now, 600)  # 10 min x 6 = 60
    await client.patch("/product/billing/settings", json={"spend_limit": 100}, headers=h)
    assert (await client.get("/product/billing/summary", headers=h)).json()["limit_state"] == "ok"
    await add_usage(client, ws.live_org_id, now, 300)  # +30 => 90 (>= 80%)
    s = (await client.get("/product/billing/summary", headers=h)).json()
    assert s["limit_state"] == "warn" and s["month_usage_value"] == 90 and s["month_minutes"] == 15
    await add_usage(client, ws.live_org_id, now, 120)  # +12 => 102
    assert (await client.get("/product/billing/summary", headers=h)).json()["limit_state"] == "limit"
    async with client.session_factory() as s2:
        assert await billing.limit_reached(s2, ws.live_org_id) is True
    u = (await client.get("/product/billing/usage?days=7", headers=h)).json()
    assert round(sum(d["value"] for d in u["by_day"]), 2) == 102
    await client.patch("/product/billing/settings", json={"clear_spend_limit": True}, headers=h)
    assert (await client.get("/product/billing/summary", headers=h)).json()["limit_state"] == "ok"


async def test_topup_flow_is_verified_and_idempotent(client, monkeypatch):
    monkeypatch.setattr(payments, "get_payments", lambda: FakePay())
    import api.product.billing_router as br

    monkeypatch.setattr(br, "get_payments", lambda: FakePay())
    _, tok = await signup(client, "a@x.com")
    h, live = bearer(tok), {**bearer(tok), "X-Environment": "live"}
    assert (await client.post("/product/billing/topups", json={"amount": 500}, headers=h)).json()["detail"]["code"] == "test_is_free"
    assert (await client.post("/product/billing/topups", json={"amount": 5}, headers=live)).json()["detail"]["code"] == "bad_amount"
    t = (await client.post("/product/billing/topups", json={"amount": 500}, headers=live)).json()
    assert t["key"] == "key_x" and t["amount"] == 500

    bad = await client.post("/product/billing/topups/confirm", json={"order_id": t["order_id"], "payment_id": "p1", "signature": "forged"}, headers=live)
    assert bad.status_code == 400 and client.wallet.balance == 0
    for _ in range(2):  # confirm twice: credited once
        assert (await client.post("/product/billing/topups/confirm", json={"order_id": t["order_id"], "payment_id": "p1", "signature": "good"}, headers=live)).status_code == 200
    assert client.wallet.balance == 500

    # provider webhook for the same order does not double-credit; wrong signature is rejected
    ev = json.dumps({"event": "payment.captured", "payload": {"payment": {"entity": {"id": "p1", "order_id": t["order_id"]}}}})
    assert (await client.post("/product/billing/webhooks/razorpay", content=ev, headers={"X-Razorpay-Signature": "nope"})).status_code == 400
    assert (await client.post("/product/billing/webhooks/razorpay", content=ev, headers={"X-Razorpay-Signature": "sig"})).status_code == 200
    assert client.wallet.balance == 500
    assert [p["status"] for p in (await client.get("/product/billing/payments", headers=live)).json()] == ["paid"]


async def test_webhook_credits_when_confirm_never_happened(client, monkeypatch):
    import api.product.billing_router as br

    monkeypatch.setattr(br, "get_payments", lambda: FakePay())
    _, tok = await signup(client, "a@x.com")
    live = {**bearer(tok), "X-Environment": "live"}
    t = (await client.post("/product/billing/topups", json={"amount": 250}, headers=live)).json()
    ev = json.dumps({"event": "order.paid", "payload": {"payment": {"entity": {"id": "p9", "order_id": t["order_id"]}}}})
    client.cookies.clear()  # the provider has no login
    assert (await client.post("/product/billing/webhooks/razorpay", content=ev, headers={"X-Razorpay-Signature": "sig"})).status_code == 200
    assert client.wallet.balance == 250


async def test_invoices_are_issued_once_with_gst_and_scoped(client, monkeypatch):
    monkeypatch.setenv("PRODUCT_SELLER_STATE", "29")
    monkeypatch.setenv("PRODUCT_SELLER_NAME", "Seller Pvt Ltd")
    _, tok_a = await signup(client, "a@x.com")
    _, tok_b = await signup(client, "b@x.com")
    client.cookies.clear()
    ha = bearer(tok_a)
    async with client.session_factory() as s:
        ws = (await s.execute(select(product_models.ProductWorkspaceModel).order_by(product_models.ProductWorkspaceModel.id))).scalars().first()
    await client.patch("/product/billing/settings", json={"billing_name": "Sunrise Dental", "billing_state": "29", "billing_gstin": "29ABCDE1234F1Z5"}, headers=ha)
    await add_usage(client, ws.live_org_id, datetime(2026, 1, 15, tzinfo=UTC), 6000)  # 100 min x 6 = 600 charged
    await add_usage(client, ws.live_org_id, datetime.now(UTC), 60)                    # this month: not invoiced yet

    inv = (await client.get("/product/billing/invoices", headers=ha)).json()
    assert len(inv) == 1 and inv[0]["period"] == "2026-01" and inv[0]["taxable"] == 600 and inv[0]["total"] == 708 and inv[0]["tax"] == 108
    again = (await client.get("/product/billing/invoices", headers=ha)).json()
    assert [i["number"] for i in again] == [inv[0]["number"]]  # issued once, number stable

    pdf = await client.get(f"/product/billing/invoices/{inv[0]['number']}/pdf", headers=ha)
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF") and pdf.headers["content-type"] == "application/pdf"
    hb = bearer(tok_b)
    assert (await client.get(f"/product/billing/invoices/{inv[0]['number']}/pdf", headers=hb)).status_code == 404
    assert (await client.get("/product/billing/invoices", headers=hb)).json() == []
    async with client.session_factory() as s:
        row = (await s.execute(select(product_models.ProductInvoiceModel))).scalar_one()
    assert row.tax["cgst"] == 54 and row.tax["sgst"] == 54 and row.tax["igst"] == 0


async def test_billing_needs_billing_permission(client):
    me, tok_a = await signup(client, "a@x.com")
    _, tok_b = await signup(client, "b@x.com")
    client.cookies.clear()
    async with client.session_factory() as s:
        ws = (await s.execute(select(product_models.ProductWorkspaceModel).order_by(product_models.ProductWorkspaceModel.id))).scalars().first()
        b = (await s.execute(select(models.UserModel).where(models.UserModel.email == "b@x.com"))).scalar_one()
        s.add(product_models.ProductMembershipModel(workspace_id=ws.id, user_id=b.id, role="developer"))
        await s.commit()
    hb = bearer(tok_b, **{"X-Workspace": me["current_workspace"]["id"]})
    assert (await client.get("/product/billing/summary", headers=hb)).status_code == 403
    assert (await client.patch("/product/billing/settings", json={"spend_limit": 1}, headers=hb)).status_code == 403


def test_price_follows_the_minutes_in_the_wallet():
    from api.product import pricing

    balances = (0, 5999.99, 6000, 10979.75, 27499.99, 27500, 74999, 75000, 340000, 5_000_000)
    assert [pricing.rate_for_balance(b) for b in balances] == [6.75, 6.75, 6.0, 6.0, 6.0, 5.5, 5.5, 5.0, 3.4, 3.4]
    # a wallet of Rs 10,979.75 holds ~1,830 minutes at its own rate, so it is in the Rs 6.00 slab, not Rs 6.75
    assert 1000 <= 10979.75 / pricing.rate_for_balance(10979.75) < 5000
    assert pricing.next_balance_step(10979.75) == (27500.0, 5.5, 5000)
    assert pricing.next_balance_step(0) == (6000.0, 6.0, 1000)
    assert pricing.next_balance_step(5_000_000) is None
    # every balance's slab really can hold the minutes that balance buys (no gaps, no negative jumps)
    last = 0.0
    for b in range(0, 400_000, 250):
        mins = b / pricing.rate_for_balance(b)
        assert mins >= last - 1e-6
        last = mins


def test_volume_slabs_and_where_a_minute_goes():
    from api.product import pricing

    assert [pricing.rate_for(m) for m in (0, 999, 1000, 4999, 5000, 14999, 24999, 37499, 49999, 74999, 99999, 100000, 500000)] == [6.75, 6.75, 6.0, 6.0, 5.5, 5.5, 5.0, 4.6, 4.2, 3.8, 3.4, 3.4, 3.4]
    assert pricing.next_step(500) == (1000, 6.0) and pricing.next_step(100000) is None
    parts = {p["name"]: p["value"] for p in pricing.split(2, 6.75)}  # a two minute call
    assert parts["Phone"] == 0.8 and round(parts["Voice"], 4) == round((13.5 - 0.8) * 0.6, 4)
    assert round(parts["Speech to text"] / parts["AI brain"], 3) == 3.0 and round(sum(parts.values()), 4) == 13.5


async def test_practice_calls_are_charged_once_to_the_live_wallet(client):
    from datetime import UTC, datetime

    from sqlalchemy import select as sel

    from api.db import models, product_models
    from api.product import practice

    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    await client.get("/product/billing/summary", headers=h)  # turns billing on and grants the welcome minutes
    client.wallet.minutes, client.wallet.balance = 1.0, 100.0
    async with client.session_factory() as s:
        ws = (await s.execute(sel(product_models.ProductWorkspaceModel))).scalars().first()
        s.add(models.WorkflowModel(id=950, name="w", organization_id=ws.test_org_id, workflow_definition={}))
        s.add(models.WorkflowRunModel(name="r", workflow_id=950, mode="smallwebrtc", is_completed=True, cost_info={"call_duration_seconds": 150}, created_at=datetime.now(UTC)))
        await s.commit()
        assert await practice.charge_practice_calls(s, client.wallet) == 1
        assert await practice.charge_practice_calls(s, client.wallet) == 0  # never twice
    assert client.wallet.minutes == 0.0 and round(client.wallet.balance, 4) == round(100 - 2 * 6.75, 4)  # 3 minutes billed: 1 free, 2 paid


def test_billing_is_per_minute_rounded_up():
    from api.product import pricing

    assert [pricing.billed_minutes(s) for s in (None, 0, 1, 60, 61, 119, 120, 121)] == [0, 0, 1, 1, 2, 2, 2, 3]


async def test_charge_takes_money_when_only_the_balance_is_left(monkeypatch):
    """The balance's minutes can't be removed like free minutes: a call with no free minutes left is charged in money."""
    from api.product import payments
    from api.services.billing import wallet_service as ws

    calls = {"removed": [], "credits": []}

    async def summary(org_id):
        return {"minutes_available": 1626.0, "minutes_remaining": 0.0}

    async def remove(org_id, minutes, description=None):
        calls["removed"].append(minutes)
        raise ws.WalletError("Only 0 minutes available to remove")

    async def credit(org_id, amount, description=None, idempotency_key=None):
        calls["credits"].append(amount)

    monkeypatch.setattr(ws, "get_summary", summary)
    monkeypatch.setattr(ws, "remove_minutes", remove)
    monkeypatch.setattr(ws, "credit_money", credit)
    taken = await payments.CoreWallet().charge(11, 2.0, 6.0, "Practice call #1", "practice:1")
    assert taken == 12.0 and calls["removed"] == [] and calls["credits"] == [-12.0]


async def test_only_the_first_accounts_get_the_signup_bonus(client, monkeypatch):
    monkeypatch.setenv("PRODUCT_SIGNUP_BONUS", "100")
    monkeypatch.setenv("PRODUCT_SIGNUP_BONUS_LIMIT", "2")
    heads = []
    for email in ("a@x.com", "b@x.com", "c@x.com"):
        _, tok = await signup(client, email)
        heads.append({**bearer(tok), "X-Environment": "live"})
    for h in heads[:2]:
        await client.get("/product/billing/summary", headers=h)
        await client.get("/product/billing/summary", headers=h)  # asking again never gives it twice
    assert client.wallet.balance == 200
    await client.get("/product/billing/summary", headers=heads[2])  # the third is past the limit
    assert client.wallet.balance == 200
    async with client.session_factory() as s:
        assert await billing.bonus_given(s) == 2 and await billing.bonus_left(s) == 0


async def test_welcome_shows_the_bonus_that_was_given(client, monkeypatch):
    monkeypatch.setenv("PRODUCT_SIGNUP_BONUS", "100")
    _, tok = await signup(client, "a@x.com")
    h = {**bearer(tok), "X-Environment": "live"}
    got = (await client.get("/product/billing/welcome", headers=h)).json()
    assert got["bonus"] == 100 and got["currency"]
    monkeypatch.setenv("PRODUCT_SIGNUP_BONUS_LIMIT", "1")
    _, tok2 = await signup(client, "b@x.com")
    assert (await client.get("/product/billing/welcome", headers={**bearer(tok2), "X-Environment": "live"})).json()["bonus"] == 0
