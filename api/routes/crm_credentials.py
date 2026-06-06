from datetime import datetime
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api.db import db_client
from api.db.models import UserModel
from api.services.auth.depends import get_user, require_role
from api.enums import UserRole

router = APIRouter(prefix="/crm-credentials")


class SaveCRMCredentialRequest(BaseModel):
    provider: str = Field(..., pattern="^(hubspot|zoho_crm|salesforce)$")
    name: str = Field(..., min_length=1, max_length=255)
    credentials_data: Dict[str, Any]


class CRMCredentialResponse(BaseModel):
    id: int
    provider: str
    name: str
    is_active: bool
    created_at: datetime
    last_used_at: Optional[datetime] = None


@router.post("")
async def save_crm_credential(
    request: SaveCRMCredentialRequest,
    user: UserModel = Depends(require_role([UserRole.ADMIN])),
) -> CRMCredentialResponse:
    """Create or update organization's CRM credential."""
    if not user.selected_organization_id:
        raise HTTPException(status_code=400, detail="No organization selected")

    try:
        credential = await db_client.create_crm_credential(
            organization_id=user.selected_organization_id,
            provider=request.provider,
            name=request.name,
            credentials_data=request.credentials_data
        )
        return CRMCredentialResponse(
            id=credential.id,
            provider=credential.provider,
            name=credential.name,
            is_active=credential.is_active,
            created_at=credential.created_at,
            last_used_at=credential.last_used_at
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("")
async def list_crm_credentials(
    user: UserModel = Depends(require_role([UserRole.ADMIN])),
) -> List[CRMCredentialResponse]:
    """List all CRM credentials for organization."""
    if not user.selected_organization_id:
        raise HTTPException(status_code=400, detail="No organization selected")

    credentials = await db_client.list_crm_credentials(user.selected_organization_id)
    return [
        CRMCredentialResponse(
            id=cred.id,
            provider=cred.provider,
            name=cred.name,
            is_active=cred.is_active,
            created_at=cred.created_at,
            last_used_at=cred.last_used_at
        )
        for cred in credentials
    ]


@router.get("/{provider}")
async def get_crm_credential(
    provider: str,
    user: UserModel = Depends(require_role([UserRole.ADMIN])),
) -> CRMCredentialResponse:
    """Get CRM credential metadata for provider."""
    if not user.selected_organization_id:
        raise HTTPException(status_code=400, detail="No organization selected")

    credential = await db_client.get_crm_credential(user.selected_organization_id, provider)
    if not credential:
        raise HTTPException(status_code=404, detail="CRM credential not found")

    return CRMCredentialResponse(
        id=credential.id,
        provider=credential.provider,
        name=credential.name,
        is_active=credential.is_active,
        created_at=credential.created_at,
        last_used_at=credential.last_used_at
    )


@router.delete("/{provider}")
async def delete_crm_credential(
    provider: str,
    user: UserModel = Depends(require_role([UserRole.ADMIN])),
) -> dict:
    """Delete CRM credential for provider."""
    if not user.selected_organization_id:
        raise HTTPException(status_code=400, detail="No organization selected")

    deleted = await db_client.delete_crm_credential(user.selected_organization_id, provider)
    if not deleted:
        raise HTTPException(status_code=404, detail="CRM credential not found")

    return {"status": "success", "provider": provider}
