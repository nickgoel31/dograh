"""Testing Lab: simulated callers, saved test cases, and A/B tests of two prompts. Always on the agent's Test copy: free, never reaches real callers."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select

from api.db.product_models import (ProductAbTestModel, ProductAgentModel, ProductSimRunModel, ProductTestCaseModel, ProductTestResultModel)
from api.product import agents as agent_svc
from api.product import definition as defn
from api.product import labs
from api.product.deps import Ctx, get_ctx, require
from api.product.errors import product_error
from api.product.gateway import PlatformGateway, get_gateway
from api.product.ids import decode_id, encode_id
from api.product.llm_gateway import AgentTextGateway, LLMGateway, get_llm, get_text
from api.product.roles import Perm

router = APIRouter(prefix="/product/lab", tags=["lab"])
MAX_CASES, MAX_AB_RUNS, STALE = 30, 40, timedelta(minutes=30)
AB_CONCURRENCY = 3  # practice calls run at once in an A/B test
_tasks: set[asyncio.Task] = set()  # keeps background runs alive until they finish


def get_session_factory():
    from api.product.deps import session_factory

    return session_factory()


def _spawn(coro) -> None:
    async def later():
        await asyncio.sleep(0.05)  # let the request that started this finish and release its database session first
        await coro

    t = asyncio.create_task(later())
    _tasks.add(t)
    t.add_done_callback(_tasks.discard)


async def _agent(ctx: Ctx, agent_id: str) -> ProductAgentModel:
    return await agent_svc.get_agent(ctx.session, ctx.workspace, agent_id)


def _status(row, now: datetime) -> tuple[str, str | None]:
    """A run that has been 'running' for ages was interrupted (the app restarted): say so instead of spinning forever."""
    created = row.created_at.replace(tzinfo=UTC) if row.created_at and row.created_at.tzinfo is None else row.created_at
    if row.status == "running" and created and now - created > STALE:
        return "failed", "This run was interrupted. Start it again."
    return row.status, row.note


# ---------------- simulated callers ----------------
class PersonaOut(BaseModel):
    id: str
    name: str


class SimBody(BaseModel):
    agent_id: str
    persona: str
    goal: str = Field(default="", max_length=300)


class SimOut(BaseModel):
    id: str
    persona: str
    persona_name: str
    status: str
    score: int | None
    note: str | None
    passed: bool | None
    turns: list[dict]


def _sim_out(r: ProductSimRunModel, now: datetime) -> SimOut:
    st, note = _status(r, now)
    return SimOut(id=encode_id("sim", r.id), persona=r.persona, persona_name=labs.PERSONAS.get(r.persona, (r.persona,))[0], status=st, score=r.score,
                  note=note, passed=None if r.score is None else r.score >= labs.PASS_SCORE, turns=r.transcript or [])


async def _run_sim(factory, run_id: int, org_id: int, user_id: int, workflow_id: int, persona: str, goal: str, text, llm) -> None:
    try:
        turns, j = await labs.simulate(text, llm, org_id=org_id, user_id=user_id, workflow_id=workflow_id, persona=persona, goal=goal)
        status, score, note = ("done", j.score, j.note) if j else ("failed", None, "We couldn't score this conversation. Run it again.")
    except Exception as e:  # noqa: BLE001 - shown as a plain message
        turns, status, score = [], "failed", None
        note = e.detail["message"] if hasattr(e, "detail") and isinstance(e.detail, dict) else "The practice call didn't finish. Please try again."
    async with factory() as s:
        r = await s.get(ProductSimRunModel, run_id)
        r.transcript, r.status, r.score, r.note = turns, status, score, note
        await s.commit()


@router.get("/personas", response_model=list[PersonaOut])
async def personas(ctx: Ctx = Depends(get_ctx)):
    return [PersonaOut(id=k, name=v[0]) for k, v in labs.PERSONAS.items()]


@router.post("/sim", response_model=SimOut, status_code=201)
async def start_sim(body: SimBody, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE)), text: AgentTextGateway = Depends(get_text),
                    llm: LLMGateway = Depends(get_llm), factory=Depends(get_session_factory)):
    if body.persona not in labs.PERSONAS:
        raise product_error(400, "bad_persona", "Pick one of the caller types.")
    a = await _agent(ctx, body.agent_id)
    r = ProductSimRunModel(workspace_id=ctx.workspace.id, agent_id=a.id, persona=body.persona, status="running", transcript=[])
    ctx.session.add(r)
    await ctx.session.commit()
    _spawn(_run_sim(factory, r.id, ctx.workspace.test_org_id, ctx.user.id, a.test_workflow_id, body.persona, body.goal.strip(), text, llm))
    return _sim_out(r, datetime.now(UTC))


@router.get("/sim", response_model=list[SimOut])
async def list_sims(agent_id: str, ctx: Ctx = Depends(get_ctx)):
    a = await _agent(ctx, agent_id)
    rows = (await ctx.session.scalars(select(ProductSimRunModel).where(ProductSimRunModel.agent_id == a.id, ProductSimRunModel.ab_test_id.is_(None))
                                      .order_by(ProductSimRunModel.id.desc()).limit(20))).all()
    now = datetime.now(UTC)
    return [_sim_out(r, now) for r in rows]


@router.get("/sim/{sim_id}", response_model=SimOut)
async def get_sim(sim_id: str, ctx: Ctx = Depends(get_ctx)):
    n = decode_id("sim", sim_id)
    r = await ctx.session.scalar(select(ProductSimRunModel).where(ProductSimRunModel.id == n, ProductSimRunModel.workspace_id == ctx.workspace.id)) if n else None
    if r is None:
        raise product_error(404, "run_not_found", "We couldn't find that practice call.")
    return _sim_out(r, datetime.now(UTC))


# ---------------- test cases ----------------
class CaseBody(BaseModel):
    agent_id: str
    say: str = Field(min_length=1, max_length=500)
    expect: str = Field(min_length=1, max_length=500)
    must_call: str | None = Field(default=None, max_length=80)


class CaseOut(BaseModel):
    id: str
    say: str
    expect: str
    must_call: str | None
    passed: bool | None = None  # None = not run yet against this version of the agent
    note: str | None = None
    reply: str | None = None


async def _cases(ctx: Ctx, a: ProductAgentModel) -> list[CaseOut]:
    cases = (await ctx.session.scalars(select(ProductTestCaseModel).where(ProductTestCaseModel.agent_id == a.id).order_by(ProductTestCaseModel.id))).all()
    res = {r.case_id: r for r in (await ctx.session.scalars(select(ProductTestResultModel).where(
        ProductTestResultModel.case_id.in_([c.id for c in cases] or [0]), ProductTestResultModel.agent_version == a.version))).all()}
    return [CaseOut(id=encode_id("tc", c.id), say=c.say, expect=c.expect, must_call=c.must_call, passed=res[c.id].passed if c.id in res else None,
                    note=res[c.id].note if c.id in res else None, reply=res[c.id].reply if c.id in res else None) for c in cases]


@router.get("/cases", response_model=list[CaseOut])
async def list_cases(agent_id: str, ctx: Ctx = Depends(get_ctx)):
    return await _cases(ctx, await _agent(ctx, agent_id))


@router.post("/cases", response_model=list[CaseOut], status_code=201)
async def add_case(body: CaseBody, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE))):
    a = await _agent(ctx, body.agent_id)
    if len(await _cases(ctx, a)) >= MAX_CASES:
        raise product_error(400, "too_many_cases", f"You can keep up to {MAX_CASES} test cases per agent.")
    ctx.session.add(ProductTestCaseModel(workspace_id=ctx.workspace.id, agent_id=a.id, say=body.say.strip(), expect=body.expect.strip(), must_call=(body.must_call or "").strip() or None))
    await ctx.session.commit()
    return await _cases(ctx, a)


@router.delete("/cases/{case_id}", status_code=204)
async def delete_case(case_id: str, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE))):
    n = decode_id("tc", case_id)
    c = await ctx.session.scalar(select(ProductTestCaseModel).where(ProductTestCaseModel.id == n, ProductTestCaseModel.workspace_id == ctx.workspace.id)) if n else None
    if c is None:
        raise product_error(404, "case_not_found", "We couldn't find that test case.")
    await ctx.session.delete(c)
    await ctx.session.commit()


@router.post("/cases/run", response_model=list[CaseOut])
async def run_cases(agent_id: str, force: bool = False, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE)), text: AgentTextGateway = Depends(get_text), llm: LLMGateway = Depends(get_llm)):
    """Run every case that hasn't been run against this version of the agent (or all, with force). Results are kept per version."""
    a = await _agent(ctx, agent_id)
    cases = (await ctx.session.scalars(select(ProductTestCaseModel).where(ProductTestCaseModel.agent_id == a.id))).all()
    have = {r.case_id: r for r in (await ctx.session.scalars(select(ProductTestResultModel).where(
        ProductTestResultModel.case_id.in_([c.id for c in cases] or [0]), ProductTestResultModel.agent_version == a.version))).all()}
    todo = [c for c in cases if force or c.id not in have]
    sem = asyncio.Semaphore(3)

    async def one(c):
        async with sem:
            try:
                return c, await labs.check_case(text, llm, org_id=ctx.workspace.test_org_id, user_id=ctx.user.id, workflow_id=a.test_workflow_id, say=c.say, expect=c.expect, must_call=c.must_call)
            except Exception as e:  # noqa: BLE001
                msg = e.detail["message"] if hasattr(e, "detail") and isinstance(e.detail, dict) else "This one couldn't run. Try again."
                return c, (False, msg, "")

    for c, (ok, note, reply) in await asyncio.gather(*(one(c) for c in todo)):
        prev = have.get(c.id)
        if prev:
            prev.passed, prev.note, prev.reply = ok, note[:300], reply[:1000]
        else:
            ctx.session.add(ProductTestResultModel(case_id=c.id, agent_version=a.version, passed=ok, note=note[:300], reply=reply[:1000]))
    await ctx.session.commit()
    return await _cases(ctx, a)


# ---------------- A/B tests ----------------
class AbBody(BaseModel):
    agent_id: str
    name: str = Field(min_length=1, max_length=120)
    prompt_b: str = Field(min_length=1, max_length=20000)
    runs: int = Field(default=20, ge=2, le=MAX_AB_RUNS)


class AbOut(BaseModel):
    id: str
    name: str
    status: str
    runs_per_variant: int
    done_a: int
    done_b: int
    pass_a: int
    pass_b: int
    result: dict | None


async def _ab_out(session, t: ProductAbTestModel) -> AbOut:
    rows = (await session.scalars(select(ProductSimRunModel).where(ProductSimRunModel.ab_test_id == t.id))).all()
    fin = lambda v: [r for r in rows if r.variant == v and r.status in ("done", "failed")]  # noqa: E731
    ok = lambda v: sum(1 for r in fin(v) if r.score is not None and r.score >= labs.PASS_SCORE)  # noqa: E731
    return AbOut(id=encode_id("ab", t.id), name=t.name, status=t.status, runs_per_variant=t.runs_per_variant, done_a=len(fin("A")), done_b=len(fin("B")),
                 pass_a=ok("A"), pass_b=ok("B"), result=t.result)


async def _run_ab(factory, ab_id: int, org_id: int, user_id: int, text, llm) -> None:
    async with factory() as s:
        t = await s.get(ProductAbTestModel, ab_id)
        plan = [(v, w, i) for i in range(t.runs_per_variant) for v, w in (("A", t.workflow_a), ("B", t.workflow_b))]
        agent_id, ws_id = t.agent_id, t.workspace_id
        made = {(v, i): ProductSimRunModel(workspace_id=ws_id, agent_id=agent_id, ab_test_id=ab_id, variant=v, persona=list(labs.PERSONAS)[i % len(labs.PERSONAS)], status="running", transcript=[])
                for v, w, i in plan}
        s.add_all(made.values())
        await s.commit()
        ids = {k: r.id for k, r in made.items()}
    sem = asyncio.Semaphore(AB_CONCURRENCY)

    async def one(v, w, i):
        async with sem:
            await _run_sim(factory, ids[(v, i)], org_id, user_id, w, list(labs.PERSONAS)[i % len(labs.PERSONAS)], "", text, llm)

    await asyncio.gather(*(one(v, w, i) for v, w, i in plan))
    async with factory() as s:
        t = await s.get(ProductAbTestModel, ab_id)
        out = await _ab_out(s, t)
        t.result = labs.significance(out.pass_a, out.done_a, out.pass_b, out.done_b)
        t.status = "done"
        await s.commit()


@router.post("/ab", response_model=AbOut, status_code=201)
async def start_ab(body: AbBody, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE)), pg: PlatformGateway = Depends(get_gateway),
                   text: AgentTextGateway = Depends(get_text), llm: LLMGateway = Depends(get_llm), factory=Depends(get_session_factory)):
    a = await _agent(ctx, body.agent_id)
    graph = await agent_svc.get_flow(pg, ctx.workspace, a)
    prompt_a = defn.get_prompt(graph)
    if not prompt_a.strip():
        raise product_error(400, "no_prompt", "Add instructions to this agent before testing two versions of them.")
    # Two throwaway copies of the Test agent, identical except for the instructions being compared.
    wa = await pg.create_agent(ctx.workspace.test_org_id, ctx.user.id, f"{a.name} [A]", defn.with_prompt(graph, prompt=prompt_a))
    wb = await pg.create_agent(ctx.workspace.test_org_id, ctx.user.id, f"{a.name} [B]", defn.with_prompt(graph, prompt=body.prompt_b))
    t = ProductAbTestModel(workspace_id=ctx.workspace.id, agent_id=a.id, name=body.name.strip(), prompt_a=prompt_a, prompt_b=body.prompt_b, workflow_a=wa, workflow_b=wb,
                           runs_per_variant=body.runs, status="running")
    ctx.session.add(t)
    await ctx.session.commit()
    _spawn(_run_ab(factory, t.id, ctx.workspace.test_org_id, ctx.user.id, text, llm))
    return await _ab_out(ctx.session, t)


@router.get("/ab", response_model=list[AbOut])
async def list_ab(agent_id: str, ctx: Ctx = Depends(get_ctx)):
    a = await _agent(ctx, agent_id)
    rows = (await ctx.session.scalars(select(ProductAbTestModel).where(ProductAbTestModel.agent_id == a.id).order_by(ProductAbTestModel.id.desc()).limit(10))).all()
    return [await _ab_out(ctx.session, t) for t in rows]


@router.get("/ab/{ab_id}", response_model=AbOut)
async def get_ab(ab_id: str, ctx: Ctx = Depends(get_ctx)):
    n = decode_id("ab", ab_id)
    t = await ctx.session.scalar(select(ProductAbTestModel).where(ProductAbTestModel.id == n, ProductAbTestModel.workspace_id == ctx.workspace.id)) if n else None
    if t is None:
        raise product_error(404, "test_not_found", "We couldn't find that test.")
    return await _ab_out(ctx.session, t)
