"""Calls the customer's agents have taken. Always scoped to the workspace *and* the Test/Live organization."""

from datetime import date, datetime, time, timedelta
from typing import Awaitable, Callable

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import load_only

from api.db.models import WorkflowModel, WorkflowRunModel
from api.db.product_models import ProductAgentModel
from api.product import config
from api.product import conversations as conv
from api.product import pricing
from api.product.deps import Ctx, get_ctx
from api.product.errors import product_error
from api.product.ids import decode_call_id, encode_call_id
from api.product.llm_gateway import LLMGateway, get_llm

router = APIRouter(prefix="/product/conversations", tags=["conversations"])

SCAN_LIMIT = 2000  # filters computed in Python only look at the newest calls

AudioSigner = Callable[[WorkflowRunModel], Awaitable[str | None]]


async def get_audio_signer() -> AudioSigner:
    async def sign(run: WorkflowRunModel) -> str | None:
        if not run.recording_url:
            return None
        from api.services.storage import get_storage_for_backend

        url = await get_storage_for_backend(run.storage_backend).aget_signed_url(
            file_path=run.recording_url, expiration=3600, force_inline=True
        )
        return url or None

    return sign


class TurnOut(BaseModel):
    who: str
    t: float
    end: float
    text: str
    reply: float | None = None
    tool: str | None = None


class CallOut(BaseModel):
    id: str
    time: str
    caller: str
    phone: str | None
    agent_id: str | None
    agent_name: str | None
    duration: int
    outcome: str | None  # None = still in progress
    # Not produced yet: needs the post-call analysis job.
    sentiment: int | None = None
    cost: float
    fail_reason: str | None = None
    test: bool


class CallDetail(CallOut):
    turns: list[TurnOut]
    summary: str | None = None
    extracted: dict[str, str]
    cost_split: list[dict]
    audio_url: str | None = None


class CallPage(BaseModel):
    calls: list[CallOut]
    total: int
    page: int
    limit: int
    truncated: bool = False


def _rate(ctx: Ctx) -> float:
    return getattr(ctx, "rate", None) or config.PRICE_PER_MIN


def _price(ctx: Ctx, duration: float | None) -> float:
    """Practice calls cost the same as real ones."""
    if not duration:
        return 0.0
    return round(duration / 60 * _rate(ctx), 2)


def _out(ctx: Ctx, run: WorkflowRunModel, agents: dict[int, ProductAgentModel]) -> CallOut:
    gathered = run.gathered_context or {}
    duration = conv.duration_seconds(run.cost_info, run.usage_info)
    outcome = conv.product_outcome(
        disposition=gathered.get("mapped_call_disposition") or gathered.get("call_disposition"),
        completed=bool(run.is_completed), duration=duration,
    )
    name, phone = conv.caller_of(run.initial_context, gathered)
    agent = agents.get(run.workflow_id)
    return CallOut(
        id=encode_call_id(run.id), time=run.created_at.isoformat() if run.created_at else "",
        caller=name, phone=phone, agent_id=agent.public_id if agent else None,
        agent_name=agent.name if agent else None, duration=int(round(duration or 0)),
        outcome=outcome, cost=_price(ctx, duration), fail_reason=conv.failure_reason(outcome),
        test=ctx.environment == "test",
    )


async def _load_rate(ctx: Ctx) -> None:
    from api.product import rates

    ctx.rate = await rates.workspace_rate(ctx.session, ctx.workspace)


async def _agents(ctx: Ctx) -> dict[int, ProductAgentModel]:
    rows = (await ctx.session.scalars(select(ProductAgentModel).where(ProductAgentModel.workspace_id == ctx.workspace.id))).all()
    out: dict[int, ProductAgentModel] = {}
    for a in rows:
        wid = a.test_workflow_id if ctx.environment == "test" else a.live_workflow_id
        if wid is not None:
            out[wid] = a
    return out


async def present(ctx: Ctx, calls: list["CallOut"]) -> list["CallOut"]:
    """Apply the workspace's privacy settings to calls on their way out."""
    from api.product import privacy

    from api.product import insights

    mood = await insights.sentiments(ctx.session, [i for i in (decode_call_id(c.id) for c in calls) if i])
    for c in calls:
        c.sentiment = mood.get(decode_call_id(c.id))
    if (await privacy.get_settings(ctx.session, ctx.workspace.id)).redact_pii:
        for c in calls:
            c.phone, c.caller = privacy.mask_phone(c.phone), privacy.redact_text(c.caller)
    return calls


def _scope(ctx: Ctx):
    """Runs of workflows in this workspace's organization for the active environment."""
    return (
        select(WorkflowRunModel)
        .join(WorkflowModel, WorkflowRunModel.workflow_id == WorkflowModel.id)
        .where(WorkflowModel.organization_id == ctx.org_id)
    )


@router.get("", response_model=CallPage)
async def list_calls(
    agent: str | None = Query(default=None, max_length=40),
    outcome: str | None = Query(default=None, max_length=20),
    failed: bool = False,
    q: str | None = Query(default=None, max_length=80),
    text: str | None = Query(default=None, max_length=80),
    date_from: date | None = None,
    date_to: date | None = None,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=25, ge=1, le=100),
    ctx: Ctx = Depends(get_ctx),
):
    agents = await _agents(ctx)
    await _load_rate(ctx)
    stmt = _scope(ctx).options(load_only(
        WorkflowRunModel.id, WorkflowRunModel.workflow_id, WorkflowRunModel.created_at, WorkflowRunModel.is_completed,
        WorkflowRunModel.cost_info, WorkflowRunModel.usage_info, WorkflowRunModel.initial_context,
        WorkflowRunModel.gathered_context, WorkflowRunModel.recording_url, *([WorkflowRunModel.logs] if text else []),
    ))
    if agent:
        wid = next((w for w, a in agents.items() if a.public_id == agent), None)
        if wid is None:
            return CallPage(calls=[], total=0, page=page, limit=limit)
        stmt = stmt.where(WorkflowRunModel.workflow_id == wid)
    if date_from:
        stmt = stmt.where(WorkflowRunModel.created_at >= datetime.combine(date_from, time.min))
    if date_to:
        stmt = stmt.where(WorkflowRunModel.created_at < datetime.combine(date_to + timedelta(days=1), time.min))
    wanted = "failed" if failed else outcome
    if wanted and wanted not in conv.OUTCOMES:
        raise product_error(400, "bad_outcome", "That outcome isn't one we know.")
    stmt = stmt.order_by(WorkflowRunModel.created_at.desc(), WorkflowRunModel.id.desc())

    if not (wanted or q or text):  # everything can be done in SQL
        total = await ctx.session.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
        rows = (await ctx.session.scalars(stmt.offset((page - 1) * limit).limit(limit))).all()
        return CallPage(calls=await present(ctx, [_out(ctx, r, agents) for r in rows]), total=total, page=page, limit=limit)

    rows = (await ctx.session.scalars(stmt.limit(SCAN_LIMIT + 1))).all()
    truncated = len(rows) > SCAN_LIMIT
    if text:  # what was said
        needle = text.strip().lower()
        rows = [r for r in rows if any(needle in (t.get("text") or "").lower() for t in conv.build_transcript((r.logs or {}).get("realtime_feedback_events")))]
    calls = [_out(ctx, r, agents) for r in rows[:SCAN_LIMIT]]
    if wanted:
        calls = [c for c in calls if c.outcome == wanted]
    if q:
        needle = q.lower()
        calls = [c for c in calls if needle in f"{c.caller} {c.phone or ''} {c.agent_name or ''} {c.id}".lower()]
    start = (page - 1) * limit
    return CallPage(calls=await present(ctx, calls[start:start + limit]), total=len(calls), page=page, limit=limit, truncated=truncated)


@router.get("/{call_id}", response_model=CallDetail)
async def get_call(call_id: str, ctx: Ctx = Depends(get_ctx), sign: AudioSigner = Depends(get_audio_signer), llm: LLMGateway = Depends(get_llm)):
    run_id = decode_call_id(call_id)
    run = await ctx.session.scalar(_scope(ctx).where(WorkflowRunModel.id == run_id)) if run_id else None
    if run is None:
        raise product_error(404, "call_not_found", "We couldn't find that call.")
    agents = await _agents(ctx)
    await _load_rate(ctx)
    base = _out(ctx, run, agents)
    events = (run.logs or {}).get("realtime_feedback_events")
    from api.product import privacy

    settings = await privacy.get_settings(ctx.session, ctx.workspace.id)
    turns = [TurnOut(**t) for t in conv.build_transcript(events)]
    extracted = conv.extracted_answers(run.gathered_context)
    summary = None
    if base.outcome is not None:  # a finished call: one-line summary and mood, written once by the AI
        from api.product import insights

        ins = await insights.ensure(ctx.session, llm, workspace_id=ctx.workspace.id, org_id=ctx.org_id, user_id=ctx.user.id if ctx.user else ctx.workspace.owner_user_id,
                                    run_id=run.id, turns=[t.model_dump() for t in turns])
        if ins is not None:
            summary, base.sentiment = ins.summary, ins.sentiment
        else:
            summary = insights.fallback([t.model_dump() for t in turns])
    if settings.redact_pii:
        for t in turns:
            t.text = privacy.redact_text(t.text) or ""
        extracted = {k: privacy.redact_text(v) or "" for k, v in extracted.items()}
        await present(ctx, [base])
    return CallDetail(
        **base.model_dump(),
        turns=turns, summary=privacy.redact_text(summary) if settings.redact_pii else summary,
        extracted=extracted,
        cost_split=pricing.split((conv.duration_seconds(run.cost_info, run.usage_info) or 0) / 60, _rate(ctx)),
        audio_url=await sign(run) if settings.record_calls else None,
    )


@router.get("/export/csv")
async def export_csv(ctx: Ctx = Depends(get_ctx)):
    from fastapi.responses import StreamingResponse
    import csv
    import io

    agents = await _agents(ctx)
    stmt = _scope(ctx).options(load_only(
        WorkflowRunModel.id, WorkflowRunModel.workflow_id, WorkflowRunModel.created_at, WorkflowRunModel.is_completed,
        WorkflowRunModel.cost_info, WorkflowRunModel.usage_info, WorkflowRunModel.initial_context,
        WorkflowRunModel.gathered_context,
    )).order_by(WorkflowRunModel.created_at.desc(), WorkflowRunModel.id.desc())

    async def rows():
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["Call", "Time", "Caller", "Phone", "Agent", "Seconds", "Outcome", "Cost"])
        yield buf.getvalue(); buf.seek(0); buf.truncate()
        result = await ctx.session.stream_scalars(stmt.execution_options(yield_per=200))
        async for r in result:
            c = _out(ctx, r, agents)
            # A leading = + - @ would be run as a formula by spreadsheet apps.
            safe = lambda v: ("'" + v) if isinstance(v, str) and v[:1] in "=+-@" else v
            w.writerow([c.id, c.time, safe(c.caller), safe(c.phone or ""), safe(c.agent_name or ""), c.duration, c.outcome or "in progress", c.cost])
            yield buf.getvalue(); buf.seek(0); buf.truncate()

    return StreamingResponse(rows(), media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="calls.csv"'})
