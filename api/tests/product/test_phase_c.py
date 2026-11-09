"""Contacts, do-not-call, limits, languages, transcript search, weekly report, after-call texts, website chat, branding."""

from datetime import UTC, datetime, timedelta

import pytest_asyncio
from sqlalchemy import select

from api.db import models, product_models
from api.product import caps, contacts as ct, post_call
from api.tests.product.support import bearer, make_client, signup
from api.tests.product.test_platform import make_agent, workspace


@pytest_asyncio.fixture
async def client(monkeypatch):
    async with make_client(monkeypatch) as c:
        yield c


async def live_run(client, org_id, wf_id, phone, said=None, name=None, age_days=0, disposition=None):
    events = [{"type": "rtf-user-transcription", "payload": {"text": t, "final": True}} for t in (said or ["Hello"])] + [{"type": "rtf-bot-text", "payload": {"text": "Sure."}}]
    async with client.session_factory() as s:
        if not await s.get(models.WorkflowModel, wf_id):
            s.add(models.WorkflowModel(id=wf_id, name="w", organization_id=org_id, workflow_definition={}))
        run = models.WorkflowRunModel(
            name="r", workflow_id=wf_id, mode="smallwebrtc", is_completed=True, logs={"realtime_feedback_events": events}, cost_info={"call_duration_seconds": 120},
            gathered_context={"call_disposition": disposition} if disposition else {}, initial_context={"caller_number": phone, **({"caller_name": name} if name else {})},
            created_at=datetime.now(UTC) - timedelta(days=age_days))
        s.add(run)
        await s.commit()
        return run.id


async def test_contacts_do_not_call_and_opt_out(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    ws = await workspace(client)
    await live_run(client, ws.live_org_id, 801, "+919800000001", name="Asha", said=["Table for two"])
    await live_run(client, ws.live_org_id, 801, "+919800000001", said=["Same again"])
    await live_run(client, ws.live_org_id, 801, "+919800000002", said=["Please stop calling me"])
    page = (await client.get("/product/contacts", headers=h)).json()
    by = {c["phone"]: c for c in page["contacts"]}
    assert page["total"] == 2 and by["+919800000001"]["calls"] == 2 and by["+919800000001"]["name"] == "Asha"
    assert by["+919800000002"]["blocked"] is True and by["+919800000001"]["blocked"] is False  # "stop calling me" blocks them
    assert [b["reason"] for b in (await client.get("/product/contacts/blocked", headers=h)).json()] == ["asked"]
    assert any(n["kind"] == "dnc" for n in (await client.get("/product/notifications", headers=h)).json()["items"])

    cid = by["+919800000001"]["id"]
    up = (await client.patch(f"/product/contacts/{cid}", json={"notes": "Prefers evenings", "tags": ["vip", "vip", "pune"]}, headers=h)).json()
    assert up["notes"] == "Prefers evenings" and up["tags"] == ["pune", "vip"]
    assert (await client.get("/product/contacts?q=evenings", headers=h)).json()["total"] == 1
    csv = (await client.get("/product/contacts/export/csv", headers=h)).text
    assert "+919800000001" in csv and "Prefers evenings" in csv and csv.count("yes") == 1

    added = (await client.post("/product/contacts/blocked", json={"numbers": "+919800000001, 98 765 43210\n+919800000001"}, headers=h)).json()
    assert added == {"added": 1, "skipped": 1} or added["added"] >= 1
    async with client.session_factory() as s:
        assert "+919800000001" in await ct.blocked_set(s, ws.id)
    blk = next(b for b in (await client.get("/product/contacts/blocked", headers=h)).json() if b["phone"] == "+919800000001")
    assert (await client.delete(f"/product/contacts/blocked/{blk['id']}", headers=h)).status_code == 204


async def test_agent_limits_languages_and_transcript_search(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    ws = await workspace(client)
    aid, _ = await make_agent(client, h)
    r = await client.patch(f"/product/agents/{aid}", json={"style": {"daily_call_cap": 1, "languages": ["English", "Hindi"]}}, headers=h)
    assert r.status_code == 200 and r.json()["style"]["languages"] == ["English", "Hindi"]
    assert (await client.patch(f"/product/agents/{aid}", json={"style": {"daily_call_cap": -5}}, headers=h)).status_code == 400
    prompt = (await client.get(f"/product/agents/{aid}", headers=h)).json()["prompt"]
    assert "English in Latin letters" in prompt and "Hindi in Devanagari" in prompt  # each language is written in its own script

    await client.post(f"/product/agents/{aid}/publish", headers=h)
    async with client.session_factory() as s:
        agent = (await s.execute(select(product_models.ProductAgentModel))).scalar_one()
        assert await caps.exceeded(s, agent) is None
        wf = agent.live_workflow_id
    await live_run(client, ws.live_org_id, wf, "+919800000003", said=["I want a haircut tomorrow"])
    async with client.session_factory() as s:
        agent = (await s.execute(select(product_models.ProductAgentModel))).scalar_one()
        assert await caps.exceeded(s, agent) == caps.FULL_TODAY
        agent.style = {**agent.style, "daily_call_cap": 0}
        assert await caps.exceeded(s, agent) is None  # 0 means no limit

    live = {**h, "X-Environment": "live"}
    assert (await client.get("/product/conversations?text=haircut", headers=live)).json()["total"] == 1
    assert (await client.get("/product/conversations?text=pizza", headers=live)).json()["total"] == 0


async def test_weekly_report_and_after_call_text_go_out_once(client, monkeypatch):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    ws = await workspace(client)
    await live_run(client, ws.live_org_id, 811, "+919800000004", said=["Book me in"], disposition="appointment_booked")
    async with client.session_factory() as s:
        assert await post_call.weekly_reports(s, client.mailer) == 1
        assert await post_call.weekly_reports(s, client.mailer) == 0  # once a week
    assert any("weekly report" in subj.lower() or "your week" in subj.lower() for _, subj, _ in client.mailer.sent)

    assert (await client.put("/product/team/settings", headers=h, json={"record_calls": True, "redact_pii": False, "sms_after_call": "Thanks for calling! Reply here for help."})).json()["sms_after_call"].startswith("Thanks")
    monkeypatch.setenv("PRODUCT_PLIVO_AUTH_ID", "MAX")
    monkeypatch.setenv("PRODUCT_PLIVO_AUTH_TOKEN", "tok")
    async with client.session_factory() as s:
        cfg = models.TelephonyConfigurationModel(organization_id=ws.live_org_id, name="c", provider="plivo", credentials={})
        s.add(cfg)
        await s.flush()
        s.add(models.TelephonyPhoneNumberModel(organization_id=ws.live_org_id, telephony_configuration_id=cfg.id, address="+918000000000", address_normalized="918000000000", address_type="PSTN", country_code="IN", is_active=True))
        await s.commit()
    await live_run(client, ws.live_org_id, 811, "+919800000005", said=["Hi"])
    sent = []

    async def fake_send(auth_id, token, src, dst, text, transport=None):
        sent.append((src, dst, text))
        return True

    async with client.session_factory() as s:
        out = await post_call.contacts_and_texts(s, send=fake_send)
    assert out["texts"] >= 1 and ("+918000000000", "+919800000005", "Thanks for calling! Reply here for help.") in sent


async def test_website_chat_and_white_label_branding(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    aid, _ = await make_agent(client, h)
    await client.post(f"/product/agents/{aid}/publish", headers=h)
    await client.put("/product/team/settings", headers=h, json={"record_calls": True, "redact_pii": False, "widget_origins": ["https://shop.example.com"],
                                                                 "brand_name": "Acme Voice", "brand_color": "#112233", "logo_url": "https://acme.example.com/logo.png"})
    bad = {"embedder": "https://evil.example.com"}
    assert (await client.post(f"/public/widget/{aid}/chat/start", json=bad)).status_code == 403
    ok = {"embedder": "https://shop.example.com"}
    started = (await client.post(f"/public/widget/{aid}/chat/start", json=ok)).json()
    assert started["reply"] and started["session"].startswith("chat_")
    said = (await client.post(f"/public/widget/{aid}/chat/say", json={**ok, "session": started["session"], "text": "Do you open on Sunday?"})).json()
    assert said["reply"]
    assert (await client.post(f"/public/widget/{aid}/chat/say", json={**ok, "session": "chat_nope", "text": "hi"})).status_code == 400

    me = (await client.get("/product/me", headers=h)).json()
    assert me["branding"] == {"name": "Acme Voice", "color": "#112233", "logo": "https://acme.example.com/logo.png"}
    assert (await client.put("/product/team/settings", headers=h, json={"record_calls": True, "redact_pii": False, "brand_color": "red"})).json()["detail"]["code"] == "bad_color"
    sub = (await client.post("/product/team/sub-accounts", json={"name": "Client One"}, headers=h)).json()
    child = (await client.get("/product/me", headers={**h, "X-Workspace": sub["id"]})).json()
    assert child["branding"]["name"] == "Acme Voice"  # sub-accounts show their agency's brand
    usage = (await client.get("/product/team/sub-accounts/usage", headers=h)).json()
    assert [a["name"] for a in usage["accounts"]] == ["Client One"] and usage["total_minutes"] == 0


def test_whatsapp_follow_up_text_and_template_choice():
    from api.product import whatsapp

    assert whatsapp.render("Hi {name},\nthanks from {business}!  Pay: {payment_link}", name="Asha Rao", business="Sunrise", link="https://pay.example/x") == "Hi Asha, thanks from Sunrise! Pay: https://pay.example/x"
    assert whatsapp.render("Hello {name}", name=None, business="X", link=None) == "Hello there"
    assert whatsapp.params_for("Thanks!", None) == ("swarvo_followup", ["Thanks!"])
    assert whatsapp.params_for("Thanks!", "https://pay.example/x") == ("swarvo_followup_pay", ["Thanks!", "https://pay.example/x"])
    assert whatsapp.params_for("Pay at https://pay.example/x", "https://pay.example/x")[0] == "swarvo_followup"  # the link is already in the words


async def test_whatsapp_follow_up_goes_to_new_callers_but_not_to_people_who_asked_to_stop(client, monkeypatch):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    ws = await workspace(client)
    r = await client.put("/product/team/settings", headers=h, json={"record_calls": True, "redact_pii": False, "whatsapp_after_call": "Thanks for calling {business}! Pay here: {payment_link}", "payment_link": "https://pay.example/shop"})
    assert r.status_code == 200 and r.json()["payment_link"] == "https://pay.example/shop"
    bad = await client.put("/product/team/settings", headers=h, json={"record_calls": True, "redact_pii": False, "payment_link": "http://insecure.example"})
    assert bad.status_code == 400
    await live_run(client, ws.live_org_id, 821, "+919800000011", said=["Hi"])
    await live_run(client, ws.live_org_id, 821, "+919800000012", said=["Please do not call me again"])
    sent = []

    async def fake_wa(phone, text, link=None):
        sent.append((phone, text, link))
        return True

    async with client.session_factory() as s:
        out = await post_call.contacts_and_texts(s, wa_send=fake_wa)
    assert out["whatsapp"] == 1 and sent[0][0] == "+919800000011" and "https://pay.example/shop" in sent[0][1]


async def test_live_calls_lists_only_calls_in_progress_in_this_workspace(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    ws = await workspace(client)
    await live_run(client, ws.live_org_id, 831, "+919800000021")  # finished: not listed
    async with client.session_factory() as s:
        s.add(models.WorkflowRunModel(name="now", workflow_id=831, mode="twilio", state="running", is_completed=False, initial_context={"caller_number": "+919800000022", "caller_name": "Ravi"},
                                      created_at=datetime.now(UTC) - timedelta(seconds=75)))
        s.add(models.WorkflowRunModel(name="stuck", workflow_id=831, mode="twilio", state="running", is_completed=False, initial_context={"caller_number": "+919800000023"},
                                      created_at=datetime.now(UTC) - timedelta(hours=9)))  # never reported an end: not still going
        await s.commit()
    r = (await client.get("/product/live", headers={**h, "X-Environment": "live"})).json()
    assert [c["caller"] for c in r["calls"]] == ["Ravi"] and 60 <= r["calls"][0]["seconds"] < 120
    assert (await client.get("/product/live", headers=h)).json()["calls"] == []  # Test mode is another organization
    client.cookies.clear()
    _, tok_b = await signup(client, "b@x.com")
    assert (await client.get("/product/live", headers={**bearer(tok_b), "X-Environment": "live"})).json()["calls"] == []
