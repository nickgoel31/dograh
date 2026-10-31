"""The workspace's current price per minute, from how much money its wallet holds."""

from sqlalchemy import select

from api.db.models import OrganizationModel
from api.db.product_models import ProductWorkspaceModel
from api.product import billing as bl
from api.product import pricing


async def month_minutes(session, ws: ProductWorkspaceModel) -> float:
    start, end = bl.month_bounds(bl.current_period())
    return sum(e["minutes"] for e in await bl.usage_entries(session, ws.live_org_id, start, end))


async def workspace_rate(session, ws: ProductWorkspaceModel) -> float:
    org = await session.get(OrganizationModel, ws.live_org_id)
    return pricing.rate_for_balance(float(org.balance or 0.0) if org is not None else 0.0)


async def sync_org_rate(session, ws: ProductWorkspaceModel) -> float:
    """Point the Live wallet's rate at the slab its balance is in (brought-over organizations keep their own rate)."""
    rate = await workspace_rate(session, ws)
    org = await session.get(OrganizationModel, ws.live_org_id)
    if org is not None and org.wallet_enabled and not ws.adopted:
        org.billing_rate = rate
        org.billing_pulse = 60  # billed per minute, rounded up
    return rate


async def sync_all(session) -> int:
    n = 0
    for ws in (await session.scalars(select(ProductWorkspaceModel).where(ProductWorkspaceModel.adopted.is_(False)))).all():
        await sync_org_rate(session, ws)
        n += 1
    await session.commit()
    return n
