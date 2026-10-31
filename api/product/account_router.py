"""Forgot password, reset, and email verification. Links are single-use and expire; only a hash is stored."""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.db.models import UserModel
from api.db.product_models import ProductAuthTokenModel, ProductUserProfileModel
from api.product import emailer
from api.product.deps import get_session, get_user_only
from api.product.errors import product_error
from api.product.router import _client_ip
from api.utils import rate_limit
from api.utils.auth import hash_password

router = APIRouter(prefix="/product/auth", tags=["account"])
RESET_HOURS, VERIFY_DAYS = 1, 3


class ForgotBody(BaseModel):
    email: EmailStr


class ResetBody(BaseModel):
    token: str = Field(min_length=10, max_length=100)
    password: str = Field(min_length=8, max_length=128)


class TokenBody(BaseModel):
    token: str = Field(min_length=10, max_length=100)


def _hash(t: str) -> str:
    return hashlib.sha256(t.encode()).hexdigest()


async def make_token(session: AsyncSession, user_id: int, kind: str, ttl: timedelta) -> str:
    token = secrets.token_urlsafe(32)
    session.add(ProductAuthTokenModel(user_id=user_id, kind=kind, token_hash=_hash(token), expires_at=datetime.now(UTC) + ttl))
    await session.flush()
    return token


async def take_token(session: AsyncSession, token: str, kind: str) -> ProductAuthTokenModel | None:
    row = await session.scalar(select(ProductAuthTokenModel).where(ProductAuthTokenModel.token_hash == _hash(token), ProductAuthTokenModel.kind == kind))
    if row is None or row.used_at is not None:
        return None
    exp = row.expires_at if row.expires_at.tzinfo else row.expires_at.replace(tzinfo=UTC)
    if exp < datetime.now(UTC):
        return None
    row.used_at = datetime.now(UTC)
    return row


async def send_verification(session: AsyncSession, mailer: emailer.Mailer, user: UserModel) -> bool:
    token = await make_token(session, user.id, "verify", timedelta(days=VERIFY_DAYS))
    link = f"{emailer.app_url()}/verify?token={token}"
    return await mailer.send(user.email, "Confirm your email", f"Confirm your email address: {link}",
                             emailer.wrap("Confirm your email", "<p>Press the button to confirm this email address.</p>", ("Confirm email", link)))


@router.post("/forgot")
async def forgot(body: ForgotBody, request: Request, session: AsyncSession = Depends(get_session), mailer: emailer.Mailer = Depends(emailer.get_mailer)):
    """Always answers the same, so nobody can find out which emails have accounts."""
    await rate_limit.enforce(f"pforgot:ip:{_client_ip(request)}", 10, 3600, "Too many attempts. Try again later.")
    await rate_limit.enforce(f"pforgot:{body.email.lower()}", 3, 3600, "Too many attempts. Try again later.")
    user = await session.scalar(select(UserModel).where(UserModel.email == body.email.lower()))
    if user is not None and mailer.enabled:
        token = await make_token(session, user.id, "reset", timedelta(hours=RESET_HOURS))
        link = f"{emailer.app_url()}/reset?token={token}"
        await session.commit()
        await mailer.send(user.email, "Reset your password", f"Reset your password: {link}\nThis link works once, for {RESET_HOURS} hour.",
                          emailer.wrap("Reset your password", f"<p>Press the button to choose a new password. The link works once and expires in {RESET_HOURS} hour. If you didn't ask for this, ignore this email.</p>", ("Choose a new password", link)))
    return {"ok": True, "message": "If that email has an account, we've sent a link to reset the password."}


@router.post("/reset")
async def reset(body: ResetBody, session: AsyncSession = Depends(get_session)):
    row = await take_token(session, body.token, "reset")
    if row is None:
        raise product_error(400, "link_expired", "That link has expired or was already used. Ask for a new one.")
    user = await session.get(UserModel, row.user_id)
    user.password_hash = hash_password(body.password)
    await session.commit()
    return {"ok": True}


@router.post("/verify/send")
async def verify_send(base=Depends(get_user_only), mailer: emailer.Mailer = Depends(emailer.get_mailer)):
    session, user = base
    if not mailer.enabled:
        raise product_error(503, "email_off", "We can't send emails right now. Please try again later.")
    sent = await send_verification(session, mailer, user)
    await session.commit()
    return {"ok": sent}


@router.post("/verify")
async def verify(body: TokenBody, session: AsyncSession = Depends(get_session)):
    row = await take_token(session, body.token, "verify")
    if row is None:
        raise product_error(400, "link_expired", "That link has expired or was already used. Ask for a new one.")
    profile = await session.get(ProductUserProfileModel, row.user_id)
    if profile is None:
        profile = ProductUserProfileModel(user_id=row.user_id)
        session.add(profile)
    profile.email_verified_at = datetime.now(UTC)
    await session.commit()
    return {"ok": True}
