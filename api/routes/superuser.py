import json
import time
import uuid
import re
import time
from collections import defaultdict
from datetime import datetime, timezone
from typing import List, Optional

from loguru import logger
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import select, func, delete as sa_delete

from api.db import db_client
from api.db.models import OrganizationModel, UserModel, WorkflowModel, WorkflowRunModel, organization_users_association
from api.services.billing import wallet_service
from api.utils import rate_limit
from api.utils.auth import create_jwt_token
from api.enums import UserRole
from api.services.auth.depends import get_superuser
from api.services.auth.stack_auth import stackauth

router = APIRouter(prefix="/superuser", tags=["superuser"])



class ImpersonateRequest(BaseModel):
    """Request payload for superadmin impersonation.

    Either ``provider_user_id`` **or** ``user_id`` must be supplied. If both are
    provided, ``provider_user_id`` takes precedence.
    """

    provider_user_id: str | None = None
    user_id: int | None = None


class ImpersonateResponse(BaseModel):
    refresh_token: str
    access_token: str


class SwitchOrgRequest(BaseModel):
    org_id: int


class SwitchOrgResponse(BaseModel):
    access_token: str
    org_id: int
    org_name: str


class SuperuserWorkflowRunResponse(BaseModel):
    id: int
    name: str
    workflow_id: int
    workflow_name: Optional[str]
    user_id: Optional[int]
    organization_id: Optional[int]
    organization_name: Optional[str]
    mode: str
    is_completed: bool
    recording_url: Optional[str]
    transcript_url: Optional[str]
    usage_info: Optional[dict]
    cost_info: Optional[dict]
    initial_context: Optional[dict]
    gathered_context: Optional[dict]
    created_at: datetime


class SuperuserWorkflowRunsListResponse(BaseModel):
    workflow_runs: List[SuperuserWorkflowRunResponse]
    total_count: int
    page: int
    limit: int
    total_pages: int


@router.post("/impersonate")
async def impersonate(
    request: ImpersonateRequest, 
    fastapi_request: Request,
    user: UserModel = Depends(get_superuser)
) -> ImpersonateResponse:
    """Impersonate a user as a super-admin.
    Internally, Stack Auth requires the **provider user ID** (a UUID-ish string)
    to create an impersonation session.
    """
    # Shared across workers via Redis (falls back to per-process).
    await rate_limit.enforce(
        f"impersonate:{user.id}",
        10,
        60,
        "Too many impersonation requests. Please try again later.",
    )

    provider_user_id: str | None = request.provider_user_id

    # ------------------------------------------------------------------
    # Fallback: resolve provider_user_id from internal ``user_id``
    # ------------------------------------------------------------------
    if provider_user_id is None:
        if request.user_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Either 'provider_user_id' or 'user_id' must be provided.",
            )

        db_user = await db_client.get_user_by_id(request.user_id)

        if db_user is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"User with ID {request.user_id} not found.",
            )

        provider_user_id = db_user.provider_id

    # ------------------------------------------------------------------
    # Call Stack Auth to create the impersonation session
    # ------------------------------------------------------------------
    session = await stackauth.impersonate(provider_user_id)

    return ImpersonateResponse(
        refresh_token=session["refresh_token"],
        access_token=session["access_token"],
    )


@router.post("/switch-org", response_model=SwitchOrgResponse)
async def switch_org(
    request: SwitchOrgRequest,
    user: UserModel = Depends(get_superuser),
):
    """Switch organization context for superuser.
    Updates selected_organization_id in DB and returns a JWT token scoped with acting_as_org_id.
    """
    async with db_client.async_session() as session:
        org = await session.get(OrganizationModel, request.org_id)
        if not org:
            raise HTTPException(status_code=404, detail="Organization not found")
        if not getattr(org, "is_active", True):
            raise HTTPException(status_code=400, detail="Organization is deactivated")

        db_user = await session.get(UserModel, user.id)
        if db_user:
            db_user.selected_organization_id = org.id
            await session.commit()

        token = create_jwt_token(
            user_id=user.id,
            email=user.email,
            role=user.role,
            is_superuser=True,
            acting_as_org_id=org.id,
        )

        return SwitchOrgResponse(
            access_token=token,
            org_id=org.id,
            org_name=org.name,
        )


@router.get("/workflow-runs")
async def get_workflow_runs(
    page: int = Query(1, ge=1, description="Page number (starts from 1)"),
    limit: int = Query(50, ge=1, le=100, description="Number of items per page"),
    filters: Optional[str] = Query(None, description="JSON-encoded filter criteria"),
    sort_by: Optional[str] = Query(
        None, description="Field to sort by (e.g., 'duration', 'created_at')"
    ),
    sort_order: Optional[str] = Query(
        "desc", description="Sort order ('asc' or 'desc')"
    ),
    user: UserModel = Depends(get_superuser),
) -> SuperuserWorkflowRunsListResponse:
    """
    Get paginated list of all workflow runs with organization information.
    Requires superuser privileges.

    Filters should be provided as a JSON-encoded array of filter criteria.
    Example: [{"field": "id", "type": "number", "value": {"value": 680}}]
    """
    offset = (page - 1) * limit

    # Parse filters if provided
    filter_criteria = None
    if filters:
        try:
            filter_criteria = json.loads(filters)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid filter format")

    # Validate sort_order
    if sort_order not in ("asc", "desc"):
        sort_order = "desc"

    workflow_runs, total_count = await db_client.get_workflow_runs_for_superadmin(
        limit=limit,
        offset=offset,
        filters=filter_criteria,
        sort_by=sort_by,
        sort_order=sort_order,
    )

    total_pages = (total_count + limit - 1) // limit  # Ceiling division

    return SuperuserWorkflowRunsListResponse(
        workflow_runs=[SuperuserWorkflowRunResponse(**run) for run in workflow_runs],
        total_count=total_count,
        page=page,
        limit=limit,
        total_pages=total_pages,
    )

def generate_slug(name: str) -> str:
    slug = name.lower()
    slug = re.sub(r'[^a-z0-9]+', '-', slug)
    return slug.strip('-')

class CreateOrganizationRequest(BaseModel):
    name: str
    slug: Optional[str] = None
    balance: Optional[float] = 0.0
    billing_rate: Optional[float] = 0.0
    billing_pulse: Optional[int] = 60
    monthly_minutes_limit: Optional[float] = 0.0
    monthly_minutes_start_year: Optional[int] = None
    monthly_minutes_start_month: Optional[int] = None
    monthly_minutes_end_year: Optional[int] = None
    monthly_minutes_end_month: Optional[int] = None
    quota_reset_day: Optional[int] = 1
    concurrency_limit: Optional[int] = None
    billing_currency: Optional[str] = None
    monthly_carry_forward: Optional[bool] = None
    allow_overdraft: Optional[bool] = None
    wallet_enabled: Optional[bool] = None

class UpdateOrganizationRequest(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None
    balance: Optional[float] = None
    billing_rate: Optional[float] = None
    billing_pulse: Optional[int] = None
    monthly_minutes_limit: Optional[float] = None
    monthly_minutes_start_year: Optional[int] = None
    monthly_minutes_start_month: Optional[int] = None
    monthly_minutes_end_year: Optional[int] = None
    monthly_minutes_end_month: Optional[int] = None
    cycle_year: Optional[int] = None
    cycle_month: Optional[int] = None
    custom_minutes_used: Optional[float] = None
    cycle_topup_minutes: Optional[float] = None
    quota_reset_day: Optional[int] = None
    whatsapp_enabled: Optional[bool] = None
    whatsapp_phone_number_id: Optional[str] = None
    whatsapp_access_token: Optional[str] = None
    whatsapp_business_account_id: Optional[str] = None
    concurrency_limit: Optional[int] = None
    billing_currency: Optional[str] = None
    monthly_carry_forward: Optional[bool] = None
    allow_overdraft: Optional[bool] = None
    wallet_enabled: Optional[bool] = None
    is_reseller: Optional[bool] = None
    hide_model_details: Optional[bool] = None
    parent_org_id: Optional[int] = None
    wholesale_rate: Optional[float] = None
    max_child_orgs: Optional[int] = None
    model_profile_id: Optional[int] = None


class AssignUserRequest(BaseModel):
    user_id: int
    role: str

class RemoveUserRequest(BaseModel):
    user_id: int

class SwitchOrgRequest(BaseModel):
    org_id: int

@router.post("/organizations")
async def create_organization(request: CreateOrganizationRequest, user: UserModel = Depends(get_superuser)):
    name = request.name.strip()
    if len(name) < 2 or len(name) > 100:
        raise HTTPException(status_code=400, detail="Name must be between 2 and 100 characters")
    
    slug = request.slug or generate_slug(name)
    
    async with db_client.async_session() as session:
        # Check uniqueness
        existing = await session.execute(
            select(OrganizationModel).where(
                (OrganizationModel.name == name) | (OrganizationModel.slug == slug)
            )
        )
        if existing.scalars().first():
            raise HTTPException(status_code=400, detail="Organization with this name or slug already exists")
            
        new_org = OrganizationModel(
            name=name,
            slug=slug,
            provider_id=f"org_{uuid.uuid4().hex[:12]}",
            is_active=True,
            balance=0.0,  # opening balance goes through the ledger below
            wallet_enabled=bool(
                request.wallet_enabled
                if request.wallet_enabled is not None
                else ((request.monthly_minutes_limit or 0) > 0 or (request.balance or 0) > 0)
            ),
            wallet_started_at=datetime.now(timezone.utc),
            billing_currency=(request.billing_currency or "INR").upper()[:8],
            monthly_carry_forward=True if request.monthly_carry_forward is None else request.monthly_carry_forward,
            allow_overdraft=bool(request.allow_overdraft),
            billing_rate=request.billing_rate if request.billing_rate is not None else 0.0,
            billing_pulse=request.billing_pulse if request.billing_pulse is not None else 60,
            monthly_minutes_limit=request.monthly_minutes_limit if request.monthly_minutes_limit is not None else 0.0,
            monthly_minutes_start_year=request.monthly_minutes_start_year,
            monthly_minutes_start_month=request.monthly_minutes_start_month,
            monthly_minutes_end_year=request.monthly_minutes_end_year,
            monthly_minutes_end_month=request.monthly_minutes_end_month,
            quota_reset_day=request.quota_reset_day,
            concurrency_limit=request.concurrency_limit,
        )
        if request.billing_pulse is not None and request.billing_pulse not in (1, 15, 30, 60):
            raise HTTPException(status_code=400, detail="billing_pulse must be 1, 15, 30 or 60 seconds")
        if request.quota_reset_day is not None and not (1 <= request.quota_reset_day <= 28):
            raise HTTPException(status_code=400, detail="quota_reset_day must be between 1 and 28")
        session.add(new_org)
        await session.commit()
        await session.refresh(new_org)

        if request.balance:
            await wallet_service.credit_money(
                new_org.id, request.balance, description="Opening balance", actor_user_id=user.id
            )
            await session.refresh(new_org)

        return {
            "id": new_org.id,
            "name": new_org.name,
            "slug": new_org.slug,
            "provider_id": new_org.provider_id,
            "created_at": new_org.created_at,
            "balance": new_org.balance,
            "billing_rate": new_org.billing_rate,
            "billing_pulse": new_org.billing_pulse,
            "monthly_minutes_limit": new_org.monthly_minutes_limit,
            "monthly_minutes_start_year": new_org.monthly_minutes_start_year,
            "monthly_minutes_start_month": new_org.monthly_minutes_start_month,
            "monthly_minutes_end_year": new_org.monthly_minutes_end_year,
            "monthly_minutes_end_month": new_org.monthly_minutes_end_month,
            "quota_reset_day": new_org.quota_reset_day,
            "concurrency_limit": new_org.concurrency_limit,
        }

@router.get("/organizations")
async def list_all_organizations(user: UserModel = Depends(get_superuser)):
    """List all organizations with stats."""
    async with db_client.async_session() as session:
        # Using separate queries for stats to avoid complex group bys that might break
        orgs = await session.execute(select(OrganizationModel))
        orgs = orgs.scalars().all()
        
        result = []
        for o in orgs:
            # Members count
            members_result = await session.execute(
                select(UserModel)
                .join(organization_users_association, UserModel.id == organization_users_association.c.user_id)
                .where(organization_users_association.c.organization_id == o.id)
            )
            members = members_result.scalars().all()
            
            admin_count = sum(1 for m in members if m.role == 'admin')
            client_count = sum(1 for m in members if m.role == 'client')
            member_count = len(members)
            
            # Agents count
            agents_result = await session.execute(
                select(func.count(WorkflowModel.id))
                .where(WorkflowModel.organization_id == o.id)
            )
            agent_count = agents_result.scalar() or 0

            try:
                wallet = await wallet_service.get_summary(o.id)
            except Exception as exc:  # one bad org must not blank the whole list
                logger.error(f"Wallet summary failed for org {o.id}: {exc}")
                wallet = {
                    "balance": o.balance or 0.0,
                    "monthly_minutes_limit": o.monthly_minutes_limit or 0.0,
                    "wallet_enabled": bool(o.wallet_enabled),
                    "currency": o.billing_currency,
                    "monthly_carry_forward": bool(o.monthly_carry_forward),
                    "allow_overdraft": bool(o.allow_overdraft),
                    "minutes_remaining": 0.0,
                    "minutes_available": 0.0,
                }
            base_balance = wallet["balance"]
            balance_val = wallet["balance"]
            limit = wallet["monthly_minutes_limit"]

            result.append({
                "id": o.id,
                "name": o.name,
                "slug": o.slug,
                "provider_id": o.provider_id,
                "created_at": o.created_at,
                "is_active": o.is_active,
                "member_count": member_count,
                "admin_count": admin_count,
                "client_count": client_count,
                "agent_count": agent_count,
                "balance": balance_val,
                "base_balance": base_balance,
                "billing_rate": o.billing_rate,
                "billing_pulse": o.billing_pulse,
                "monthly_minutes_limit": limit,
                "monthly_minutes_start_year": getattr(o, "monthly_minutes_start_year", None),
                "monthly_minutes_start_month": getattr(o, "monthly_minutes_start_month", None),
                "monthly_minutes_end_year": getattr(o, "monthly_minutes_end_year", None),
                "monthly_minutes_end_month": getattr(o, "monthly_minutes_end_month", None),
                "whatsapp_enabled": getattr(o, "whatsapp_enabled", False),
                "whatsapp_phone_number_id": getattr(o, "whatsapp_phone_number_id", None),
                "whatsapp_business_account_id": getattr(o, "whatsapp_business_account_id", None),
                "whatsapp_webhook_verify_token": getattr(o, "whatsapp_webhook_verify_token", None),
                "whatsapp_has_access_token": bool(getattr(o, "whatsapp_access_token", None)),
                "concurrency_limit": getattr(o, "concurrency_limit", None),
                "wallet_enabled": wallet["wallet_enabled"],
                "billing_currency": wallet["currency"],
                "monthly_carry_forward": wallet["monthly_carry_forward"],
                "allow_overdraft": wallet["allow_overdraft"],
                "minutes_remaining": wallet["minutes_remaining"],
                "minutes_available": wallet["minutes_available"],
                "quota_reset_day": getattr(o, "quota_reset_day", 1),
                "is_reseller": o.is_reseller,
                "hide_model_details": o.hide_model_details,
                "parent_org_id": o.parent_org_id,
                "wholesale_rate": o.wholesale_rate,
                "max_child_orgs": o.max_child_orgs,
                "model_profile_id": o.model_profile_id,
            })

    return result

@router.patch("/organizations/{org_id}")
async def update_organization(org_id: int, request: UpdateOrganizationRequest, user: UserModel = Depends(get_superuser)):
    async with db_client.async_session() as session:
        org = await session.get(OrganizationModel, org_id)
        if not org:
            raise HTTPException(status_code=404, detail="Organization not found")
            
        if request.name is not None:
            # check uniqueness
            existing = await session.execute(
                select(OrganizationModel).where(OrganizationModel.name == request.name, OrganizationModel.id != org_id)
            )
            if existing.scalars().first():
                raise HTTPException(status_code=400, detail="Name already in use")
            org.name = request.name
            
        if request.is_active is not None:
            org.is_active = request.is_active
            
        # Money is only ever moved through the wallet ledger (after commit, below)
        balance_delta = None
        if request.balance is not None:
            balance_delta = float(request.balance) - float(org.balance or 0.0)

        if request.wallet_enabled is not None:
            org.wallet_enabled = request.wallet_enabled
            if request.wallet_enabled and org.wallet_started_at is None:
                org.wallet_started_at = datetime.now(timezone.utc)
        if request.monthly_carry_forward is not None:
            org.monthly_carry_forward = request.monthly_carry_forward
        if request.allow_overdraft is not None:
            org.allow_overdraft = request.allow_overdraft
        if request.billing_currency is not None:
            org.billing_currency = request.billing_currency.upper()[:8]

        # ---- reseller tenancy & model profile (platform owner only) ----
        owner_fields = request.model_dump(exclude_unset=True)
        if owner_fields.get("is_reseller") and (
            org.parent_org_id or owner_fields.get("parent_org_id")
        ):
            raise HTTPException(
                status_code=400, detail="A client organization cannot also be a reseller"
            )
        if "parent_org_id" in owner_fields:
            new_parent = owner_fields["parent_org_id"]
            if new_parent is not None:
                if new_parent == org.id:
                    raise HTTPException(
                        status_code=400, detail="An organization cannot be its own parent"
                    )
                parent = await session.get(OrganizationModel, new_parent)
                if parent is None or not parent.is_reseller:
                    raise HTTPException(
                        status_code=400, detail="Parent must be a reseller organization"
                    )
                if org.is_reseller:
                    raise HTTPException(
                        status_code=400,
                        detail="A reseller cannot be a client of another reseller",
                    )
                org.hide_model_details = True  # clients of resellers never see model details
            org.parent_org_id = new_parent
        if request.is_reseller is not None:
            org.is_reseller = request.is_reseller
            if request.is_reseller:
                org.hide_model_details = True
        if request.hide_model_details is not None:
            org.hide_model_details = request.hide_model_details
        if "wholesale_rate" in owner_fields:
            rate = owner_fields["wholesale_rate"]
            if rate is not None and rate < 0:
                raise HTTPException(status_code=400, detail="wholesale_rate cannot be negative")
            org.wholesale_rate = rate
        if "max_child_orgs" in owner_fields:
            org.max_child_orgs = owner_fields["max_child_orgs"]
        if "model_profile_id" in owner_fields:
            pid = owner_fields["model_profile_id"]
            if pid is not None and not await db_client.get_model_profile(pid):
                raise HTTPException(status_code=404, detail="Model profile not found")
            org.model_profile_id = pid

        if request.billing_rate is not None:
            if request.billing_rate < 0:
                raise HTTPException(status_code=400, detail="billing_rate cannot be negative")
            org.billing_rate = request.billing_rate

        if request.billing_pulse is not None:
            if request.billing_pulse not in [1, 15, 30, 60]:
                raise HTTPException(status_code=400, detail="billing_pulse must be 1, 15, 30 or 60 seconds")
            org.billing_pulse = request.billing_pulse

        if request.monthly_minutes_limit is not None:
            org.monthly_minutes_limit = request.monthly_minutes_limit
            
        if request.concurrency_limit is not None:
            org.concurrency_limit = request.concurrency_limit

        # Handle updating start/end contract periods, including explicit setting to None (nullification)
        fields_to_check = [
            "monthly_minutes_start_year",
            "monthly_minutes_start_month",
            "monthly_minutes_end_year",
            "monthly_minutes_end_month"
        ]
        for f in fields_to_check:
            val = getattr(request, f)
            is_set = f in request.model_fields_set or (hasattr(request, "__fields_set__") and f in request.__fields_set__)
            if is_set:
                setattr(org, f, val)

        if request.quota_reset_day is not None:
            if not (1 <= request.quota_reset_day <= 28):
                raise HTTPException(status_code=400, detail="quota_reset_day must be between 1 and 28")
            org.quota_reset_day = request.quota_reset_day

        if request.custom_minutes_used is not None or request.cycle_topup_minutes is not None:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Per-cycle overrides were replaced by the wallet ledger. Use "
                    "POST /superuser/organizations/{id}/wallet/topup-minutes or "
                    ".../wallet/deduct-minutes instead."
                ),
            )

        if request.whatsapp_enabled is not None:
            org.whatsapp_enabled = request.whatsapp_enabled
            if request.whatsapp_enabled and not org.whatsapp_webhook_verify_token:
                import secrets
                org.whatsapp_webhook_verify_token = secrets.token_urlsafe(32)

        if request.whatsapp_phone_number_id is not None:
            org.whatsapp_phone_number_id = request.whatsapp_phone_number_id

        if request.whatsapp_access_token is not None:
            if request.whatsapp_access_token == "":
                org.whatsapp_access_token = None
            else:
                from api.utils.encryption import encrypt_data
                org.whatsapp_access_token = encrypt_data(request.whatsapp_access_token)

        if request.whatsapp_business_account_id is not None:
            org.whatsapp_business_account_id = request.whatsapp_business_account_id

        await session.commit()
        await session.refresh(org)

        if balance_delta is not None and abs(balance_delta) > 1e-9:
            await wallet_service.credit_money(
                org.id,
                balance_delta,
                description="Balance set by super admin",
                actor_user_id=user.id,
            )
            await session.refresh(org)

        return {
            "id": org.id,
            "name": org.name,
            "is_active": org.is_active,
            "balance": org.balance,
            "billing_rate": org.billing_rate,
            "billing_pulse": org.billing_pulse,
            "monthly_minutes_limit": getattr(org, "monthly_minutes_limit", 0.0) or 0.0,
            "monthly_minutes_start_year": getattr(org, "monthly_minutes_start_year", None),
            "monthly_minutes_start_month": getattr(org, "monthly_minutes_start_month", None),
            "monthly_minutes_end_year": getattr(org, "monthly_minutes_end_year", None),
            "monthly_minutes_end_month": getattr(org, "monthly_minutes_end_month", None),
            "quota_reset_day": getattr(org, "quota_reset_day", 1),
            "whatsapp_enabled": getattr(org, "whatsapp_enabled", False),
            "whatsapp_phone_number_id": getattr(org, "whatsapp_phone_number_id", None),
            "whatsapp_business_account_id": getattr(org, "whatsapp_business_account_id", None),
            "whatsapp_webhook_verify_token": getattr(org, "whatsapp_webhook_verify_token", None),
            "whatsapp_has_access_token": bool(getattr(org, "whatsapp_access_token", None)),
            "concurrency_limit": getattr(org, "concurrency_limit", None),
            "wallet_enabled": org.wallet_enabled,
            "billing_currency": org.billing_currency,
            "monthly_carry_forward": org.monthly_carry_forward,
            "allow_overdraft": org.allow_overdraft,
            "is_reseller": org.is_reseller,
            "hide_model_details": org.hide_model_details,
            "parent_org_id": org.parent_org_id,
            "wholesale_rate": org.wholesale_rate,
            "max_child_orgs": org.max_child_orgs,
            "model_profile_id": org.model_profile_id,
        }

class TopupMinutesRequest(BaseModel):
    minutes: float
    expires_at: Optional[datetime] = None
    description: Optional[str] = None
    idempotency_key: Optional[str] = None


class CreditMoneyRequest(BaseModel):
    amount: float
    description: Optional[str] = None
    idempotency_key: Optional[str] = None


class DeductMinutesRequest(BaseModel):
    minutes: float
    description: Optional[str] = None


async def _require_org(org_id: int) -> None:
    if not await db_client.get_organization_by_id(org_id):
        raise HTTPException(status_code=404, detail="Organization not found")


@router.get("/organizations/{org_id}/wallet")
async def superuser_get_wallet(org_id: int, user: UserModel = Depends(get_superuser)):
    await _require_org(org_id)
    return {
        "wallet": await wallet_service.get_summary(org_id),
        "audit": await wallet_service.audit_org(org_id),
    }


@router.get("/organizations/{org_id}/wallet/ledger")
async def superuser_wallet_ledger(
    org_id: int,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    entry_type: Optional[str] = None,
    user: UserModel = Depends(get_superuser),
):
    await _require_org(org_id)
    items, total = await wallet_service.list_ledger(
        org_id, limit=limit, offset=offset, entry_type=entry_type
    )
    return {"items": items, "total": total}


@router.post("/organizations/{org_id}/wallet/topup-minutes")
async def superuser_topup_minutes(
    org_id: int, request: TopupMinutesRequest, user: UserModel = Depends(get_superuser)
):
    await _require_org(org_id)
    try:
        entry_id = await wallet_service.grant_minutes(
            org_id,
            request.minutes,
            expires_at=request.expires_at,
            description=request.description,
            actor_user_id=user.id,
            idempotency_key=request.idempotency_key,
        )
    except wallet_service.WalletError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"ledger_id": entry_id, "wallet": await wallet_service.get_summary(org_id)}


@router.post("/organizations/{org_id}/wallet/credit")
async def superuser_credit_money(
    org_id: int, request: CreditMoneyRequest, user: UserModel = Depends(get_superuser)
):
    await _require_org(org_id)
    try:
        entry_id = await wallet_service.credit_money(
            org_id,
            request.amount,
            description=request.description,
            actor_user_id=user.id,
            idempotency_key=request.idempotency_key,
        )
    except wallet_service.WalletError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"ledger_id": entry_id, "wallet": await wallet_service.get_summary(org_id)}


@router.post("/organizations/{org_id}/wallet/deduct-minutes")
async def superuser_deduct_minutes(
    org_id: int, request: DeductMinutesRequest, user: UserModel = Depends(get_superuser)
):
    await _require_org(org_id)
    try:
        entry_id = await wallet_service.remove_minutes(
            org_id,
            request.minutes,
            description=request.description,
            actor_user_id=user.id,
        )
    except wallet_service.WalletError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"ledger_id": entry_id, "wallet": await wallet_service.get_summary(org_id)}


@router.post("/organizations/{org_id}/wallet/refund-run/{run_id}")
async def superuser_refund_run(
    org_id: int, run_id: int, user: UserModel = Depends(get_superuser)
):
    await _require_org(org_id)
    try:
        refunded = await wallet_service.refund_usage(
            run_id, organization_id=org_id, actor_user_id=user.id
        )
    except wallet_service.WalletError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"refunded": refunded, "wallet": await wallet_service.get_summary(org_id)}


@router.post("/organizations/{org_id}/wallet/reconcile")
async def superuser_reconcile_wallet(org_id: int, user: UserModel = Depends(get_superuser)):
    """Bill any completed calls that never reached the ledger."""
    await _require_org(org_id)
    stats = await wallet_service.reconcile_unbilled_runs(org_id, min_age_minutes=0)
    return {"stats": stats, "wallet": await wallet_service.get_summary(org_id)}


class ModelProfileRequest(BaseModel):
    slug: Optional[str] = None
    display_name: Optional[str] = None
    description: Optional[str] = None
    tier: Optional[str] = None
    capabilities: Optional[List[str]] = None
    config: Optional[dict] = None
    allowed_org_ids: Optional[List[int]] = None
    is_active: Optional[bool] = None


@router.get("/model-profiles")
async def list_model_profiles(user: UserModel = Depends(get_superuser)):
    from api.services.reseller import profiles as profile_service

    return [
        profile_service.owner_view(p)
        for p in await db_client.list_model_profiles()
    ]


@router.post("/model-profiles")
async def create_model_profile(
    request: ModelProfileRequest, user: UserModel = Depends(get_superuser)
):
    from api.services.reseller import profiles as profile_service

    if not request.display_name or not request.config:
        raise HTTPException(status_code=400, detail="display_name and config are required")
    try:
        config = profile_service.normalize_config(request.config)
    except profile_service.ProfileConfigError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    slug = request.slug or generate_slug(request.display_name)
    try:
        profile = await db_client.create_model_profile(
            slug=slug,
            display_name=request.display_name.strip(),
            description=request.description,
            tier=request.tier,
            capabilities=request.capabilities or [],
            config=config,
            allowed_org_ids=request.allowed_org_ids or [],
            is_active=True if request.is_active is None else request.is_active,
        )
    except Exception as exc:  # unique slug violation
        raise HTTPException(status_code=400, detail=f"Could not create profile: {exc.__class__.__name__}")
    return profile_service.owner_view(profile)


@router.patch("/model-profiles/{profile_id}")
async def update_model_profile(
    profile_id: int, request: ModelProfileRequest, user: UserModel = Depends(get_superuser)
):
    """Changing a profile instantly changes the models behind every org using it."""
    from api.schemas.user_configuration import UserConfiguration
    from api.services.configuration.masking import check_for_masked_keys
    from api.services.configuration.merge import merge_user_configurations
    from api.services.reseller import profiles as profile_service

    existing = await db_client.get_model_profile(profile_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Model profile not found")

    fields = request.model_dump(exclude_unset=True)
    if request.config is not None:
        try:
            merged = merge_user_configurations(
                UserConfiguration.model_validate(existing.config or {}), request.config
            )
            check_for_masked_keys(merged)
            fields["config"] = profile_service.normalize_config(
                merged.model_dump(exclude_none=True, exclude={"last_validated_at"})
            )
        except (ValueError, profile_service.ProfileConfigError) as exc:
            raise HTTPException(status_code=422, detail=str(exc))
    if "display_name" in fields and fields["display_name"]:
        fields["display_name"] = fields["display_name"].strip()
    profile = await db_client.update_model_profile(profile_id, **fields)
    return profile_service.owner_view(profile)


@router.delete("/model-profiles/{profile_id}")
async def delete_model_profile(profile_id: int, user: UserModel = Depends(get_superuser)):
    try:
        await db_client.delete_model_profile(profile_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return {"detail": "Model profile deleted"}


@router.delete("/organizations/{org_id}")
async def delete_organization(org_id: int, user: UserModel = Depends(get_superuser)):
    async with db_client.async_session() as session:
        org = await session.get(OrganizationModel, org_id)
        if not org:
            raise HTTPException(status_code=404, detail="Organization not found")
            
        # check for active agents
        active_agents = await session.execute(
            select(WorkflowModel).where(WorkflowModel.organization_id == org_id, WorkflowModel.status == 'active')
        )
        if active_agents.scalars().first():
            raise HTTPException(status_code=400, detail="Cannot deactivate organization with active agents")
            
        # check for active calls (not completed/failed)
        active_calls = await session.execute(
            select(WorkflowRunModel).where(
                WorkflowRunModel.workflow.has(organization_id=org_id),
                WorkflowRunModel.state.notin_(['completed', 'failed'])
            )
        )
        if active_calls.scalars().first():
            raise HTTPException(status_code=400, detail="Cannot deactivate organization with active calls")
            
        org.is_active = False
        await session.commit()
        return {"message": "Organization deactivated successfully"}

@router.post("/organizations/{org_id}/assign-user")
async def assign_user(org_id: int, request: AssignUserRequest, super_user: UserModel = Depends(get_superuser)):
    if request.role not in ['admin', 'client']:
        raise HTTPException(status_code=400, detail="Invalid role")
        
    async with db_client.async_session() as session:
        org = await session.get(OrganizationModel, org_id)
        if not org:
            raise HTTPException(status_code=404, detail="Organization not found")
            
        user = await session.get(UserModel, request.user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
            
        if user.is_superuser or user.role == UserRole.SUPER_ADMIN.value:
            raise HTTPException(status_code=400, detail="Cannot assign superadmin to an organization")
            
        # Remove from previous orgs in association table
        await session.execute(
            organization_users_association.delete().where(organization_users_association.c.user_id == user.id)
        )
        
        # Add to new org
        await session.execute(
            organization_users_association.insert().values(
                user_id=user.id,
                organization_id=org.id
            )
        )
        
        user.selected_organization_id = org.id
        user.role = request.role
        await session.commit()
        return {"message": "User assigned successfully"}

@router.post("/organizations/{org_id}/remove-user")
async def remove_user(org_id: int, request: RemoveUserRequest, super_user: UserModel = Depends(get_superuser)):
    async with db_client.async_session() as session:
        # Check if user is the last admin
        members_result = await session.execute(
            select(UserModel)
            .join(organization_users_association, UserModel.id == organization_users_association.c.user_id)
            .where(organization_users_association.c.organization_id == org_id)
        )
        members = members_result.scalars().all()
        
        is_admin = any(m.id == request.user_id and m.role == 'admin' for m in members)
        if is_admin:
            admin_count = sum(1 for m in members if m.role == 'admin')
            if admin_count <= 1:
                raise HTTPException(status_code=400, detail="Cannot remove the last admin of an organization")
        
        # Remove from org
        await session.execute(
            organization_users_association.delete().where(
                organization_users_association.c.user_id == request.user_id,
                organization_users_association.c.organization_id == org_id
            )
        )
        
        user = await session.get(UserModel, request.user_id)
        if user and user.selected_organization_id == org_id:
            user.selected_organization_id = None
            
        await session.commit()
        return {"message": "User removed successfully"}

@router.get("/organizations/{org_id}/members")
async def get_org_members(org_id: int, super_user: UserModel = Depends(get_superuser)):
    async with db_client.async_session() as session:
        members_result = await session.execute(
            select(UserModel)
            .join(organization_users_association, UserModel.id == organization_users_association.c.user_id)
            .where(organization_users_association.c.organization_id == org_id)
        )
        members = members_result.scalars().all()
        
        return [
            {
                "id": m.id,
                "email": m.email,
                "name": getattr(m, 'name', None) or m.email,
                "role": m.role,
                "joined_at": m.created_at,
                "last_active": m.created_at # mock
            } for m in members
        ]

class SuperuserUserResponse(BaseModel):
    id: int
    email: Optional[str]
    role: str
    is_superuser: bool
    created_at: datetime
    selected_organization_id: Optional[int]
    provider_id: Optional[str] = None
    org_name: Optional[str] = None


class SuperuserUsersListResponse(BaseModel):
    users: List[SuperuserUserResponse]
    total_count: int
    page: int
    limit: int
    total_pages: int


@router.get("/users", response_model=SuperuserUsersListResponse)
async def list_all_users(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    org_id: Optional[int] = Query(None),
    user: UserModel = Depends(get_superuser),
):
    """List all users in the system."""
    users, total_count = await db_client.get_all_users_paginated(page=page, limit=limit, org_id=org_id)
    total_pages = (total_count + limit - 1) // limit
    
    return SuperuserUsersListResponse(
        users=[
            SuperuserUserResponse(
                id=u.id,
                email=u.email,
                role=u.role,
                is_superuser=u.is_superuser,
                created_at=u.created_at,
                selected_organization_id=u.selected_organization_id,
                provider_id=u.provider_id,
                org_name=u.selected_organization.name if u.selected_organization else None
            )
            for u in users
        ],
        total_count=total_count,
        page=page,
        limit=limit,
        total_pages=total_pages,
    )


class UpdateUserRoleRequest(BaseModel):
    role: Optional[str] = None
    is_superuser: Optional[bool] = None


@router.patch("/users/{user_id}/role", response_model=SuperuserUserResponse)
async def update_user_role(
    user_id: int,
    request: UpdateUserRoleRequest,
    user: UserModel = Depends(get_superuser),
):
    """Update a user's role and/or superuser status."""
    if request.role is not None and request.role not in {r.value for r in UserRole}:
        raise HTTPException(status_code=400, detail="Invalid role")
    try:
        updated_user = await db_client.update_user_role_and_superuser(
            user_id=user_id,
            role=request.role,
            is_superuser=request.is_superuser,
        )
        return SuperuserUserResponse(
            id=updated_user.id,
            email=updated_user.email,
            role=updated_user.role,
            is_superuser=updated_user.is_superuser,
            created_at=updated_user.created_at,
            selected_organization_id=updated_user.selected_organization_id,
            provider_id=updated_user.provider_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


class AuditedWorkflowRunResponse(BaseModel):
    id: int
    name: str
    workflow_name: Optional[str]
    created_at: datetime
    duration_seconds: float
    is_completed: bool


@router.get("/organizations/{org_id}/runs", response_model=List[AuditedWorkflowRunResponse])
async def list_organization_runs_for_audit(
    org_id: int,
    year: int = Query(..., description="Target year"),
    month: int = Query(..., description="Target month"),
    user: UserModel = Depends(get_superuser),
):
    """List all workflow runs for a specific organization in a billing cycle for superadmin audit."""
    from datetime import datetime, timezone
    from dateutil.relativedelta import relativedelta
    from sqlalchemy.orm import joinedload
    from api.db.models import OrganizationModel, OrganizationUsageCycleModel, WorkflowModel, WorkflowRunModel
    
    async with db_client.async_session() as session:
        org = await session.get(OrganizationModel, org_id)
        if not org:
            raise HTTPException(status_code=404, detail="Organization not found")
            
        reset_day = getattr(org, "quota_reset_day", 1) or 1
        try:
            period_start = datetime(year, month, reset_day, 0, 0, 0, tzinfo=timezone.utc)
        except ValueError:
            period_start = datetime(year, month, 1, 0, 0, 0, tzinfo=timezone.utc)
            
        period_end = period_start + relativedelta(months=1) - relativedelta(seconds=1)
        
        stmt = (
            select(WorkflowRunModel)
            .join(WorkflowModel, WorkflowRunModel.workflow_id == WorkflowModel.id)
            .options(joinedload(WorkflowRunModel.workflow))
            .where(
                WorkflowModel.organization_id == org_id,
                WorkflowRunModel.created_at >= period_start,
                WorkflowRunModel.created_at <= period_end
            )
            .order_by(WorkflowRunModel.created_at.desc())
        )
        runs_result = await session.execute(stmt)
        runs = list(runs_result.scalars().all())
        
        return [
            AuditedWorkflowRunResponse(
                id=r.id,
                name=r.name,
                workflow_name=r.workflow.name if r.workflow else "Unknown",
                created_at=r.created_at,
                duration_seconds=float(r.cost_info.get("call_duration_seconds", 0) or 0),
                is_completed=r.is_completed
            )
            for r in runs
        ]


@router.delete("/runs/{run_id}")
async def delete_workflow_run_for_audit(
    run_id: int,
    user: UserModel = Depends(get_superuser),
):
    """Delete a workflow run and recalculate the corresponding usage cycle duration."""
    from sqlalchemy.orm import joinedload
    from api.db.models import WorkflowRunModel, WorkflowModel, OrganizationUsageCycleModel
    
    async with db_client.async_session() as session:
        stmt = (
            select(WorkflowRunModel)
            .options(joinedload(WorkflowRunModel.workflow))
            .where(WorkflowRunModel.id == run_id)
        )
        run_result = await session.execute(stmt)
        run = run_result.scalar_one_or_none()
        if not run:
            raise HTTPException(status_code=404, detail="Workflow run not found")
            
        workflow = run.workflow
        if not workflow or not workflow.organization_id:
            await session.delete(run)
            await session.commit()
            return {"detail": "Workflow run deleted successfully"}
            
        org_id = workflow.organization_id
        run_created_at = run.created_at
        
        await session.delete(run)
        await session.commit()
        
        stmt_cycle = (
            select(OrganizationUsageCycleModel)
            .where(
                OrganizationUsageCycleModel.organization_id == org_id,
                OrganizationUsageCycleModel.period_start <= run_created_at,
                OrganizationUsageCycleModel.period_end >= run_created_at
            )
        )
        cycle_result = await session.execute(stmt_cycle)
        cycle = cycle_result.scalar_one_or_none()
        
        if cycle:
            stmt_runs = (
                select(WorkflowRunModel)
                .join(WorkflowModel, WorkflowRunModel.workflow_id == WorkflowModel.id)
                .where(
                    WorkflowModel.organization_id == org_id,
                    WorkflowRunModel.created_at >= cycle.period_start,
                    WorkflowRunModel.created_at <= cycle.period_end
                )
            )
            remaining_runs_result = await session.execute(stmt_runs)
            remaining_runs = remaining_runs_result.scalars().all()
            
            total_seconds = 0
            for r in remaining_runs:
                cost_info = r.cost_info or {}
                duration = cost_info.get("call_duration_seconds", 0) or 0
                total_seconds += int(round(duration))
                
            cycle.total_duration_seconds = total_seconds
            await session.commit()
            
        return {"detail": "Workflow run deleted and cycle minutes recalculated successfully"}


@router.delete("/runs")
async def delete_all_workflow_runs(
    org_id: Optional[int] = Query(None, description="If provided, only delete runs for this organization"),
    user: UserModel = Depends(get_superuser),
):
    """
    Bulk-delete all workflow runs (optionally scoped to one organization).

    After deletion, every affected usage cycle's ``total_duration_seconds`` is
    recalculated from the surviving runs so that the billing wallet stays
    accurate.

    Query params:
        org_id – when supplied only runs whose workflow belongs to that org
                 are removed; when omitted **all** runs in the system are deleted.
    """
    from sqlalchemy.orm import joinedload
    from api.db.models import WorkflowRunModel, WorkflowModel, OrganizationUsageCycleModel

    async with db_client.async_session() as session:
        # ── 1. Collect the IDs and org associations of runs to delete ─────────
        if org_id is not None:
            # Validate org exists
            org = await session.get(OrganizationModel, org_id)
            if not org:
                raise HTTPException(status_code=404, detail="Organization not found")

            stmt = (
                select(WorkflowRunModel)
                .join(WorkflowModel, WorkflowRunModel.workflow_id == WorkflowModel.id)
                .where(WorkflowModel.organization_id == org_id)
                .options(joinedload(WorkflowRunModel.workflow))
            )
        else:
            stmt = (
                select(WorkflowRunModel)
                .options(joinedload(WorkflowRunModel.workflow))
            )

        result = await session.execute(stmt)
        runs_to_delete = result.scalars().all()

        if not runs_to_delete:
            return {"detail": "No workflow runs found to delete", "deleted_count": 0}

        # ── 2. Collect affected (org_id, created_at) pairs for cycle recalc ──
        affected_org_ids: set[int] = set()
        for r in runs_to_delete:
            if r.workflow and r.workflow.organization_id:
                affected_org_ids.add(r.workflow.organization_id)

        # ── 3. Delete the runs ─────────────────────────────────────────────────
        run_ids = [r.id for r in runs_to_delete]
        deleted_count = len(run_ids)

        await session.execute(
            sa_delete(WorkflowRunModel).where(WorkflowRunModel.id.in_(run_ids))
        )
        await session.commit()

        # ── 4. Recalculate total_duration_seconds for every affected cycle ────
        for affected_org_id in affected_org_ids:
            # Fetch all cycles for this org
            cycles_result = await session.execute(
                select(OrganizationUsageCycleModel).where(
                    OrganizationUsageCycleModel.organization_id == affected_org_id
                )
            )
            cycles = cycles_result.scalars().all()

            for cycle in cycles:
                # Sum duration of surviving runs in this cycle window
                surviving_result = await session.execute(
                    select(WorkflowRunModel)
                    .join(WorkflowModel, WorkflowRunModel.workflow_id == WorkflowModel.id)
                    .where(
                        WorkflowModel.organization_id == affected_org_id,
                        WorkflowRunModel.created_at >= cycle.period_start,
                        WorkflowRunModel.created_at <= cycle.period_end,
                    )
                )
                surviving_runs = surviving_result.scalars().all()
                total_seconds = sum(
                    int(round(r.cost_info.get("call_duration_seconds", 0) or 0))
                    for r in surviving_runs
                    if r.cost_info
                )
                cycle.total_duration_seconds = total_seconds

        await session.commit()

        return {
            "detail": f"Deleted {deleted_count} workflow run(s) and recalculated usage cycles successfully",
            "deleted_count": deleted_count,
        }
