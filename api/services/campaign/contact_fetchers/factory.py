from typing import Dict, Type
from api.services.campaign.contact_fetchers.base import BaseContactFetcher
from api.services.campaign.contact_fetchers.google_sheets import GoogleSheetsContactFetcher
from api.services.campaign.contact_fetchers.api_endpoint import APIEndpointContactFetcher
from api.services.campaign.contact_fetchers.hubspot import HubSpotContactFetcher
from api.services.campaign.contact_fetchers.zoho_crm import ZohoCRMContactFetcher
from api.services.campaign.contact_fetchers.salesforce import SalesforceContactFetcher


class ContactFetcherFactory:
    """Factory for retrieving contact fetcher instances based on source type."""

    _fetchers: Dict[str, Type[BaseContactFetcher]] = {
        "google_sheets": GoogleSheetsContactFetcher,
        "api_endpoint": APIEndpointContactFetcher,
        "hubspot": HubSpotContactFetcher,
        "zoho_crm": ZohoCRMContactFetcher,
        "salesforce": SalesforceContactFetcher,
    }

    @classmethod
    def get_fetcher(cls, source_type: str) -> BaseContactFetcher:
        """Get fetcher instance for the given source type."""
        fetcher_cls = cls._fetchers.get(source_type.lower())
        if not fetcher_cls:
            raise ValueError(f"Unsupported contact source type: {source_type}")
        return fetcher_cls()
