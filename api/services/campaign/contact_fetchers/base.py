from abc import ABC, abstractmethod
from typing import Any, Dict, List


class BaseContactFetcher(ABC):
    """Abstract base class for all external contact fetchers."""

    @abstractmethod
    async def validate_config(self, config: Dict[str, Any], org_id: int) -> bool:
        """Validate configuration and connection to the source.

        Should raise ValueError/Exception with helpful messages if connection fails.
        """
        pass

    @abstractmethod
    async def preview_contacts(self, config: Dict[str, Any], org_id: int, limit: int = 5) -> List[Dict[str, Any]]:
        """Fetch and return a small preview list of parsed contact records (max `limit`).

        Each contact should be a dictionary containing at least 'phone_number'.
        """
        pass

    @abstractmethod
    async def fetch_contacts(self, config: Dict[str, Any], org_id: int) -> List[Dict[str, Any]]:
        """Fetch all contacts from the source.

        Returns:
            List[Dict[str, Any]]: List of contact dicts.
            Each dictionary MUST contain a 'phone_number' key in E.164 format.
            Any other keys will be included in the contact's initial_context.
        """
        pass
