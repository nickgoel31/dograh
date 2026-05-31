import json
import time
from collections import defaultdict
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import select

from api.db import db_client
from api.db.models import OrganizationModel, UserModel
from api.services.auth.depends import get_superuser
from api.services.auth.stack_auth import stackauth

router = APIRouter(prefix="/superuser", tags=["superuser"])

# Simple in-memory rate limiter for impersonation
impersonate_rate_limits = defaultdict(list)


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
    client_ip = fastapi_request.client.host if fastapi_request.client else "unknown"
    current_time = time.time()
    
    # Clean up old entries (older than 1 minute)
    impersonate_rate_limits[client_ip] = [t for t in impersonate_rate_limits[client_ip] if current_time - t < 60]
    
    # Allow max 10 requests per minute
    if len(impersonate_rate_limits[client_ip]) >= 10:
        raise HTTPException(status_code=429, detail="Too many impersonation requests. Please try again later.")
        
    impersonate_rate_limits[client_ip].append(current_time)

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

@router.get("/organizations")
async def list_all_organizations(user: UserModel = Depends(get_superuser)):
    """List all organizations on the platform."""
    async with db_client.async_session_maker() as session:
        result = await session.execute(select(OrganizationModel))
        orgs = result.scalars().all()

    return [{"id": o.id, "name": o.name, "provider_id": o.provider_id} for o in orgs]


class SuperuserUserResponse(BaseModel):
    id: int
    email: Optional[str]
    role: str
    is_superuser: bool
    created_at: datetime
    selected_organization_id: Optional[int]
    provider_id: Optional[str] = None


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
    user: UserModel = Depends(get_superuser),
):
    """List all users in the system."""
    users, total_count = await db_client.get_all_users_paginated(page=page, limit=limit)
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
