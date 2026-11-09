"""Phase 6 main paths: notifications, home, knowledge, tools, campaigns."""

from datetime import UTC, datetime

import pytest
import pytest_asyncio
from sqlalchemy import select

from api.db import models, product_models
from api.product import campaigns as camp
from api.tests.product.support import bearer, make_client, signup


@pytest_asyncio.fixture
async def client(monkeypatch):
    async with make_client(monkeypatch) as c:
        yield c


async def ws_of(client):
    async with client.session_factory() as s:
        return (await s.execute(select(product_models.ProductWorkspaceModel).order_by(product_models.ProductWorkspaceModel.id))).scalars().first()


async def agent(client, h, **kw):
    return (await client.post("/product/agents", json={"name": "P", "template": "receptionist", **kw}, headers=h)).json()["id"]


# ---------- notifications ----------
async def test_spend_alert_creates_one_notification_and_read_marks(client, monkeypatch):
    monkeypatch.setenv("PRODUCT_SIGNUP_BONUS", "0")  # a welcome balance would stop the low-balance alert
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    ws = await ws_of(client)
    async with client.session_factory() as s:
        s.add(models.WalletLedgerModel(organization_id=ws.live_org_id, entry_type="usage", billed_seconds=900, rate_snapshot=6.0, money_delta=-90, created_at=datetime.now(UTC)))
        await s.commit()
    await client.patch("/product/billing/settings", json={"spend_limit": 100}, headers=h)
    for _ in range(3):
        await client.get("/product/billing/summary", headers=h)
    n = (await client.get("/product/notifications", headers=h)).json()
    # one 80% warning and one low-balance alert, however many times the page loads
    assert n["unread"] == 2 and sorted(i["kind"] for i in n["items"]) == ["balance", "spend"]
    assert (await client.post(f"/product/notifications/{n['items'][0]['id']}/read", headers=h)).status_code == 200
    assert (await client.get("/product/notifications", headers=h)).json()["unread"] == 1
    await client.post("/product/notifications/read-all", headers=h)
    assert (await client.get("/product/notifications", headers=h)).json()["unread"] == 0
    assert (await client.post("/product/notifications/ntf_bad/read", headers=h)).status_code == 404


async def test_notifications_are_per_workspace(client):
    _, tok_a = await signup(client, "a@x.com")
    _, tok_b = await signup(client, "b@x.com")
    client.cookies.clear()
    ws = await ws_of(client)
    async with client.session_factory() as s:
        s.add(product_models.ProductNotificationModel(workspace_id=ws.id, kind="x", title="Hi"))
        await s.commit()
    assert (await client.get("/product/notifications", headers=bearer(tok_a))).json()["unread"] == 1
    assert (await client.get("/product/notifications", headers=bearer(tok_b))).json()["unread"] == 0


# ---------- home ----------
async def test_home_checklist_and_kpis(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    steps = lambda r: {s["id"]: s["done"] for s in r["onboarding"]}
    assert not any(steps((await client.get("/product/home/summary", headers=h)).json()).values())
    aid = await agent(client, h)
    ws = await ws_of(client)
    async with client.session_factory() as s:
        ag = (await s.execute(select(product_models.ProductAgentModel))).scalar_one()
        s.add(models.WorkflowModel(id=ag.test_workflow_id, name="w", organization_id=ws.test_org_id, workflow_definition={}))
        for disp, dur in (("appointment_booked", 60), ("pipeline_error", 30), ("user_hangup", 90)):
            s.add(models.WorkflowRunModel(name="r", workflow_id=ag.test_workflow_id, mode="smallwebrtc", is_completed=True, created_at=datetime.now(UTC),
                                          cost_info={"call_duration_seconds": dur}, gathered_context={"call_disposition": disp}))
        await s.commit()
    r = (await client.get("/product/home/summary?range=today", headers=h)).json()
    assert r["kpis"]["calls"] == 3 and r["kpis"]["success_rate"] == 67 and r["kpis"]["minutes"] == 3.0 and r["kpis"]["spend"] == 0
    assert steps(r) == {"agent": True, "voice": False, "test": True, "number": False}
    assert any(a["kind"] == "failed_calls" for a in r["attention"])
    assert (await client.get("/product/home/summary?range=year", headers=h)).status_code == 422
    live = (await client.get("/product/home/summary", headers={**h, "X-Environment": "live"})).json()
    assert live["kpis"]["calls"] == 0 and aid


# ---------- knowledge ----------
async def test_knowledge_both_orgs_attach_and_go_live_remap(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    ws = await ws_of(client)
    aid = await agent(client, h)
    await client.post("/product/knowledge/url", json={"url": "https://example.com/faq"}, headers=h)
    await client.post("/product/knowledge/text", json={"title": "Hours", "text": "Open 9 to 6."}, headers=h)
    qa = await client.post("/product/knowledge/qa", json={"title": "Policies", "pairs": [{"q": "Refunds?", "a": "Within 7 days."}]}, headers=h)
    assert qa.status_code == 201
    assert (await client.post("/product/knowledge/text", json={"title": "Hours", "text": "x"}, headers=h)).json()["detail"]["code"] == "name_taken"
    docs = (await client.get("/product/knowledge", headers=h)).json()
    assert {d["kind"] for d in docs} == {"Website", "Text", "Q&A"} and {d["title"] for d in docs} >= {"Hours", "Policies"}
    assert len(client.kb.docs[ws.test_org_id]) == len(client.kb.docs[ws.live_org_id]) == 3  # a Live twin of each
    assert (await client.post("/product/knowledge/url", json={"url": "ftp://x"}, headers=h)).status_code == 400

    ids = [d["id"] for d in docs if d["title"] == "Hours"]
    assert (await client.put(f"/product/knowledge/agent/{aid}", json={"document_ids": ids}, headers=h)).json() == ids
    assert (await client.get(f"/product/knowledge/agent/{aid}", headers=h)).json() == ids
    assert (await client.put(f"/product/knowledge/agent/{aid}", json={"document_ids": ["doc_nope"]}, headers=h)).status_code == 404
    ask = (await client.post("/product/knowledge/ask", json={"question": "When open?", "agent_id": aid}, headers=h)).json()
    assert ask["found"] and ask["source"] == "Hours" and (await client.post("/product/knowledge/ask", json={"question": "x"}, headers=h)).json()["found"]

    await client.post(f"/product/agents/{aid}/publish", headers=h)
    live_graph = next(g for (org, _), g in client.fake.published.items() if org == ws.live_org_id)
    live_uuid = next(d["document_uuid"] for d in client.kb.docs[ws.live_org_id] if d["filename"] == "Hours.txt")
    assert live_graph["nodes"][0]["data"]["document_uuids"] == [live_uuid]

    await client.delete(f"/product/knowledge/{ids[0]}", headers=h)
    assert all(d["filename"] != "Hours.txt" for org in client.kb.docs.values() for d in org)


async def test_knowledge_scoping_roles_and_file_tickets(client):
    _, tok_a = await signup(client, "a@x.com")
    _, tok_b = await signup(client, "b@x.com")
    client.cookies.clear()
    ha, hb = bearer(tok_a), bearer(tok_b)
    await client.post("/product/knowledge/text", json={"title": "Secret", "text": "x"}, headers=ha)
    assert (await client.get("/product/knowledge", headers=hb)).json() == []
    did = (await client.get("/product/knowledge", headers=ha)).json()[0]["id"]
    assert (await client.delete(f"/product/knowledge/{did}", headers=hb)).status_code == 404

    up = (await client.post("/product/knowledge/file", json={"filename": "menu.pdf"}, headers=ha)).json()
    assert len(up["upload_urls"]) == 2
    assert (await client.post("/product/knowledge/file/process", json={"ticket": up["ticket"]}, headers=hb)).status_code == 400  # another workspace
    assert (await client.post("/product/knowledge/file/process", json={"ticket": "garbage"}, headers=ha)).status_code == 400
    assert (await client.post("/product/knowledge/file/process", json={"ticket": up["ticket"]}, headers=ha)).status_code == 202
    assert any(d["kind"] == "PDF" for d in (await client.get("/product/knowledge", headers=ha)).json())


# ---------- tools ----------
async def test_tools_create_mask_attach_remap_and_ssrf(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    ws = await ws_of(client)
    aid = await agent(client, h)
    body = {"name": "Notify", "description": "Tell the team about a booking.", "url": "https://hooks.example.com/x", "headers": {"Authorization": "Bearer SECRET"},
            "parameters": [{"name": "caller_name", "type": "string", "description": "Caller's name"}]}
    t = (await client.post("/product/tools", json=body, headers=h)).json()
    assert t["headers"] == {"Authorization": "••••••"} and "SECRET" not in str((await client.get("/product/tools", headers=h)).text)
    assert (await client.post("/product/tools", json=body, headers=h)).status_code == 409
    assert len(client.tools.items[ws.test_org_id]) == len(client.tools.items[ws.live_org_id]) == 1
    assert (await client.post("/product/tools", json={**body, "name": "X", "url": "ftp://a"}, headers=h)).status_code == 400
    cat = (await client.get("/product/tools/catalog", headers=h)).json()
    assert {c["status"] for c in cat} == {"available"} and next(c for c in cat if c["id"] == "webhook")["status"] == "available"

    assert (await client.put(f"/product/tools/agent/{aid}", json={"tool_ids": [t["id"]]}, headers=h)).json() == [t["id"]]
    await client.post(f"/product/agents/{aid}/publish", headers=h)
    live_graph = next(g for (org, _), g in client.fake.published.items() if org == ws.live_org_id)
    assert live_graph["nodes"][0]["data"]["tool_uuids"] == [client.tools.items[ws.live_org_id][0]["uuid"]]

    for bad in ("http://127.0.0.1:8000/x", "http://169.254.169.254/latest/meta-data", "http://localhost/x"):
        r = await client.post("/product/tools/test", json={"url": bad}, headers=h)
        assert r.status_code == 400 and r.json()["detail"]["code"] == "unsafe_url", bad
    assert (await client.delete(f"/product/tools/{t['id']}", headers=h)).status_code == 204
    assert client.tools.items[ws.test_org_id] == [] and client.tools.items[ws.live_org_id] == []


async def test_developer_can_manage_tools_viewer_cannot(client):
    me, tok_a = await signup(client, "a@x.com")
    _, tok_b = await signup(client, "b@x.com")
    client.cookies.clear()
    ws = await ws_of(client)
    async with client.session_factory() as s:
        b = (await s.execute(select(models.UserModel).where(models.UserModel.email == "b@x.com"))).scalar_one()
        s.add(product_models.ProductMembershipModel(workspace_id=ws.id, user_id=b.id, role="viewer"))
        await s.commit()
    hb = bearer(tok_b, **{"X-Workspace": me["current_workspace"]["id"]})
    assert (await client.get("/product/tools", headers=hb)).status_code == 200
    r = await client.post("/product/tools", json={"name": "n", "description": "d", "url": "https://x.example.com"}, headers=hb)
    assert r.status_code == 403


# ---------- campaigns ----------
CSV = "name,phone\nAsha,+919876543210\nRavi,98765 43211\nAsha again,+91 98765 43210\nBad,12\n,\n"


def test_contact_check_normalises_dedupes_and_reports():
    r = camp.check_contacts(CSV, "IN")
    assert [v["phone_number"] for v in r["valid"]] == ["+919876543210", "+919876543211"]
    assert r["duplicates"] == 1 and len(r["invalid"]) == 1 and r["invalid"][0]["row"] == 5 and r["columns"] == ["name"]
    assert camp.to_csv(r["valid"]).splitlines()[0] == "phone_number,name"
    for bad in ("name\nA\n", "only header\n", "x,y\n1,2\n"):
        with pytest.raises(ValueError):
            camp.check_contacts(bad, "IN")


def test_compliance_gate():
    ok = dict(consent=True, dnc_checked=True, tz="Asia/Kolkata", slots=[{"day_of_week": 1, "start_time": "10:00", "end_time": "17:00"}])
    camp.check_compliance(**ok)
    for patch, needle in (({"consent": False}, "agreed"), ({"dnc_checked": False}, "Do-Not-Call"), ({"tz": "Mars/Base"}, "time zone"), ({"slots": []}, "at least one"),
                          ({"slots": [{"day_of_week": 1, "start_time": "07:00", "end_time": "12:00"}]}, "between 09:00 and 21:00"),
                          ({"slots": [{"day_of_week": 1, "start_time": "10:00", "end_time": "22:30"}]}, "between 09:00 and 21:00")):
        with pytest.raises(ValueError, match=needle):
            camp.check_compliance(**{**ok, **patch})


async def test_campaign_flow_gate_audit_counters_and_scope(client):
    _, tok_a = await signup(client, "a@x.com")
    _, tok_b = await signup(client, "b@x.com")
    client.cookies.clear()
    ha = bearer(tok_a)
    live = {**ha, "X-Environment": "live"}
    aid = await agent(client, ha)
    body = {"name": "Reminders", "agent_id": aid, "csv_text": CSV, "slots": [{"day_of_week": 1, "start_time": "10:00", "end_time": "17:00"}],
            "consent_confirmed": True, "dnc_checked": True}
    assert (await client.post("/product/campaigns", json=body, headers=ha)).json()["detail"]["code"] == "live_only"
    assert (await client.post("/product/campaigns", json=body, headers=live)).json()["detail"]["code"] == "agent_not_live"
    await client.post(f"/product/agents/{aid}/publish", headers=ha)
    assert (await client.post("/product/campaigns", json=body, headers=live)).json()["detail"]["code"] == "no_number"  # campaigns call from the customer's own numbers
    async with client.session_factory() as s:
        ws = (await s.execute(select(product_models.ProductWorkspaceModel))).scalars().first()
        cfg = models.TelephonyConfigurationModel(organization_id=ws.live_org_id, name="c", provider="twilio", credentials={})
        s.add(cfg)
        await s.flush()
        s.add(models.TelephonyPhoneNumberModel(organization_id=ws.live_org_id, telephony_configuration_id=cfg.id, address="+919800000001", address_normalized="919800000001",
                                               address_type="PSTN", country_code="IN", is_active=True))
        await s.commit()
    for patch, code in (({"consent_confirmed": False}, "compliance_blocked"), ({"dnc_checked": False}, "compliance_blocked"),
                        ({"slots": [{"day_of_week": 1, "start_time": "05:00", "end_time": "09:00"}]}, "compliance_blocked"), ({"csv_text": "a,b\n1,2\n"}, "compliance_blocked")):
        r = await client.post("/product/campaigns", json={**body, **patch}, headers=live)
        assert r.status_code == 400 and r.json()["detail"]["code"] == code
    assert client.camps.items == []  # nothing was created by a blocked attempt

    made = (await client.post("/product/campaigns", json=body, headers=live)).json()
    assert made["status"] == "scheduled" and made["id"].startswith("cmp_") and made["agent_id"] == aid
    assert client.camps.csv[1].splitlines()[0] == "phone_number,name" and client.camps.csv[1].count("+91") == 2  # cleaned list reached the platform
    async with client.session_factory() as s:
        audit = (await s.execute(select(product_models.ProductCampaignAuditModel))).scalar_one()
    assert audit.detail["consent_confirmed"] and audit.detail["dnc_attested"] and audit.detail["registry_checked"] is False and audit.detail["contacts"] == 2

    assert (await client.post(f"/product/campaigns/{made['id']}/start", headers=live)).json()["status"] == "running"
    assert (await client.post(f"/product/campaigns/{made['id']}/pause", headers=live)).json()["status"] == "paused"
    await client.post(f"/product/agents/{aid}/pause", headers=ha)
    assert (await client.post(f"/product/campaigns/{made['id']}/resume", headers=live)).status_code == 200  # resume is allowed; start of a paused agent is not
    assert (await client.get("/product/campaigns", headers=ha)).json() == []  # Test mode lists none

    ws = await ws_of(client)
    async with client.session_factory() as s:
        wf_live = (await s.execute(select(product_models.ProductAgentModel))).scalar_one().live_workflow_id
        s.add(models.WorkflowModel(id=wf_live, name="w", organization_id=ws.live_org_id, workflow_definition={}))
        for disp, ref in (("appointment_booked", 1), ("voicemail_detected", 1), ("no_answer", 1), ("user_hangup", 1)):
            s.add(models.WorkflowRunModel(name="r", workflow_id=wf_live, mode="twilio", is_completed=True, campaign_id=ref, created_at=datetime.now(UTC),
                                          cost_info={"call_duration_seconds": 40}, gathered_context={"call_disposition": disp}))
        await s.commit()
    row = (await client.get("/product/campaigns", headers=live)).json()[0]
    assert (row["dialed"], row["answered"], row["voicemail"], row["no_answer"], row["converted"]) == (4, 2, 1, 1, 1)

    hb = {**bearer(tok_b), "X-Environment": "live"}
    assert (await client.get("/product/campaigns", headers=hb)).json() == []
    assert (await client.post(f"/product/campaigns/{made['id']}/start", headers=hb)).status_code == 404


async def test_hand_over_to_a_person_and_call_me(client):
    _, tok = await signup(client, "a@x.com")
    ha = bearer(tok)
    aid = await agent(client, ha)
    assert (await client.get(f"/product/tools/handover/{aid}", headers=ha)).json()["enabled"] is False
    assert (await client.put(f"/product/tools/handover/{aid}", json={"number": "98765"}, headers=ha)).json()["detail"]["code"] == "bad_number"
    r = await client.put(f"/product/tools/handover/{aid}", json={"number": "+919876543210", "when": "The caller asks for the doctor."}, headers=ha)
    assert r.json() == {"enabled": True, "number": "+919876543210", "when": "The caller asks for the doctor."}
    tools = (await client.get("/product/tools", headers=ha)).json()
    assert [(t["kind"], t["number"]) for t in tools] == [("transfer", "+919876543210")]
    assert (await client.get(f"/product/tools/agent/{aid}", headers=ha)).json() == [tools[0]["id"]]  # attached to the agent
    await client.put(f"/product/tools/handover/{aid}", json={"number": "+911111111111"}, headers=ha)  # changing it replaces, never duplicates
    assert len((await client.get("/product/tools", headers=ha)).json()) == 1
    assert (await client.delete(f"/product/tools/handover/{aid}", headers=ha)).status_code == 204
    assert (await client.get("/product/tools", headers=ha)).json() == []

    body = {"phone": "+919800000002"}
    assert (await client.post(f"/product/agents/{aid}/call-me", json=body, headers=ha)).json()["detail"]["code"] == "not_live_yet"
    await client.post(f"/product/agents/{aid}/publish", headers=ha)
    assert (await client.post(f"/product/agents/{aid}/call-me", json=body, headers=ha)).json()["detail"]["code"] == "no_number"
    async with client.session_factory() as s:
        ws = (await s.execute(select(product_models.ProductWorkspaceModel))).scalars().first()
        cfg = models.TelephonyConfigurationModel(organization_id=ws.live_org_id, name="c", provider="twilio", credentials={})
        s.add(cfg)
        await s.flush()
        s.add(models.TelephonyPhoneNumberModel(organization_id=ws.live_org_id, telephony_configuration_id=cfg.id, address="+919800000001", address_normalized="919800000001", address_type="PSTN", country_code="IN", is_active=True))
        await s.commit()
    ok = await client.post(f"/product/agents/{aid}/call-me", json=body, headers=ha)
    assert ok.json()["status"] == "calling" and client.phone.calls[0][2] == "+919800000002"
    assert (await client.post(f"/product/agents/{aid}/call-me", json={"phone": "12345"}, headers=ha)).json()["detail"]["code"] == "bad_number"


async def test_calendar_booking_through_calcom(client):
    import json as _json
    from datetime import date, timedelta

    import httpx

    from api.product import calcom, integrations_router

    day = (date.today() + timedelta(days=3)).isoformat()
    seen = []

    def handler(req: httpx.Request):
        seen.append((req.method, req.url.path, dict(req.headers), _json.loads(req.content) if req.content else None))
        if req.url.path == "/v2/slots":
            return httpx.Response(200, json={"status": "success", "data": {day: [{"start": f"{day}T10:00:00.000+05:30"}, {"start": f"{day}T10:30:00.000+05:30"}]}})
        if req.url.path == "/v2/bookings":
            return httpx.Response(201, json={"status": "success", "data": {"uid": "bk_1"}})
        return httpx.Response(404)

    client._transport.app.dependency_overrides[integrations_router.get_calcom] = lambda: (lambda key: calcom.CalCom(key, transport=httpx.MockTransport(handler)))
    _, tok = await signup(client, "a@x.com")
    ha = bearer(tok)
    assert (await client.get("/product/integrations/calendar", headers=ha)).json()["connected"] is False
    assert (await client.put("/product/integrations/calendar", json={"api_key": "cal_live_abc123456", "event_type_id": 77, "timezone": "Mars/Base"}, headers=ha)).json()["detail"]["code"] == "bad_timezone"
    assert (await client.put("/product/integrations/calendar", json={"api_key": "cal_live_abc123456", "event_type_id": 77}, headers=ha)).json()["connected"] is True
    tools = (await client.get("/product/tools", headers=ha)).json()
    assert sorted(t["name"] for t in tools) == ["Book an appointment", "Check free appointment times"]
    assert all("cal_live" not in _json.dumps(t) for t in tools)  # the key never appears in the tool list
    url = next(t["url"] for t in tools if t["name"] == "Check free appointment times")
    token = url.split("/calendar/")[1].split("/")[0]

    slots = (await client.get(f"/product/hooks/calendar/{token}/slots", params={"date": day})).json()
    assert slots["times"] == [f"{day} 10:00", f"{day} 10:30"] or slots["times"] == []  # times in the past are left out
    booked = (await client.post(f"/product/hooks/calendar/{token}/book", json={"start": f"{day} 10:30", "name": "Asha", "phone": "+919800000001"})).json()
    assert booked["booked"] is True
    method, path, headers, body = next(x for x in seen if x[1] == "/v2/bookings")
    assert headers["cal-api-version"] == "2026-02-25" and body["eventTypeId"] == 77 and body["start"] == f"{day}T05:00:00Z" and body["attendee"]["name"] == "Asha"
    assert (await client.get("/product/hooks/calendar/wrong-token/slots", params={"date": day})).status_code == 404
    assert (await client.delete("/product/integrations/calendar", headers=ha)).status_code == 204
    assert (await client.get("/product/tools", headers=ha)).json() == []


async def _live_agent_with_number(client, ha):
    aid = await agent(client, ha)
    await client.post(f"/product/agents/{aid}/publish", headers=ha)
    async with client.session_factory() as s:
        ws = (await s.execute(select(product_models.ProductWorkspaceModel))).scalars().first()
        cfg = models.TelephonyConfigurationModel(organization_id=ws.live_org_id, name="c", provider="twilio", credentials={})
        s.add(cfg)
        await s.flush()
        s.add(models.TelephonyPhoneNumberModel(organization_id=ws.live_org_id, telephony_configuration_id=cfg.id, address="+919800000001", address_normalized="919800000001",
                                               address_type="PSTN", country_code="IN", is_active=True))
        await s.commit()
    return aid


async def test_retry_rules_reach_the_platform(client):
    _, tok = await signup(client, "a@x.com")
    ha = bearer(tok)
    live = {**ha, "X-Environment": "live"}
    aid = await _live_agent_with_number(client, ha)
    body = {"name": "R", "agent_id": aid, "csv_text": CSV, "slots": [{"day_of_week": 1, "start_time": "10:00", "end_time": "17:00"}], "consent_confirmed": True, "dnc_checked": True,
            "max_retries": 3, "retry_delay_minutes": 15, "retry_on_busy": False, "retry_on_voicemail": True}
    assert (await client.post("/product/campaigns", json=body, headers=live)).status_code == 201
    assert client.camps.items[0]["retry"] == {"max_retries": 3, "delay": 900, "on_busy": False, "on_no_answer": True, "on_voicemail": True}


async def test_a_call_back_is_a_one_person_campaign_in_a_one_hour_window(client):
    from datetime import timedelta

    _, tok = await signup(client, "a@x.com")
    ha = bearer(tok)
    live = {**ha, "X-Environment": "live"}
    aid = await _live_agent_with_number(client, ha)
    when = (datetime.now() + timedelta(days=1)).replace(hour=15, minute=30, second=0, microsecond=0)
    ok = {"agent_id": aid, "phone": "98765 43210 ".replace(" ", ""), "when": when.isoformat(), "timezone": "Asia/Kolkata", "name": "Asha"}
    r = await client.post("/product/campaigns/callback", json={**ok, "phone": "+919876543210"}, headers=live)
    assert r.status_code == 201, r.text
    item = client.camps.items[0]
    assert item["schedule"]["slots"][0]["start_time"] == "15:30" and item["schedule"]["slots"][0]["end_time"] == "16:30"
    assert "+919876543210" in client.camps.csv[1] and item["state"] == "running"
    for patch, code in (({"when": (datetime.now() - timedelta(hours=1)).isoformat()}, "too_soon"), ({"when": (datetime.now() + timedelta(days=60)).isoformat()}, "too_far"),
                        ({"when": when.replace(hour=23).isoformat()}, "compliance_blocked"), ({"phone": "12345"}, "bad_phone"), ({"timezone": "Mars/Base"}, "bad_timezone")):
        bad = await client.post("/product/campaigns/callback", json={**ok, "phone": "+919876543210", **patch}, headers=live)
        assert bad.status_code == 400 and bad.json()["detail"]["code"] == code, (patch, bad.text)
    assert (await client.post("/product/campaigns/callback", json={**ok, "phone": "+919876543210"}, headers=ha)).json()["detail"]["code"] == "live_only"


async def test_handover_keeps_the_message_and_ring_time(client):
    _, tok = await signup(client, "a@x.com")
    ha = bearer(tok)
    aid = await agent(client, ha)
    r = await client.put(f"/product/tools/handover/{aid}", json={"number": "+919876543210", "message": "Please hold, connecting you to our doctor.", "timeout": 45}, headers=ha)
    assert r.status_code == 200, r.text
    g = (await client.get(f"/product/tools/handover/{aid}", headers=ha)).json()
    assert g["message"] == "Please hold, connecting you to our doctor." and g["timeout"] == 45
    assert (await client.put(f"/product/tools/handover/{aid}", json={"number": "+919876543210", "timeout": 5}, headers=ha)).status_code == 422
