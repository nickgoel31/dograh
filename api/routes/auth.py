from fastapi import APIRouter, Depends, HTTPException, Request
from loguru import logger
from pydantic import BaseModel

from api.db import db_client
from api.db.models import UserModel
from api.enums import ASSIGNABLE_ORG_ROLES, ROLE_RANK, PostHogEvent
from api.utils import rate_limit
from api.schemas.auth import AuthResponse, LoginRequest, SignupRequest, UserResponse
from api.services.auth.depends import create_user_configuration_with_mps_key, get_user
from api.services.posthog_client import capture_event
from api.utils.auth import create_jwt_token, hash_password, verify_password

router = APIRouter(
    prefix="/auth",
    tags=["auth"],
)


_DUMMY_HASH = hash_password("dummy-password-for-timing-equalisation")


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


@router.post("/signup", response_model=AuthResponse)
async def signup(request: SignupRequest, http_request: Request):
    await rate_limit.enforce(
        f"signup:{_client_ip(http_request)}", 10, 3600, "Too many signup attempts"
    )

    # Generic message so this endpoint cannot be used to enumerate emails.
    existing_user = await db_client.get_user_by_email(request.email)
    if existing_user:
        raise HTTPException(
            status_code=400,
            detail="Unable to create account with these details. "
            "If you already have an account, please sign in.",
        )

    # Decode and validate invite token if provided
    org_id = None
    role = "admin"
    if request.invite_token:
        try:
            from api.utils.auth import decode_jwt_token
            payload = decode_jwt_token(request.invite_token)
            if str(payload.get("email", "")).lower() != request.email.lower():
                raise HTTPException(status_code=400, detail="Invite token email mismatch")
            org_id = payload.get("org_id")
            role = payload.get("role", "client")
            if org_id is None or role not in ASSIGNABLE_ORG_ROLES:
                raise HTTPException(status_code=400, detail="Invalid invite token")
        except Exception as e:
            if isinstance(e, HTTPException):
                raise e
            raise HTTPException(status_code=400, detail="Invalid or expired invite token")

        # Validate the organization *before* creating the user so a bad invite
        # cannot leave an orphan account (and burn the email) behind.
        if not await db_client.get_organization_by_id(org_id):
            raise HTTPException(status_code=400, detail="Invited organization not found")

    # Hash password and create user
    hashed = hash_password(request.password)
    user = await db_client.create_user_with_email(
        email=request.email,
        password_hash=hashed,
        name=request.name,
        role=role,
    )

    if org_id:
        organization = await db_client.get_organization_by_id(org_id)
    else:
        # Create organization for the user
        org_provider_id = f"org_{user.provider_id}"
        organization, _ = await db_client.get_or_create_organization_by_provider_id(
            org_provider_id=org_provider_id, user_id=user.id
        )

    # Link user to organization
    await db_client.add_user_to_organization(user.id, organization.id)
    await db_client.update_user_selected_organization(user.id, organization.id)

    # Create default service configuration
    try:
        mps_config = await create_user_configuration_with_mps_key(
            user.id, organization.id, user.provider_id
        )
        if mps_config:
            await db_client.update_user_configuration(user.id, mps_config)
    except Exception:
        logger.warning(
            "Failed to create default configuration for OSS user", exc_info=True
        )

    # Create JWT token
    token = create_jwt_token(user.id, request.email, user.role, user.is_superuser)

    capture_event(
        distinct_id=str(user.provider_id),
        event=PostHogEvent.SIGNED_UP,
        properties={
            "organization_id": organization.id,
            "auth_provider": "local",
        },
    )

    return AuthResponse(
        token=token,
        user=UserResponse(
            id=user.id,
            email=user.email,
            name=request.name,
            organization_id=organization.id,
            provider_id=user.provider_id,
        ),
    )


@router.post("/login", response_model=AuthResponse)
async def login(request: LoginRequest, http_request: Request):
    ip = _client_ip(http_request)
    await rate_limit.enforce(f"login:ip:{ip}", 30, 300, "Too many login attempts")
    await rate_limit.enforce(
        f"login:email:{request.email.lower()}", 10, 300, "Too many login attempts"
    )

    # Look up user by email
    user = await db_client.get_user_by_email(request.email)
    if not user or not user.password_hash:
        # Spend the same CPU as a real check so timing doesn't reveal whether
        # the email exists.
        verify_password(request.password, _DUMMY_HASH)
        raise HTTPException(status_code=401, detail="Invalid email or password")

    # Verify password
    if not verify_password(request.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    # Create JWT token
    token = create_jwt_token(user.id, user.email, user.role, user.is_superuser)

    capture_event(
        distinct_id=str(user.provider_id),
        event=PostHogEvent.SIGNED_IN,
        properties={
            "organization_id": user.selected_organization_id,
            "auth_provider": "local",
        },
    )

    return AuthResponse(
        token=token,
        user=UserResponse(
            id=user.id,
            email=user.email,
            organization_id=user.selected_organization_id,
            provider_id=user.provider_id,
        ),
    )


@router.get("/me", response_model=UserResponse)
async def get_current_user(user: UserModel = Depends(get_user)):
    return UserResponse(
        id=user.id,
        email=user.email,
        organization_id=user.selected_organization_id,
        provider_id=user.provider_id,
    )


class AcceptInviteRequest(BaseModel):
    token: str


@router.post("/accept-invite")
async def accept_invite(
    request: AcceptInviteRequest,
    user: UserModel = Depends(get_user),
):
    """Link an existing logged-in user to an organization via invite token."""
    try:
        from api.utils.auth import decode_jwt_token
        payload = decode_jwt_token(request.token)
        
        # Verify invite email matches the logged-in user's email
        if str(payload.get("email", "")).lower() != (user.email or "").lower():
            raise HTTPException(status_code=400, detail="Invite email does not match logged-in user")
            
        org_id = payload.get("org_id")
        role = payload.get("role", "client")
        if org_id is None or role not in ASSIGNABLE_ORG_ROLES:
            raise HTTPException(status_code=400, detail="Invalid invite token")

        # Check organization exists
        org = await db_client.get_organization_by_id(org_id)
        if not org:
            raise HTTPException(status_code=400, detail="Invited organization not found")
            
        # Add user to organization
        await db_client.add_user_to_organization(user.id, org_id)
        
        # Never demote: a super admin (or existing admin) who accepts a
        # lower-privilege invite keeps the role they already have.
        current_role = user.role or "client"
        if user.is_superuser or ROLE_RANK.get(role, 0) <= ROLE_RANK.get(current_role, 0):
            role = current_role
        else:
            await db_client.update_user_role_and_superuser(user_id=user.id, role=role)
        await db_client.update_user_selected_organization(user.id, org_id)
        
        return {"detail": "Successfully joined organization", "organization_id": org_id, "role": role}
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=400, detail="Invalid or expired invite token")
