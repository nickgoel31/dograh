"""Owner admin dashboard: every customer, their balance and agents, and a few safe controls.

Only a platform superuser whose email is in PRODUCT_ADMIN_EMAILS (default admin@twjlabs.com) can use it. Both are required, so
nobody gets in just by signing up with that address (public sign-up refuses it too). Create the account with scripts/create_admin.py.
"""

import os
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select

from api.db.models import UserModel, WorkflowModel, WorkflowRunModel
from api.product import audit, config, phone_verify, swarvo_access
from api.product import billing as bl
from api.product.deps import get_user_only
from api.product.errors import product_error
from api.product.payments import WalletGateway, get_wallet
from api.db.product_models import (
    ProductAgentModel, ProductBillingSettingsModel, ProductMembershipModel, ProductWorkspaceModel,
)

router = APIRouter(prefix="/product/admin", tags=["admin"])


def admin_emails() -> set[str]:
    raw = os.getenv("PRODUCT_ADMIN_EMAILS")
    raw = "admin@twjlabs.com" if raw is None else raw
    return {e.strip().lower() for e in raw.split(",") if e.strip()}


def is_admin(user: UserModel) -> bool:
    return bool(user.is_superuser) and (user.email or "").strip().lower() in admin_emails()


async def require_admin(base=Depends(get_user_only)):
    session, user = base
    if not is_admin(user):
        raise product_error(403, "not_admin", "This area is only for the platform owner.")
    return session, user


async def _calls(session, org_ids: list[int], since: datetime | None = None) -> dict[int, int]:
    """Call counts per organization."""
    if not org_ids:
        return {}
    q = select(WorkflowModel.organization_id, func.count(WorkflowRunModel.id)).join(WorkflowRunModel, WorkflowRunModel.workflow_id == WorkflowModel.id).where(WorkflowModel.organization_id.in_(org_ids))
    if since is not None:
        q = q.where(WorkflowRunModel.created_at >= since)
    return dict((await session.execute(q.group_by(WorkflowModel.organization_id))).all())


async def _owner_emails(session, ids: list[int]) -> dict[int, str | None]:
    if not ids:
        return {}
    return dict((await session.execute(select(UserModel.id, UserModel.email).where(UserModel.id.in_(ids)))).all())


@router.get("/overview")
async def overview(base=Depends(require_admin)):
    session, _ = base
    day, week = datetime.now(UTC) - timedelta(days=1), datetime.now(UTC) - timedelta(days=7)
    count = lambda q: session.scalar(q)
    live_orgs = list(await session.scalars(select(ProductWorkspaceModel.live_org_id)))
    return {
        "users": await count(select(func.count()).select_from(UserModel)),
        "workspaces": await count(select(func.count()).select_from(ProductWorkspaceModel)),
        "new_workspaces_7d": await count(select(func.count()).select_from(ProductWorkspaceModel).where(ProductWorkspaceModel.created_at >= week)),
        "agents": await count(select(func.count()).select_from(ProductAgentModel)),
        "live_agents": await count(select(func.count()).select_from(ProductAgentModel).where(ProductAgentModel.status == "live")),
        "calls_24h": sum((await _calls(session, live_orgs, day)).values()),
        "calls_7d": sum((await _calls(session, live_orgs, week)).values()),
        "bonus_given": await bl.bonus_given(session),
        "bonus_limit": bl.signup_bonus_limit(),
        "phone_verified": await count(select(func.count()).select_from(ProductBillingSettingsModel).where(ProductBillingSettingsModel.phone_verified_at.is_not(None))),
        "currency": config.CURRENCY,
    }


@router.get("/workspaces")
async def workspaces(q: str | None = Query(default=None, max_length=80), limit: int = Query(default=25, ge=1, le=100), offset: int = Query(default=0, ge=0),
                     base=Depends(require_admin), wallet: WalletGateway = Depends(get_wallet)):
    session, _ = base
    query = select(ProductWorkspaceModel)
    if q:
        like = f"%{q.strip().lower()}%"
        owners = select(UserModel.id).where(func.lower(UserModel.email).like(like))
        query = query.where(or_(func.lower(ProductWorkspaceModel.name).like(like), ProductWorkspaceModel.owner_user_id.in_(owners), ProductWorkspaceModel.public_id == q.strip()))
    total = await session.scalar(select(func.count()).select_from(query.subquery()))
    rows = (await session.scalars(query.order_by(ProductWorkspaceModel.id.desc()).limit(limit).offset(offset))).all()
    emails = await _owner_emails(session, [w.owner_user_id for w in rows])
    calls = await _calls(session, [w.live_org_id for w in rows])
    agents = dict((await session.execute(select(ProductAgentModel.workspace_id, func.count()).where(ProductAgentModel.workspace_id.in_([w.id for w in rows])).group_by(ProductAgentModel.workspace_id))).all()) if rows else {}
    settings = {s.workspace_id: s for s in (await session.scalars(select(ProductBillingSettingsModel).where(ProductBillingSettingsModel.workspace_id.in_([w.id for w in rows])))).all()} if rows else {}
    out = []
    for w in rows:
        try:
            bal = float((await wallet.summary(w.live_org_id)).get("balance", 0) or 0)
        except Exception:  # noqa: BLE001 - one broken wallet must not hide the whole list
            bal = None
        s = settings.get(w.id)
        out.append({"id": w.public_id, "name": w.name, "owner": emails.get(w.owner_user_id), "created": w.created_at, "balance": bal, "agents": agents.get(w.id, 0),
                    "calls": calls.get(w.live_org_id, 0), "phone_verified": bool(s and s.phone_verified_at), "bonus": bool(s and s.signup_bonus_at),
                    "adopted": w.adopted, "child": w.parent_workspace_id is not None})
    return {"total": total or 0, "workspaces": out, "currency": config.CURRENCY}


async def _workspace(session, public_id: str) -> ProductWorkspaceModel:
    ws = await session.scalar(select(ProductWorkspaceModel).where(ProductWorkspaceModel.public_id == public_id))
    if ws is None:
        raise product_error(404, "workspace_not_found", "We couldn't find that workspace.")
    return ws


@router.get("/workspaces/{public_id}")
async def workspace_detail(public_id: str, base=Depends(require_admin), wallet: WalletGateway = Depends(get_wallet)):
    session, _ = base
    ws = await _workspace(session, public_id)
    s = await bl.get_settings(session, ws)
    await session.commit()
    try:
        w = await wallet.summary(ws.live_org_id)
    except Exception:  # noqa: BLE001
        w = {}
    members = (await session.execute(select(UserModel.email, ProductMembershipModel.role).join(ProductMembershipModel, ProductMembershipModel.user_id == UserModel.id).where(ProductMembershipModel.workspace_id == ws.id))).all()
    agents = (await session.scalars(select(ProductAgentModel).where(ProductAgentModel.workspace_id == ws.id).order_by(ProductAgentModel.id.desc()))).all()
    day = datetime.now(UTC) - timedelta(days=30)
    start, end = bl.month_bounds(bl.current_period())
    entries = await bl.usage_entries(session, ws.live_org_id, start, end) + await bl.practice_entries(session, ws, start, end)
    return {
        "id": ws.public_id, "name": ws.name, "created": ws.created_at, "adopted": ws.adopted, "currency": config.CURRENCY,
        "balance": float(w.get("balance", 0) or 0), "minutes_available": float(w.get("minutes_available", 0) or 0),
        "month_minutes": round(sum(e["minutes"] for e in entries), 2), "month_spend": round(sum(e["value"] for e in entries), 2),
        "calls_30d": (await _calls(session, [ws.live_org_id], day)).get(ws.live_org_id, 0),
        "phone_verified": s.phone_verified_at is not None, "verified_phone": phone_verify.mask(s.verified_phone), "bonus_given": s.signup_bonus_at is not None,
        "members": [{"email": e, "role": r} for e, r in members],
        "agents": [{"id": a.public_id, "name": a.name, "status": a.status, "voice": a.voice_id} for a in agents],
        "swarvo_tts": ws.public_id in await swarvo_access.workspace_ids_with_access(session),
    }


class SwarvoIn(BaseModel):
    everyone: bool | None = None
    enabled: bool | None = None  # for one workspace


@router.get("/swarvo-tts")
async def swarvo_status(base=Depends(require_admin)):
    """Who can use the swarvo-tts 2.5 voices. They are 'coming soon' for everyone else."""
    session, _ = base
    cur = await swarvo_access.get_setting(session)
    names = {}
    if cur["workspaces"]:
        rows = (await session.execute(select(ProductWorkspaceModel.public_id, ProductWorkspaceModel.name).where(ProductWorkspaceModel.public_id.in_(cur["workspaces"])))).all()
        names = dict(rows)
    return {"everyone": cur["everyone"], "workspaces": [{"id": i, "name": names.get(i, i)} for i in cur["workspaces"]], "discount_percent": swarvo_access.discount_percent()}


@router.put("/swarvo-tts")
async def swarvo_everyone(body: SwarvoIn, base=Depends(require_admin)):
    session, _ = base
    if body.everyone is None:
        raise product_error(400, "need_value", "Say whether everyone should have it.")
    cur = await swarvo_access.put_setting(session, everyone=body.everyone)
    await session.commit()
    return {"everyone": cur["everyone"]}


@router.put("/workspaces/{public_id}/swarvo-tts")
async def swarvo_workspace(public_id: str, body: SwarvoIn, base=Depends(require_admin)):
    session, _ = base
    ws = await _workspace(session, public_id)
    if body.enabled is None:
        raise product_error(400, "need_value", "Say whether to turn it on or off.")
    await swarvo_access.set_workspace(session, ws.public_id, body.enabled)
    await session.commit()
    return {"id": ws.public_id, "swarvo_tts": body.enabled}


class BalanceIn(BaseModel):
    amount: float = Field(ge=-1_000_000, le=1_000_000)  # positive adds money, negative takes it away
    note: str = Field(min_length=3, max_length=120)


@router.post("/workspaces/{public_id}/balance")
async def adjust_balance(public_id: str, body: BalanceIn, base=Depends(require_admin), wallet: WalletGateway = Depends(get_wallet)):
    session, admin = base
    ws = await _workspace(session, public_id)
    if body.amount == 0:
        raise product_error(400, "zero_amount", "Enter an amount above or below zero.")
    await wallet.credit(ws.live_org_id, body.amount, f"Admin adjustment: {body.note}", f"admin:{ws.id}:{uuid.uuid4().hex}")
    await audit.record(session, ws.id, admin.id, "admin.balance", body.note, {"amount": body.amount, "by": admin.email})
    await session.commit()
    w = await wallet.summary(ws.live_org_id)
    return {"balance": float(w.get("balance", 0) or 0)}


@router.post("/workspaces/{public_id}/verify-phone")
async def verify_phone(public_id: str, base=Depends(require_admin), wallet: WalletGateway = Depends(get_wallet)):
    """Mark a workspace's number check as done by hand (for a customer who cannot receive WhatsApp codes). Gives the bonus if it was waiting."""
    session, admin = base
    ws = await _workspace(session, public_id)
    s = await bl.get_settings(session, ws)
    if s.phone_verified_at is None:
        s.phone_verified_at = datetime.now(UTC)
        await audit.record(session, ws.id, admin.id, "admin.verify_phone", None, {"by": admin.email})
        await session.commit()
        await bl.ensure_billing(session, wallet, ws)
        await session.commit()
    return {"phone_verified": True}
