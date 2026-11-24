"""WhatsApp follow-ups over HTTP: the rules a workspace sets up (per agent, per IVR menu, or for everything), a test message and the send log."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from api.db.product_models import ProductAgentModel, ProductBillingSettingsModel, ProductFollowupModel, ProductFollowupSendModel, ProductIvrModel
from api.product import followups as fu
from api.product import phone_verify, whatsapp
from api.product.deps import Ctx, get_ctx, require
from api.product.errors import product_error
from api.product.ids import new_public_id
from api.product.roles import Perm

router = APIRouter(prefix="/product/followups", tags=["followups"])


def get_wa_send():
    """The WhatsApp sender (a seam for tests)."""
    return whatsapp.send


class FollowupOut(BaseModel):
    id: str
    name: str
    enabled: bool
    source: str
    source_id: str | None
    source_name: str | None
    trigger: str
    message: str
    link: str | None
    delay_minutes: int
    cooldown_hours: int
    consent: bool
    sent: int
    failed: int


class FollowupIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    enabled: bool | None = None
    source: str | None = None
    source_id: str | None = Field(default=None, max_length=32)
    trigger: str | None = None
    message: str | None = Field(default=None, max_length=fu.MESSAGE_MAX)
    link: str | None = Field(default=None, max_length=300)
    delay_minutes: int | None = Field(default=None, ge=0, le=1440)
    cooldown_hours: int | None = Field(default=None, ge=0, le=720)
    consent: bool | None = None


async def _names(ctx: Ctx) -> dict[str, str]:
    a = (await ctx.session.execute(select(ProductAgentModel.public_id, ProductAgentModel.name).where(ProductAgentModel.workspace_id == ctx.workspace.id))).all()
    i = (await ctx.session.execute(select(ProductIvrModel.public_id, ProductIvrModel.name).where(ProductIvrModel.workspace_id == ctx.workspace.id))).all()
    return {**dict(a), **dict(i)}


async def _out(ctx: Ctx, r: ProductFollowupModel, names: dict[str, str]) -> FollowupOut:
    rows = dict((await ctx.session.execute(select(ProductFollowupSendModel.status, func.count(ProductFollowupSendModel.id)).where(ProductFollowupSendModel.followup_id == r.id).group_by(ProductFollowupSendModel.status))).all())
    return FollowupOut(id=r.public_id, name=r.name, enabled=r.enabled, source=r.source, source_id=r.source_id, source_name=names.get(r.source_id or ""), trigger=r.trigger,
                       message=r.message, link=r.link, delay_minutes=r.delay_minutes, cooldown_hours=r.cooldown_hours, consent=r.consent, sent=int(rows.get("sent", 0)), failed=int(rows.get("failed", 0)))


async def _get(ctx: Ctx, public_id: str) -> ProductFollowupModel:
    row = await ctx.session.scalar(select(ProductFollowupModel).where(ProductFollowupModel.public_id == public_id, ProductFollowupModel.workspace_id == ctx.workspace.id))
    if row is None:
        raise product_error(404, "followup_not_found", "We couldn't find that follow-up.")
    return row


async def _apply(ctx: Ctx, row: ProductFollowupModel, b: FollowupIn) -> None:
    if b.source is not None:
        if b.source not in fu.SOURCES:
            raise product_error(400, "bad_source", "Choose all calls, one agent, or one phone menu.")
        if b.source != row.source and b.source_id is None:
            row.source_id = None  # a different kind of source needs its own pick
        row.source = b.source
    if row.source == "all":
        row.source_id = None
    else:
        if b.source_id is not None:
            row.source_id = b.source_id
        agents = (await ctx.session.scalars(select(ProductAgentModel.public_id).where(ProductAgentModel.workspace_id == ctx.workspace.id))).all()
        menus = (await ctx.session.scalars(select(ProductIvrModel.public_id).where(ProductIvrModel.workspace_id == ctx.workspace.id))).all()
        if not row.source_id or row.source_id not in (agents if row.source == "agent" else menus):
            raise product_error(400, "bad_source", "Choose which agent or menu this is for.")
    if b.trigger is not None:
        if b.trigger not in fu.TRIGGERS:
            raise product_error(400, "bad_trigger", "Choose when to send the message.")
        row.trigger = b.trigger
    for k in ("name", "message", "delay_minutes", "cooldown_hours", "consent"):
        v = getattr(b, k)
        if v is not None:
            setattr(row, k, v.strip() if isinstance(v, str) else v)
    if b.link is not None:
        link = b.link.strip()
        if link and not link.lower().startswith("https://"):
            raise product_error(400, "bad_link", "The link should start with https://")
        row.link = link or None
    if b.enabled is not None:
        if b.enabled and not row.consent:
            raise product_error(400, "consent_needed", "Confirm that callers are told they will get this message before you turn it on.")
        if b.enabled and not (row.message or "").strip():
            raise product_error(400, "message_needed", "Write the message first.")
        row.enabled = b.enabled
    if row.enabled and (not row.consent or not (row.message or "").strip()):
        row.enabled = False  # a rule that lost its message or its confirmation never keeps sending


@router.get("/status")
async def status(ctx: Ctx = Depends(get_ctx)):
    s = await ctx.session.get(ProductBillingSettingsModel, ctx.workspace.id)
    return {"whatsapp_ready": whatsapp.configured(), "test_number": phone_verify.mask(s.verified_phone) if s and s.verified_phone else None, "variables": list(fu.VARIABLES),
            "triggers": list(fu.TRIGGERS), "daily_cap": fu.daily_cap()}


@router.get("", response_model=list[FollowupOut])
async def list_followups(ctx: Ctx = Depends(get_ctx)):
    names = await _names(ctx)
    rows = (await ctx.session.scalars(select(ProductFollowupModel).where(ProductFollowupModel.workspace_id == ctx.workspace.id).order_by(ProductFollowupModel.id))).all()
    return [await _out(ctx, r, names) for r in rows]


@router.post("", response_model=FollowupOut, status_code=201)
async def create(body: FollowupIn, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE))):
    n = await ctx.session.scalar(select(func.count(ProductFollowupModel.id)).where(ProductFollowupModel.workspace_id == ctx.workspace.id)) or 0
    if n >= 30:
        raise product_error(400, "too_many", "You can have up to 30 follow-ups. Delete one you no longer use.")
    row = ProductFollowupModel(public_id=new_public_id("fup"), workspace_id=ctx.workspace.id, name=(body.name or "New follow-up").strip(), enabled=False, source="all", trigger="any", message="")
    ctx.session.add(row)
    await _apply(ctx, row, body.model_copy(update={"name": None, "enabled": None}))
    await ctx.session.commit()
    return await _out(ctx, row, await _names(ctx))


@router.patch("/{followup_id}", response_model=FollowupOut)
async def change(followup_id: str, body: FollowupIn, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE))):
    row = await _get(ctx, followup_id)
    await _apply(ctx, row, body)
    await ctx.session.commit()
    return await _out(ctx, row, await _names(ctx))


@router.delete("/{followup_id}", status_code=204)
async def remove(followup_id: str, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE))):
    await ctx.session.delete(await _get(ctx, followup_id))
    await ctx.session.commit()


@router.post("/{followup_id}/test")
async def send_test(followup_id: str, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE)), wa_send=Depends(get_wa_send)):
    """Send this message, with example values, to the workspace's own verified WhatsApp number."""
    row = await _get(ctx, followup_id)
    s = await ctx.session.get(ProductBillingSettingsModel, ctx.workspace.id)
    if not s or not s.verified_phone:
        raise product_error(400, "no_test_number", "Verify your own WhatsApp number first (it happens when you sign up), then you can send yourself a test.")
    if not whatsapp.configured() and wa_send is whatsapp.send:
        raise product_error(503, "whatsapp_off", "WhatsApp sending isn't switched on for the platform yet. Please contact support.")
    text = fu.render(row.message, {"name": "Alex", "business": ctx.workspace.name, "agent": "your agent", "caller": s.verified_phone, "payment_link": row.link or "", "summary": "A short summary of the call."})
    if not text:
        raise product_error(400, "message_needed", "Write the message first.")
    ok = await wa_send(s.verified_phone, text, row.link)
    if not ok:
        raise product_error(502, "send_failed", "WhatsApp did not accept the test message. Check that the message templates are approved.")
    return {"ok": True, "preview": text}


@router.get("/{followup_id}/sends")
async def sends(followup_id: str, limit: int = Query(default=30, le=100), ctx: Ctx = Depends(get_ctx)):
    row = await _get(ctx, followup_id)
    rows = (await ctx.session.scalars(select(ProductFollowupSendModel).where(ProductFollowupSendModel.followup_id == row.id).order_by(ProductFollowupSendModel.id.desc()).limit(limit))).all()
    return [{"phone": ("•" * (len(r.phone) - 4) + r.phone[-4:]) if len(r.phone) > 4 else r.phone, "status": r.status, "reason": r.reason, "call": r.call_key, "at": r.at.isoformat() if r.at else None} for r in rows]
