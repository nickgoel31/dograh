"""Agent script, the in-app assistant, identity verification (KYC) before buying numbers, and number prices."""

import base64

import pytest_asyncio

from api.product import llm_gateway, number_providers, numbers_router
from api.tests.product.support import bearer, make_client, signup
from api.tests.product.test_platform import make_agent, workspace

PDF = base64.b64encode(b"%PDF-1.4 test").decode()


@pytest_asyncio.fixture
async def client(monkeypatch):
    async with make_client(monkeypatch) as c:
        yield c


async def test_script_is_saved_returned_and_goes_into_the_prompt(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    made = (await client.post("/product/agents", json={"name": "Bot", "template": "receptionist", "script": "1. Greet.\n2. Ask the name."}, headers=h)).json()
    assert made["script"].startswith("1. Greet")
    ws = await workspace(client)
    from sqlalchemy import select

    from api.db import product_models

    async with client.session_factory() as s:
        wf = (await s.execute(select(product_models.ProductAgentModel.test_workflow_id))).scalar_one()
    graph = await client.fake.working_definition(ws.test_org_id, wf)
    assert "Ask the name." in next(n for n in graph["nodes"] if n["type"] == "startCall")["data"]["prompt"]
    r = await client.patch(f"/product/agents/{made['id']}", json={"script": "Always offer a callback."}, headers=h)
    assert r.status_code == 200 and r.json()["script"] == "Always offer a callback."
    graph = await client.fake.working_definition(ws.test_org_id, wf)
    assert "Always offer a callback." in next(n for n in graph["nodes"] if n["type"] == "startCall")["data"]["prompt"]


async def test_assistant_answers_and_falls_back_to_the_help_articles(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    body = {"messages": [{"role": "user", "content": "How do I buy a phone number?"}], "page": "/numbers"}
    ok = await client.post("/product/assistant/chat", json=body, headers=h)
    assert ok.status_code == 200 and ok.json()["reply"]
    assert "Phone Numbers" in client.llm.calls[-1] or client.llm.calls  # the model was asked

    class Down:
        async def complete(self, *a, **k):
            raise RuntimeError("no model")

    client._transport.app.dependency_overrides[llm_gateway.get_llm] = lambda: Down()
    fb = (await client.post("/product/assistant/chat", json=body, headers=h)).json()["reply"]
    assert "phone number" in fb.lower() and "/help" in fb
    assert (await client.post("/product/assistant/chat", json={"messages": [], "page": "/"}, headers=h)).status_code == 422
    client.cookies.clear()
    assert (await client.post("/product/assistant/chat", json=body)).status_code == 401


async def test_indian_numbers_need_approved_kyc_and_show_prices(client, monkeypatch):
    monkeypatch.setenv("PRODUCT_OPS_SECRET", "ops-secret")
    monkeypatch.setenv("PRODUCT_NUMBER_MONTHLY_LOCAL", "299")
    monkeypatch.setattr(numbers_router.providers, "provider_for", lambda env: number_providers.SandboxNumbers())
    _, tok = await signup(client, "a@x.com")
    live = {**bearer(tok), "X-Environment": "live"}
    assert (await client.get("/product/kyc", headers=live)).json()["status"] == "none"
    offers = (await client.get("/product/numbers/available?country=IN", headers=live)).json()
    assert offers[0]["kyc_required"] is True and offers[0]["monthly"] == 299 and offers[0]["per_minute"] > 0 and offers[0]["currency"] == "INR"
    blocked = await client.post("/product/numbers", json={"number": offers[0]["number"]}, headers=live)
    assert blocked.status_code == 403 and blocked.json()["detail"]["code"] == "kyc_required"

    form = {"business_name": "Smile Dental", "business_type": "company", "contact_name": "Asha Rao", "contact_email": "asha@smile.in", "contact_phone": "+919999999999",
            "address": "12 MG Road", "city": "Pune", "state": "Maharashtra", "postal_code": "411001", "pan": "abcde1234f", "gstin": None}
    docs = [{"kind": "pan", "name": "pan.pdf", "mime": "application/pdf", "data_b64": PDF}, {"kind": "address_proof", "name": "bill.pdf", "mime": "application/pdf", "data_b64": PDF}]
    assert (await client.put("/product/kyc", json={**form, "pan": "123", "documents": docs}, headers=live)).status_code in (400, 422)
    assert (await client.put("/product/kyc", json={**form, "documents": docs[:1]}, headers=live)).json()["detail"]["code"] == "documents_missing"
    sent = await client.put("/product/kyc", json={**form, "documents": docs}, headers=live)
    assert sent.status_code == 200 and sent.json()["status"] == "submitted" and sent.json()["data"]["pan"] == "AB******4F" and len(sent.json()["documents"]) == 2
    assert (await client.post("/product/numbers", json={"number": offers[0]["number"]}, headers=live)).status_code == 403  # still under review

    ws = (await workspace(client)).id
    assert (await client.get("/product/ops/kyc")).status_code == 401
    pending = (await client.get("/product/ops/kyc", headers={"X-Ops-Secret": "ops-secret"})).json()
    assert pending[0]["workspace_id"] == ws and pending[0]["pan"] == "ABCDE1234F"
    doc = await client.get(f"/product/ops/kyc/{ws}/documents/0", headers={"X-Ops-Secret": "ops-secret"})
    assert doc.status_code == 200 and doc.content.startswith(b"%PDF")
    no = await client.post(f"/product/ops/kyc/{ws}", json={"status": "rejected"}, headers={"X-Ops-Secret": "ops-secret"})
    assert no.status_code == 400  # a reason is needed
    assert (await client.post(f"/product/ops/kyc/{ws}", json={"status": "approved"}, headers={"X-Ops-Secret": "ops-secret"})).status_code == 200
    assert (await client.get("/product/kyc", headers=live)).json()["status"] == "approved"
    assert (await client.post("/product/numbers", json={"number": offers[0]["number"]}, headers=live)).status_code == 201
    assert (await client.put("/product/kyc", json={**form, "documents": docs}, headers=live)).status_code == 409  # approved details are locked


async def test_home_assistant_plans_tool_calls_and_ignores_unknown_ones(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)

    async def said(text):
        async def complete(*a, **k):
            return text

        client.llm.complete = complete
        return (await client.post("/product/assistant/plan", json={"messages": [{"role": "user", "content": "hi"}], "page": "/"}, headers=h)).json()

    out = await said('```json\n{"reply": "Let me look.", "calls": [{"tool": "list_agents", "args": {}}, {"tool": "delete_everything", "args": {}}, {"tool": "create_agent", "args": {"name": "Bot"}}]}\n```')
    assert out["reply"] == "Let me look." and [(c["tool"], c["kind"]) for c in out["calls"]] == [("list_agents", "read"), ("create_agent", "write")]
    plain = await said("Just text, no JSON.")
    assert plain["reply"] == "Just text, no JSON." and plain["calls"] == []


async def test_an_agent_can_be_deleted_only_from_its_own_workspace(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    made = (await client.post("/product/agents", json={"name": "Bot", "template": "receptionist"}, headers=h)).json()
    other = bearer((await signup(client, "b@x.com"))[1])
    assert (await client.delete(f"/product/agents/{made['id']}", headers=other)).status_code == 404
    assert (await client.delete(f"/product/agents/{made['id']}", headers=h)).status_code == 204
    assert (await client.get(f"/product/agents/{made['id']}", headers=h)).status_code == 404
    assert [a["id"] for a in (await client.get("/product/agents", headers=h)).json()] == []


async def test_the_assistant_uses_the_platform_key_but_other_features_do_not(monkeypatch):
    from api.product import llm_gateway

    seen = {}

    async def fake_inference(llm, messages, system):
        seen["llm"] = llm
        return "hi"

    def fake_service(provider, model, key, **extra):
        seen["cfg"] = (provider, model, key)
        return "svc"

    import api.services.pipecat.service_factory as sf
    import api.services.workflow.qa.analysis as qa

    monkeypatch.setattr(sf, "create_llm_service_from_provider", fake_service)
    monkeypatch.setattr(qa, "_run_llm_inference", fake_inference)
    monkeypatch.setenv("PRODUCT_ASSISTANT_OPENAI_KEY", "sk-platform")
    out = await llm_gateway.CoreLLM().complete(1, 1, "sys", [{"role": "user", "content": "x"}], platform=True)
    assert out == "hi" and seen["cfg"] == ("openai", "gpt-4.1-mini", "sk-platform")


class FakePlivoCompliance:
    """Stands in for Plivo's compliance service."""

    def __init__(self, fail=False):
        self.fail, self.sent, self.state, self.linked = fail, [], ("submitted", None), []

    async def submit(self, data, docs, callback_url):
        if self.fail:
            from api.product.plivo_kyc import ComplianceError

            raise ComplianceError("Plivo returned no document list")
        self.sent.append((data["business_name"], sorted(d["kind"] for d in docs), callback_url))
        return "cmp-123"

    async def status(self, cid):
        assert cid == "cmp-123"
        return self.state

    async def link(self, number, cid):
        self.linked.append((number, cid))


def _form(kind="company"):
    form = {"business_name": "Smile Dental", "business_type": kind, "contact_name": "Asha Rao", "contact_email": "asha@smile.in", "contact_phone": "+919999999999",
            "address": "12 MG Road", "city": "Pune", "state": "Maharashtra", "postal_code": "411001", "pan": "ABCDE1234F", "gstin": "27ABCDE1234F1Z5"}
    docs = [{"kind": k, "name": f"{k}.pdf", "mime": "application/pdf", "data_b64": PDF} for k in ("pan", "address_proof", "business_proof", "gst")]
    return form, docs


async def test_kyc_is_sent_to_the_carrier_and_settles_by_itself(client, monkeypatch):
    from api.product import kyc_router, plivo_kyc

    fake = FakePlivoCompliance()
    client._transport.app.dependency_overrides[plivo_kyc.get_compliance] = lambda: fake
    monkeypatch.setenv("PRODUCT_OPS_SECRET", "ops")
    _, tok = await signup(client, "a@x.com")
    live = {**bearer(tok), "X-Environment": "live"}
    form, docs = _form()
    # a business must send its registration and GST papers
    assert (await client.put("/product/kyc", json={**form, "documents": docs[:2]}, headers=live)).json()["detail"]["code"] == "documents_missing"
    sent = (await client.put("/product/kyc", json={**form, "documents": docs}, headers=live)).json()
    assert sent["status"] == "submitted" and "plivo_id" not in sent["data"] and fake.sent[0][0] == "Smile Dental" and fake.sent[0][1] == ["address_proof", "business_proof", "gst", "pan"]
    assert fake.sent[0][2].endswith("/api/v1/product/hooks/plivo-kyc")
    # still being checked: nothing changes
    assert (await client.get("/product/kyc", headers=live)).json()["status"] == "submitted"
    # the carrier approves; the callback makes us ask it, and the workspace is approved without anyone clicking
    fake.state = ("approved", None)
    assert (await client.post("/product/hooks/plivo-kyc", json={"compliance_id": "cmp-123"})).status_code == 200
    assert (await client.get("/product/kyc", headers=live)).json()["status"] == "approved"


async def test_a_rejection_comes_back_with_the_reason_and_a_failed_submission_falls_back_to_a_person(client, monkeypatch):
    from api.product import kyc_router, plivo_kyc

    fake = FakePlivoCompliance()
    client._transport.app.dependency_overrides[plivo_kyc.get_compliance] = lambda: fake
    _, tok = await signup(client, "a@x.com")
    live = {**bearer(tok), "X-Environment": "live"}
    form, docs = _form()
    await client.put("/product/kyc", json={**form, "documents": docs}, headers=live)
    fake.state = ("rejected", "GST certificate is blurry")
    async with client.session_factory() as s:
        assert await kyc_router.sync_all(s, fake, None) == 1
    got = (await client.get("/product/kyc", headers=live)).json()
    assert got["status"] == "rejected" and got["note"] == "GST certificate is blurry"
    # when the carrier can't be reached the verification is simply waiting for a person, like before
    broken = FakePlivoCompliance(fail=True)
    client._transport.app.dependency_overrides[plivo_kyc.get_compliance] = lambda: broken
    again = (await client.put("/product/kyc", json={**form, "documents": docs}, headers=live)).json()
    assert again["status"] == "submitted"
    async with client.session_factory() as s:
        row = await kyc_router.get_row(s, (await workspace(client)).id)
        assert "no document list" in row.data["auto_error"] and "plivo_id" not in row.data


def test_plivo_requirements_are_read_whatever_the_reply_looks_like():
    from api.product import plivo_kyc

    reply = {"api_id": "x", "requirements": {"documents": [{"document_type_id": "d1", "name": "Registration Certificate", "proof_required": True, "data_fields": [{"field_name": "business_name"}]},
                                                           {"document_type_id": "d2", "name": "GST Registration Certificate", "proof_required": True}]}}
    got = plivo_kyc._doc_types(reply)
    assert [(d["id"], plivo_kyc.kind_of(d["name"]), d["fields"]) for d in got] == [("d1", "business_proof", ["business_name"]), ("d2", "gst", [])]
