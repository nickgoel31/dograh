"""Sign in with Google for the phone app.

The app cannot use the web's Google button or cookies, so it opens Google in the phone's secure browser sheet and gets back a one-time code:

  1. The app makes a random secret (verifier) and sends us its hash (challenge) to GET /start, which sends the person to Google.
  2. Google returns to GET /callback with a code. We swap it for the person's Google identity, sign them in (or create their account, exactly like the
     website's Google button) and send the browser back to the app as swarvo://auth?code=...
  3. The app posts that code and its verifier to POST /exchange and receives the same bearer token the password login returns.

The code works once, for two minutes, and only together with the verifier, so another app that sees the swarvo:// link cannot use it.
It needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (the same web client the website uses) and the callback address added to that client in Google Cloud.
POST /google also accepts a Google ID token directly, for a native Google button later (extra client ids can be listed in GOOGLE_MOBILE_CLIENT_IDS).
"""

from __future__ import annotations

import base64
import hashlib
import logging
import os
import re
import secrets
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

import jwt
from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.constants import OSS_JWT_SECRET
from api.db.models import UserModel
from api.db.product_models import ProductAuthTokenModel
from api.product import config
from api.product import google_auth
from api.product.deps import get_session
from api.product.errors import product_error
from api.product.oauth_router import _origin
from api.product.router import _client_ip, _me
from api.product.schemas import SetupOut
from api.product.service import list_workspaces
from api.utils import rate_limit

log = logging.getLogger(__name__)
router = APIRouter(prefix="/product/mobile/auth/google", tags=["mobile"])

CODE_KIND = "mobile_login"  # fits the table's 12-character kind column
CODE_LIFE = timedelta(minutes=2)
STATE_LIFE = timedelta(minutes=10)
CHALLENGE = re.compile(r"^[A-Za-z0-9_-]{43}$")  # base64url of a SHA-256


def app_scheme() -> str:
    return os.getenv("MOBILE_APP_SCHEME", "swarvo").strip().rstrip(":/") or "swarvo"


def _back(**params: str) -> RedirectResponse:
    return RedirectResponse(f"{app_scheme()}://auth?{urlencode(params)}", status_code=302, headers={"Cache-Control": "no-store"})


def _callback_url(request: Request) -> str:
    return f"{_origin(request)}/api/v1/product/mobile/auth/google/callback"


def _code_hash(code: str, challenge: str) -> str:
    return hashlib.sha256(f"{code}|{challenge}".encode()).hexdigest()


def challenge_of(verifier: str) -> str:
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()


@router.get("/start")
async def start(request: Request, challenge: str = Query(), session: AsyncSession = Depends(get_session)):
    """Sends the person to Google. ``challenge`` is the SHA-256 of a secret the app keeps (base64url)."""
    await rate_limit.enforce(f"pmgoogle:ip:{_client_ip(request)}", 40, 300, "Too many attempts. Try again in a few minutes.")
    client_id = os.getenv("GOOGLE_CLIENT_ID", "")
    if not client_id or not os.getenv("GOOGLE_CLIENT_SECRET"):
        return _back(error="not_set_up")
    if not CHALLENGE.match(challenge):
        return _back(error="bad_request")
    state = jwt.encode({"c": challenge, "p": "gstate", "n": secrets.token_hex(6), "exp": datetime.now(UTC) + STATE_LIFE}, OSS_JWT_SECRET, algorithm="HS256")
    q = urlencode({"client_id": client_id, "redirect_uri": _callback_url(request), "response_type": "code", "scope": "openid email profile", "state": state, "prompt": "select_account"})
    return RedirectResponse(f"https://accounts.google.com/o/oauth2/v2/auth?{q}", status_code=302, headers={"Cache-Control": "no-store"})


async def exchange_code(code: str, redirect_uri: str) -> str | None:
    """Google's id_token for an authorization code (a seam the tests replace)."""
    import httpx

    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post("https://oauth2.googleapis.com/token", data={"code": code, "client_id": os.getenv("GOOGLE_CLIENT_ID", ""), "client_secret": os.getenv("GOOGLE_CLIENT_SECRET", ""),
                                                                           "redirect_uri": redirect_uri, "grant_type": "authorization_code"})
        return r.json().get("id_token") if r.status_code == 200 else None
    except Exception:  # noqa: BLE001
        return None


@router.get("/callback")
async def callback(request: Request, state: str = Query(default=""), code: str = Query(default=""), error: str = Query(default=""), session: AsyncSession = Depends(get_session)):
    """Google sends the person back here. We finish the sign-in and hand a one-time code to the app."""
    try:
        st = jwt.decode(state, OSS_JWT_SECRET, algorithms=["HS256"])
        if st.get("p") != "gstate" or not CHALLENGE.match(str(st.get("c", ""))):
            raise ValueError("bad state")
    except Exception:  # noqa: BLE001
        return _back(error="bad_request")
    if error or not code:
        return _back(error="cancelled")
    id_token = await exchange_code(code, _callback_url(request))
    claims = await google_auth.verify_google_token(id_token) if id_token else None
    if claims is None:
        return _back(error="google_failed")
    try:
        user, created = await google_auth.user_from_claims(session, claims)
    except Exception as e:  # noqa: BLE001 - a blocked account (not switched on yet, company sign-in rules) is told plainly, not with a crash page
        detail = getattr(e, "detail", None)
        log.info("mobile google sign-in refused: %s", detail or e)
        return _back(error=detail.get("code", "google_failed") if isinstance(detail, dict) else "google_failed")
    raw = secrets.token_urlsafe(32)
    session.add(ProductAuthTokenModel(user_id=user.id, kind=CODE_KIND, token_hash=_code_hash(raw, st["c"]), expires_at=datetime.now(UTC) + CODE_LIFE))
    await session.commit()
    return _back(code=raw, **({"new": "1"} if created else {}))


class ExchangeIn(BaseModel):
    code: str = Field(min_length=20, max_length=100)
    verifier: str = Field(min_length=32, max_length=128)


class MobileLoginOut(BaseModel):
    token: str
    me: dict


async def _login_out(session: AsyncSession, user: UserModel) -> MobileLoginOut:
    from api.utils.auth import create_jwt_token

    if not await list_workspaces(session, user.id):
        raise product_error(403, "setup_required", "Finish setting up your account on the website first.")
    me = (await _me(session, user, None, config.DEFAULT_ENVIRONMENT)).model_dump(mode="json")
    return MobileLoginOut(token=create_jwt_token(user.id, user.email or "", "admin", False), me=me)


@router.post("/exchange", response_model=MobileLoginOut)
async def exchange(body: ExchangeIn, request: Request, session: AsyncSession = Depends(get_session)):
    await rate_limit.enforce(f"pmgoogle-x:ip:{_client_ip(request)}", 30, 300, "Too many attempts. Try again in a few minutes.")
    row = await session.scalar(select(ProductAuthTokenModel).where(ProductAuthTokenModel.token_hash == _code_hash(body.code, challenge_of(body.verifier)), ProductAuthTokenModel.kind == CODE_KIND))
    exp = row.expires_at.replace(tzinfo=UTC) if row is not None and row.expires_at.tzinfo is None else (row.expires_at if row is not None else None)
    if row is None or row.used_at is not None or exp < datetime.now(UTC):
        raise product_error(401, "google_failed", "That sign-in has expired. Please try again.")
    row.used_at = datetime.now(UTC)
    user = await session.get(UserModel, row.user_id)
    await session.commit()
    return await _login_out(session, user)


class CredentialIn(BaseModel):
    credential: str = Field(min_length=20, max_length=4000)


@router.post("", response_model=MobileLoginOut)
async def with_id_token(body: CredentialIn, request: Request, session: AsyncSession = Depends(get_session)):
    """Sign in with a Google ID token the app already has (a native Google button)."""
    await rate_limit.enforce(f"pmgoogle-t:ip:{_client_ip(request)}", 30, 300, "Too many attempts. Try again in a few minutes.")
    claims = await google_auth.verify_google_token(body.credential)
    if claims is None:
        raise product_error(401, "google_failed", "We couldn't sign you in with Google. Please try again.")
    user, _ = await google_auth.user_from_claims(session, claims)
    return await _login_out(session, user)
