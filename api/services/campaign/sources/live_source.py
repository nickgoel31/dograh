import hashlib
from typing import Any, Dict, List, Optional
from loguru import logger
from sqlalchemy import func

from api.db import db_client
from api.services.campaign.source_sync import (
    CampaignSourceSyncService,
    ValidationError,
    ValidationResult,
)
from api.services.campaign.contact_fetchers.factory import ContactFetcherFactory


class LiveSourceSyncService(CampaignSourceSyncService):
    """Implementation for Live Campaign Source synchronization (Google Sheets, APIs, CRMs)"""

    async def validate_source(
        self, source_id: str, organization_id: Optional[int] = None, config: Optional[Dict[str, Any]] = None
    ) -> ValidationResult:
        """Validate a live source using the provided config dictionary."""
        # Fallback to campaign's saved config if config parameter is not passed
        if not config:
            return ValidationResult(
                is_valid=False,
                error=ValidationError(message="Source configuration is required for validation"),
            )

        source_type = config.get("source_type", source_id)
        try:
            fetcher = ContactFetcherFactory.get_fetcher(source_type)
            await fetcher.validate_config(config, organization_id)

            # Fetch a few items for schema validation
            preview = await fetcher.preview_contacts(config, organization_id, limit=5)
            if not preview:
                return ValidationResult(
                    is_valid=True,
                    headers=[],
                    rows=[]
                )

            headers = list(preview[0].keys())
            rows = [list(item.values()) for item in preview]

            return self.validate_source_data(headers, rows)
        except Exception as e:
            logger.error(f"Validation failed for live source {source_type}: {e}")
            return ValidationResult(
                is_valid=False,
                error=ValidationError(message=str(e)),
            )

    async def sync_source_data(self, campaign_id: int) -> int:
        """Fetch data from the live source and insert new queued runs into the DB."""
        campaign = await db_client.get_campaign_by_id(campaign_id)
        if not campaign:
            raise ValueError(f"Campaign {campaign_id} not found")

        source_type = campaign.source_type
        config = campaign.source_config or {}

        try:
            fetcher = ContactFetcherFactory.get_fetcher(source_type)
            contacts = await fetcher.fetch_contacts(config, campaign.organization_id)
        except Exception as e:
            logger.error(f"Live source sync failed for campaign {campaign_id}: {e}")
            # Update campaign state to store the error
            await db_client.update_campaign(
                campaign_id=campaign_id,
                source_sync_status="failed",
                source_sync_error=str(e),
                source_sync_errors=list(set((campaign.source_sync_errors or []) + [str(e)]))
            )
            raise e

        if not contacts:
            logger.warning(f"No contacts retrieved from live source {source_type} for campaign {campaign_id}")
            await db_client.update_campaign(
                campaign_id=campaign_id,
                source_sync_status="completed",
                source_total_fetched=0
            )
            return 0

        # Sourcing existing runs for deduplication
        existing_runs = await db_client.get_queued_runs_for_campaign(campaign_id)
        existing_uuids = {run.source_uuid for run in existing_runs if run.source_uuid}

        queued_runs = []
        for idx, contact in enumerate(contacts):
            phone_number = contact.get("phone_number")
            if not phone_number:
                continue

            # Unique key for contact based on source type & phone number hash
            phone_hash = hashlib.md5(phone_number.encode()).hexdigest()[:12]
            source_uuid = f"{source_type}_{phone_hash}"

            # Skip if already ingested and auto_sync_only_new is enabled
            if campaign.auto_sync_only_new and source_uuid in existing_uuids:
                continue

            # Prevent batch-level duplicates
            if any(qr["source_uuid"] == source_uuid for qr in queued_runs):
                continue

            queued_runs.append({
                "campaign_id": campaign_id,
                "source_uuid": source_uuid,
                "context_variables": contact,
                "state": "queued"
            })

        # Insert new records
        if queued_runs:
            await db_client.bulk_create_queued_runs(queued_runs)
            logger.info(f"Inserted {len(queued_runs)} new queued runs for campaign {campaign_id}")

        total_synced = len(queued_runs)

        await db_client.update_campaign(
            campaign_id=campaign_id,
            total_rows=(campaign.total_rows or 0) + total_synced,
            source_total_fetched=len(contacts),
            source_sync_status="completed",
            source_last_synced_at=func.now()
        )

        return total_synced
