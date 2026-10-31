"""Conversations: outcome mapping, transcript building, ids, tenant scoping."""

from datetime import UTC, datetime, timedelta

import pytest_asyncio
from sqlalchemy import select

from api.db import models, product_models
from api.product import conversations as conv
from api.product.ids import decode_call_id, encode_call_id
from api.tests.product.support import bearer, make_client, signup


@pytest_asyncio.fixture
async def client(monkeypatch):
    async with make_client(monkeypatch) as c:
        yield c


def test_outcome_mapping_table():
    o = lambda d, done=True, dur=60: conv.product_outcome(disposition=d, completed=done, duration=dur)
    assert o("appointment_booked") == "booked"
    assert o("XFER") == "transferred" and o("call_transferred") == "transferred"
    assert o("voicemail_detected") == "voicemail"
    assert o("pipeline_error") == "failed"
    assert o("user_idle_max_duration_exceeded") == "no-answer"
    assert o("qualified_lead") == "qualified"
    assert o("not_interested") == "resolved"  # never "qualified"
    assert o("user_hangup") == "resolved"
    assert o(None, dur=2) == "no-answer" and o(None) == "resolved"
    assert o(None, done=False) is None  # still in progress


def test_transcript_merges_bot_chunks_and_measures_reply_speed():
    base = datetime(2026, 1, 1, tzinfo=UTC)
    ts = lambda s: (base + timedelta(seconds=s)).isoformat()
    ev = [
        {"type": "rtf-bot-text", "payload": {"text": "Hello"}, "timestamp": ts(0)},
        {"type": "rtf-bot-text", "payload": {"text": "there!"}, "timestamp": ts(1)},
        {"type": "rtf-user-transcription", "payload": {"text": "Book me in", "final": True}, "timestamp": ts(4)},
        {"type": "rtf-user-transcription", "payload": {"text": "Boo", "final": False}, "timestamp": ts(3)},
        {"type": "ttfb-metric", "payload": {"ttfb_seconds": 0.4}, "timestamp": ts(5)},
        {"type": "ttfb-metric", "payload": {"ttfb_seconds": 0.3}, "timestamp": ts(5)},
        {"type": "rtf-function-call-start", "payload": {"function_name": "book"}, "timestamp": ts(6)},
        {"type": "rtf-bot-text", "payload": {"text": "Done."}, "timestamp": ts(7)},
    ]
    t = conv.build_transcript(ev)
    assert [x["who"] for x in t] == ["agent", "caller", "agent"]
    assert t[0]["text"] == "Hello there!" and t[1]["text"] == "Book me in"
    assert t[2]["reply"] == 0.7 and t[2]["text"] == "Done."


def test_cost_split_adds_up_to_price_and_hides_vendor_cost():
    split = conv.cost_split({"cost_breakdown": {"llm_cost": 3.0, "tts_cost": 1.0, "stt_cost": 1.0}}, 10.0)
    assert round(sum(s["value"] for s in split), 2) == 10.0 and split[-1] == {"name": "Phone", "value": 0.0}
    assert all(s["value"] == 0 for s in conv.cost_split(None, 0))


def test_call_ids_are_opaque_and_tamper_proof():
    cid = encode_call_id(1234)
    assert cid.startswith("call_") and decode_call_id(cid) == 1234
    assert decode_call_id(cid[:-1] + ("0" if cid[-1] != "0" else "1")) is None
    assert decode_call_id("call_zz") is None and decode_call_id("nope") is None


def test_extracted_answers_hide_internal_keys():
    out = conv.extracted_answers({"call_disposition": "x", "provider": "p", "party_size": 4, "_t": 1, "blob": {"a": 1}})
    assert out == {"Party size": "4"}


async def _run(client, org_id, wf_id, **kw):
    async with client.session_factory() as s:
        wf = models.WorkflowModel(id=wf_id, name="w", organization_id=org_id, workflow_definition={})
        run = models.WorkflowRunModel(
            name="r", workflow_id=wf_id, mode="smallwebrtc", is_completed=True,
            cost_info={"call_duration_seconds": 90, "cost_breakdown": {"llm_cost": 1, "tts_cost": 1, "stt_cost": 1}},
            gathered_context={"call_disposition": "appointment_booked"}, initial_context={"caller_number": "+911234567890"},
            created_at=datetime.now(UTC), **kw,
        )
        s.add_all([wf, run])
        await s.commit()
        return run.id


async def test_list_detail_scoping_and_environments(client):
    me_a, tok_a = await signup(client, "a@x.com")
    _, tok_b = await signup(client, "b@x.com")
    client.cookies.clear()
    ha = bearer(tok_a)
    aid = (await client.post("/product/agents", json={"name": "P", "template": "receptionist"}, headers=ha)).json()["id"]
    async with client.session_factory() as s:
        ws = (await s.execute(select(product_models.ProductWorkspaceModel).where(
            product_models.ProductWorkspaceModel.public_id == me_a["current_workspace"]["id"]))).scalar_one()
        ag = (await s.execute(select(product_models.ProductAgentModel))).scalar_one()
    rid = await _run(client, ws.test_org_id, ag.test_workflow_id)
    await _run(client, ws.live_org_id, 999)  # a live call, invisible in Test mode

    page = (await client.get("/product/conversations", headers=ha)).json()
    assert page["total"] == 1 and page["calls"][0]["outcome"] == "booked"
    assert page["calls"][0]["agent_id"] == aid and page["calls"][0]["cost"] == 13.5 and page["calls"][0]["test"] is True  # practice calls cost the same as real ones
    assert page["calls"][0]["duration"] == 90 and page["calls"][0]["phone"] == "+911234567890"
    live = (await client.get("/product/conversations", headers={**ha, "X-Environment": "live"})).json()
    assert live["total"] == 1 and live["calls"][0]["cost"] == 13.5  # 90 seconds is billed as 2 minutes

    assert (await client.get("/product/conversations?outcome=booked", headers=ha)).json()["total"] == 1
    assert (await client.get("/product/conversations?outcome=failed", headers=ha)).json()["total"] == 0
    assert (await client.get("/product/conversations?outcome=nonsense", headers=ha)).status_code == 400

    cid = page["calls"][0]["id"]
    d = (await client.get(f"/product/conversations/{cid}", headers=ha)).json()
    assert d["cost_split"][-1]["name"] == "Phone" and d["audio_url"] is None and d["summary"] is None
    # another workspace, and the other environment, cannot read it
    hb = bearer(tok_b)
    assert (await client.get(f"/product/conversations/{cid}", headers=hb)).status_code == 404
    assert (await client.get("/product/conversations", headers=hb)).json()["total"] == 0
    assert (await client.get(f"/product/conversations/{cid}", headers={**ha, "X-Environment": "live"})).status_code == 404
    assert "call_" in cid and str(rid) != cid
    csv = await client.get("/product/conversations/export/csv", headers=ha)
    assert csv.status_code == 200 and "booked" in csv.text
