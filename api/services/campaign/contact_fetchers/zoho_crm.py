import re
from typing import Any, Dict, List, Optional
import httpx
from loguru import logger

from api.services.campaign.contact_fetchers.base import BaseContactFetcher
from api.utils.telephony_address import normalize_telephony_address


class ZohoCRMContactFetcher(BaseContactFetcher):
    """Zoho CRM contact fetcher supporting OAuth token refresh, custom modules and views."""

    async def _get_access_token(self, config: Dict[str, Any], org_id: int) -> str:
        credential_id = config.get("credential_id")
        
        # If no DB credential reference, use the static token in config
        if not credential_id:
            token = config.get("access_token")
            if not token:
                raise ValueError("Zoho CRM Access Token is not configured")
            return token

        # Load from DB
        from api.db import db_client
        from sqlalchemy.future import select
        from api.db.models import CRMCredentialModel
        from api.utils.encryption import decrypt_json, encrypt_json

        async with db_client.session_factory() as session:
            stmt = select(CRMCredentialModel).where(
                CRMCredentialModel.id == int(credential_id),
                CRMCredentialModel.organization_id == org_id,
                CRMCredentialModel.is_active == True
            )
            res = await session.execute(stmt)
            cred = res.scalar_one_or_none()
            if not cred:
                raise ValueError(f"Zoho CRM Credential {credential_id} not found or inactive")

            cred_dict = decrypt_json(cred.credentials)
            
            # Check if we have refresh details
            refresh_token = cred_dict.get("refresh_token")
            client_id = cred_dict.get("client_id")
            client_secret = cred_dict.get("client_secret")
            access_token = cred_dict.get("access_token")

            # If refresh details are present, always attempt refresh to guarantee validity
            # (or we could store expires_at, but proactive refresh is extremely robust for background syncs)
            if refresh_token and client_id and client_secret:
                try:
                    accounts_url = cred_dict.get("accounts_url", "https://accounts.zoho.com")
                    refresh_url = f"{accounts_url}/oauth/v2/token"
                    
                    data = {
                        "refresh_token": refresh_token,
                        "client_id": client_id,
                        "client_secret": client_secret,
                        "grant_type": "refresh_token"
                    }
                    
                    async with httpx.AsyncClient(timeout=10.0) as client:
                        response = await client.post(refresh_url, data=data)
                        response.raise_for_status()
                        res_data = response.json()
                        
                        new_access_token = res_data.get("access_token")
                        if new_access_token:
                            access_token = new_access_token
                            cred_dict["access_token"] = new_access_token
                            if "api_domain" in res_data:
                                cred_dict["api_domain"] = res_data["api_domain"]
                            
                            # Save back to database
                            cred.credentials = encrypt_json(cred_dict)
                            session.add(cred)
                            await session.commit()
                            logger.info(f"Successfully refreshed Zoho CRM token for credential {credential_id}")
                except Exception as e:
                    logger.error(f"Failed to refresh Zoho CRM token: {e}")
                    # Fallback to current access_token if refresh failed
                    if not access_token:
                        raise ValueError(f"Failed to refresh expired Zoho CRM token: {str(e)}")

        return access_token

    async def validate_config(self, config: Dict[str, Any], org_id: int) -> bool:
        try:
            token = await self._get_access_token(config, org_id)
        except ValueError as e:
            raise ValueError(f"Zoho CRM validation failed: {str(e)}")

        api_domain = config.get("api_domain", "https://www.zohoapis.com").rstrip('/')
        module = config.get("module", "Leads").strip()
        
        headers = {"Authorization": f"Zoho-oauthtoken {token}"}
        url = f"{api_domain}/crm/v6/{module}"
        params = {"per_page": 1}

        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                response = await client.get(url, headers=headers, params=params)
                response.raise_for_status()
                return True
            except Exception as e:
                logger.error(f"Zoho CRM connection test failed: {e}")
                raise ValueError(f"Failed to connect to Zoho CRM: {str(e)}")

    async def preview_contacts(self, config: Dict[str, Any], org_id: int, limit: int = 5) -> List[Dict[str, Any]]:
        contacts = await self._fetch_zoho_contacts(config, org_id, limit=limit)
        return contacts[:limit]

    async def fetch_contacts(self, config: Dict[str, Any], org_id: int) -> List[Dict[str, Any]]:
        return await self._fetch_zoho_contacts(config, org_id)

    async def _fetch_zoho_contacts(self, config: Dict[str, Any], org_id: int, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        token = await self._get_access_token(config, org_id)
        api_domain = config.get("api_domain", "https://www.zohoapis.com").rstrip('/')
        module = config.get("module", "Leads").strip()
        phone_field = config.get("phone_field", "Phone").strip()
        view_id = config.get("view_id")

        headers = {"Authorization": f"Zoho-oauthtoken {token}"}
        contacts = []
        page = 1
        more_records = True

        async with httpx.AsyncClient(timeout=15.0) as client:
            while more_records:
                url = f"{api_domain}/crm/v6/{module}"
                params = {
                    "page": page,
                    "per_page": 100
                }
                if view_id:
                    params["cvid"] = view_id

                try:
                    response = await client.get(url, headers=headers, params=params)
                    if response.status_code == 204:  # No Content
                        break
                    response.raise_for_status()
                    data = response.json()
                except Exception as e:
                    raise ValueError(f"Failed to fetch contacts from Zoho CRM: {str(e)}")

                records = data.get("data", [])
                if not records:
                    break

                for rec in records:
                    phone_val = rec.get(phone_field)
                    if not phone_val:
                        # Fallback phone field checks
                        for fb in ["Phone", "Mobile", "Phone_Number", "Mobile_Number", "phone", "mobile"]:
                            phone_val = rec.get(fb)
                            if phone_val:
                                break
                    if not phone_val:
                        continue

                    # Map record fields to context dict
                    context = {}
                    for k, v in rec.items():
                        # Exclude complex nested metadata structures
                        if isinstance(v, (dict, list)):
                            continue
                        context[k] = str(v) if v is not None else ""

                    norm_phone = self._normalize_phone(phone_val)
                    context["phone_number"] = norm_phone
                    contacts.append(context)

                    if limit and len(contacts) >= limit:
                        return contacts

                info = data.get("info", {})
                more_records = info.get("more_records", False)
                page += 1

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
