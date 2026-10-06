"""Reseller portal API.

A reseller is an organization flagged ``is_reseller`` by the platform owner. It
can create and manage *client* organizations, set their prices and limits,
grant them minutes, choose a **model profile** for them and see their usage and
margin. Resellers never see which providers or models a profile maps to, nor
what the platform pays for them.
"""

import re
import uuid
from datetime import UTC, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, EmailStr, Field

from api.constants import UI_APP_URL
from api.db import db_client
from api.db.models import OrganizationModel
from api.enums import ASSIGNABLE_ORG_ROLES
from api.services.billing import wallet_service
from api.services.reseller import profiles as profile_service
from api.services.reseller.access import (
    ResellerContext,
    child_org_or_404,
    reseller_context,
)
from api.utils.auth import create_invite_token

router = APIRouter(prefix="/reseller", tags=["reseller"])

PULSES = (1, 15, 30, 60)


# --------------------------------------------------------------------- schemas
class CreateClientRequest(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    billing_rate: float = Field(default=0.0, ge=0)
    billing_pulse: int = 60
    monthly_minutes_limit: float = Field(default=0.0, ge=0)
    initial_minutes: float = Field(default=0.0, ge=0)
    monthly_carry_forward: bool = True
    allow_overdraft: bool = False
    model_profile_id: Optional[int] = None
    admin_email: Optional[EmailStr] = None


class UpdateClientRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=100)
    is_active: Optional[bool] = None
    wallet_enabled: Optional[bool] = None
    billing_rate: Optional[float] = Field(default=None, ge=0)
    billing_pulse: Optional[int] = None
    monthly_minutes_limit: Optional[float] = Field(default=None, ge=0)
    monthly_carry_forward: Optional[bool] = None
    allow_overdraft: Optional[bool] = None
    quota_reset_day: Optional[int] = Field(default=None, ge=1, le=28)
    concurrency_limit: Optional[int] = Field(default=None, ge=0)


class GrantMinutesRequest(BaseModel):
    minutes: float = Field(gt=0)
    description: Optional[str] = None
    idempotency_key: Optional[str] = None


class CreditRequest(BaseModel):
    amount: float
    description: Optional[str] = None
    idempotency_key: Optional[str] = None


class ModelProfileAssignment(BaseModel):
    profile_id: Optional[int] = None


class InviteClientUserRequest(BaseModel):
    email: EmailStr
    role: str = "admin"


# --------------------------------------------------------------------- helpers
def _slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def _client_view(org: OrganizationModel, wallet: dict | None = None, stats: dict | None = None):
    """Everything a reseller may know about a client. No model / cost details."""
    profile_name = None
    return {
        "id": org.id,
        "name": org.name,
        "slug": org.slug,
        "is_active": org.is_active,
        "created_at": org.created_at,
        "wallet_enabled": org.wallet_enabled,
        "billing_rate": org.billing_rate,
        "billing_pulse": org.billing_pulse,
        "monthly_minutes_limit": org.monthly_minutes_limit,
        "monthly_carry_forward": org.monthly_carry_forward,
        "allow_overdraft": org.allow_overdraft,
        "quota_reset_day": org.quota_reset_day,
        "concurrency_limit": org.concurrency_limit,
        "model_profile_id": org.model_profile_id,
        "model_profile_name": profile_name,
        "wallet": wallet,
        "stats": stats,
    }


async def _profile_names(org_id: int) -> dict[int, str]:
    return {p.id: p.display_name for p in await db_client.list_model_profiles_for_org(org_id)}


async def _require_assignable_profile(ctx: ResellerContext, profile_id: int) -> None:
    allowed = {p.id for p in await db_client.list_model_profiles_for_org(ctx.org.id)}
    if profile_id not in allowed:
        raise HTTPException(status_code=404, detail="Model profile not found")


def _check_retail_rate(ctx: ResellerContext, rate: float | None) -> None:
    wholesale = float(ctx.org.wholesale_rate or 0.0)
    if rate and wholesale and rate < wholesale:
        raise HTTPException(
            status_code=400,
            detail=f"billing_rate cannot be below your wholesale rate ({wholesale:g}/min)",
        )


# ---------------------------------------------------------------------- routes
@router.get("/overview")
async def overview(
    days: int = Query(30, ge=1, le=366),
    ctx: ResellerContext = Depends(reseller_context),
):
    end = datetime.now(UTC) + timedelta(seconds=1)
    start = end - timedelta(days=days)
    children = await db_client.list_child_organizations(ctx.org.id)
    stats = await wallet_service.client_stats(ctx.org.id, start=start, end=end)
    names = await _profile_names(ctx.org.id)

    clients = []
    totals = {"calls": 0, "minutes": 0.0, "wholesale_cost": 0.0, "estimated_margin": 0.0}
    for child in children:
        s = dict(stats.get(child.id, {}))
        list_value = s.get("minutes", 0.0) * float(child.billing_rate or 0.0)
        s["list_value"] = round(list_value, 2)
        s["estimated_margin"] = round(list_value - s.get("wholesale_cost", 0.0), 2)
        view = _client_view(child, stats=s)
        view["model_profile_name"] = names.get(child.model_profile_id)
        clients.append(view)
        totals["calls"] += s.get("calls", 0)
        totals["minutes"] += s.get("minutes", 0.0)
        totals["wholesale_cost"] += s.get("wholesale_cost", 0.0)
        totals["estimated_margin"] += s["estimated_margin"]

    return {
        "organization": {
            "id": ctx.org.id,
            "name": ctx.org.name,
            "wholesale_rate": ctx.org.wholesale_rate,
            "max_child_orgs": ctx.org.max_child_orgs,
            "wallet": await wallet_service.get_summary(ctx.org.id),
        },
        "period_days": days,
        "clients": clients,
        "totals": {k: round(v, 2) for k, v in totals.items()},
    }


@router.get("/model-profiles")
async def list_profiles(ctx: ResellerContext = Depends(reseller_context)):
    """Profiles you may assign. Only labels and descriptions - never the providers."""
    profiles = await db_client.list_model_profiles_for_org(ctx.org.id)
    return [profile_service.public_view(p) for p in profiles]


@router.post("/clients")
async def create_client(
    request: CreateClientRequest, ctx: ResellerContext = Depends(reseller_context)
):
    if request.billing_pulse not in PULSES:
        raise HTTPException(status_code=400, detail="billing_pulse must be 1, 15, 30 or 60")
    _check_retail_rate(ctx, request.billing_rate)

    cap = ctx.org.max_child_orgs
    if cap is not None and await db_client.count_child_organizations(ctx.org.id) >= cap:
        raise HTTPException(status_code=403, detail=f"Client limit reached ({cap})")

    name = request.name.strip()
    slug = _slugify(name)
    if await db_client.organization_name_or_slug_taken(name, slug):
        raise HTTPException(status_code=400, detail="A workspace with this name already exists")

    profile_id = request.model_profile_id
    if profile_id is None:
        profile_id = ctx.org.model_profile_id
    elif profile_id is not None:
        await _require_assignable_profile(ctx, profile_id)

    child = await db_client.create_child_organization(
        name=name,
        slug=slug,
        provider_id=f"org_{uuid.uuid4().hex[:12]}",
        is_active=True,
        parent_org_id=ctx.org.id,
        hide_model_details=True,  # clients of a reseller never see model details
        model_profile_id=profile_id,
        wallet_enabled=True,
        wallet_started_at=datetime.now(UTC),
        billing_currency=ctx.org.billing_currency,
        billing_rate=request.billing_rate,
        billing_pulse=request.billing_pulse,
        monthly_minutes_limit=request.monthly_minutes_limit,
        monthly_carry_forward=request.monthly_carry_forward,
        allow_overdraft=request.allow_overdraft,
    )

    if request.initial_minutes > 0:
        await wallet_service.grant_minutes(
            child.id,
            request.initial_minutes,
            description="Initial minutes",
            actor_user_id=ctx.user.id,
            idempotency_key=f"initial:{child.id}",
        )

    invite = None
    if request.admin_email:
        token = create_invite_token(child.id, request.admin_email, "admin")
        invite = {"token": token, "invite_url": f"{UI_APP_URL}/signup?invite_token={token}"}

    return {"client": _client_view(child), "invite": invite}


@router.get("/clients/{client_id}")
async def get_client(client_id: int, ctx: ResellerContext = Depends(reseller_context)):
    child = await child_org_or_404(ctx, client_id)
    view = _client_view(child, wallet=await wallet_service.get_summary(child.id))
    view["model_profile_name"] = (await _profile_names(ctx.org.id)).get(child.model_profile_id)
    return view


@router.patch("/clients/{client_id}")
async def update_client(
    client_id: int,
    request: UpdateClientRequest,
    ctx: ResellerContext = Depends(reseller_context),
):
    child = await child_org_or_404(ctx, client_id)
    fields = request.model_dump(exclude_unset=True)
    if "billing_pulse" in fields and fields["billing_pulse"] not in PULSES:
        raise HTTPException(status_code=400, detail="billing_pulse must be 1, 15, 30 or 60")
    if "name" in fields:
        fields["name"] = fields["name"].strip()
        if fields["name"] != child.name and await db_client.organization_name_or_slug_taken(
            fields["name"], _slugify(fields["name"])
        ):
            raise HTTPException(status_code=400, detail="A workspace with this name already exists")
    if "billing_rate" in fields:
        _check_retail_rate(ctx, fields["billing_rate"])
    if fields.get("wallet_enabled") and child.wallet_started_at is None:
        fields["wallet_started_at"] = datetime.now(UTC)
    updated = await db_client.update_organization_fields(child.id, **fields)
    return _client_view(updated, wallet=await wallet_service.get_summary(updated.id))


@router.put("/clients/{client_id}/model-profile")
async def assign_model_profile(
    client_id: int,
    request: ModelProfileAssignment,
    ctx: ResellerContext = Depends(reseller_context),
):
    """Switch which models power a client. Takes effect on the client's next call."""
    child = await child_org_or_404(ctx, client_id)
    if request.profile_id is not None:
        await _require_assignable_profile(ctx, request.profile_id)
    updated = await db_client.update_organization_fields(
        child.id, model_profile_id=request.profile_id
    )
    names = await _profile_names(ctx.org.id)
    return {
        "model_profile_id": updated.model_profile_id,
        "model_profile_name": names.get(updated.model_profile_id),
    }


@router.post("/clients/{client_id}/wallet/grant-minutes")
async def grant_minutes(
    client_id: int,
    request: GrantMinutesRequest,
    ctx: ResellerContext = Depends(reseller_context),
):
    child = await child_org_or_404(ctx, client_id)
    try:
        await wallet_service.grant_minutes(
            child.id,
            request.minutes,
            description=request.description,
            actor_user_id=ctx.user.id,
            idempotency_key=request.idempotency_key,
        )
    except wallet_service.WalletError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"wallet": await wallet_service.get_summary(child.id)}


@router.post("/clients/{client_id}/wallet/deduct-minutes")
async def deduct_minutes(
    client_id: int,
    request: GrantMinutesRequest,
    ctx: ResellerContext = Depends(reseller_context),
):
    child = await child_org_or_404(ctx, client_id)
    try:
        await wallet_service.remove_minutes(
            child.id,
            request.minutes,
            description=request.description,
            actor_user_id=ctx.user.id,
        )
    except wallet_service.WalletError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"wallet": await wallet_service.get_summary(child.id)}


@router.post("/clients/{client_id}/wallet/credit")
async def credit_client(
    client_id: int,
    request: CreditRequest,
    ctx: ResellerContext = Depends(reseller_context),
):
    """Record a payment received from the client (adds to their money balance)."""
    child = await child_org_or_404(ctx, client_id)
    try:
        await wallet_service.credit_money(
            child.id,
            request.amount,
            description=request.description,
            actor_user_id=ctx.user.id,
            idempotency_key=request.idempotency_key,
        )
    except wallet_service.WalletError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"wallet": await wallet_service.get_summary(child.id)}


@router.get("/clients/{client_id}/wallet/ledger")
async def client_ledger(
    client_id: int,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    entry_type: Optional[str] = None,
    ctx: ResellerContext = Depends(reseller_context),
):
    child = await child_org_or_404(ctx, client_id)
    items, total = await wallet_service.list_ledger(
        child.id, limit=limit, offset=offset, entry_type=entry_type
    )
    return {"items": items, "total": total}


@router.post("/clients/{client_id}/invite")
async def invite_client_user(
    client_id: int,
    request: InviteClientUserRequest,
    ctx: ResellerContext = Depends(reseller_context),
):
    child = await child_org_or_404(ctx, client_id)
    if request.role not in ASSIGNABLE_ORG_ROLES:
        raise HTTPException(status_code=400, detail="Invalid role")
    token = create_invite_token(child.id, request.email, request.role)
    return {"token": token, "invite_url": f"{UI_APP_URL}/signup?invite_token={token}"}

