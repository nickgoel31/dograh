import uuid

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.db.models import UserModel
from api.db.product_models import ProductUserProfileModel
from api.product import config, totp
from api.product.deps import Ctx, get_ctx, get_session, get_user_only
from api.product.errors import product_error
from api.product.ids import user_public_id
from api.product.roles import MATRIX, Role
from api.product.schemas import (
    LoginBody,
    MeOut,
    SetupOut,
    SignupBody,
    UserOut,
    WorkspaceCreateBody,
    WorkspaceOut,
)
from api.product.service import (
    create_workspace,
    default_view,
    get_display_name,
    list_workspaces,
)
from api.utils import rate_limit
from api.utils.auth import create_jwt_token, hash_password, verify_password

router = APIRouter(prefix="/product", tags=["product"])

# Computed once so login timing doesn't reveal whether an email exists.
_DUMMY_HASH = hash_password("timing-equalisation")


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _set_session(response: Response, user: UserModel) -> None:
    token = create_jwt_token(user.id, user.email or "", "admin", False)
    response.set_cookie(
        config.SESSION_COOKIE_NAME,
        token,
        max_age=config.SESSION_MAX_AGE_SECONDS,
        httponly=True,
        secure=config.SESSION_COOKIE_SECURE,
        samesite=config.SESSION_COOKIE_SAMESITE,
        path="/",
    )


async def _me(session: AsyncSession, user: UserModel, workspace_id: str | None, env: str) -> MeOut:
    views = await list_workspaces(session, user.id)
    cur = next((v for v in views if v.workspace.public_id == workspace_id), None) or default_view(views)
    return MeOut(
        user=UserOut(
            id=user_public_id(user.provider_id),
            email=user.email,
            name=await get_display_name(session, user.id),
        ),
        workspaces=[
            WorkspaceOut(id=v.workspace.public_id, name=v.workspace.name, role=v.role) for v in views
        ],
        current_workspace=WorkspaceOut(
            id=cur.workspace.public_id, name=cur.workspace.name, role=cur.role
        ),
        environment=env,
        permissions=sorted(p.value for p in MATRIX[Role(cur.role)]),
        plan="free",
        feature_flags={"sso": False, "ip_allowlist": False, "voice_cloning": False},
        brand=config.PRODUCT_NAME,
    )


@router.post("/auth/signup", response_model=MeOut)
async def signup(
    body: SignupBody,
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_session),
):
    await rate_limit.enforce(
        f"psignup:{_client_ip(request)}", 10, 3600, "Too many sign-up attempts. Try again later."
    )
    email = body.email.lower()
    if await session.scalar(select(UserModel.id).where(UserModel.email == email).limit(1)):
        raise product_error(
            400,
            "signup_failed",
            "We couldn't create that account. If you already have one, sign in instead.",
        )
    user = UserModel(
        provider_id=f"usr_{uuid.uuid4().hex}",
        email=email,
        password_hash=hash_password(body.password),
        role="admin",
    )
    session.add(user)
    await session.flush()
    session.add(ProductUserProfileModel(user_id=user.id, display_name=body.name))
    await create_workspace(session, user, body.workspace_name or f"{body.name}'s workspace")
    await session.commit()
    _set_session(response, user)
    return await _me(session, user, None, config.DEFAULT_ENVIRONMENT)


@router.post("/auth/login", response_model=MeOut | SetupOut)
async def login(
    body: LoginBody,
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_session),
):
    msg = "Too many attempts. Try again in a few minutes."
    await rate_limit.enforce(f"plogin:ip:{_client_ip(request)}", 30, 300, msg)
    await rate_limit.enforce(f"plogin:{body.email.lower()}", 10, 300, msg)
    user = await session.scalar(select(UserModel).where(UserModel.email == body.email.lower()))
    if not user or not user.password_hash:
        verify_password(body.password, _DUMMY_HASH)
        raise product_error(401, "bad_credentials", "That email or password isn't right.")
    if not verify_password(body.password, user.password_hash):
        raise product_error(401, "bad_credentials", "That email or password isn't right.")
    profile = await session.get(ProductUserProfileModel, user.id)
    if profile is not None and profile.totp_enabled:
        if not body.code:
            raise product_error(401, "two_factor_required", "Enter the 6-digit code from your authenticator app.")
        if not totp.verify(profile.totp_secret or "", body.code):
            raise product_error(401, "bad_code", "That code isn't right. Check your authenticator app and try again.")
    _set_session(response, user)
    if not await list_workspaces(session, user.id):  # an existing account that hasn't been brought over yet
        return SetupOut(user=UserOut(id=user_public_id(user.provider_id), email=user.email, name=await get_display_name(session, user.id)))
    return await _me(session, user, None, config.DEFAULT_ENVIRONMENT)


@router.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie(config.SESSION_COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/me", response_model=MeOut)
async def me(ctx: Ctx = Depends(get_ctx)):
    return await _me(ctx.session, ctx.user, ctx.workspace.public_id, ctx.environment)


@router.get("/workspaces", response_model=list[WorkspaceOut])
async def workspaces(base=Depends(get_user_only)):
    session, user = base
    return [
        WorkspaceOut(id=v.workspace.public_id, name=v.workspace.name, role=v.role)
        for v in await list_workspaces(session, user.id)
    ]


@router.post("/workspaces", response_model=WorkspaceOut)
async def new_workspace(body: WorkspaceCreateBody, base=Depends(get_user_only)):
    session, user = base
    ws = await create_workspace(session, user, body.name)
    await session.commit()
    return WorkspaceOut(id=ws.public_id, name=ws.name, role=Role.OWNER.value)
