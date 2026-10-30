"""Home: KPIs, calls over time, what needs attention, and the first-run checklist. All derived from real data."""

from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import load_only

from api.db.models import TelephonyPhoneNumberModel, WorkflowModel, WorkflowRunModel
from api.db.product_models import ProductAgentModel
from api.product import billing as bl
from api.product import config
from api.product import conversations as conv
from api.product.deps import Ctx, get_ctx

router = APIRouter(prefix="/product/home", tags=["home"])
SCAN_LIMIT = 5000

# One definition of "success", used everywhere: the caller got what they came for or was handed to a person.
SUCCESS = {"booked", "resolved", "qualified", "transferred"}


class Kpis(BaseModel):
    calls: int
    success_rate: int | None  # None when there are no finished calls
    minutes: float
    spend: float


class Attention(BaseModel):
    kind: str
    text: str
    link: str


class Step(BaseModel):
    id: str
    label: str
    done: bool


class HomeOut(BaseModel):
    range: str
    kpis: Kpis
    days: list[dict]
    attention: list[Attention]
    onboarding: list[Step]
    free_mode: bool
    truncated: bool = False


def _since(range_: str, now: datetime) -> datetime:
    if range_ == "today":
        return datetime.combine(now.date(), datetime.min.time(), tzinfo=UTC)
    return now - timedelta(days=7 if range_ == "7d" else 30)


@router.get("/summary", response_model=HomeOut)
async def summary(range: str = Query(default="7d", pattern="^(today|7d|30d)$"), ctx: Ctx = Depends(get_ctx)):
    now = datetime.now(UTC)
    since = _since(range, now)
    rows = (await ctx.session.scalars(
        select(WorkflowRunModel).join(WorkflowModel, WorkflowRunModel.workflow_id == WorkflowModel.id)
        .where(WorkflowModel.organization_id == ctx.org_id, WorkflowRunModel.created_at >= since)
        .options(load_only(WorkflowRunModel.id, WorkflowRunModel.created_at, WorkflowRunModel.is_completed, WorkflowRunModel.cost_info,
                           WorkflowRunModel.usage_info, WorkflowRunModel.gathered_context))
        .order_by(WorkflowRunModel.id.desc()).limit(SCAN_LIMIT + 1)
    )).all()
    truncated = len(rows) > SCAN_LIMIT
    by_day: dict[str, dict] = {}
    done = ok = failed = 0
    minutes = 0.0
    for r in rows[:SCAN_LIMIT]:
        g = r.gathered_context or {}
        dur = conv.duration_seconds(r.cost_info, r.usage_info)
        outcome = conv.product_outcome(disposition=g.get("mapped_call_disposition") or g.get("call_disposition"), completed=bool(r.is_completed), duration=dur)
        minutes += (dur or 0) / 60
        d = by_day.setdefault(r.created_at.strftime("%Y-%m-%d"), {"day": r.created_at.strftime("%Y-%m-%d"), "calls": 0, "minutes": 0.0})
        d["calls"] += 1
        d["minutes"] += (dur or 0) / 60
        if outcome is not None:
            done += 1
            ok += outcome in SUCCESS
            failed += outcome == "failed"
    n = min(len(rows), SCAN_LIMIT)
    spend = 0.0 if ctx.environment == "test" else round(minutes * config.PRICE_PER_MIN, 2)

    attention: list[Attention] = []
    if failed:
        attention.append(Attention(kind="failed_calls", text=f"{failed} call{'s' if failed != 1 else ''} didn't go well. See what happened.", link="/conversations?failed=1"))
    s = await bl.get_settings(ctx.session, ctx.workspace)
    state = bl.limit_state(s.spend_limit, await bl.month_value(ctx.session, ctx.workspace))
    if state != "ok":
        attention.append(Attention(kind="spend", text="You've reached your spending limit." if state == "limit" else "You've used over 80% of your spending limit.", link="/billing"))

    agents = (await ctx.session.scalars(select(ProductAgentModel).where(ProductAgentModel.workspace_id == ctx.workspace.id))).all()
    has_number = bool(await ctx.session.scalar(select(func.count()).select_from(TelephonyPhoneNumberModel).where(
        TelephonyPhoneNumberModel.organization_id == ctx.org_id, TelephonyPhoneNumberModel.inbound_workflow_id.is_not(None))))
    test_calls = await ctx.session.scalar(
        select(func.count()).select_from(WorkflowRunModel).join(WorkflowModel, WorkflowRunModel.workflow_id == WorkflowModel.id)
        .where(WorkflowModel.organization_id == ctx.workspace.test_org_id)) or 0
    onboarding = [
        Step(id="agent", label="Create an agent", done=bool(agents)),
        Step(id="voice", label="Give it a voice", done=any(a.voice_id for a in agents)),
        Step(id="test", label="Talk to it in your browser", done=test_calls > 0),
        Step(id="number", label="Connect a phone number", done=has_number),
    ]
    return HomeOut(
        range=range, kpis=Kpis(calls=n, success_rate=round(100 * ok / done) if done else None, minutes=round(minutes, 1), spend=spend),
        days=[{**d, "minutes": round(d["minutes"], 1)} for d in sorted(by_day.values(), key=lambda x: x["day"])],
        attention=attention, onboarding=onboarding, free_mode=ctx.environment == "test", truncated=truncated,
    )
