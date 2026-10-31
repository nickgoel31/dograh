"""Phase 8: public API and keys, webhooks, roles, invites, audit, privacy, two-step sign-in, help."""

import json
import time
from datetime import UTC, datetime, timedelta

import pytest_asyncio
from sqlalchemy import select

from api.db import models, product_models
from api.product import developers as dev
from api.product import totp
from api.tests.product.support import bearer, make_client, signup


@pytest_asyncio.fixture
async def client(monkeypatch):
    async with make_client(monkeypatch) as c:
        yield c


async def workspace(client):
    async with client.session_factory() as s:
        return (await s.execute(select(product_models.ProductWorkspaceModel))).scalars().first()


async def make_agent(client, h, name="Bot"):
    a = (await client.post("/product/agents", json={"name": name, "template": "receptionist"}, headers=h)).json()
    async with client.session_factory() as s:
        row = (await s.execute(select(product_models.ProductAgentModel).where(product_models.ProductAgentModel.public_id == a["id"]))).scalar_one()
        return a["id"], row.test_workflow_id


async def add_run(client, org_id, wf_id, age_days=0, logs=None, recording=None):
    async with client.session_factory() as s:
        if not await s.get(models.WorkflowModel, wf_id):
            s.add(models.WorkflowModel(id=wf_id, name="w", organization_id=org_id, workflow_definition={}))
        run = models.WorkflowRunModel(
            name="r", workflow_id=wf_id, mode="smallwebrtc", is_completed=True, logs=logs, recording_url=recording,
            cost_info={"call_duration_seconds": 60}, gathered_context={"call_disposition": "appointment_booked"},
            initial_context={"caller_number": "+911234567890"}, created_at=datetime.now(UTC) - timedelta(days=age_days),
        )
        s.add(run)
        await s.commit()
        return run.id


async def join(client, owner_h, email, role):
    """Invite `email` into the owner's workspace and accept as that person. Returns their headers for that workspace."""
    inv = (await client.post("/product/team/invites", json={"email": email, "role": role}, headers=owner_h)).json()
    _, tok = await signup(client, email)
    r = await client.post("/product/team/invites/accept", json={"token": inv["token"]}, headers=bearer(tok))
    assert r.status_code == 200, r.text
    return bearer(tok, **{"X-Workspace": r.json()["workspace"]})


async def test_keys_public_api_and_request_log(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    agent_id, wf = await make_agent(client, h)
    ws = await workspace(client)
    k = (await client.post("/product/developers/keys", json={"name": "server"}, headers=h)).json()
    assert k["key"].startswith("sk_test_") and k["environment"] == "test"
    listed = (await client.get("/product/developers/keys", headers=h)).json()
    assert listed[0]["key"] is None and k["key"] not in json.dumps(listed)  # shown once only

    kh = {"Authorization": f"Bearer {k['key']}"}
    assert (await client.get("/public/me", headers=kh)).json()["environment"] == "test"
    assert [a["id"] for a in (await client.get("/public/agents", headers=kh)).json()] == [agent_id]
    assert (await client.get("/public/agents", headers={"Authorization": "Bearer sk_test_nope"})).status_code == 401
    assert (await client.get("/public/agents")).status_code == 401

    live = (await client.post("/product/developers/keys", json={"name": "live"}, headers=bearer(tok, **{"X-Environment": "live"}))).json()
    assert live["key"].startswith("sk_live_")
    assert (await client.get("/public/agents", headers={"Authorization": f"Bearer {live['key']}"})).json() == []  # nothing live yet

    run_id = await add_run(client, ws.test_org_id, wf)
    page = (await client.get("/public/calls", headers=kh)).json()
    assert page["total"] == 1
    cid = page["calls"][0]["id"]
    assert (await client.get(f"/public/calls/{cid}", headers=kh)).status_code == 200
    assert (await client.get("/public/calls", headers={"Authorization": f"Bearer {live['key']}"})).json()["total"] == 0  # live key can't see test calls
    assert run_id

    log = (await client.get("/product/developers/logs", headers=h)).json()
    assert {"/public/agents", "/public/calls"} <= {x["path"] for x in log} and any(x["status"] == 200 for x in log)

    assert (await client.delete(f"/product/developers/keys/{k['id']}", headers=h)).status_code == 200
    assert (await client.get("/public/agents", headers=kh)).status_code == 401


async def test_roles_are_enforced_on_every_sensitive_endpoint(client):
    _, tok = await signup(client, "owner@x.com")
    owner = bearer(tok)
    heads = {
        "owner": owner,
        "admin": await join(client, owner, "admin@x.com", "admin"),
        "developer": await join(client, owner, "dev@x.com", "developer"),
        "viewer": await join(client, owner, "view@x.com", "viewer"),
    }
    ws = (await client.get("/product/me", headers=owner)).json()["current_workspace"]["id"]
    for h in heads.values():
        h["X-Workspace"] = ws
    settings = {"record_calls": True, "redact_pii": False}
    cases = [  # method, path, body, roles allowed
        ("get", "/product/developers/keys", None, {"owner", "admin", "developer"}),
        ("post", "/product/developers/keys", {"name": "k"}, {"owner", "admin", "developer"}),
        ("get", "/product/developers/webhooks", None, {"owner", "admin", "developer"}),
        ("get", "/product/team/audit", None, {"owner", "admin"}),
        ("post", "/product/team/invites", {"email": "new@x.com", "role": "viewer"}, {"owner", "admin"}),
        ("put", "/product/team/settings", settings, {"owner", "admin"}),
        ("post", "/product/team/sub-accounts", {"name": "Client"}, {"owner", "admin"}),
        ("post", "/product/team/privacy/purge", None, {"owner"}),
        ("get", "/product/team", None, {"owner", "admin", "developer", "viewer"}),
        ("post", "/product/agents", {"name": "Z"}, {"owner", "admin", "developer"}),
        ("get", "/product/agents", None, {"owner", "admin", "developer", "viewer"}),
    ]
    for method, path, body, allowed in cases:
        for role, h in heads.items():
            r = await getattr(client, method)(path, headers=h, **({"json": body} if body is not None else {}))
            assert (r.status_code != 403) == (role in allowed), f"{method} {path} as {role} -> {r.status_code} {r.text}"


async def test_webhooks_sign_dedupe_retry_and_alert(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    for bad in ("http://example.com/x", "https://127.0.0.1/x", "https://10.0.0.5/x"):
        assert (await client.post("/product/developers/webhooks", json={"url": bad}, headers=h)).status_code == 400
    hook = (await client.post("/product/developers/webhooks", json={"url": "https://hooks.example.com/in"}, headers=h)).json()
    assert hook["secret"].startswith("whsec_")
    assert (await client.get("/product/developers/webhooks", headers=h)).json()[0]["secret"] is None

    d = (await client.post(f"/product/developers/webhooks/{hook['id']}/test", headers=h)).json()
    assert d["status"] == "ok"
    url, headers, body = client.sender.sent[-1]
    ts, sig = [p.split("=", 1)[1] for p in headers[dev.signature_header()].split(",")]
    assert sig == dev.sign(hook["secret"], int(ts), body) and json.loads(body)["type"] == "webhook.test"

    # calls become events once each
    _, wf = await make_agent(client, h)
    await add_run(client, (await workspace(client)).test_org_id, wf)
    client.sender.sent.clear()
    first = (await client.post("/product/developers/webhooks/send-now", headers=h)).json()
    types = sorted(json.loads(b)["type"] for _, _, b in client.sender.sent)
    assert first["queued"] == 2 and types == ["call.ended", "call.started"]
    assert (await client.post("/product/developers/webhooks/send-now", headers=h)).json() == {"queued": 0, "sent": 0}

    # a broken receiver is retried with back-off, then given up on with an alert
    client.sender.code = 500
    d = (await client.post(f"/product/developers/webhooks/{hook['id']}/test", headers=h)).json()
    assert d["status"] == "pending" and d["attempts"] == 1 and d["next_attempt"]
    now = datetime.now(UTC)
    async with client.session_factory() as s:
        for i in range(1, 8):
            await dev.deliver_due(s, client.sender, now=now + timedelta(days=i))
        await s.commit()
    rows = (await client.get(f"/product/developers/webhooks/{hook['id']}/deliveries", headers=h)).json()
    assert rows[0]["status"] == "failed" and rows[0]["attempts"] == dev.MAX_ATTEMPTS
    assert (await client.get("/product/developers/webhooks", headers=h)).json()[0]["failing"] is True
    assert any(n["kind"] == "webhook" for n in (await client.get("/product/notifications", headers=h)).json()["items"])

    client.sender.code = 200  # fixed on their side: resend by hand
    again = (await client.post(f"/product/developers/webhooks/deliveries/{rows[0]['id']}/resend", headers=h)).json()
    assert again["status"] == "ok"


async def test_team_invites_roles_and_audit(client):
    _, tok = await signup(client, "owner@x.com")
    owner = bearer(tok)
    inv = (await client.post("/product/team/invites", json={"email": "Dev@x.com", "role": "developer"}, headers=owner)).json()
    assert (await client.post("/product/team/invites", json={"email": "z@x.com", "role": "owner"}, headers=owner)).status_code == 400
    assert len((await client.get("/product/team", headers=owner)).json()["invites"]) == 1

    _, wrong = await signup(client, "other@x.com")
    r = await client.post("/product/team/invites/accept", json={"token": inv["token"]}, headers=bearer(wrong))
    assert r.status_code == 403 and r.json()["detail"]["code"] == "invite_wrong_account"

    _, dev_tok = await signup(client, "dev@x.com")
    ok = await client.post("/product/team/invites/accept", json={"token": inv["token"]}, headers=bearer(dev_tok))
    assert ok.status_code == 200 and ok.json()["role"] == "developer"
    assert (await client.post("/product/team/invites/accept", json={"token": inv["token"]}, headers=bearer(dev_tok))).status_code == 400  # single use

    team = (await client.get("/product/team", headers=owner)).json()
    assert {m["role"] for m in team["members"]} == {"owner", "developer"} and team["invites"] == []
    member = next(m for m in team["members"] if m["role"] == "developer")
    me = next(m for m in team["members"] if m["you"])
    assert (await client.patch(f"/product/team/members/{me['id']}", json={"role": "viewer"}, headers=owner)).status_code == 400
    assert (await client.patch(f"/product/team/members/{member['id']}", json={"role": "viewer"}, headers=owner)).status_code == 200
    assert (await client.delete(f"/product/team/members/{member['id']}", headers=owner)).status_code == 200
    assert (await client.get("/product/me", headers=bearer(dev_tok))).status_code in (200, 403)  # still has their own workspace

    actions = [a["action"] for a in (await client.get("/product/team/audit", headers=owner)).json()]
    assert {"invite.created", "invite.accepted", "member.role_changed", "member.removed"} <= set(actions)


async def test_privacy_redaction_recording_consent_and_retention(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    ws = await workspace(client)
    agent_id, wf = await make_agent(client, h)
    from api.product import conversations_router as cr

    async def fake_sign(run):
        return "https://audio.example/x.wav" if run.recording_url else None

    client._transport.app.dependency_overrides[cr.get_audio_signer] = lambda: fake_sign
    events = [{"type": "rtf-user-transcription", "payload": {"text": "Call me on +91 98765 43210 or mail a@b.com", "final": True}}]
    rid = await add_run(client, ws.test_org_id, wf, logs={"realtime_feedback_events": events}, recording="s3://rec.wav")
    cid = (await client.get("/product/conversations", headers=h)).json()["calls"][0]["id"]
    before = (await client.get(f"/product/conversations/{cid}", headers=h)).json()
    assert "a@b.com" in before["turns"][0]["text"] and before["audio_url"]

    bad = await client.put("/product/team/settings", json={"record_calls": False, "redact_pii": True, "widget_origins": ["ftp://x"]}, headers=h)
    assert bad.status_code == 400
    r = await client.put("/product/team/settings", headers=h, json={
        "record_calls": False, "redact_pii": True, "retention_days": 30, "consent_announcement": "This call may be recorded.", "widget_origins": ["https://shop.example.com/"]})
    assert r.status_code == 200 and r.json()["widget_origins"] == ["https://shop.example.com"]
    after = (await client.get(f"/product/conversations/{cid}", headers=h)).json()
    text = after["turns"][0]["text"]
    assert "[phone]" in text and "[email]" in text and "a@b.com" not in text and after["audio_url"] is None
    assert (await client.get("/product/conversations", headers=h)).json()["calls"][0]["phone"].startswith("•••")

    # announcement is spoken first on Live calls
    assert (await client.post(f"/product/agents/{agent_id}/publish", headers=h)).status_code == 200
    graph = client.fake.published[(ws.live_org_id, next(k[1] for k in client.fake.published if k[0] == ws.live_org_id))]
    assert graph["nodes"][0]["data"]["greeting"].startswith("This call may be recorded.")

    old = await add_run(client, ws.test_org_id, wf, age_days=60, logs={"realtime_feedback_events": events}, recording="s3://old.wav")
    assert (await client.post("/product/team/privacy/purge", headers=h)).json()["cleared"] == 1
    async with client.session_factory() as s:
        gone, kept = await s.get(models.WorkflowRunModel, old), await s.get(models.WorkflowRunModel, rid)
        assert gone.recording_url is None and "realtime_feedback_events" not in (gone.logs or {}) and kept.recording_url == "s3://rec.wav"


async def test_two_step_sign_in(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    setup = (await client.post("/product/team/2fa/setup", headers=h)).json()
    assert setup["uri"].startswith("otpauth://") and setup["secret"]
    assert (await client.post("/product/team/2fa/enable", json={"code": "000000"}, headers=h)).status_code == 400

    def now_code():
        return totp._code(setup["secret"], int(time.time() // 30))

    assert (await client.post("/product/team/2fa/enable", json={"code": now_code()}, headers=h)).json()["enabled"] is True
    creds = {"email": "a@x.com", "password": "password123"}
    r = await client.post("/product/auth/login", json=creds)
    assert r.status_code == 401 and r.json()["detail"]["code"] == "two_factor_required"
    assert (await client.post("/product/auth/login", json={**creds, "code": "123456"})).json()["detail"]["code"] == "bad_code"
    assert (await client.post("/product/auth/login", json={**creds, "code": now_code()})).status_code == 200
    assert (await client.post("/product/team/2fa/disable", json={"code": now_code()}, headers=h)).json()["enabled"] is False
    assert (await client.post("/product/auth/login", json=creds)).status_code == 200


async def test_help_status_contact_and_widget(client):
    top = (await client.get("/product/help/articles?q=buy a phone number")).json()
    assert top and top[0]["id"] == "numbers"
    states = {s["name"]: s["state"] for s in (await client.get("/product/help/status")).json()}
    assert states["App and database"] == "ok" and states["Voice and AI models"] == "ok"

    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    ans = (await client.post("/product/help/ask", json={"question": "how do webhooks work"}, headers=h)).json()
    assert ans["from_ai"] is True and ans["articles"][0]["id"] == "webhooks"
    none = (await client.post("/product/help/ask", json={"question": "zzqq"}, headers=h)).json()
    assert none["articles"] == [] and none["from_ai"] is False
    assert (await client.post("/product/help/contact", json={"subject": "Hi", "body": "Help"}, headers=h)).json()["ok"] is True
    async with client.session_factory() as s:
        assert len((await s.execute(select(product_models.ProductSupportMessageModel))).scalars().all()) == 1

    js = await client.get("/public/widget.js")
    assert js.status_code == 200 and "javascript" in js.headers["content-type"] and "iframe" in js.text
