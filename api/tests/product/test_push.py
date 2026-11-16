"""Alerts on the team's phones: who gets what, the switches, what raises an alert, and that old news is never replayed."""

from datetime import UTC, datetime, timedelta

import pytest_asyncio
from sqlalchemy import select

from api.db import models
from api.db.product_models import ProductDeviceModel, ProductMembershipModel, ProductNotificationModel, ProductWorkspaceModel
from api.product import alerts, fcm
from api.product.notifications import notify
from api.tests.product.support import bearer, make_client, signup
from api.tests.product.test_platform import make_agent


class Sender:
    """A stand-in for Firebase: records what would have been sent, and can say a phone is gone."""

    def __init__(self):
        self.sent: list[tuple[str, str, str, dict, str]] = []
        self.dead: set[str] = set()

    async def send(self, token, title, body, data, channel):
        if token in self.dead:
            return "invalid"
        self.sent.append((token, title, body, data, channel))
        return "ok"


@pytest_asyncio.fixture
async def client(monkeypatch):
    monkeypatch.setattr(fcm, "configured", lambda: True)
    async with make_client(monkeypatch) as c:
        c.push = Sender()
        c._transport.app.dependency_overrides[fcm.get_sender] = lambda: c.push
        yield c


async def workspace(client):
    async with client.session_factory() as s:
        return (await s.scalars(select(ProductWorkspaceModel))).first()


async def add_phone(client, user_email, token):
    async with client.session_factory() as s:
        from api.db.models import UserModel

        u = (await s.scalars(select(UserModel).where(UserModel.email == user_email))).first()
        s.add(ProductDeviceModel(user_id=u.id, token=token, platform="android"))
        await s.commit()
        return u.id


async def add_member(client, email, role):
    _, tok = await signup(client, email)
    client.cookies.clear()
    ws = await workspace(client)
    async with client.session_factory() as s:
        from api.db.models import UserModel

        u = (await s.scalars(select(UserModel).where(UserModel.email == email))).first()
        s.add(ProductMembershipModel(workspace_id=ws.id, user_id=u.id, role=role))
        await s.commit()
    return tok


async def deliver(client):
    async with client.session_factory() as s:
        return await fcm.deliver_pending(s, client.push)


# ---------------------------------------------------------------- who gets what
async def test_an_alert_reaches_the_teams_phones_once_and_only_to_the_right_people(client):
    _, owner_tok = await signup(client, "owner@x.com")
    client.cookies.clear()
    ws = await workspace(client)
    await add_phone(client, "owner@x.com", "owner-phone-token")
    await add_member(client, "viewer@x.com", "viewer")
    await add_phone(client, "viewer@x.com", "viewer-phone-token")
    async with client.session_factory() as s:
        await notify(s, ws.id, "balance", "Your balance is running low", "Add money.", "/billing", "low:today")  # money: owners and admins only
        await notify(s, ws.id, "call", "A call didn't go through", "Open it.", "/conversations/x", "fail:1")  # everyone
        await s.commit()
    assert await deliver(client) == 3
    by_title = {}
    for token, title, _, data, channel in client.push.sent:
        by_title.setdefault(title, []).append((token, data["link"], channel))
    assert by_title["Your balance is running low"] == [("owner-phone-token", "/billing", "account")]
    assert sorted(t for t, *_ in by_title["A call didn't go through"]) == ["owner-phone-token", "viewer-phone-token"]
    assert await deliver(client) == 0  # nothing is sent twice


async def test_a_person_can_switch_alerts_off_by_kind_or_altogether(client):
    _, tok = await signup(client, "owner@x.com")
    h = bearer(tok)
    ws = await workspace(client)
    await add_phone(client, "owner@x.com", "phone-1")
    prefs = (await client.get("/product/mobile/push-prefs", headers=h)).json()
    keys = {c["key"]: c for c in prefs["categories"]}
    assert prefs["enabled"] and keys["attention"]["on"] and keys["all_calls"]["on"] is False and "money" in keys  # every finished call starts off
    off = (await client.put("/product/mobile/push-prefs", headers=h, json={"categories": {"attention": False, "bogus": True}})).json()
    assert {c["key"]: c["on"] for c in off["categories"]}["attention"] is False and "bogus" not in {c["key"] for c in off["categories"]}
    async with client.session_factory() as s:
        await notify(s, ws.id, "call", "Failed call", "", "/x", "f1")
        await notify(s, ws.id, "lead", "New booking", "", "/y", "l1")
        await s.commit()
    await deliver(client)
    assert [t for _, t, *_ in client.push.sent] == ["New booking"]
    await client.put("/product/mobile/push-prefs", headers=h, json={"enabled": False})
    async with client.session_factory() as s:
        await notify(s, ws.id, "lead", "Another booking", "", "/y", "l2")
        await s.commit()
    await deliver(client)
    assert [t for _, t, *_ in client.push.sent] == ["New booking"]  # the master switch wins
    assert (await client.get("/product/mobile/push-prefs", headers=h)).json()["enabled"] is False


async def test_the_viewer_is_not_offered_money_or_security_alerts(client):
    await signup(client, "owner@x.com")
    client.cookies.clear()
    tok = await add_member(client, "viewer@x.com", "viewer")
    # a viewer only belongs to the workspace by membership; ask with that workspace chosen
    ws = await workspace(client)
    h = bearer(tok, **{"X-Workspace": ws.public_id})
    keys = {c["key"] for c in (await client.get("/product/mobile/push-prefs", headers=h)).json()["categories"]}
    assert "attention" in keys and not ({"money", "security", "numbers"} & keys)


async def test_a_dead_phone_is_forgotten_and_signing_out_removes_the_phone(client):
    _, tok = await signup(client, "owner@x.com")
    h = bearer(tok)
    ws = await workspace(client)
    await add_phone(client, "owner@x.com", "alive-token-123")
    await add_phone(client, "owner@x.com", "dead-token-4567")
    client.push.dead.add("dead-token-4567")
    async with client.session_factory() as s:
        await notify(s, ws.id, "lead", "New booking", "", "/y", "l1")
        await s.commit()
    assert await deliver(client) == 1
    async with client.session_factory() as s:
        assert [d.token for d in (await s.scalars(select(ProductDeviceModel))).all()] == ["alive-token-123"]
    assert (await client.post("/product/mobile/push-token/forget", headers=h, json={"token": "alive-token-123"})).status_code == 200
    async with client.session_factory() as s:
        assert (await s.scalars(select(ProductDeviceModel))).all() == []


async def test_the_test_button_reaches_only_your_own_phone(client):
    _, tok = await signup(client, "owner@x.com")
    await add_phone(client, "owner@x.com", "mine-token-12345")
    r = (await client.post("/product/mobile/push-test", headers=bearer(tok))).json()
    assert r == {"sent": 1, "configured": True} and client.push.sent[0][1] == "Swarvo AI is connected"


async def test_old_alerts_are_never_pushed_and_nothing_is_sent_without_firebase(client, monkeypatch):
    await signup(client, "owner@x.com")
    ws = await workspace(client)
    await add_phone(client, "owner@x.com", "phone-123456")
    async with client.session_factory() as s:
        await notify(s, ws.id, "lead", "Old news", "", "/y", "old")
        row = (await s.scalars(select(ProductNotificationModel))).first()
        row.created_at = datetime.now(UTC) - timedelta(hours=3)
        await s.commit()
    assert await deliver(client) == 0
    async with client.session_factory() as s:
        await notify(s, ws.id, "lead", "Fresh news", "", "/y", "fresh")
        await s.commit()
    monkeypatch.setattr(fcm, "configured", lambda: False)
    assert await deliver(client) == 0 and client.push.sent == []  # no Firebase key: quietly nothing
    monkeypatch.setattr(fcm, "configured", lambda: True)
    assert await deliver(client) == 1


# ---------------------------------------------------------------- what raises an alert
async def test_finished_calls_raise_bookings_handoffs_milestones_and_a_phone_only_note(client):
    _, tok = await signup(client, "owner@x.com")
    h = bearer(tok)
    ws = await workspace(client)
    await add_phone(client, "owner@x.com", "owner-phone-token")
    async with client.session_factory() as s:
        s.add(models.WorkflowModel(id=701, name="w", organization_id=ws.live_org_id, workflow_definition={}))
        for disposition in ("appointment_booked", "transferred_to_human", "no_interest_ended"):
            s.add(models.WorkflowRunModel(name="r", workflow_id=701, mode="smallwebrtc", is_completed=True, cost_info={"call_duration_seconds": 90}, gathered_context={"call_disposition": disposition}, created_at=datetime.now(UTC)))
        s.add(models.WorkflowRunModel(name="old", workflow_id=701, mode="smallwebrtc", is_completed=True, cost_info={"call_duration_seconds": 90}, gathered_context={"call_disposition": "appointment_booked"}, created_at=datetime.now(UTC) - timedelta(hours=5)))
        await s.commit()
        await alerts.scan(s, client.mailer, client.wallet)
        titles = {n.title: n for n in (await s.scalars(select(ProductNotificationModel))).all()}
    assert "New booking" in titles and "A caller was passed to a person" in titles and "10 calls answered" not in titles
    assert sum(1 for n in titles.values() if n.kind == "lead") == 1  # the five-hour-old booking is history, not news
    every = [n for n in titles.values() if n.kind == "every_call"]
    assert len(every) == 3 and all(n.push_only for n in every)
    bell = (await client.get("/product/notifications", headers=h)).json()
    assert not any(i["kind"] == "every_call" for i in bell["items"])  # phone-only notes stay out of the bell
    async with client.session_factory() as s:
        again = await alerts.scan(s, client.mailer, client.wallet)
    assert again == 0  # the next minute raises nothing new
    await deliver(client)
    assert {t for _, t, *_ in client.push.sent} >= {"New booking", "A caller was passed to a person"} and not any(t.startswith("Call finished") for _, t, *_ in client.push.sent)  # every-call is off by default


async def test_a_round_number_of_calls_is_celebrated_once(client):
    await signup(client, "owner@x.com")
    ws = await workspace(client)
    async with client.session_factory() as s:
        s.add(models.WorkflowModel(id=702, name="w", organization_id=ws.live_org_id, workflow_definition={}))
        for _ in range(10):
            s.add(models.WorkflowRunModel(name="r", workflow_id=702, mode="smallwebrtc", is_completed=True, cost_info={"call_duration_seconds": 60}, gathered_context={}, created_at=datetime.now(UTC)))
        await s.commit()
        await alerts.scan(s, client.mailer, client.wallet)
        await alerts.scan(s, client.mailer, client.wallet)
        titles = [n.title for n in (await s.scalars(select(ProductNotificationModel))).all()]
    assert titles.count("10 calls answered") == 1 and "Your agent answered its first call" not in titles  # only the number just reached


async def test_a_finished_campaign_is_reported_and_a_teammates_publish_does_not_buzz_themselves(client):
    _, tok = await signup(client, "owner@x.com")
    h = bearer(tok)
    ws = await workspace(client)
    await add_phone(client, "owner@x.com", "owner-phone-token")
    async with client.session_factory() as s:
        s.add(models.WorkflowModel(id=703, name="w", organization_id=ws.live_org_id, workflow_definition={}))
        await s.flush()
        s.add(models.CampaignModel(name="Diwali offers", organization_id=ws.live_org_id, workflow_id=703, created_by=1, source_id="x", state="completed", total_rows=40, processed_rows=38, completed_at=datetime.now(UTC)))
        await s.commit()
        await alerts.scan(s, client.mailer, client.wallet)
        n = (await s.scalars(select(ProductNotificationModel).where(ProductNotificationModel.kind == "campaign"))).one()
    assert n.title == "Campaign finished: Diwali offers" and n.body == "38 of 40 contacts reached"
    aid, _ = await make_agent(client, h)
    await client.post(f"/product/agents/{aid}/publish", headers=h)
    await client.post(f"/product/agents/{aid}/pause", headers=h)
    await deliver(client)
    sent = [t for _, t, *_ in client.push.sent]
    assert "Campaign finished: Diwali offers" in sent and not any("is live" in t or "was paused" in t for t in sent)  # your own actions are not news to you


async def test_money_security_and_team_events_raise_alerts(client):
    _, tok = await signup(client, "owner@x.com")
    h = bearer(tok)
    await client.post("/product/developers/keys", json={"name": "CI"}, headers=h)
    mine = (await client.get("/product/notifications", headers=h)).json()["items"]
    assert any(i["kind"] == "security" and i["title"] == "A new API key was created" for i in mine)
    async with client.session_factory() as s:
        await notify(s, (await workspace(client)).id, "topup", "Money added", "", "/billing", "t1")
        await s.commit()
    for kind in ("topup", "invoice", "campaign", "milestone", "agent", "team", "security", "webhook", "kyc", "report", "handoff", "lead", "every_call", "chat", "call", "balance", "spend", "billing", "dnc"):
        assert fcm.category_of(kind) in fcm.CATEGORIES, kind
