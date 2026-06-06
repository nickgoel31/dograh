from datetime import datetime, UTC
from loguru import logger
from typing import Optional
from sqlalchemy.future import select

from api.db import db_client
from api.db.models import WhatsAppMessageModel, OrganizationModel, WorkflowRunModel
from api.services.whatsapp.client import WhatsAppClient


async def trigger_post_call_whatsapp(workflow_run_id: int, organization_id: int) -> None:
    """Check organization and workflow settings and trigger WhatsApp follow-up.

    This function should be called at the end of the post-call execution pipeline,
    after call analysis/summary is complete.
    """
    logger.info(f"Checking WhatsApp follow-up for workflow run {workflow_run_id} in org {organization_id}")
    
    async with db_client.async_session() as session:
        # 1. Fetch organization and verify WhatsApp is enabled
        org_result = await session.execute(
            select(OrganizationModel).where(OrganizationModel.id == organization_id)
        )
        org = org_result.scalars().first()
        if not org or not org.whatsapp_enabled:
            logger.debug(f"WhatsApp follow-up skipped: Organization {organization_id} has WhatsApp disabled")
            return

        if not org.whatsapp_phone_number_id or not org.whatsapp_access_token:
            logger.warning(f"WhatsApp follow-up skipped: Organization {organization_id} is missing Meta credentials")
            return

        # 2. Fetch WorkflowRun with its definition
        run_result = await session.execute(
            select(WorkflowRunModel).where(WorkflowRunModel.id == workflow_run_id)
        )
        workflow_run = run_result.scalars().first()
        if not workflow_run:
            logger.error(f"WhatsApp follow-up failed: WorkflowRun {workflow_run_id} not found")
            return

        # Access workflow definition configurations
        definition = workflow_run.definition
        if not definition:
            logger.debug(f"WhatsApp follow-up skipped: WorkflowRun {workflow_run_id} has no definition")
            return

        workflow_configurations = definition.workflow_configurations or {}
        whatsapp_config = workflow_configurations.get("whatsapp", {})
        
        # Check if enabled for this specific agent/workflow
        enabled = whatsapp_config.get("enabled", False) or whatsapp_config.get("whatsapp_trigger", False)
        if not enabled:
            logger.debug(f"WhatsApp follow-up skipped: Disabled in workflow configurations for run {workflow_run_id}")
            return

        template_name = whatsapp_config.get("template_name", "call_summary")
        language_code = whatsapp_config.get("language_code", "en")

        # 3. Resolve recipient phone number
        # Look for recipient phone in initial context, gathered context, or name (usually name contains number)
        recipient_phone = (
            workflow_run.initial_context.get("phone_number")
            or workflow_run.initial_context.get("recipient_phone")
            or workflow_run.gathered_context.get("phone_number")
            or workflow_run.name  # fallback to run name which is often phone number
        )
        if not recipient_phone:
            logger.warning(f"WhatsApp follow-up skipped: No recipient phone number found in workflow run {workflow_run_id}")
            return

        # 4. Resolve template parameters
        # Standard variables
        contact_name = (
            workflow_run.initial_context.get("contact_name")
            or workflow_run.initial_context.get("name")
            or "Customer"
        )
        
        # Call duration
        duration_sec = workflow_run.usage_info.get("duration") or workflow_run.usage_info.get("duration_seconds", 0)
        try:
            duration_sec = float(duration_sec)
        except (ValueError, TypeError):
            duration_sec = 0.0
        minutes = int(duration_sec // 60)
        seconds = int(duration_sec % 60)
        duration_str = f"{minutes}m {seconds}s" if minutes > 0 else f"{seconds}s"

        # Summary
        summary = (
            workflow_run.annotations.get("summary")
            or workflow_run.annotations.get("qa_summary")
            or "Thank you for speaking with our AI agent."
        )

        # Booking link
        booking_link = (
            workflow_run.initial_context.get("booking_link")
            or workflow_run.gathered_context.get("booking_link")
            or "https://dograh.com"
        )

        # Transcript snippet
        transcript = (
            workflow_run.annotations.get("transcript")
            or "No transcript available."
        )

        # Map variables
        var_map = {
            "contact_name": contact_name,
            "duration": duration_str,
            "summary": summary,
            "booking_link": booking_link,
            "transcript": transcript[:200] + "..." if len(transcript) > 200 else transcript
        }

        # Determine parameter values based on template choice
        config_params = whatsapp_config.get("parameters")
        if isinstance(config_params, list):
            # Resolve parameters specified in the custom configuration list
            parameters = [str(var_map.get(p, p)) for p in config_params]
        else:
            # Standard order for default templates
            if "booking" in template_name.lower():
                parameters = [contact_name, booking_link]
            else:
                parameters = [contact_name, duration_str, summary]

        # 5. Create WhatsAppMessage record in pending state
        message_body = f"Template: {template_name}. Parameters: {', '.join(parameters)}"
        db_message = WhatsAppMessageModel(
            organization_id=organization_id,
            workflow_run_id=workflow_run_id,
            direction="outbound",
            message_type=template_name,
            recipient_phone=recipient_phone,
            template_name=template_name,
            template_language=language_code,
            message_body=message_body,
            status="pending"
        )
        session.add(db_message)
        await session.commit()
        await session.refresh(db_message)

        # 6. Dispatch message via client
        try:
            client = WhatsAppClient(
                phone_number_id=org.whatsapp_phone_number_id,
                encrypted_access_token=org.whatsapp_access_token,
                business_account_id=org.whatsapp_business_account_id
            )
            response = await client.send_template_message(
                to=recipient_phone,
                template_name=template_name,
                language_code=language_code,
                parameters=parameters
            )
            
            # Update message with Meta message ID on success
            messages = response.get("messages", [])
            if messages:
                db_message.whatsapp_message_id = messages[0].get("id")
            db_message.status = "sent"
            db_message.updated_at = datetime.now(UTC)
            await session.commit()
            logger.info(f"WhatsApp follow-up message sent successfully for run {workflow_run_id}")
            
        except Exception as e:
            logger.error(f"Failed to send WhatsApp message: {e}")
            db_message.status = "failed"
            db_message.error_message = str(e)
            db_message.updated_at = datetime.now(UTC)
            await session.commit()
