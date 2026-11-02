"""The workspace's current price per minute, from how much money its wallet holds."""

from sqlalchemy import select

from api.db.models import OrganizationModel
from api.db.models import WalletLedgerModel
from api.db.product_models import ProductBillingSettingsModel, ProductPracticeChargeModel, ProductWorkspaceModel
from api.product import billing as bl
from api.product import pricing


async def month_minutes(session, ws: ProductWorkspaceModel) -> float:
    start, end = bl.month_bounds(bl.current_period())
    return sum(e["minutes"] for e in await bl.usage_entries(session, ws.live_org_id, start, end))


async def workspace_rate(session, ws: ProductWorkspaceModel) -> float:
    """Today's price: the cheapest slab the wallet has ever filled. A slab, once reached, is kept as the balance goes down."""
    org = await session.get(OrganizationModel, ws.live_org_id)
    now = pricing.rate_for_balance(float(org.balance or 0.0) if org is not None else 0.0)
    s = await session.get(ProductBillingSettingsModel, ws.id)
    return min(now, s.locked_rate) if s is not None and s.locked_rate else now


async def run_rates(session, ws: ProductWorkspaceModel, limit: int = 50000) -> dict[int, float]:
    """The price per minute each call was actually charged at, so old calls keep the price they had."""
    out: dict[int, float] = {}
    rows = await session.execute(select(WalletLedgerModel.workflow_run_id, WalletLedgerModel.rate_snapshot).where(
        WalletLedgerModel.organization_id == ws.live_org_id, WalletLedgerModel.entry_type == "usage",
        WalletLedgerModel.workflow_run_id.is_not(None), WalletLedgerModel.rate_snapshot.is_not(None)).order_by(WalletLedgerModel.id.desc()).limit(limit))
    for run_id, rate in rows.all():
        out[run_id] = float(rate)
    prac = await session.execute(select(ProductPracticeChargeModel.run_id, ProductPracticeChargeModel.minutes, ProductPracticeChargeModel.amount).where(
        ProductPracticeChargeModel.workspace_id == ws.id, ProductPracticeChargeModel.minutes > 0))
    for run_id, minutes, amount in prac.all():
        out[run_id] = round(float(amount) / float(minutes), 4)
    return out


async def sync_org_rate(session, ws: ProductWorkspaceModel) -> float:
    """Point the Live wallet's rate at the slab its balance is in (brought-over organizations keep their own rate)."""
    rate = await workspace_rate(session, ws)
    org = await session.get(OrganizationModel, ws.live_org_id)
    if org is not None and org.wallet_enabled and not ws.adopted:
        s = await session.get(ProductBillingSettingsModel, ws.id)
        if s is not None and (not s.locked_rate or rate < s.locked_rate):
            s.locked_rate = rate  # remember the cheapest slab reached
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
