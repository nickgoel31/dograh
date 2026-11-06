"""The signed-in person's own account: name, email (and whether it is verified), WhatsApp number, timezone and password.

Separate from the workspace: this is about the person, so it works the same in every workspace they belong to.
"""

from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from api.db.product_models import ProductUserProfileModel
from api.product import phone_verify as pv
from api.product.deps import get_user_only
from api.product.errors import product_error
from api.product.router import _client_ip
from api.utils import rate_limit
from api.utils.auth import hash_password, verify_password

router = APIRouter(prefix="/product/account", tags=["account"])


async def _profile(session, user) -> ProductUserProfileModel:
    p = await session.get(ProductUserProfileModel, user.id)
    if p is None:
        p = ProductUserProfileModel(user_id=user.id, display_name=(user.email or "").split("@")[0] or None)
        session.add(p)
        await session.flush()
    return p


def _out(user, p: ProductUserProfileModel) -> dict:
    has_password = bool(user.password_hash)
    return {
        "name": p.display_name,
        "email": user.email,
        # Someone who only ever signed in with Google has no password, and Google has already checked their address.
        "email_verified": p.email_verified_at is not None or not has_password,
        "sign_in": "password" if has_password else "google",
        "has_password": has_password,
        "phone": pv.mask(p.verified_phone),
        "phone_verified": p.phone_verified_at is not None,
        "phone_pending": pv.mask(p.otp_phone) if p.otp_hash and p.otp_expires_at and pv._aware(p.otp_expires_at) > pv.now() else None,
        "whatsapp_ready": pv.configured(),
        "timezone": p.timezone,
        "two_step": bool(p.totp_enabled),
        "member_since": getattr(user, "created_at", None),
    }


@router.get("")
async def account(base=Depends(get_user_only)):
    session, user = base
    p = await _profile(session, user)
    await session.commit()
    return _out(user, p)


class ProfileBody(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    timezone: str | None = Field(default=None, max_length=64)


@router.patch("/profile")
async def update_profile(body: ProfileBody, base=Depends(get_user_only)):
    session, user = base
    p = await _profile(session, user)
    if body.name is not None:
        name = " ".join(body.name.split())
        if not name:
            raise product_error(400, "bad_name", "Enter your name.")
        p.display_name = name
    if body.timezone is not None:
        if body.timezone == "":
            p.timezone = None
        else:
            try:
                ZoneInfo(body.timezone)
            except Exception:  # noqa: BLE001
                raise product_error(400, "bad_timezone", "Pick a timezone from the list.")
            p.timezone = body.timezone
    await session.commit()
    return _out(user, p)


class PhoneStart(BaseModel):
    phone: str = Field(min_length=6, max_length=24)


class PhoneCheck(BaseModel):
    code: str = Field(min_length=4, max_length=10)


@router.post("/phone/start")
async def phone_start(body: PhoneStart, request: Request, base=Depends(get_user_only), sender: pv.OtpSender = Depends(pv.get_sender)):
    session, user = base
    await rate_limit.enforce(f"pphone:{user.id}", 10, 3600, "Too many attempts. Try again later.")
    p = await _profile(session, user)

    async def taken(phone: str) -> bool:
        return bool(await session.scalar(select(ProductUserProfileModel.user_id).where(ProductUserProfileModel.verified_phone == phone, ProductUserProfileModel.user_id != user.id)))

    try:
        await pv.start(session, _Salt(user.id), p, body.phone, sender, taken=taken, change=True)  # a verified number can be replaced by proving a new one
    except pv.VerifyError as e:
        await session.rollback()
        raise product_error(e.status, e.code, e.message)
    await session.commit()
    return _out(user, p)


class _Salt:
    """Gives the phone check something to salt the code with: the person, not a workspace."""

    def __init__(self, user_id: int):
        self.id = f"u{user_id}"


@router.post("/phone/check")
async def phone_check(body: PhoneCheck, base=Depends(get_user_only)):
    session, user = base
    p = await _profile(session, user)
    try:
        pv.check(_Salt(user.id), p, body.code, change=True)
    except pv.VerifyError as e:
        await session.commit()  # keep the wrong-guess count
        raise product_error(e.status, e.code, e.message)
    try:
        await session.commit()
    except IntegrityError:  # someone proved this very number a moment ago
        await session.rollback()
        raise product_error(409, "phone_in_use", "That number is already used by another account. Use a different WhatsApp number.")
    return _out(user, p)


@router.delete("/phone")
async def phone_remove(base=Depends(get_user_only)):
    session, user = base
    p = await _profile(session, user)
    p.verified_phone = p.phone_verified_at = p.otp_phone = p.otp_hash = p.otp_expires_at = None
    await session.commit()
    return _out(user, p)


class PasswordBody(BaseModel):
    current: str | None = Field(default=None, max_length=128)
    new: str = Field(min_length=8, max_length=128)


@router.post("/password")
async def change_password(body: PasswordBody, request: Request, base=Depends(get_user_only)):
    session, user = base
    await rate_limit.enforce(f"ppass:{user.id}", 8, 3600, "Too many attempts. Try again later.")
    if user.password_hash:  # changing a password needs the current one; someone who only used Google can simply set a first one
        if not body.current or not verify_password(body.current, user.password_hash):
            raise product_error(400, "wrong_password", "Your current password isn't right.")
    user.password_hash = hash_password(body.new)
    await session.commit()
    p = await _profile(session, user)
    return _out(user, p)
