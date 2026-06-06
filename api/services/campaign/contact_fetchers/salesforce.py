import re
from typing import Any, Dict, List, Optional
import httpx
from loguru import logger

from api.services.campaign.contact_fetchers.base import BaseContactFetcher
from api.utils.telephony_address import normalize_telephony_address


class SalesforceContactFetcher(BaseContactFetcher):
    """Salesforce CRM contact fetcher using SOQL query endpoint."""

    async def _get_access_token(self, config: Dict[str, Any], org_id: int) -> str:
        access_token = config.get("access_token")
        credential_id = config.get("credential_id")
        if credential_id:
            from api.db import db_client
            from sqlalchemy.future import select
            from api.db.models import CRMCredentialModel
            from api.utils.encryption import decrypt_json

            async with db_client.session_factory() as session:
                stmt = select(CRMCredentialModel).where(
                    CRMCredentialModel.id == int(credential_id),
                    CRMCredentialModel.organization_id == org_id,
                    CRMCredentialModel.is_active == True
                )
                res = await session.execute(stmt)
                cred = res.scalar_one_or_none()
                if cred:
                    cred_dict = decrypt_json(cred.credentials)
                    access_token = cred_dict.get("access_token")
        
        if not access_token:
            raise ValueError("Salesforce Access Token is not configured")
        return access_token

    async def validate_config(self, config: Dict[str, Any], org_id: int) -> bool:
        try:
            token = await self._get_access_token(config, org_id)
        except ValueError as e:
            raise ValueError(f"Salesforce validation failed: {str(e)}")

        instance_url = config.get("instance_url", "https://login.salesforce.com").rstrip('/')
        headers = {"Authorization": f"Bearer {token}"}
        # A simple query to validate connection
        query = "SELECT Id FROM Contact LIMIT 1"
        url = f"{instance_url}/services/data/v59.0/query"
        params = {"q": query}

        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                response = await client.get(url, headers=headers, params=params)
                response.raise_for_status()
                return True
            except Exception as e:
                logger.error(f"Salesforce connection test failed: {e}")
                raise ValueError(f"Failed to connect to Salesforce: {str(e)}")

    async def preview_contacts(self, config: Dict[str, Any], org_id: int, limit: int = 5) -> List[Dict[str, Any]]:
        contacts = await self._fetch_salesforce_contacts(config, org_id, limit=limit)
        return contacts[:limit]

    async def fetch_contacts(self, config: Dict[str, Any], org_id: int) -> List[Dict[str, Any]]:
        return await self._fetch_salesforce_contacts(config, org_id)

    async def _fetch_salesforce_contacts(self, config: Dict[str, Any], org_id: int, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        token = await self._get_access_token(config, org_id)
        instance_url = config.get("instance_url", "https://login.salesforce.com").rstrip('/')
        phone_field = config.get("phone_field", "Phone").strip()
        soql_query = config.get("soql_query")

        # If custom query is not provided, generate a default one
        if not soql_query:
            soql_query = f"SELECT Id, FirstName, LastName, Email, {phone_field} FROM Contact"

        headers = {"Authorization": f"Bearer {token}"}
        contacts = []
        
        async with httpx.AsyncClient(timeout=15.0) as client:
            url = f"{instance_url}/services/data/v59.0/query"
            params = {"q": soql_query}
            done = False

            while not done:
                try:
                    response = await client.get(url, headers=headers, params=params if url.endswith("/query") else None)
                    response.raise_for_status()
                    data = response.json()
                except Exception as e:
                    raise ValueError(f"Failed to execute Salesforce query: {str(e)}")

                records = data.get("records", [])
                for rec in records:
                    phone_val = rec.get(phone_field)
                    if not phone_val:
                        for fb in ["Phone", "MobilePhone", "phone", "mobile"]:
                            phone_val = rec.get(fb)
                            if phone_val:
                                break
                    if not phone_val:
                        continue

                    # Map record fields, dropping metadata attributes
                    context = {}
                    for k, v in rec.items():
                        if k == "attributes":
                            continue
                        context[k] = str(v) if v is not None else ""

                    norm_phone = self._normalize_phone(phone_val)
                    context["phone_number"] = norm_phone
                    contacts.append(context)

                    if limit and len(contacts) >= limit:
                        return contacts

                done = data.get("done", True)
                next_records_url = data.get("nextRecordsUrl")
                if not done and next_records_url:
                    url = f"{instance_url}{next_records_url}"
                    params = {}
                else:
                    break

        return contacts

    def _normalize_phone(self, phone: str) -> str:
        raw_phone = str(phone).strip()
        try:
            return normalize_telephony_address(raw_phone).canonical
        except Exception:
            cleaned = re.sub(r"[^\d+]", "", raw_phone)
            if not cleaned.startswith("+"):
                cleaned = "+" + cleaned
            return cleaned
