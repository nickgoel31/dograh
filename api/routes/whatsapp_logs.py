from datetime import datetime, UTC
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query
from loguru import logger
from sqlalchemy import func
from sqlalchemy.future import select

from api.db import db_client
from api.db.models import UserModel, WhatsAppMessageModel, OrganizationModel
from api.services.auth.depends import require_role
from api.enums import UserRole
from api.services.whatsapp.client import WhatsAppClient

router = APIRouter(prefix="/whatsapp", tags=["WhatsApp Logs"])


from sqlalchemy.orm import selectinload

async def check_whatsapp_enabled(user: UserModel) -> OrganizationModel:
    """Dependency to check if WhatsApp is enabled for the user's selected organization."""
    if not user.selected_organization_id:
        raise HTTPException(status_code=400, detail="No organization selected")
        
    org = await db_client.get_organization_by_id(user.selected_organization_id)
    if not org or not org.whatsapp_enabled:
        raise HTTPException(
            status_code=403,
            detail="WhatsApp integration is not enabled for your organization"
        )
    return org


@router.get("/logs")
async def list_whatsapp_logs(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    status: Optional[str] = Query(None),
    recipient_phone: Optional[str] = Query(None),
    user: UserModel = Depends(require_role([UserRole.ADMIN, UserRole.CLIENT])),
):
    """Retrieve paginated list of sent WhatsApp messages for the selected organization."""
    org = await check_whatsapp_enabled(user)
    
    async with db_client.async_session() as session:
        # Build query
        query = select(WhatsAppMessageModel).where(
            WhatsAppMessageModel.organization_id == org.id
        ).options(selectinload(WhatsAppMessageModel.workflow_run))
        
        if status:
            query = query.where(WhatsAppMessageModel.status == status)
            
        if recipient_phone:
            query = query.where(WhatsAppMessageModel.recipient_phone.contains(recipient_phone))
            
        # Count total
        count_stmt = select(func.count()).select_from(query.subquery())
        total_result = await session.execute(count_stmt)
        total = total_result.scalar() or 0
        
        # Paginate and fetch
        query = query.order_by(WhatsAppMessageModel.created_at.desc())
        query = query.offset((page - 1) * limit).limit(limit)
        
        result = await session.execute(query)
        messages = result.scalars().all()
        
        return {
            "total": total,
            "page": page,
            "limit": limit,
            "logs": [
                {
                    "id": m.id,
                    "direction": m.direction,
                    "message_type": m.message_type,
                    "whatsapp_message_id": m.whatsapp_message_id,
                    "recipient_phone": m.recipient_phone,
                    "template_name": m.template_name,
                    "template_language": m.template_language,
                    "message_body": m.message_body,
                    "status": m.status,
                    "error_message": m.error_message,
                    "created_at": m.created_at,
                    "updated_at": m.updated_at,
                    "workflow_run_id": m.workflow_run_id,
                    "workflow_id": m.workflow_run.workflow_id if m.workflow_run else None,
                }
                for m in messages
            ]
        }


@router.post("/logs/{message_id}/retry")
async def retry_whatsapp_message(
    message_id: int,
    user: UserModel = Depends(require_role([UserRole.ADMIN])),
):
    """Retry sending a failed outbound WhatsApp message."""
    org = await check_whatsapp_enabled(user)
    
    async with db_client.async_session() as session:
        stmt = select(WhatsAppMessageModel).where(
            WhatsAppMessageModel.id == message_id,
            WhatsAppMessageModel.organization_id == org.id
        )
        res = await session.execute(stmt)
        msg = res.scalars().first()
        
        if not msg:
            raise HTTPException(status_code=404, detail="WhatsApp message log not found")
            
        if msg.direction != "outbound":
            raise HTTPException(status_code=400, detail="Cannot retry incoming messages")
            
        if not org.whatsapp_phone_number_id or not org.whatsapp_access_token:
            raise HTTPException(status_code=400, detail="Organization is missing WhatsApp API credentials")

        # Parse parameters back from body
        # Message body was stored in the format: "Template: template_name. Parameters: param1, param2, ..."
        parameters = []
        if msg.message_body and "Parameters: " in msg.message_body:
            parts = msg.message_body.split("Parameters: ", 1)
            if len(parts) > 1:
                parameters = [p.strip() for p in parts[1].split(",") if p.strip()]

        # Mark as pending and attempt resend
        msg.status = "pending"
        msg.error_message = None
        msg.updated_at = datetime.now(UTC)
        await session.commit()
        
        try:
            client = WhatsAppClient(
                phone_number_id=org.whatsapp_phone_number_id,
                encrypted_access_token=org.whatsapp_access_token,
                business_account_id=org.whatsapp_business_account_id
            )
            response = await client.send_template_message(
                to=msg.recipient_phone,
                template_name=msg.template_name or "call_summary",
                language_code=msg.template_language or "en",
                parameters=parameters
            )
            
            messages = response.get("messages", [])
            if messages:
                msg.whatsapp_message_id = messages[0].get("id")
            msg.status = "sent"
            msg.updated_at = datetime.now(UTC)
            await session.commit()
            return {"status": "success", "whatsapp_message_id": msg.whatsapp_message_id}
            
        except Exception as e:
            logger.error(f"WhatsApp retry failed: {e}")
            msg.status = "failed"
            msg.error_message = str(e)
            msg.updated_at = datetime.now(UTC)
            await session.commit()
            raise HTTPException(status_code=500, detail=f"Failed to retry WhatsApp message: {str(e)}")
