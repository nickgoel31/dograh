"""Per-agent limits: calls per day and spend per month. Checked on inbound calls and "call me"."""

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import load_only

from api.db.models import WorkflowRunModel
from api.product import config
from api.product import conversations as conv

FULL_TODAY = "Sorry, we can't take more calls today. Please try again tomorrow."
FULL_MONTH = "Sorry, we can't take your call right now. Please try again later."


async def exceeded(session, agent, now: datetime | None = None) -> str | None:
    """A polite message when this agent has reached a limit, else None."""
    style = agent.style or {}
    daily, monthly = int(style.get("daily_call_cap") or 0), int(style.get("monthly_spend_cap") or 0)
    wf = agent.live_workflow_id
    if wf is None or not (daily or monthly):
        return None
    now = now or datetime.now(UTC)
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    runs = (await session.scalars(select(WorkflowRunModel).where(WorkflowRunModel.workflow_id == wf, WorkflowRunModel.created_at >= start).options(
        load_only(WorkflowRunModel.created_at, WorkflowRunModel.cost_info, WorkflowRunModel.usage_info)).limit(20000))).all()
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    naive = lambda d: d.replace(tzinfo=None)  # noqa: E731 - some databases hand back times without a zone
    if daily and sum(1 for r in runs if r.created_at and naive(r.created_at) >= naive(today)) >= daily:
        return FULL_TODAY
    if monthly:
        spent = sum((conv.duration_seconds(r.cost_info, r.usage_info) or 0) / 60 * config.PRICE_PER_MIN for r in runs)
        if spent >= monthly:
            return FULL_MONTH
    return None
