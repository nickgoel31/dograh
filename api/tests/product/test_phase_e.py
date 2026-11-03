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
