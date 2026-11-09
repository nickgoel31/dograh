"""Live calls: the calls happening right now in this workspace, for the active environment (Test or Live)."""

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select

from api.db.models import WorkflowModel, WorkflowRunModel
from api.db.product_models import ProductAgentModel
from api.product import conversations as conv
from api.product.deps import Ctx, get_ctx
from api.product.ids import encode_call_id

router = APIRouter(prefix="/product/live", tags=["live"])
MAX_AGE = timedelta(hours=3)  # a call that never reported an end is not still going after this long


class LiveCall(BaseModel):
    id: str
    caller: str
    phone: str | None
    agent_id: str | None
    agent_name: str | None
    started: str
    seconds: int
    direction: str


class LiveOut(BaseModel):
    calls: list[LiveCall]
    now: str


@router.get("", response_model=LiveOut)
async def live_calls(ctx: Ctx = Depends(get_ctx)):
    now = datetime.now(UTC)
    rows = (await ctx.session.scalars(
        select(WorkflowRunModel).join(WorkflowModel, WorkflowRunModel.workflow_id == WorkflowModel.id)
        .where(WorkflowModel.organization_id == ctx.org_id, WorkflowRunModel.is_completed.is_(False), WorkflowRunModel.state == "running", WorkflowRunModel.created_at > now - MAX_AGE)
        .order_by(WorkflowRunModel.created_at.desc()).limit(100))).all()
    agents = {a.test_workflow_id if ctx.environment == "test" else a.live_workflow_id: a for a in (await ctx.session.scalars(
        select(ProductAgentModel).where(ProductAgentModel.workspace_id == ctx.workspace.id))).all()}
    out = []
    for r in rows:
        name, phone = conv.caller_of(r.initial_context, r.gathered_context)
        a = agents.get(r.workflow_id)
        started = r.created_at if r.created_at.tzinfo else r.created_at.replace(tzinfo=UTC)
        out.append(LiveCall(id=encode_call_id(r.id), caller=name, phone=phone, agent_id=a.public_id if a else None, agent_name=a.name if a else None,
                            started=started.isoformat(), seconds=max(0, int((now - started).total_seconds())), direction=str(getattr(r.call_type, "value", r.call_type) or "inbound")))
    return LiveOut(calls=out, now=now.isoformat())
