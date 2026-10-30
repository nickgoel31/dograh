"""Phase 7 main paths: Testing Lab (callers, cases, A/B) and analytics + insights."""

import asyncio
import json
from datetime import UTC, datetime, timedelta

import pytest_asyncio
from sqlalchemy import select

from api.db import models, product_models
from api.product import analytics_router as an
from api.product import labs
from api.tests.product.support import bearer, make_client, signup


@pytest_asyncio.fixture
async def client(monkeypatch):
    async with make_client(monkeypatch) as c:
        yield c


async def mk_agent(client, h, prompt=None):
    aid = (await client.post("/product/agents", json={"name": "P", "template": "receptionist"}, headers=h)).json()["id"]
    if prompt:
        await client.patch(f"/product/agents/{aid}", json={"prompt": prompt}, headers=h)
    return aid


async def wait_done(client, path, h, key="status", want=("done", "failed"), tries=400):
    # Wait for the background job itself, not by polling: the test database has one shared connection,
    # so a polling request closing its session could roll back the job's half-finished write.
    from api.product import labs_router

    await asyncio.gather(*list(labs_router._tasks))
    for _ in range(tries):
        r = (await client.get(path, headers=h)).json()
        if r[key] in want:
            return r
        await asyncio.sleep(0.03)
    raise AssertionError(f"never finished: {r}")


# ---------- pure logic ----------
def test_judgement_weights_made_up_facts_and_rejects_junk():
    good = labs.parse_judgement('x {"goal_reached":100,"politeness":100,"handled_difficulty":100,"no_made_up_facts":100,"note":"ok"} y')
    assert good.score == 100
    lied = labs.parse_judgement('{"goal_reached":100,"politeness":100,"handled_difficulty":100,"no_made_up_facts":0,"note":"invented a price"}')
    assert lied.score == 75 and lied.note == "invented a price"
    assert labs.parse_judgement("no json here") is None and labs.parse_judgement('{"goal_reached":"lots"}') is None
    assert labs.parse_verdict('{"pass": true, "note": "n"}') == (True, "n") and labs.parse_verdict('{"pass":"yes"}') is None


def test_ab_winner_only_when_data_is_enough_and_gap_is_real():
    assert labs.significance(8, 10, 2, 10)["reason"] == "not_enough_data"  # too few runs, however big the gap
    win = labs.significance(40, 50, 20, 50)
    assert win["winner"] == "A" and win["p"] < 0.05
    assert labs.significance(21, 40, 20, 40)["winner"] is None and labs.significance(21, 40, 20, 40)["reason"] == "no_clear_winner"
    assert labs.significance(10, 30, 10, 30)["reason"] == "no_clear_winner" or labs.significance(10, 30, 10, 30)["winner"] is None


def test_insight_numbers_must_come_from_the_fact():
    fact = {"numbers": [9, 14, 5.0], "text": "x"}
    assert an.numbers_traceable("Your busiest hour is 09:00 with 14 calls.", fact)
    assert not an.numbers_traceable("Your busiest hour is 09:00 with 41 calls.", fact)
    assert not an.numbers_traceable("That's a 20% jump", fact)


# ---------- simulated callers ----------
async def test_simulated_caller_runs_in_background_and_is_scored(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    aid = await mk_agent(client, h)
    assert {p["id"] for p in (await client.get("/product/lab/personas", headers=h)).json()} >= {"angry", "confused", "fast"}
    r = await client.post("/product/lab/sim", json={"agent_id": aid, "persona": "angry"}, headers=h)
    assert r.status_code == 201 and r.json()["status"] == "running"
    done = await wait_done(client, f"/product/lab/sim/{r.json()['id']}", h)
    assert done["status"] == "done" and done["score"] == 90 and done["passed"] is True and done["note"] == "Went well."
    assert {t["who"] for t in done["turns"]} == {"agent", "caller"}
    assert [s["id"] for s in (await client.get(f"/product/lab/sim?agent_id={aid}", headers=h)).json()] == [r.json()["id"]]
    assert (await client.post("/product/lab/sim", json={"agent_id": aid, "persona": "alien"}, headers=h)).status_code == 400


async def test_unscorable_run_fails_with_a_plain_message(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    aid = await mk_agent(client, h)
    client.llm.judge = "I refuse to answer in JSON."
    r = await client.post("/product/lab/sim", json={"agent_id": aid, "persona": "fast"}, headers=h)
    done = await wait_done(client, f"/product/lab/sim/{r.json()['id']}", h)
    assert done["status"] == "failed" and "couldn't score" in done["note"] and done["passed"] is None


# ---------- test cases ----------
async def test_cases_cache_per_version_check_tool_calls_and_scope(client):
    _, tok_a = await signup(client, "a@x.com")
    _, tok_b = await signup(client, "b@x.com")
    client.cookies.clear()
    h = bearer(tok_a)
    aid = await mk_agent(client, h)
    c1 = (await client.post("/product/lab/cases", json={"agent_id": aid, "say": "What are your hours?", "expect": "State opening hours"}, headers=h)).json()[0]
    await client.post("/product/lab/cases", json={"agent_id": aid, "say": "Let me talk to a person", "expect": "Offer a human", "must_call": "transfer"}, headers=h)
    assert all(c["passed"] is None for c in (await client.get(f"/product/lab/cases?agent_id={aid}", headers=h)).json())

    res = (await client.post(f"/product/lab/cases/run?agent_id={aid}", headers=h)).json()
    by = {c["say"]: c for c in res}
    assert by["What are your hours?"]["passed"] is True
    assert by["Let me talk to a person"]["passed"] is False and "transfer" in by["Let me talk to a person"]["note"]  # the tool was never called
    calls_before = len(client.llm.calls)
    await client.post(f"/product/lab/cases/run?agent_id={aid}", headers=h)
    assert len(client.llm.calls) == calls_before  # cached for this version: nothing re-run

    client.text.tools["Let me talk to a person"] = ["transfer"]
    await client.patch(f"/product/agents/{aid}", json={"prompt": "A new prompt."}, headers=h)  # new version: results no longer apply
    assert all(c["passed"] is None for c in (await client.get(f"/product/lab/cases?agent_id={aid}", headers=h)).json())
    res = (await client.post(f"/product/lab/cases/run?agent_id={aid}", headers=h)).json()
    assert all(c["passed"] for c in res)
    client.llm.verdict = '{"pass": false, "note": "Wrong hours."}'
    forced = (await client.post(f"/product/lab/cases/run?agent_id={aid}&force=true", headers=h)).json()
    assert [c["passed"] for c in forced] == [False, False] or forced[0]["passed"] is False

    hb = bearer(tok_b)
    assert (await client.get(f"/product/lab/cases?agent_id={aid}", headers=hb)).status_code == 404
    assert (await client.delete(f"/product/lab/cases/{c1['id']}", headers=hb)).status_code == 404
    assert (await client.delete(f"/product/lab/cases/{c1['id']}", headers=h)).status_code == 204


# ---------- A/B ----------
async def test_ab_test_compares_two_prompts_and_will_not_crown_a_winner_on_thin_data(client, monkeypatch):
    monkeypatch.setattr("api.product.labs_router.AB_CONCURRENCY", 1)  # the test database has one shared connection
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    aid = await mk_agent(client, h, prompt="Prompt A: be brief.")
    r = await client.post("/product/lab/ab", json={"agent_id": aid, "name": "Brief vs warm", "prompt_b": "Prompt B: be warm.", "runs": 4}, headers=h)
    assert r.status_code == 201
    done = await wait_done(client, f"/product/lab/ab/{r.json()['id']}", h)
    assert (done["done_a"], done["done_b"], done["pass_a"], done["pass_b"]) == (4, 4, 4, 4)
    assert done["result"]["winner"] is None and done["result"]["reason"] == "not_enough_data"
    from api.product.definition import get_prompt

    prompts = sorted(get_prompt(g) for g in client.fake.published.values() if get_prompt(g).startswith("Prompt "))
    assert prompts == ["Prompt A: be brief.", "Prompt B: be warm."]  # two throwaway copies, one prompt each
    assert (await client.post("/product/lab/ab", json={"agent_id": aid, "name": "x", "prompt_b": "b", "runs": 1}, headers=h)).status_code == 422


async def test_lab_requires_write_permission_and_scope(client):
    me, tok_a = await signup(client, "a@x.com")
    _, tok_b = await signup(client, "b@x.com")
    client.cookies.clear()
    aid = await mk_agent(client, bearer(tok_a))
    assert (await client.post("/product/lab/sim", json={"agent_id": aid, "persona": "angry"}, headers=bearer(tok_b))).status_code == 404
    assert (await client.get("/product/lab/sim/sim_bogus", headers=bearer(tok_b))).status_code == 404
    assert (await client.get("/product/lab/ab/ab_bogus", headers=bearer(tok_b))).status_code == 404


# ---------- analytics ----------
async def seed_runs(client, ws, wf_id, org_id, rows):
    """rows: (days_ago, hour, disposition, seconds, events)"""
    async with client.session_factory() as s:
        if not await s.get(models.WorkflowModel, wf_id):
            s.add(models.WorkflowModel(id=wf_id, name="w", organization_id=org_id, workflow_definition={}))
        for days, hour, disp, secs, events in rows:
            when = (datetime.now(UTC) - timedelta(days=days)).replace(hour=hour, minute=0, second=0, microsecond=0)
            s.add(models.WorkflowRunModel(name="r", workflow_id=wf_id, mode="twilio", is_completed=True, created_at=when,
                                          cost_info={"call_duration_seconds": secs, "cost_breakdown": {"stt_cost": 1, "llm_cost": 2, "tts_cost": 1}},
                                          gathered_context={"call_disposition": disp}, logs={"realtime_feedback_events": events}))
        await s.commit()


async def ws_and_agent(client):
    async with client.session_factory() as s:
        ws = (await s.execute(select(product_models.ProductWorkspaceModel))).scalars().first()
        ag = (await s.execute(select(product_models.ProductAgentModel))).scalars().first()
    return ws, ag


async def test_analytics_numbers_compare_funnel_and_assumptions(client):
    _, tok = await signup(client, "a@x.com")
    h, live = bearer(tok), {**bearer(tok), "X-Environment": "live"}
    aid = await mk_agent(client, h)
    await client.post(f"/product/agents/{aid}/publish", headers=h)
    ws, ag = await ws_and_agent(client)
    ev = [{"type": "rtf-bot-text", "node_name": "Greeting", "payload": {"text": "hi"}}, {"type": "ttfb-metric", "node_name": "Greeting", "payload": {"ttfb_seconds": 0.5}},
          {"type": "rtf-bot-text", "node_name": "Book", "payload": {"text": "ok"}}]
    await seed_runs(client, ws, ag.live_workflow_id, ws.live_org_id, [
        (1, 10, "appointment_booked", 120, ev), (1, 11, "user_hangup", 60, ev[:2]), (2, 10, "qualified_lead", 60, []), (3, 12, "pipeline_error", 30, []),
        (9, 10, "appointment_booked", 60, []), (10, 10, "user_hangup", 60, [])])
    r = (await client.get("/product/analytics?days=7&compare=true", headers=live)).json()
    c = r["current"]
    assert (c["calls"], c["bookings"], c["qualified"], c["resolution_rate"]) == (4, 1, 1, 75) and c["minutes"] == 4.5
    assert c["hours_replaced"] == 0.1 and c["money_saved"] == 22.5 and r["human_cost_is_default"] is True  # 4.5 min x default 5
    assert c["total_cost"] == 27.0 and c["per_minute"] == 6.0 and c["per_call"] == 6.75
    assert r["previous"]["calls"] == 2 and r["previous"]["bookings"] == 1
    assert [(f["step"], f["count"]) for f in r["funnel"]] == [("Greeting", 2), ("Book", 1)] and r["avg_reply_seconds"] == 0.5
    assert r["interruption_rate"] is None and r["sentiment_trend"] is None  # not recorded by the platform: left empty

    await client.patch("/product/analytics/settings", json={"human_cost_per_min": 10}, headers=h)
    r2 = (await client.get("/product/analytics?days=7", headers=live)).json()
    assert r2["current"]["money_saved"] == 45.0 and r2["human_cost_is_default"] is False and r2["previous"] is None
    assert (await client.get(f"/product/analytics?days=7&agent={aid}", headers=live)).json()["current"]["calls"] == 4
    assert (await client.get("/product/analytics?days=7&agent=agt_nope", headers=live)).json()["current"]["calls"] == 0
    test = (await client.get("/product/analytics?days=7", headers=h)).json()  # Test mode: separate, and free
    assert test["current"]["calls"] == 0 and test["free_mode"] is True


async def test_analytics_assumption_needs_billing_permission_and_is_scoped(client):
    _, tok_a = await signup(client, "a@x.com")
    _, tok_b = await signup(client, "b@x.com")
    client.cookies.clear()
    ws, _ = (await ws_and_agent(client))[0], None
    await mk_agent(client, bearer(tok_a))
    ws, ag = await ws_and_agent(client)
    await seed_runs(client, ws, ag.test_workflow_id, ws.test_org_id, [(1, 9, "appointment_booked", 60, [])])
    assert (await client.get("/product/analytics?days=7", headers=bearer(tok_a))).json()["current"]["calls"] == 1
    assert (await client.get("/product/analytics?days=7", headers=bearer(tok_b))).json()["current"]["calls"] == 0
    async with client.session_factory() as s:
        b = (await s.execute(select(models.UserModel).where(models.UserModel.email == "b@x.com"))).scalar_one()
        s.add(product_models.ProductMembershipModel(workspace_id=ws.id, user_id=b.id, role="developer"))
        await s.commit()
    hb = bearer(tok_b, **{"X-Workspace": ws.public_id})
    assert (await client.patch("/product/analytics/settings", json={"human_cost_per_min": 1}, headers=hb)).status_code == 403


# ---------- insights ----------
async def test_insights_are_traceable_cached_and_fall_back_to_plain_wording(client):
    _, tok = await signup(client, "a@x.com")
    h, live = bearer(tok), {**bearer(tok), "X-Environment": "live"}
    aid = await mk_agent(client, h)
    await client.post(f"/product/agents/{aid}/publish", headers=h)
    ws, ag = await ws_and_agent(client)
    rows = [(1, 9, "appointment_booked", 90, [])] * 8 + [(1, 15, "no_answer", 20, [])] * 4 + [(2, 9, "user_hangup", 100, [])] * 2 + [(9, 9, "user_hangup", 60, [])] * 8 + [(9, 15, "pipeline_error", 20, [])] * 4
    await seed_runs(client, ws, ag.live_workflow_id, ws.live_org_id, rows)
    assert (await client.get("/product/analytics/insights", headers=h)).json() == []  # Test mode has none
    # a model that invents a number is ignored; the plain, traceable sentence is kept
    client.llm.rewrite = lambda s: s + " That's a 99% improvement!"
    first = (await client.get("/product/analytics/insights", headers=live)).json()
    assert 1 <= len(first) <= 3 and all("99" not in i["text"] for i in first)
    text = " ".join(i["text"] for i in first)
    assert "15:00" in text
    client.llm.rewrite = lambda s: "Nope, something else entirely."
    assert (await client.get("/product/analytics/insights", headers=live)).json() == first  # computed once per week
