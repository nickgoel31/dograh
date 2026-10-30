"""Analytics: business, quality and cost views computed from the calls themselves, plus plain-English weekly insights."""

from __future__ import annotations

import os
import re
from collections import Counter, defaultdict
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import load_only

from api.db.models import WorkflowModel, WorkflowRunModel
from api.db.product_models import ProductAgentModel, ProductInsightModel
from api.product import billing as bl
from api.product import config
from api.product import conversations as conv
from api.product.deps import Ctx, get_ctx, require
from api.product.llm_gateway import LLMGateway, get_llm
from api.product.roles import Perm

router = APIRouter(prefix="/product/analytics", tags=["analytics"])
SCAN_LIMIT, LOG_SAMPLE = 20000, 300
SUCCESS = {"booked", "resolved", "qualified", "transferred"}


def default_human_cost() -> float:
    try:
        return float(os.getenv("HUMAN_COST_PER_MIN_DEFAULT", "") or 5.0)
    except ValueError:
        return 5.0


def classify(run) -> tuple[str | None, float]:
    g = run.gathered_context or {}
    dur = conv.duration_seconds(run.cost_info, run.usage_info) or 0.0
    return conv.product_outcome(disposition=g.get("mapped_call_disposition") or g.get("call_disposition"), completed=bool(run.is_completed), duration=dur), dur


def summarize(rows: list, price: float, human_cost: float) -> dict:
    """Numbers for one period. `rows` are runs; price 0 means Test (free)."""
    out = Counter()
    minutes = 0.0
    by_day: dict[str, dict] = defaultdict(lambda: {"calls": 0, "bookings": 0, "stt": 0.0, "brain": 0.0, "voice": 0.0, "phone": 0.0})
    for r in rows:
        o, dur = classify(r)
        m = dur / 60
        minutes += m
        out["calls"] += 1
        d = by_day[r.created_at.strftime("%Y-%m-%d")]
        d["calls"] += 1
        if o is not None:
            out["finished"] += 1
            out["success"] += o in SUCCESS
            out["bookings"] += o == "booked"
            out["qualified"] += o == "qualified"
            d["bookings"] += o == "booked"
        value = m * price
        for (name, share) in zip(("stt", "brain", "voice"), _shares(r.cost_info)):
            d[name] += value * share
    return {
        "calls": out["calls"], "minutes": round(minutes, 1), "bookings": out["bookings"], "qualified": out["qualified"],
        "resolution_rate": round(100 * out["success"] / out["finished"]) if out["finished"] else None,
        "money_saved": round(minutes * human_cost, 2), "hours_replaced": round(minutes / 60, 1),
        "total_cost": round(minutes * price, 2), "per_call": round(minutes * price / out["calls"], 2) if out["calls"] else 0.0,
        "per_minute": round(price, 2) if minutes else 0.0,
        "days": [{"day": k, **{kk: (round(vv, 2) if isinstance(vv, float) else vv) for kk, vv in v.items()}} for k, v in sorted(by_day.items())],
    }


def _shares(cost_info: dict | None) -> tuple[float, float, float]:
    b = (cost_info or {}).get("cost_breakdown") or {}
    w = [float(b.get(k) or 0) for k in ("stt_cost", "llm_cost", "tts_cost")]
    t = sum(w)
    return (w[0] / t, w[1] / t, w[2] / t) if t > 0 else (0.0, 0.0, 0.0)


def funnel_and_reply(events_per_run: list[list[dict]]) -> tuple[list[dict], float | None]:
    """How many calls reached each step (in the order steps first appear), and the average measured reply delay."""
    order: list[str] = []
    reached: Counter = Counter()
    ttfb: list[float] = []
    for events in events_per_run:
        seen = set()
        for e in events or []:
            name = e.get("node_name")
            if name and name not in seen:
                seen.add(name)
                if name not in order:
                    order.append(name)
            if e.get("type") == "ttfb-metric":
                try:
                    ttfb.append(float((e.get("payload") or {}).get("ttfb_seconds")))
                except (TypeError, ValueError):
                    pass
        reached.update(seen)
    return [{"step": n, "count": reached[n]} for n in order], (round(sum(ttfb) / len(ttfb), 2) if ttfb else None)


async def _runs(ctx: Ctx, start: datetime, end: datetime, agent_wf: int | None, with_logs: bool = False):
    q = (select(WorkflowRunModel).join(WorkflowModel, WorkflowRunModel.workflow_id == WorkflowModel.id)
         .where(WorkflowModel.organization_id == ctx.org_id, WorkflowRunModel.created_at >= start, WorkflowRunModel.created_at < end))
    if agent_wf is not None:
        q = q.where(WorkflowRunModel.workflow_id == agent_wf)
    cols = [WorkflowRunModel.id, WorkflowRunModel.created_at, WorkflowRunModel.is_completed, WorkflowRunModel.cost_info, WorkflowRunModel.usage_info,
            WorkflowRunModel.gathered_context, WorkflowRunModel.workflow_id]
    return (await ctx.session.scalars(q.options(load_only(*cols)).order_by(WorkflowRunModel.id.desc()).limit(SCAN_LIMIT))).all()


class AnalyticsOut(BaseModel):
    days: int
    currency: str
    free_mode: bool
    current: dict
    previous: dict | None = None
    funnel: list[dict]
    avg_reply_seconds: float | None
    # Not recorded by the platform yet: shown as empty, never invented.
    interruption_rate: float | None = None
    sentiment_trend: list | None = None
    human_cost_per_min: float
    human_cost_is_default: bool


@router.get("", response_model=AnalyticsOut)
async def analytics(days: int = Query(default=30, ge=1, le=365), agent: str | None = Query(default=None, max_length=40), compare: bool = False, ctx: Ctx = Depends(get_ctx)):
    now = datetime.now(UTC)
    start = now - timedelta(days=days)
    wf = None
    if agent:
        a = await ctx.session.scalar(select(ProductAgentModel).where(ProductAgentModel.public_id == agent, ProductAgentModel.workspace_id == ctx.workspace.id))
        wf = (a.test_workflow_id if ctx.environment == "test" else a.live_workflow_id) if a else -1
    s = await bl.get_settings(ctx.session, ctx.workspace)
    human = s.human_cost_per_min if s.human_cost_per_min is not None else default_human_cost()
    price = 0.0 if ctx.environment == "test" else config.PRICE_PER_MIN
    rows = await _runs(ctx, start, now, wf)
    current = summarize(rows, price, human)
    prev = summarize(await _runs(ctx, start - timedelta(days=days), start, wf), price, human) if compare else None
    sample = [r.id for r in rows if r.is_completed][:LOG_SAMPLE]
    logs = (await ctx.session.execute(select(WorkflowRunModel.logs).where(WorkflowRunModel.id.in_(sample)))).scalars().all() if sample else []
    funnel, reply = funnel_and_reply([(lg or {}).get("realtime_feedback_events") or [] for lg in logs])
    await ctx.session.commit()
    return AnalyticsOut(days=days, currency=config.CURRENCY, free_mode=ctx.environment == "test", current=current, previous=prev, funnel=funnel, avg_reply_seconds=reply,
                        human_cost_per_min=human, human_cost_is_default=s.human_cost_per_min is None)


class SettingsBody(BaseModel):
    human_cost_per_min: float = Field(ge=0, le=100000)


@router.patch("/settings")
async def set_assumptions(body: SettingsBody, ctx: Ctx = Depends(require(Perm.BILLING_MANAGE))):
    (await bl.get_settings(ctx.session, ctx.workspace)).human_cost_per_min = body.human_cost_per_min
    await ctx.session.commit()
    return {"human_cost_per_min": body.human_cost_per_min}


# ---------------- insights ----------------
def week_key(now: datetime) -> str:
    y, w, _ = now.isocalendar()
    return f"{y}-W{w:02d}"


def build_facts(this: list, last: list, agent_names: dict[int, str]) -> list[dict]:
    """Candidate insights with the exact numbers they rest on. Every sentence shown to a customer comes from one of these."""
    facts: list[dict] = []
    ok = lambda rows: [(classify(r), r) for r in rows]  # noqa: E731
    cur, prv = ok(this), ok(last)
    rate = lambda xs: (round(100 * sum(1 for (o, _), _r in xs if o in SUCCESS) / sum(1 for (o, _), _r in xs if o is not None)) if any(o is not None for (o, _), _r in xs) else None)  # noqa: E731
    fin = lambda xs: sum(1 for (o, _), _r in xs if o is not None)  # noqa: E731
    rc, rp = rate(cur), rate(prv)
    if rc is not None and rp is not None and fin(cur) >= 10 and fin(prv) >= 10 and rc != rp:
        up = rc > rp
        facts.append({"id": "success_change", "weight": abs(rc - rp), "numbers": [rc, rp, abs(rc - rp)],
                      "text": f"Your success rate {'rose' if up else 'fell'} from {rp}% to {rc}% compared with the week before."})
    hours = Counter(r.created_at.hour for r in this)
    if len(this) >= 10:
        h, n = hours.most_common(1)[0]
        facts.append({"id": "busiest_hour", "weight": 20, "numbers": [h, n], "text": f"Your busiest hour is {h:02d}:00 (UTC), with {n} calls this week."})
    missed = Counter(r.created_at.hour for (o, _), r in cur if o in ("no-answer", "failed"))
    if missed:
        h, n = missed.most_common(1)[0]
        if n >= 3:
            facts.append({"id": "missed_hour", "weight": 40 + n, "numbers": [h, n], "text": f"{n} calls around {h:02d}:00 (UTC) went unanswered or failed. That is your weakest hour."})
    if cur:
        by = Counter(r.workflow_id for _, r in cur)
        wid, n = by.most_common(1)[0]
        if len(by) > 1 and wid in agent_names:
            facts.append({"id": "top_agent", "weight": 10, "numbers": [n], "text": f"{agent_names[wid]} took the most calls this week: {n}."})
    avg = lambda xs: (sum(d for (_, d), _r in xs) / len(xs) / 60) if xs else None  # noqa: E731
    ac, ap = avg(cur), avg(prv)
    if ac and ap and len(cur) >= 10 and len(prv) >= 10 and abs(ac - ap) / ap >= 0.15:
        facts.append({"id": "length_change", "weight": 30, "numbers": [round(ap, 1), round(ac, 1)],
                      "text": f"Calls are {'longer' if ac > ap else 'shorter'} than last week: {round(ac, 1)} minutes on average, up from {round(ap, 1)}." if ac > ap else
                              f"Calls are shorter than last week: {round(ac, 1)} minutes on average, down from {round(ap, 1)}."})
    return sorted(facts, key=lambda f: -f["weight"])[:3]


_NUM = re.compile(r"\d+(?:\.\d+)?")


def numbers_traceable(text: str, fact: dict) -> bool:
    """Every number in a sentence must come from the fact it rests on (any formatting, e.g. 9 or 09)."""
    allowed = {float(n) for n in fact["numbers"]}
    text = re.sub(r'\b(\d{1,2}):00\b', r'\1', text)  # a clock time like 09:00 is just the hour
    return all(float(m) in allowed for m in _NUM.findall(text))


async def phrase(llm: LLMGateway, ctx: Ctx, fact: dict) -> str:
    """Friendlier wording from the model, used only if it keeps every number intact. Otherwise the plain sentence stands."""
    try:
        t = (await llm.complete(ctx.workspace.test_org_id, ctx.user.id, "Rewrite the sentence in warm, plain English for a small business owner. Keep every number exactly. One sentence, no new facts.",
                                [{"role": "user", "content": fact["text"]}])).strip()
    except Exception:  # noqa: BLE001
        return fact["text"]
    return t if t and len(t) < 300 and numbers_traceable(t, fact) else fact["text"]


class InsightOut(BaseModel):
    id: str
    text: str


@router.get("/insights", response_model=list[InsightOut])
async def insights(ctx: Ctx = Depends(get_ctx), llm: LLMGateway = Depends(get_llm)):
    if ctx.environment == "test":
        return []
    wk = week_key(datetime.now(UTC))
    row = await ctx.session.scalar(select(ProductInsightModel).where(ProductInsightModel.workspace_id == ctx.workspace.id, ProductInsightModel.week == wk))
    if row is None:
        now = datetime.now(UTC)
        agents = {a.live_workflow_id: a.name for a in (await ctx.session.scalars(select(ProductAgentModel).where(ProductAgentModel.workspace_id == ctx.workspace.id))).all() if a.live_workflow_id}
        facts = build_facts(await _runs(ctx, now - timedelta(days=7), now, None), await _runs(ctx, now - timedelta(days=14), now - timedelta(days=7), None), agents)
        items = [{"id": f["id"], "text": await phrase(llm, ctx, f)} for f in facts]
        row = ProductInsightModel(workspace_id=ctx.workspace.id, week=wk, items=items)
        ctx.session.add(row)
        await ctx.session.commit()
    return [InsightOut(**i) for i in row.items]
