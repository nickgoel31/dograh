"""WhatsApp number check for new accounts (see phone_verify.py). Any member of the workspace can do it."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError

from api.product import billing as bl
from api.product import phone_verify as pv
from api.product.deps import Ctx, get_ctx
from api.product.errors import product_error
from api.product.payments import WalletGateway, get_wallet

router = APIRouter(prefix="/product/verify", tags=["verify"])


class StatusOut(BaseModel):
    required: bool  # true = the app must show the number check before anything else
    verified: bool
    phone: str | None = None  # the verified number, partly hidden
    pending_phone: str | None = None  # a code was sent here and is waiting
    bonus: float = 0.0  # what they get once the number is verified


class StartIn(BaseModel):
    phone: str = Field(min_length=6, max_length=24)


class CheckIn(BaseModel):
    code: str = Field(min_length=4, max_length=10)


async def _status(ctx: Ctx) -> StatusOut:
    s = await bl.get_settings(ctx.session, ctx.workspace)
    req = pv.required(ctx.workspace, s)
    waiting = bool(s.otp_hash and s.otp_expires_at and pv._aware(s.otp_expires_at) > pv.now())
    return StatusOut(required=req, verified=s.phone_verified_at is not None, phone=pv.mask(s.verified_phone),
                     pending_phone=pv.mask(s.otp_phone) if waiting else None, bonus=bl.signup_bonus() if req else 0.0)


@router.get("", response_model=StatusOut)
async def status(ctx: Ctx = Depends(get_ctx)):
    out = await _status(ctx)
    await ctx.session.commit()  # the settings row may have just been created
    return out


@router.post("/start", response_model=StatusOut)
async def start(body: StartIn, ctx: Ctx = Depends(get_ctx), sender: pv.OtpSender = Depends(pv.get_sender)):
    s = await bl.get_settings(ctx.session, ctx.workspace)
    try:
        await pv.start(ctx.session, ctx.workspace, s, body.phone, sender)
    except pv.VerifyError as e:
        await ctx.session.rollback()
        raise product_error(e.status, e.code, e.message)
    await ctx.session.commit()
    return await _status(ctx)


@router.post("/check", response_model=StatusOut)
async def check(body: CheckIn, ctx: Ctx = Depends(get_ctx), wallet: WalletGateway = Depends(get_wallet)):
    s = await bl.get_settings(ctx.session, ctx.workspace)
    try:
        pv.check(ctx.workspace, s, body.code)
    except pv.VerifyError as e:
        await ctx.session.commit()  # keep the wrong-guess count
        raise product_error(e.status, e.code, e.message)
    try:
        await ctx.session.commit()
    except IntegrityError:  # someone else verified this very number a moment ago
        await ctx.session.rollback()
        raise product_error(409, "phone_in_use", "That number is already used by another account. Use a different WhatsApp number.")
    await bl.ensure_billing(ctx.session, wallet, ctx.workspace)  # the sign-up bonus was waiting for this
    await ctx.session.commit()
    return await _status(ctx)
