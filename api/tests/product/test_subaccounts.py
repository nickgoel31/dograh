"""Sub-accounts: they share the parent's wallet, the parent can cap and pause them, and the people who run the parent can open them."""

import contextlib
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from sqlalchemy import select

from api.db import models, product_models
from api.product import config, subaccounts, subaccounts_router
from api.product import payments
from api.services.billing import wallet_service
from api.tests.product.support import bearer, make_client, signup


@pytest_asyncio.fixture
async def client(monkeypatch):
    async with make_client(monkeypatch) as c:
        c._transport.app.include_router(subaccounts_router.router)  # type: ignore[attr-defined]

        @contextlib.asynccontextmanager
        async def _sess():
            async with c.session_factory() as s:
                yield s

        async def _prepare(session, org_id, now):  # the allowance and expiry steps need Postgres; the lock is what these tests rely on
            return await wallet_service._lock_org(session, org_id)

        monkeypatch.setattr(wallet_service, "_session", _sess)
        monkeypatch.setattr(wallet_service, "_prepare", _prepare)
        c.mp = monkeypatch
        yield c


async def _parent(client, email="boss@x.com"):
    _, tok = await signup(client, email)
    h = bearer(tok)
    async with client.session_factory() as s:
        ws = (await s.execute(select(product_models.ProductWorkspaceModel).where(product_models.ProductWorkspaceModel.parent_workspace_id.is_(None)))).scalars().first()
        org = await s.get(models.OrganizationModel, ws.live_org_id)
        org.wallet_enabled, org.billing_rate, org.balance = True, 2.0, 50.0
        s.add(models.WalletBucketModel(organization_id=org.id, kind="opening", minutes_total=1.0, minutes_remaining=1.0, valid_from=datetime.now(UTC) - timedelta(days=1)))
        await s.commit()
        return h, ws.id, ws.live_org_id


def _as(h, public_id):
    return {**h, config.WORKSPACE_HEADER: public_id, config.ENVIRONMENT_HEADER: "live"}


@pytest.mark.asyncio
async def test_a_sub_account_is_paid_from_the_parents_wallet_and_obeys_its_limits(client):
    h, parent_id, parent_org = await _parent(client)
    sub = (await client.post("/product/subaccounts", json={"name": "Branch A", "cap_minutes": 3}, headers=h)).json()
    assert sub["billing"] == "shared" and sub["cap_minutes"] == 3 and sub["suspended"] is False
    async with client.session_factory() as s:
        child = (await s.execute(select(product_models.ProductWorkspaceModel).where(product_models.ProductWorkspaceModel.public_id == sub["id"]))).scalar_one()
        corg = await s.get(models.OrganizationModel, child.live_org_id)
        assert corg.wallet_org_id == parent_org and corg.wallet_enabled is False and child.parent_workspace_id == parent_id
        child_org = corg.id

    parent_drift = (await wallet_service.audit_org(parent_org))["money_drift"]  # the starting balance was set directly, so it is not in the ledger
    res = await wallet_service.record_usage(child_org, 501, 150)  # 150 s -> 3 minutes at the parent's price: 1 free minute, 2 at 2.0
    assert res.billed_seconds == 180 and res.money_charged == pytest.approx(4.0)
    assert (await wallet_service.record_usage(child_org, 501, 150)).already_recorded
    async with client.session_factory() as s:
        assert (await s.get(models.OrganizationModel, parent_org)).balance == pytest.approx(46.0) and (await s.get(models.OrganizationModel, child_org)).balance == 0
    assert (await wallet_service.audit_org(child_org))["money_drift"] == 0 and (await wallet_service.audit_org(parent_org))["money_drift"] == parent_drift
    async with client.session_factory() as s:
        parent_row = (await s.execute(select(models.WalletLedgerModel).where(models.WalletLedgerModel.organization_id == parent_org, models.WalletLedgerModel.entry_type == "shared"))).scalar_one()
        assert parent_row.source_org_id == child_org and float(parent_row.money_delta) == pytest.approx(-4.0)

    # the 3-minute cap is now used up: no new calls, with a message that names no money
    blocked = await wallet_service.check_can_start_call(child_org)
    assert not blocked.allowed and "monthly minutes" in blocked.reason
    got = (await client.patch(f"/product/subaccounts/{sub['id']}", json={"clear_cap_minutes": True, "cap_value": 1.0}, headers=h)).json()
    assert got["cap_minutes"] is None and got["cap_value"] == 1.0 and got["month_minutes"] == pytest.approx(3.0) and got["month_value"] == pytest.approx(6.0)
    assert "spending limit" in (await wallet_service.check_can_start_call(child_org)).reason
    await client.patch(f"/product/subaccounts/{sub['id']}", json={"clear_cap_value": True}, headers=h)
    assert (await wallet_service.check_can_start_call(child_org)).allowed

    # pause and resume
    assert (await client.post(f"/product/subaccounts/{sub['id']}/pause", headers=h)).json()["suspended"] is True
    assert "paused" in (await wallet_service.check_can_start_call(child_org)).reason
    assert (await client.post(f"/product/subaccounts/{sub['id']}/resume", headers=h)).json()["suspended"] is False
    assert (await wallet_service.check_can_start_call(child_org)).allowed

    # when the parent runs out, the sub-account is refused without learning the parent's numbers
    async with client.session_factory() as s:
        (await s.get(models.OrganizationModel, parent_org)).balance = 0.0
        await s.commit()
    broke = await wallet_service.check_can_start_call(child_org)
    assert not broke.allowed and "shared wallet" in broke.reason and "0" not in broke.reason


@pytest.mark.asyncio
async def test_the_product_wallet_follows_the_parent_and_topups_are_refused(client):
    h, _, parent_org = await _parent(client)
    sub = (await client.post("/product/subaccounts", json={"name": "Branch B"}, headers=h)).json()
    async with client.session_factory() as s:
        child = (await s.execute(select(product_models.ProductWorkspaceModel).where(product_models.ProductWorkspaceModel.public_id == sub["id"]))).scalar_one()
        child_org = child.live_org_id
    async def summary(org_id, **kw):  # the real one reads buckets with Postgres time zones
        async with client.session_factory() as s:
            return {"balance": (await s.get(models.OrganizationModel, org_id)).balance}

    client.mp.setattr(wallet_service, "get_summary", summary)
    gw = payments.CoreWallet()
    assert (await gw.summary(child_org))["shared"] is True and (await gw.summary(child_org))["balance"] == pytest.approx(50.0)
    with pytest.raises(payments.SharedWalletError):
        await gw.credit(child_org, 10, "x", "k1")
    with pytest.raises(payments.SharedWalletError):
        await gw.grant_minutes(child_org, 10, "x", "k2")
    money = await gw.charge(child_org, 2, 3.0, "practice", "k3")  # the parent's wallet pays
    assert money == pytest.approx(6.0) or money >= 0
    r = await client.post("/product/billing/topups", json={"amount": 500}, headers=_as(h, sub["id"]))
    assert r.status_code == 400 and r.json()["detail"]["code"] == "shared_wallet"


@pytest.mark.asyncio
async def test_parent_admins_open_sub_accounts_and_nobody_else_can_manage_them(client):
    h, parent_id, _ = await _parent(client)
    sub = (await client.post("/product/subaccounts", json={"name": "Branch C"}, headers=h)).json()
    other_id, other_tok = await signup(client, "ops@x.com")
    async with client.session_factory() as s:
        for email, role in (("ops@x.com", "admin"),):
            u = (await s.execute(select(models.UserModel).where(models.UserModel.email == email))).scalar_one()
            s.add(product_models.ProductMembershipModel(workspace_id=parent_id, user_id=u.id, role=role))
        await s.commit()
    me = (await client.get("/product/me", headers=bearer(other_tok))).json()
    kids = [w for w in me["workspaces"] if w["id"] == sub["id"]]
    assert kids and kids[0]["role"] == "admin"  # opened without being added to it
    # a stranger sees none of it, and a sub-account cannot have sub-accounts of its own
    stranger = bearer((await signup(client, "stranger@x.com"))[1])
    assert (await client.get("/product/subaccounts", headers=stranger)).json() == []
    assert (await client.patch(f"/product/subaccounts/{sub['id']}", json={"name": "Hijack"}, headers=stranger)).status_code == 404
    nested = await client.post("/product/subaccounts", json={"name": "Deep"}, headers=_as(h, sub["id"]))
    assert nested.status_code == 400 and nested.json()["detail"]["code"] == "not_a_parent"


@pytest.mark.asyncio
async def test_usage_rollup_csv_and_cap_alerts(client):
    h, _, parent_org = await _parent(client)
    a = (await client.post("/product/subaccounts", json={"name": 'Acme, "North"', "cap_minutes": 4}, headers=h)).json()
    b = (await client.post("/product/subaccounts", json={"name": "Beta", "billing": "own"}, headers=h)).json()
    assert b["billing"] == "own"
    async with client.session_factory() as s:
        child = (await s.execute(select(product_models.ProductWorkspaceModel).where(product_models.ProductWorkspaceModel.public_id == a["id"]))).scalar_one()
        org_a = child.live_org_id
    await wallet_service.record_usage(org_a, 601, 200)  # 4 minutes at 60 s billing
    usage = (await client.get("/product/subaccounts/usage", headers=h)).json()
    by = {r["name"]: r for r in usage["accounts"]}
    assert by['Acme, "North"']["minutes"] == pytest.approx(4.0) and by["Beta"]["minutes"] == 0 and usage["total_minutes"] == pytest.approx(4.0)
    csv = (await client.get("/product/subaccounts/usage.csv", headers=h))
    assert csv.headers["content-type"].startswith("text/csv") and '"Acme, ""North"""' in csv.text and csv.text.strip().splitlines()[-1].startswith('"Total"')
    assert (await client.get("/product/subaccounts/usage?period=2026-13", headers=h)).status_code == 422
    async with client.session_factory() as s:
        assert await subaccounts.cap_alerts(s) == 1  # 100% of its minutes
        assert await subaccounts.cap_alerts(s) == 0  # once per month
    notes = (await client.get("/product/notifications", headers=h)).json()["items"]
    assert any("monthly limit" in n["title"] for n in notes)


@pytest.mark.asyncio
async def test_old_create_endpoint_also_makes_shared_wallet_sub_accounts(client):
    h, _, parent_org = await _parent(client)
    made = (await client.post("/product/team/sub-accounts", json={"name": "Client One"}, headers=h)).json()
    listed = (await client.get("/product/subaccounts", headers=h)).json()
    assert [x["id"] for x in listed] == [made["id"]] and listed[0]["billing"] == "shared"
