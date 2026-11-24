"""Sub-accounts: workspaces run under a parent account (an agency, a company with branches, a reseller's clients).

A sub-account is a normal workspace with its own agents, numbers, voices, knowledge, team and settings. What is different:
  * It can share the parent's wallet: it has no balance of its own, its calls are paid from the parent's wallet, at the parent's price and
    billing cycle (see wallet_service._record_shared). It can instead keep its own wallet.
  * The parent can cap what a sub-account may use each month (minutes and money), pause it, and see its usage in one rollup (also as a CSV).
  * The owners and admins of the parent can open every sub-account without being added to each (service.list_workspaces).
"""

from __future__ import annotations

import os
from datetime import UTC, datetime

from sqlalchemy import select

from api.db.models import OrganizationModel
from api.db.product_models import ProductWorkspaceModel
from api.product import audit
from api.product import billing as bl
from api.product.notifications import notify
from api.product.service import create_workspace
from api.services.billing import wallet_service

MODES = ("shared", "own")


def max_sub_accounts() -> int:
    return int(os.getenv("PRODUCT_MAX_SUBACCOUNTS", "50"))


async def children(session, parent: ProductWorkspaceModel) -> list[ProductWorkspaceModel]:
    return list((await session.scalars(select(ProductWorkspaceModel).where(ProductWorkspaceModel.parent_workspace_id == parent.id).order_by(ProductWorkspaceModel.id))).all())


async def child_of(session, parent: ProductWorkspaceModel, public_id: str) -> ProductWorkspaceModel | None:
    return await session.scalar(select(ProductWorkspaceModel).where(ProductWorkspaceModel.public_id == public_id, ProductWorkspaceModel.parent_workspace_id == parent.id))


def apply(org: OrganizationModel, parent: ProductWorkspaceModel, ws: ProductWorkspaceModel, *, mode: str | None = None, cap_value=..., cap_minutes=..., max_concurrent=...) -> None:
    """Set a sub-account's billing mode and limits on its Live organization (`...` means leave as it is; None clears)."""
    if mode is not None:
        ws.billing_mode = mode
        org.wallet_org_id = parent.live_org_id if mode == "shared" else None
        if mode == "shared":
            org.wallet_enabled = False  # nothing of its own to bill
    if cap_value is not ...:
        org.wallet_cap_value = cap_value
    if cap_minutes is not ...:
        org.wallet_cap_minutes = cap_minutes
    if max_concurrent is not ...:
        org.concurrency_limit = max_concurrent


async def create(session, parent: ProductWorkspaceModel, user, name: str, *, mode: str = "shared", cap_value=None, cap_minutes=None, max_concurrent=None) -> ProductWorkspaceModel:
    ws = await create_workspace(session, user, name, parent_id=parent.id)
    org = await session.get(OrganizationModel, ws.live_org_id)
    apply(org, parent, ws, mode=mode, cap_value=cap_value, cap_minutes=cap_minutes, max_concurrent=max_concurrent)
    await audit.record(session, parent.id, user.id, "sub_account.created", ws.public_id, {"name": ws.name, "billing": mode})
    await audit.record(session, ws.id, user.id, "sub_account.created", parent.public_id, {"parent": parent.name})
    await session.flush()
    return ws


async def set_paused(session, ws: ProductWorkspaceModel, paused: bool) -> None:
    ws.suspended = paused
    org = await session.get(OrganizationModel, ws.live_org_id)
    org.calls_paused = paused
    test = await session.get(OrganizationModel, ws.test_org_id)
    if test is not None:
        test.calls_paused = paused


async def month_numbers(session, ws: ProductWorkspaceModel, now: datetime | None = None) -> tuple[float, float]:
    """(minutes, value) this calendar month, the same figures the caps are checked against."""
    return await wallet_service.month_usage(session, ws.live_org_id, now or datetime.now(UTC))


async def rollup(session, parent: ProductWorkspaceModel, period: str | None = None) -> dict:
    """Each sub-account's calls, minutes and value for a month (YYYY-MM, default this month), with totals."""
    period = period or bl.current_period()
    start, end = bl.month_bounds(period)
    rows, tm, tv, tc = [], 0.0, 0.0, 0
    for w in await children(session, parent):
        entries = await bl.usage_entries(session, w.live_org_id, start, end)
        m, v = round(sum(e["minutes"] for e in entries), 2), round(sum(e["value"] for e in entries), 2)
        rows.append({"id": w.public_id, "name": w.name, "calls": len(entries), "minutes": m, "value": v, "billing": w.billing_mode, "suspended": bool(w.suspended)})
        tm, tv, tc = tm + m, tv + v, tc + len(entries)
    return {"period": period, "accounts": rows, "total_calls": tc, "total_minutes": round(tm, 2), "total_value": round(tv, 2)}


def to_csv(data: dict) -> str:
    lines = ["sub_account,calls,minutes,value,billing,suspended"]
    for r in data["accounts"]:
        name = '"' + r["name"].replace('"', '""') + '"'
        lines.append(f'{name},{r["calls"]},{r["minutes"]},{r["value"]},{r["billing"]},{"yes" if r["suspended"] else "no"}')
    lines.append(f'"Total",{data["total_calls"]},{data["total_minutes"]},{data["total_value"]},,')
    return "\n".join(lines) + "\n"


async def cap_alerts(session, now: datetime | None = None) -> int:
    """Tell a parent when a sub-account reaches 80% and 100% of a monthly cap (once per month per level)."""
    now = now or datetime.now(UTC)
    period = now.strftime("%Y-%m")
    sent = 0
    for w in (await session.scalars(select(ProductWorkspaceModel).where(ProductWorkspaceModel.parent_workspace_id.is_not(None)))).all():
        org = await session.get(OrganizationModel, w.live_org_id)
        if org is None or (org.wallet_cap_value is None and org.wallet_cap_minutes is None):
            continue
        minutes, value = await wallet_service.month_usage(session, org.id, now)
        ratios = [r for r in ((minutes / org.wallet_cap_minutes) if org.wallet_cap_minutes else None, (value / org.wallet_cap_value) if org.wallet_cap_value else None) if r is not None]
        top = max(ratios, default=0.0)
        for level in (100, 80):
            if top * 100 >= level:
                title = f"{w.name} has used its monthly limit" if level == 100 else f"{w.name} has used 80% of its monthly limit"
                body = "New calls from this sub-account will be refused until next month or until you raise the limit." if level == 100 else "Raise its limit if it needs more."
                if await notify(session, w.parent_workspace_id, "sub_cap", title, body, "/sub-accounts", f"subcap:{w.id}:{period}:{level}"):
                    sent += 1
                break
    await session.commit()
    return sent
