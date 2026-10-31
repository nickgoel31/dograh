"""Switch between the classic UI and the new one without logging in twice.

A short-lived, single-use code is exchanged for a session on the other side. The code is signed with a *different*
key than sessions, so it can never be used as a session token itself.
"""

import uuid
from datetime import UTC, datetime, timedelta

import jwt
from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from api.constants import OSS_JWT_SECRET
from api.db.models import UserModel
from api.product import rollout
from api.product.deps import get_session, get_user_only
from api.product.errors import product_error
from api.product.router import _set_session
from api.utils import rate_limit
from api.utils.auth import create_jwt_token

router = APIRouter(prefix="/product/auth/handoff", tags=["handoff"])
TTL_SECONDS = 90
_KEY = OSS_JWT_SECRET + ":handoff"


class StartBody(BaseModel):
    to: str = Field(pattern="^(product|classic)$")


class RedeemBody(BaseModel):
    code: str = Field(max_length=2000)
    to: str = Field(pattern="^(product|classic)$")


@router.post("")
async def start(body: StartBody, base=Depends(get_user_only)):
    """Needs a signed-in session on either side (cookie or bearer token)."""
    session, user = base
    if body.to == "product" and not await rollout.user_eligible(session, user):
        raise product_error(403, "not_enabled", rollout.NOT_ENABLED)
    code = jwt.encode(
        {"sub": str(user.id), "aud": body.to, "jti": uuid.uuid4().hex, "exp": datetime.now(UTC) + timedelta(seconds=TTL_SECONDS)},
        _KEY, algorithm="HS256",
    )
    return {"code": code}


@router.get("/eligible")
async def eligible(base=Depends(get_user_only)):
    """Whether this person may be offered the switch to the new experience (the classic UI asks before showing it)."""
    session, user = base
    return {"eligible": await rollout.user_eligible(session, user)}


@router.post("/redeem")
async def redeem(body: RedeemBody, response: Response, session: AsyncSession = Depends(get_session)):
    bad = product_error(400, "handoff_expired", "That link expired. Go back and switch again.")
    try:
        c = jwt.decode(body.code, _KEY, algorithms=["HS256"], audience=body.to)
    except jwt.PyJWTError:
        raise bad
    # Single use: the first redemption wins, a second one with the same code is refused.
    if not await rate_limit.hit(f"handoff:{c['jti']}", 1, 300):
        raise bad
    user = await session.get(UserModel, int(c["sub"]))
    if user is None:
        raise bad
    if body.to == "product":
        _set_session(response, user)
        return {"ok": True}
    return {
        "token": create_jwt_token(user.id, user.email or "", user.role, bool(user.is_superuser)),
        "user": {"id": user.id, "email": user.email, "name": user.email, "organizationId": user.selected_organization_id},
    }
