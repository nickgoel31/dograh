"""Browser practice calls cost the same per minute as real ones. They run on the private test copy, so they are charged
to the workspace's Live wallet here (free minutes first, then balance), once per call, from the scheduled tick."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from api.db.models import OrganizationModel, WorkflowModel, WorkflowRunModel
from api.db.product_models import ProductPracticeChargeModel, ProductWorkspaceModel
from api.product import conversations as conv
from api.product import pricing, rates


async def charge_practice_calls(session, wallet, now: datetime | None = None, limit: int = 100) -> int:
    now = now or datetime.now(UTC)
    charged = 0
    for ws in (await session.scalars(select(ProductWorkspaceModel).where(ProductWorkspaceModel.adopted.is_(False)))).all():
        live = await session.get(OrganizationModel, ws.live_org_id)
        if live is None or not live.wallet_enabled:
            continue
        done = select(ProductPracticeChargeModel.run_id).where(ProductPracticeChargeModel.workspace_id == ws.id)
        runs = (await session.scalars(
            select(WorkflowRunModel).join(WorkflowModel, WorkflowRunModel.workflow_id == WorkflowModel.id)
            .where(WorkflowModel.organization_id == ws.test_org_id, WorkflowRunModel.is_completed.is_(True), WorkflowRunModel.created_at > now - timedelta(days=10),
                   WorkflowRunModel.id.not_in(done)).order_by(WorkflowRunModel.id).limit(limit))).all()
        if not runs:
            continue
        rate = await rates.workspace_rate(session, ws)
        for r in runs:
            seconds = conv.duration_seconds(r.cost_info, r.usage_info) or 0
            minutes = pricing.billed_minutes(seconds)
            amount = await wallet.charge(ws.live_org_id, minutes, rate, f"Practice call #{r.id}", f"practice:{r.id}") if minutes else 0.0
            session.add(ProductPracticeChargeModel(run_id=r.id, workspace_id=ws.id, minutes=minutes, amount=amount))
            await session.flush()
            charged += 1
    await session.commit()
    return charged
