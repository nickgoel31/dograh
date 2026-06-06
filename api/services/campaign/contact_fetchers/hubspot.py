import re
from typing import Any, Dict, List, Optional
import httpx
from loguru import logger

from api.services.campaign.contact_fetchers.base import BaseContactFetcher
from api.utils.telephony_address import normalize_telephony_address


class HubSpotContactFetcher(BaseContactFetcher):
    """HubSpot CRM contact fetcher supporting list membership and standard search."""

    async def _get_access_token(self, config: Dict[str, Any], org_id: int) -> str:
        access_token = config.get("access_token")
        credential_id = config.get("credential_id")
        if credential_id:
            # Import dynamically to avoid circular dependencies
            from api.db import db_client
            from sqlalchemy.future import select
            from api.db.models import CRMCredentialModel
            from api.utils.encryption import decrypt_json

            # Read credential from DB client
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
            raise ValueError("HubSpot Access Token is not configured")
        return access_token

    async def validate_config(self, config: Dict[str, Any], org_id: int) -> bool:
        try:
            token = await self._get_access_token(config, org_id)
        except ValueError as e:
            raise ValueError(f"HubSpot connection validation failed: {str(e)}")

        headers = {"Authorization": f"Bearer {token}"}
        url = "https://api.hubapi.com/crm/v3/objects/contacts?limit=1"
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                response = await client.get(url, headers=headers)
                response.raise_for_status()
                return True
            except Exception as e:
                logger.error(f"HubSpot connection test failed: {e}")
                raise ValueError(f"Failed to connect to HubSpot API: {str(e)}")

    async def preview_contacts(self, config: Dict[str, Any], org_id: int, limit: int = 5) -> List[Dict[str, Any]]:
        contacts = await self._fetch_hubspot_contacts(config, org_id, limit=limit)
        return contacts[:limit]

    async def fetch_contacts(self, config: Dict[str, Any], org_id: int) -> List[Dict[str, Any]]:
        return await self._fetch_hubspot_contacts(config, org_id)

    async def _fetch_hubspot_contacts(self, config: Dict[str, Any], org_id: int, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        token = await self._get_access_token(config, org_id)
        list_id = config.get("list_id")
        phone_property = config.get("phone_property", "phone").strip()
        extra_properties = config.get("extra_properties", [])

        # Default properties to retrieve
        props = list(set([phone_property, "firstname", "lastname", "email"] + extra_properties))
        
        headers = {"Authorization": f"Bearer {token}"}
        contacts = []

        async with httpx.AsyncClient(timeout=15.0) as client:
            if list_id:
                # Use HubSpot v1 List Contacts API (handles property formatting automatically)
                # GET /contacts/v1/lists/{list_id}/contacts/all
                url = f"https://api.hubapi.com/contacts/v1/lists/{list_id}/contacts/all"
                vid_offset = None
                has_more = True
                
                while has_more:
                    params = {"count": 100}
                    if vid_offset is not None:
                        params["vidOffset"] = vid_offset
                    
                    try:
                        response = await client.get(url, headers=headers, params=params)
                        response.raise_for_status()
                        data = response.json()
                    except Exception as e:
                        raise ValueError(f"Failed to fetch contacts from HubSpot list: {str(e)}")

                    raw_contacts = data.get("contacts", [])
                    for rc in raw_contacts:
                        props_dict = rc.get("properties", {})
                        phone_val = props_dict.get(phone_property, {}).get("value")
                        if not phone_val:
                            # Try fallback fields
                            for fb in ["phone", "mobilephone", "phone_number"]:
                                phone_val = props_dict.get(fb, {}).get("value")
                                if phone_val:
                                    break
                        if not phone_val:
                            continue

                        # Extract context variables from properties dict
                        context = {}
                        for prop_key, prop_val in props_dict.items():
                            context[prop_key] = prop_val.get("value", "")

                        norm_phone = self._normalize_phone(phone_val)
                        context["phone_number"] = norm_phone
                        contacts.append(context)

                        if limit and len(contacts) >= limit:
                            return contacts

                    has_more = data.get("has-more", False)
                    vid_offset = data.get("vid-offset")
                    if not has_more or not vid_offset:
                        break

            else:
                # Use standard CRM Contacts API v3
                # GET /crm/v3/objects/contacts
                url = "https://api.hubapi.com/crm/v3/objects/contacts"
                after = None
                has_more = True
                
                while has_more:
                    params = {
                        "limit": 100,
                        "properties": ",".join(props)
                    }
                    if after:
                        params["after"] = after
                    
                    try:
                        response = await client.get(url, headers=headers, params=params)
                        response.raise_for_status()
                        data = response.json()
                    except Exception as e:
                        raise ValueError(f"Failed to fetch HubSpot contacts: {str(e)}")

                    results = data.get("results", [])
                    for item in results:
                        item_props = item.get("properties", {})
                        phone_val = item_props.get(phone_property)
                        if not phone_val:
                            for fb in ["phone", "mobilephone", "phone_number"]:
                                phone_val = item_props.get(fb)
                                if phone_val:
                                    break
                        if not phone_val:
                            continue

                        # Extract properties
                        context = dict(item_props)
                        norm_phone = self._normalize_phone(phone_val)
                        context["phone_number"] = norm_phone
                        contacts.append(context)

                        if limit and len(contacts) >= limit:
                            return contacts

                    paging = data.get("paging", {})
                    after = paging.get("next", {}).get("after")
                    has_more = bool(after)
                    if not has_more:
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
