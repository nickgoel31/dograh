"""Request context: who is calling, in which workspace, in which environment."""

from dataclasses import dataclass
from typing import AsyncIterator

from fastapi import Depends, Header, Request
from sqlalchemy.ext.asyncio import AsyncSession

from api.db.models import UserModel
from api.db.product_models import ProductWorkspaceModel
from api.product import config
from api.product.errors import product_error
from api.product.roles import Perm, can
from api.product.service import default_view, list_workspaces, org_for_environment
from api.utils.auth import decode_jwt_token


async def get_session() -> AsyncIterator[AsyncSession]:
    from api.db import db_client

    async with db_client.async_session() as session:
        yield session


@dataclass
class Ctx:
    session: AsyncSession
    user: UserModel
    workspace: ProductWorkspaceModel
    role: str
    environment: str

    @property
    def org_id(self) -> int:
        """The platform organization every core query for this request must use."""
        return org_for_environment(self.workspace, self.environment)


def _token_from(request: Request, authorization: str | None) -> str | None:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:]
    return request.cookies.get(config.SESSION_COOKIE_NAME)


async def get_user_only(
    request: Request,
    authorization: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> tuple[AsyncSession, UserModel]:
    token = _token_from(request, authorization)
    if not token:
        raise product_error(401, "not_signed_in", "Please sign in to continue.")
    try:
        payload = decode_jwt_token(token)
        user = await session.get(UserModel, int(payload["sub"]))
    except Exception:
        user = None
    if user is None:
        raise product_error(401, "session_expired", "Your session has expired. Please sign in again.")
    return session, user


async def get_ctx(
    x_workspace: str | None = Header(default=None, alias=config.WORKSPACE_HEADER),
    x_environment: str | None = Header(default=None, alias=config.ENVIRONMENT_HEADER),
    base: tuple[AsyncSession, UserModel] = Depends(get_user_only),
) -> Ctx:
    session, user = base
    environment = (x_environment or config.DEFAULT_ENVIRONMENT).lower()
    if environment not in ("test", "live"):
        raise product_error(400, "bad_environment", "Environment must be 'test' or 'live'.")

    views = await list_workspaces(session, user.id)
    if not views:
        raise product_error(403, "no_workspace", "You don't belong to a workspace yet.")
    if x_workspace is None:
        chosen = default_view(views)
    else:
        # Only workspaces the caller belongs to are considered, so someone
        # else's id is indistinguishable from a missing one.
        chosen = next((v for v in views if v.workspace.public_id == x_workspace), None)
        if chosen is None:
            raise product_error(404, "workspace_not_found", "We couldn't find that workspace.")
    return Ctx(session, user, chosen.workspace, chosen.role, environment)


def require(perm: Perm):
    async def _dep(ctx: Ctx = Depends(get_ctx)) -> Ctx:
        if not can(ctx.role, perm):
            raise product_error(
                403, "not_allowed", "You don't have permission to do that. Ask a workspace owner."
            )
        return ctx

    return _dep
