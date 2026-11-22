"""Swarvo Pixel devices over HTTP: signing in with a device id and code, the device list and settings in a workspace, and the owner's tools
for making, switching off and re-keying devices. The device's own live connection is in pixel_ws.py."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select

from api.db.product_models import ProductAgentModel, ProductPixelModel, ProductPixelSessionModel
from api.product import config, pixels
from api.product.admin_router import require_admin
from api.product.deps import Ctx, get_ctx, get_session, require
from api.product.errors import product_error
from api.product.ids import encode_call_id
from api.product.roles import Perm
from api.product.schemas import MeOut
from api.utils import rate_limit
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/product", tags=["pixels"])


class PixelLoginBody(BaseModel):
    device_id: str = Field(min_length=3, max_length=40)
    code: str = Field(min_length=8, max_length=40)


@router.post("/auth/pixel", response_model=MeOut)
async def pixel_login(body: PixelLoginBody, request: Request, response: Response, session: AsyncSession = Depends(get_session)):
    """Sign in with a device's id and activation code. The first time, this creates the device's account."""
    from api.product.router import _client_ip, _me, _set_session

    msg = "Too many attempts. Try again in a few minutes."
    await rate_limit.enforce(f"ppixel:ip:{_client_ip(request)}", 20, 300, msg)
    await rate_limit.enforce(f"ppixel:{pixels.clean_device_id(body.device_id)}", 10, 300, msg)
    device = await pixels.authenticate(session, body.device_id, body.code)
    if device is None:
        raise product_error(401, "bad_device", "That device id or activation code isn't right. Check the card that came with your device.")
    if device.status == "revoked":
        raise product_error(403, "device_off", "This device has been switched off. Contact support.")
    user = await pixels.sign_in(session, device)
    await session.commit()
    _set_session(response, user)
    return await _me(session, user, None, config.DEFAULT_ENVIRONMENT)


# ---------------- the devices of a workspace ----------------
class PixelOut(BaseModel):
    id: str  # the printed device id
    name: str
    status: str
    online: bool
    last_seen: str | None
    fw: str
    agent_id: str | None
    agent_name: str | None
    sessions: int
    minutes: float
    minutes_today: float


class PixelPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    agent_id: str | None = None
    clear_agent: bool = False


class PixelSessionOut(BaseModel):
    started: str
    seconds: int
    ended: str | None
    reason: str
    call_id: str | None


async def _mine(ctx: Ctx, device_id: str) -> ProductPixelModel:
    d = await pixels.find(ctx.session, device_id)
    if d is None or d.workspace_id != ctx.workspace.id:
        raise product_error(404, "device_not_found", "We couldn't find that device.")
    return d


@router.get("/pixels", response_model=list[PixelOut])
async def my_pixels(ctx: Ctx = Depends(get_ctx)):
    rows = (await ctx.session.scalars(select(ProductPixelModel).where(ProductPixelModel.workspace_id == ctx.workspace.id).order_by(ProductPixelModel.id))).all()
    agents = {a.id: a for a in (await ctx.session.scalars(select(ProductAgentModel).where(ProductAgentModel.workspace_id == ctx.workspace.id))).all()}
    use = await pixels.usage(ctx.session, [r.id for r in rows])
    now = datetime.now(UTC)
    return [PixelOut(id=r.device_id, name=r.name or r.device_id, status=r.status, online=r.status != "revoked" and pixels.is_online(r, now),
                     last_seen=r.last_seen_at.isoformat() if r.last_seen_at else None, fw=r.fw,
                     agent_id=agents[r.agent_id].public_id if r.agent_id in agents else None, agent_name=agents[r.agent_id].name if r.agent_id in agents else None,
                     **use[r.id]) for r in rows]


@router.patch("/pixels/{device_id}", response_model=PixelOut)
async def change_pixel(device_id: str, body: PixelPatch, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE))):
    d = await _mine(ctx, device_id)
    if body.name is not None:
        d.name = body.name.strip()
    if body.clear_agent:
        d.agent_id = None
    elif body.agent_id is not None:
        a = await ctx.session.scalar(select(ProductAgentModel).where(ProductAgentModel.public_id == body.agent_id, ProductAgentModel.workspace_id == ctx.workspace.id))
        if a is None:
            raise product_error(404, "agent_not_found", "We couldn't find that agent.")
        d.agent_id = a.id
    await ctx.session.commit()
    return next(p for p in await my_pixels(ctx) if p.id == d.device_id)


@router.get("/pixels/{device_id}/sessions", response_model=list[PixelSessionOut])
async def pixel_sessions(device_id: str, limit: int = Query(default=20, ge=1, le=100), ctx: Ctx = Depends(get_ctx)):
    d = await _mine(ctx, device_id)
    rows = (await ctx.session.scalars(select(ProductPixelSessionModel).where(ProductPixelSessionModel.pixel_id == d.id).order_by(ProductPixelSessionModel.id.desc()).limit(limit))).all()
    return [PixelSessionOut(started=r.started_at.isoformat() if r.started_at else "", seconds=r.seconds or 0, ended=r.ended_at.isoformat() if r.ended_at else None,
                            reason=r.end_reason or "", call_id=encode_call_id(r.run_id) if r.run_id else None) for r in rows]


# ---------------- the owner's tools ----------------
admin = APIRouter(prefix="/product/admin/pixels", tags=["admin"])


class MakeBody(BaseModel):
    count: int = Field(ge=1, le=500)
    prefix: str = Field(default="SWARVO", max_length=12)
    batch: str = Field(default="", max_length=60)


@admin.post("")
async def make_pixels(body: MakeBody, base=Depends(require_admin)):
    """New devices. The response is the only place the activation codes are ever shown: print them on the cards."""
    session, _ = base
    made = await pixels.create_batch(session, count=body.count, prefix=body.prefix, batch=body.batch)
    await session.commit()
    return [{"device_id": d.device_id, "code": code} for d, code in made]


@admin.get("")
async def all_pixels(base=Depends(require_admin)):
    session, _ = base
    rows = (await session.scalars(select(ProductPixelModel).order_by(ProductPixelModel.id.desc()).limit(500))).all()
    now = datetime.now(UTC)
    return [{"device_id": r.device_id, "name": r.name, "status": r.status, "batch": r.batch, "online": r.status != "revoked" and pixels.is_online(r, now),
             "last_seen": r.last_seen_at.isoformat() if r.last_seen_at else None, "claimed": r.claimed_at is not None, "fw": r.fw} for r in rows]


async def _admin_device(session, device_id: str) -> ProductPixelModel:
    d = await pixels.find(session, device_id)
    if d is None:
        raise product_error(404, "device_not_found", "No device with that id.")
    return d


@admin.post("/{device_id}/off")
async def switch_off(device_id: str, base=Depends(require_admin)):
    session, _ = base
    d = await _admin_device(session, device_id)
    d.status = "revoked"
    d.conn_id = None  # a connected device is dropped on its next check
    await session.commit()
    return {"ok": True}


@admin.post("/{device_id}/on")
async def switch_on(device_id: str, base=Depends(require_admin)):
    session, _ = base
    d = await _admin_device(session, device_id)
    d.status = "active" if d.claimed_at else "ready"
    await session.commit()
    return {"ok": True}


@admin.post("/{device_id}/new-code")
async def new_code(device_id: str, base=Depends(require_admin)):
    """A new activation code (the old one stops working at once, on the web and on the device)."""
    session, _ = base
    d = await _admin_device(session, device_id)
    code = pixels.new_code()
    d.code_hash = pixels.hash_code(code)
    d.conn_id = None
    await session.commit()
    return {"device_id": d.device_id, "code": code}
