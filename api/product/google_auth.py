"""Sign in with Google. The browser gets a signed ID token from Google; we check it with Google, then sign the person in
(creating a new account and workspace the first time). Needs GOOGLE_CLIENT_ID."""

import os
import uuid

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.db.models import UserModel
from api.db.product_models import ProductUserProfileModel
from api.product import config, rollout
from api.product.deps import get_session
from api.product.errors import product_error
from api.product.router import _client_ip, _me, _set_session
from api.product.schemas import SetupOut, UserOut
from api.product.ids import user_public_id
from api.product.service import create_workspace, get_display_name, list_workspaces
from api.utils import rate_limit

router = APIRouter(prefix="/product/auth", tags=["auth"])


class GoogleBody(BaseModel):
    credential: str = Field(min_length=20, max_length=4000)


async def verify_google_token(credential: str) -> dict | None:
    """Claims of a valid Google ID token for this app, else None. Google checks the signature; we check audience and email."""
    import httpx

    client_id = os.getenv("GOOGLE_CLIENT_ID", "")
    if not client_id:
        return None
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get("https://oauth2.googleapis.com/tokeninfo", params={"id_token": credential})
        claims = r.json() if r.status_code == 200 else None
    except Exception:  # noqa: BLE001
        return None
    if not claims or claims.get("aud") != client_id or str(claims.get("email_verified")).lower() != "true" or not claims.get("email"):
        return None
    return claims


@router.get("/config")
async def auth_config():
    return {"google_client_id": os.getenv("GOOGLE_CLIENT_ID") or None}


@router.post("/google")
async def google_login(body: GoogleBody, request: Request, response: Response, session: AsyncSession = Depends(get_session)):
    await rate_limit.enforce(f"pgoogle:ip:{_client_ip(request)}", 30, 300, "Too many attempts. Try again in a few minutes.")
    claims = await verify_google_token(body.credential)
    if claims is None:
        raise product_error(401, "google_failed", "We couldn't sign you in with Google. Please try again.")
    email = claims["email"].lower()
    user = await session.scalar(select(UserModel).where(UserModel.email == email))
    if user is None:
        user = UserModel(provider_id=f"usr_{uuid.uuid4().hex}", email=email, password_hash=None, role="admin")
        session.add(user)
        await session.flush()
        name = claims.get("name") or email.split("@")[0]
        session.add(ProductUserProfileModel(user_id=user.id, display_name=name))
        await create_workspace(session, user, f"{name}'s workspace")
        await session.commit()
    elif await rollout.is_held_back(session, user):
        raise product_error(403, "not_enabled", rollout.NOT_ENABLED)
    _set_session(response, user)
    if not await list_workspaces(session, user.id):
        return SetupOut(user=UserOut(id=user_public_id(user.provider_id), email=user.email, name=await get_display_name(session, user.id)))
    return await _me(session, user, None, config.DEFAULT_ENVIRONMENT)
