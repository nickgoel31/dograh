"""Sub-accounts over HTTP: create them, share the parent's wallet, set monthly limits, pause them, and see their usage in one place."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from api.db.models import OrganizationModel
from api.db.product_models import ProductAgentModel, ProductMembershipModel, ProductWorkspaceModel
from api.product import audit, config
from api.product import subaccounts as sa
from api.product.deps import Ctx, get_ctx, require
from api.product.errors import product_error
from api.product.roles import Perm

router = APIRouter(prefix="/product/subaccounts", tags=["subaccounts"])


class SubOut(BaseModel):
    id: str
    name: str
    billing: str  # shared | own
    suspended: bool
    month_minutes: float
    month_value: float
    cap_value: float | None
    cap_minutes: float | None
    max_concurrent: int | None
    members: int
    agents: int
    created: str | None


class CreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    billing: str = "shared"
    cap_value: float | None = Field(default=None, gt=0, le=10_000_000)
    cap_minutes: float | None = Field(default=None, gt=0, le=10_000_000)
    max_concurrent: int | None = Field(default=None, ge=1, le=1000)


class ChangeIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    billing: str | None = None
    cap_value: float | None = Field(default=None, gt=0, le=10_000_000)
    cap_minutes: float | None = Field(default=None, gt=0, le=10_000_000)
    max_concurrent: int | None = Field(default=None, ge=1, le=1000)
    clear_cap_value: bool = False
    clear_cap_minutes: bool = False
    clear_max_concurrent: bool = False


def _parent_only(ctx: Ctx) -> None:
    if ctx.workspace.parent_workspace_id is not None:
        raise product_error(400, "not_a_parent", "Sub-accounts can only be managed from the main account.")


async def _out(ctx: Ctx, w: ProductWorkspaceModel) -> SubOut:
    org = await ctx.session.get(OrganizationModel, w.live_org_id)
    minutes, value = await sa.month_numbers(ctx.session, w)
    members = await ctx.session.scalar(select(func.count(ProductMembershipModel.id)).where(ProductMembershipModel.workspace_id == w.id)) or 0
    agents = await ctx.session.scalar(select(func.count(ProductAgentModel.id)).where(ProductAgentModel.workspace_id == w.id)) or 0
    return SubOut(id=w.public_id, name=w.name, billing=w.billing_mode or "own", suspended=bool(w.suspended), month_minutes=minutes, month_value=value,
                  cap_value=org.wallet_cap_value, cap_minutes=org.wallet_cap_minutes, max_concurrent=org.concurrency_limit, members=int(members), agents=int(agents),
                  created=w.created_at.isoformat() if w.created_at else None)


async def _child(ctx: Ctx, public_id: str) -> ProductWorkspaceModel:
    w = await sa.child_of(ctx.session, ctx.workspace, public_id)
    if w is None:
        raise product_error(404, "sub_account_not_found", "We couldn't find that sub-account.")
    return w


@router.get("", response_model=list[SubOut])
async def list_subs(ctx: Ctx = Depends(require(Perm.TEAM_MANAGE))):
    return [await _out(ctx, w) for w in await sa.children(ctx.session, ctx.workspace)]


@router.post("", response_model=SubOut, status_code=201)
async def create(body: CreateIn, ctx: Ctx = Depends(require(Perm.WORKSPACE_CREATE_CHILD))):
    _parent_only(ctx)
    if body.billing not in sa.MODES:
        raise product_error(400, "bad_billing", "Choose the shared wallet or the sub-account's own wallet.")
    if len(await sa.children(ctx.session, ctx.workspace)) >= sa.max_sub_accounts():
        raise product_error(400, "too_many", f"You can have up to {sa.max_sub_accounts()} sub-accounts.")
    ws = await sa.create(ctx.session, ctx.workspace, ctx.user, body.name.strip(), mode=body.billing, cap_value=body.cap_value, cap_minutes=body.cap_minutes, max_concurrent=body.max_concurrent)
    await ctx.session.commit()
    return await _out(ctx, ws)


@router.get("/usage")
async def usage(period: str | None = Query(default=None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$"), ctx: Ctx = Depends(require(Perm.TEAM_MANAGE))):
    return {**await sa.rollup(ctx.session, ctx.workspace, period), "currency": config.CURRENCY}


@router.get("/usage.csv")
async def usage_csv(period: str | None = Query(default=None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$"), ctx: Ctx = Depends(require(Perm.TEAM_MANAGE))):
    data = await sa.rollup(ctx.session, ctx.workspace, period)
    return Response(content=sa.to_csv(data), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="sub-accounts-{data["period"]}.csv"'})


@router.patch("/{sub_id}", response_model=SubOut)
async def change(sub_id: str, body: ChangeIn, ctx: Ctx = Depends(require(Perm.WORKSPACE_CREATE_CHILD))):
    w = await _child(ctx, sub_id)
    org = await ctx.session.get(OrganizationModel, w.live_org_id)
    if body.billing is not None and body.billing not in sa.MODES:
        raise product_error(400, "bad_billing", "Choose the shared wallet or the sub-account's own wallet.")
    if body.name is not None:
        w.name = body.name.strip()
    sa.apply(
        org, ctx.workspace, w, mode=body.billing if body.billing != w.billing_mode else None,
        cap_value=None if body.clear_cap_value else (body.cap_value if body.cap_value is not None else ...),
        cap_minutes=None if body.clear_cap_minutes else (body.cap_minutes if body.cap_minutes is not None else ...),
        max_concurrent=None if body.clear_max_concurrent else (body.max_concurrent if body.max_concurrent is not None else ...),
    )
    await audit.record(ctx.session, ctx.workspace.id, ctx.user.id, "sub_account.changed", w.public_id, body.model_dump(exclude_none=True, exclude_defaults=True))
    await ctx.session.commit()
    return await _out(ctx, w)


@router.post("/{sub_id}/pause", response_model=SubOut)
async def pause(sub_id: str, ctx: Ctx = Depends(require(Perm.WORKSPACE_CREATE_CHILD))):
    w = await _child(ctx, sub_id)
    await sa.set_paused(ctx.session, w, True)
    await audit.record(ctx.session, ctx.workspace.id, ctx.user.id, "sub_account.paused", w.public_id)
    await ctx.session.commit()
    return await _out(ctx, w)


@router.post("/{sub_id}/resume", response_model=SubOut)
async def resume(sub_id: str, ctx: Ctx = Depends(require(Perm.WORKSPACE_CREATE_CHILD))):
    w = await _child(ctx, sub_id)
    await sa.set_paused(ctx.session, w, False)
    await audit.record(ctx.session, ctx.workspace.id, ctx.user.id, "sub_account.resumed", w.public_id)
    await ctx.session.commit()
    return await _out(ctx, w)
