"""WhatsApp follow-ups after calls: rules per agent and per IVR menu, who gets messaged, and the safeguards."""

from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from sqlalchemy import select

from api.db import models, product_models
from api.product import followups as fu
from api.product import followups_router, ivr_router
from api.product import contacts as ct
from api.tests.product.support import bearer, make_client, signup
from api.tests.product.test_phase_c import live_run
from api.tests.product.test_platform import make_agent, workspace


@pytest_asyncio.fixture
async def client(monkeypatch):
    async with make_client(monkeypatch) as c:
        app = c._transport.app  # type: ignore[attr-defined]
        app.include_router(followups_router.router)
        app.include_router(ivr_router.router)
        c.sent = []

        async def fake(phone, text, link=None):
            c.sent.append((phone, text, link))
            return True

        app.dependency_overrides[followups_router.get_wa_send] = lambda: fake
        c.fake = fake
        yield c


def test_rendering_fills_known_words_and_drops_unknown_ones():
    out = fu.render("Hi {name}, thanks from {business}. Ref {acct} {nonsense}.\nBye", {"name": "Asha", "business": "Sunrise", "acct": "1 2 3 4"})
    assert out == "Hi Asha, thanks from Sunrise. Ref 1 2 3 4 . Bye"
    assert fu.matches("any", "failed") and fu.matches("answered", "booked") and not fu.matches("answered", "no-answer") and fu.matches("voicemail", "voicemail") and not fu.matches("booked", "resolved")


@pytest.mark.asyncio
async def test_rules_need_consent_and_a_real_source(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    agent, _ = await make_agent(client, h)
    r = (await client.post("/product/followups", json={"name": "Thanks", "message": "Thanks {name}!", "source": "agent", "source_id": agent}, headers=h)).json()
    assert r["enabled"] is False and r["source_name"] and r["trigger"] == "any"
    fid = r["id"]
    assert (await client.patch(f"/product/followups/{fid}", json={"enabled": True}, headers=h)).json()["detail"]["code"] == "consent_needed"
    assert (await client.patch(f"/product/followups/{fid}", json={"source_id": "agt_nope"}, headers=h)).json()["detail"]["code"] == "bad_source"
    assert (await client.patch(f"/product/followups/{fid}", json={"source": "ivr"}, headers=h)).json()["detail"]["code"] == "bad_source"  # an agent id is not a menu
    assert (await client.patch(f"/product/followups/{fid}", json={"trigger": "sometimes"}, headers=h)).json()["detail"]["code"] == "bad_trigger"
    assert (await client.patch(f"/product/followups/{fid}", json={"link": "http://insecure.example"}, headers=h)).json()["detail"]["code"] == "bad_link"
    on = (await client.patch(f"/product/followups/{fid}", json={"consent": True, "enabled": True, "delay_minutes": 5}, headers=h)).json()
    assert on["enabled"] is True and on["delay_minutes"] == 5
    # emptying the message switches it off again
    off = (await client.patch(f"/product/followups/{fid}", json={"message": " "}, headers=h)).json()
    assert off["enabled"] is False
    # another workspace sees nothing and cannot touch it
    h2 = bearer((await signup(client, "b@x.com"))[1])
    assert (await client.get("/product/followups", headers=h2)).json() == []
    assert (await client.patch(f"/product/followups/{fid}", json={"name": "x"}, headers=h2)).status_code == 404
    assert (await client.delete(f"/product/followups/{fid}", headers=h)).status_code == 204


@pytest.mark.asyncio
async def test_an_ai_agent_follow_up_goes_once_to_the_right_callers(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    ws = await workspace(client)
    agent, _ = await make_agent(client, h)
    await client.post(f"/product/agents/{agent}/publish", headers=h)
    async with client.session_factory() as s:
        a = (await s.execute(select(product_models.ProductAgentModel).where(product_models.ProductAgentModel.public_id == agent))).scalar_one()
        a.live_workflow_id = 901
        await s.commit()
    await live_run(client, ws.live_org_id, 901, "+919800000031", name="Asha Rao", said=["Book me in"], disposition="appointment_booked", age_days=0.02)
    await live_run(client, ws.live_org_id, 901, "+919800000032", said=["Just asking"], age_days=0.02)
    await live_run(client, ws.live_org_id, 901, "+919800000033", said=["Please do not call me again"], disposition="appointment_booked", age_days=0.02)
    await live_run(client, ws.live_org_id, 901, "+919800000034", said=["Hello"], disposition="appointment_booked", age_days=0.0)  # only just finished
    f = (await client.post("/product/followups", json={"name": "Booking", "message": "Hi {name}, you are booked with {business}. {agent}", "source": "agent", "source_id": agent, "trigger": "booked", "delay_minutes": 1}, headers=h)).json()
    # off until the owner confirms callers are told
    async with client.session_factory() as s:
        assert (await fu.run_followups(s, wa_send=client.fake)) == {"sent": 0, "failed": 0, "skipped": 0}
    await client.patch(f"/product/followups/{f['id']}", json={"consent": True, "enabled": True}, headers=h)
    async with client.session_factory() as s:
        await ct.sync(s, await s.get(product_models.ProductWorkspaceModel, ws.id))  # the scheduled job folds new calls into contacts (and the do-not-call list) just before this runs
        out = await fu.run_followups(s, wa_send=client.fake)
    assert out["sent"] == 1 and out["skipped"] == 1  # the booked caller is messaged; the one who asked to stop is not; the not-booked and the too-recent are left alone
    phone, text, _ = client.sent[0]
    assert phone == "+919800000031" and text.startswith("Hi Asha, you are booked with") and "{" not in text
    # running again does nothing: each call is messaged once
    async with client.session_factory() as s:
        assert (await fu.run_followups(s, wa_send=client.fake))["sent"] == 0
    rows = (await client.get(f"/product/followups/{f['id']}/sends", headers=h)).json()
    assert sorted(r["status"] for r in rows) == ["sent", "skipped"] and all("•" in r["phone"] for r in rows if r["status"] == "sent")
    assert (await client.get("/product/followups", headers=h)).json()[0]["sent"] == 1


@pytest.mark.asyncio
async def test_an_ivr_follow_up_uses_what_the_caller_typed_and_respects_the_cooldown(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    ws = await workspace(client)
    ivr = (await client.post("/product/ivr", json={"name": "Front desk"}, headers=h)).json()["id"]
    async with client.session_factory() as s:
        row = (await s.execute(select(product_models.ProductIvrModel))).scalar_one()
        old = datetime.now(UTC) - timedelta(minutes=10)
        for i, (phone, outcome) in enumerate([("+919800000041", "voicemail"), ("+919800000041", "voicemail"), ("+919800000042", "hangup"), ("+919800000043", "agent")]):
            s.add(product_models.ProductIvrCallModel(ivr_id=row.id, workspace_id=ws.id, org_id=ws.live_org_id, call_uuid=f"c{i}", from_number=phone, to_number="+1", started_at=old, last_at=old,
                                                     outcome=outcome, trail=[], vars={"acct": "4321", "caller": phone}))
        await s.commit()
    f = (await client.post("/product/followups", json={"name": "VM thanks", "message": "We got your message about account {acct}. We'll call {caller} back.", "source": "ivr", "source_id": ivr, "trigger": "voicemail"}, headers=h)).json()
    await client.patch(f"/product/followups/{f['id']}", json={"consent": True, "enabled": True}, headers=h)
    async with client.session_factory() as s:
        out = await fu.run_followups(s, wa_send=client.fake)
    assert out["sent"] == 1 and out["skipped"] == 1  # the same person's second call within 24 h is skipped
    assert client.sent[0][0] == "+919800000041" and "account 4321" in client.sent[0][1] and "+919800000041" in client.sent[0][1]
    # a rule for "all" does not message the menu call that went on to an AI agent (the agent's own call carries it)
    g = (await client.post("/product/followups", json={"name": "All", "message": "Thanks", "source": "all"}, headers=h)).json()
    await client.patch(f"/product/followups/{g['id']}", json={"consent": True, "enabled": True}, headers=h)
    client.sent.clear()
    async with client.session_factory() as s:
        await fu.run_followups(s, wa_send=client.fake)
    assert "+919800000043" not in [p for p, _, _ in client.sent]


@pytest.mark.asyncio
async def test_test_message_goes_only_to_the_workspaces_own_verified_number(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    ws = await workspace(client)
    f = (await client.post("/product/followups", json={"name": "T", "message": "Hello {name} from {business}"}, headers=h)).json()
    assert (await client.post(f"/product/followups/{f['id']}/test", headers=h)).json()["detail"]["code"] == "no_test_number"
    async with client.session_factory() as s:
        st = await s.get(product_models.ProductBillingSettingsModel, ws.id) or product_models.ProductBillingSettingsModel(workspace_id=ws.id)
        st.verified_phone = "+919811112222"
        s.add(st)
        await s.commit()
    r = (await client.post(f"/product/followups/{f['id']}/test", headers=h)).json()
    assert r["ok"] and r["preview"].startswith("Hello Alex from") and client.sent[-1][0] == "+919811112222"
    st = (await client.get("/product/followups/status", headers=h)).json()
    assert st["test_number"] and "variables" in st
