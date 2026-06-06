from api.services.campaign.source_sync import CampaignSourceSyncService
from api.services.campaign.sources.csv import CSVSyncService
from api.services.campaign.sources.live_source import LiveSourceSyncService


def get_sync_service(source_type: str) -> CampaignSourceSyncService:
    """Returns appropriate sync service based on source type"""

    services = {
        "csv": CSVSyncService,
        "google_sheets": LiveSourceSyncService,
        "api_endpoint": LiveSourceSyncService,
        "hubspot": LiveSourceSyncService,
        "zoho_crm": LiveSourceSyncService,
        "salesforce": LiveSourceSyncService,
    }

    service_class = services.get(source_type)
    if not service_class:
        raise ValueError(f"Unknown source type: {source_type}")

    return service_class()

