from fastapi import APIRouter, Query, HTTPException, Request, Response
from fastapi.responses import PlainTextResponse
from loguru import logger
from sqlalchemy.future import select

from api.db import db_client
from api.db.models import OrganizationModel, WhatsAppMessageModel

router = APIRouter(prefix="/whatsapp/webhook", tags=["WhatsApp Webhook"])


@router.get("/{org_id}", response_class=PlainTextResponse)
async def verify_webhook(
    org_id: int,
    hub_mode: str = Query(None, alias="hub.mode"),
    hub_challenge: str = Query(None, alias="hub.challenge"),
    hub_verify_token: str = Query(None, alias="hub.verify_token"),
):
    """Verify WhatsApp webhook challenge from Meta Graph API."""
    logger.info(f"Received webhook verification request for org {org_id}")
    
    if hub_mode != "subscribe" or not hub_challenge or not hub_verify_token:
        logger.warning("Invalid verification params received from Meta")
        raise HTTPException(status_code=400, detail="Invalid verification parameters")

    async with db_client.async_session() as session:
        org = await session.get(OrganizationModel, org_id)
        if not org or not org.whatsapp_enabled:
            logger.warning(f"Webhook verify failed: Org {org_id} not found or WhatsApp disabled")
            raise HTTPException(status_code=404, detail="Organization or feature not found")

        if org.whatsapp_webhook_verify_token != hub_verify_token:
            logger.warning(f"Webhook verify failed: Token mismatch for org {org_id}")
            raise HTTPException(status_code=403, detail="Verification token mismatch")

        logger.info(f"Webhook verified successfully for org {org_id}")
        return PlainTextResponse(content=hub_challenge, status_code=200)


@router.post("/{org_id}")
async def handle_webhook_callback(org_id: int, request: Request):
    """Receive and process message status updates and payloads from Meta."""
    try:
        payload = await request.json()
    except Exception as e:
        logger.error(f"Failed to parse callback JSON payload: {e}")
        return {"status": "error", "message": "Invalid JSON"}

    logger.debug(f"Received WhatsApp callback for org {org_id}: {payload}")

    # Process entries
    entries = payload.get("entry", [])
    for entry in entries:
        changes = entry.get("changes", [])
        for change in changes:
            value = change.get("value", {})
            statuses = value.get("statuses", [])
            
            for status_info in statuses:
                wamid = status_info.get("id")
                status_str = status_info.get("status")  # sent, delivered, read, failed
                
                if not wamid or not status_str:
                    continue
                
                # Fetch message and update status
                async with db_client.async_session() as session:
                    stmt = select(WhatsAppMessageModel).where(
                        WhatsAppMessageModel.whatsapp_message_id == wamid,
                        WhatsAppMessageModel.organization_id == org_id
                    )
                    res = await session.execute(stmt)
                    db_message = res.scalars().first()
                    
                    if db_message:
                        db_message.status = status_str
                        # Parse error if any
                        errors = status_info.get("errors", [])
                        if errors:
                            error = errors[0]
                            db_message.error_message = f"Code {error.get('code')}: {error.get('message')}"
                        
                        await session.commit()
                        logger.info(f"Updated WhatsApp message {wamid} status to {status_str}")
                    else:
                        logger.warning(f"WhatsApp message with ID {wamid} not found in org {org_id}")

    return {"status": "success"}
