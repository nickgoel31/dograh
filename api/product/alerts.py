"""Owner alerts: a failed call or a low balance shows in the bell and, once, by email. Run from the scheduled tick."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from api.db.models import UserModel, WorkflowModel, WorkflowRunModel
from api.db.product_models import ProductWorkspaceModel
from api.product import conversations as conv
from api.product import emailer
from api.product.ids import encode_call_id
from api.product.notifications import notify

LOOKBACK = timedelta(hours=36)


async def scan(session, mailer: emailer.Mailer, wallet=None, now: datetime | None = None) -> int:
    """Returns how many new alerts were raised."""
    now = now or datetime.now(UTC)
    raised = 0
    for ws in (await session.scalars(select(ProductWorkspaceModel))).all():
        owner = await session.get(UserModel, ws.owner_user_id)
        to = owner.email if owner else None
        runs = (await session.scalars(
            select(WorkflowRunModel).join(WorkflowModel, WorkflowRunModel.workflow_id == WorkflowModel.id)
            .where(WorkflowModel.organization_id == ws.live_org_id, WorkflowRunModel.is_completed.is_(True), WorkflowRunModel.created_at > now - LOOKBACK)
            .order_by(WorkflowRunModel.id.desc()).limit(200))).all()
        for r in runs:
            g = r.gathered_context or {}
            outcome = conv.product_outcome(disposition=g.get("mapped_call_disposition") or g.get("call_disposition"), completed=True, duration=conv.duration_seconds(r.cost_info, r.usage_info))
            if outcome != "failed":
                continue
            if await notify(session, ws.id, "call", "A call didn't go through", "Open it to see what happened.", f"/conversations/{encode_call_id(r.id)}", f"callfail:{r.id}"):
                raised += 1
                if to:
                    await mailer.send(to, "A call didn't go through", f"A call to your agent failed. Open it in {ws.name}.",
                                      emailer.wrap("A call didn't go through", "<p>One of your agent's calls failed. Open it to see what happened.</p>", ("Open the call", f"{emailer.app_url()}/conversations/{encode_call_id(r.id)}")))
        if wallet is not None:
            w = await wallet.summary(ws.live_org_id)
            if w.get("low_balance") and await notify(session, ws.id, "balance", "Your balance is running low", "Add money to keep taking calls.", "/billing", f"low:{now.strftime('%Y-%m-%d')}"):
                raised += 1
                if to:
                    await mailer.send(to, "Your balance is running low", "Add money so your agent keeps answering calls.",
                                      emailer.wrap("Your balance is running low", "<p>Add money so your agent keeps answering calls.</p>", ("Add money", f"{emailer.app_url()}/billing")))
    await session.commit()
    return raised
