import asyncio
import json
import re
from typing import Any, Dict, List
from google.oauth2 import service_account
from googleapiclient.discovery import build
from loguru import logger

from api.services.campaign.contact_fetchers.base import BaseContactFetcher
from api.utils.telephony_address import normalize_telephony_address


def _fetch_sheet_values(spreadsheet_id: str, range_name: str, service_account_info: Dict[str, Any] = None, api_key: str = None) -> List[List[str]]:
    if service_account_info:
        creds = service_account.Credentials.from_service_account_info(service_account_info)
        service = build('sheets', 'v4', credentials=creds)
    elif api_key:
        service = build('sheets', 'v4', developerKey=api_key)
    else:
        raise ValueError("Either service_account_info or api_key must be provided")

    sheet = service.spreadsheets()
    result = sheet.values().get(spreadsheetId=spreadsheet_id, range=range_name).execute()
    return result.get('values', [])


class GoogleSheetsContactFetcher(BaseContactFetcher):
    """Fetcher for loading contacts from Google Sheets."""

    async def validate_config(self, config: Dict[str, Any], org_id: int) -> bool:
        spreadsheet_id = config.get("spreadsheet_id")
        range_name = config.get("range_name", "Sheet1!A:Z")
        auth_type = config.get("auth_type", "public")
        api_key = config.get("api_key")
        service_account_json = config.get("service_account_json")

        if not spreadsheet_id:
            raise ValueError("Spreadsheet ID is required")

        service_account_info = None
        if auth_type == "service_account":
            if not service_account_json:
                raise ValueError("Service Account JSON is required for service_account auth type")
            try:
                if isinstance(service_account_json, str):
                    service_account_info = json.loads(service_account_json)
                else:
                    service_account_info = service_account_json
            except Exception as e:
                raise ValueError(f"Invalid Service Account JSON format: {str(e)}")
        elif auth_type == "public" and not api_key:
            raise ValueError("API Key is required for public auth type")

        try:
            # Try fetching a small range to validate connection
            values = await asyncio.to_thread(
                _fetch_sheet_values,
                spreadsheet_id,
                f"{range_name.split('!')[0]}!A1:B2" if '!' in range_name else "A1:B2",
                service_account_info,
                api_key
            )
            return True
        except Exception as e:
            logger.error(f"Google Sheets validation failed: {e}")
            raise ValueError(f"Failed to connect to Google Sheet: {str(e)}")

    async def preview_contacts(self, config: Dict[str, Any], org_id: int, limit: int = 5) -> List[Dict[str, Any]]:
        contacts = await self.fetch_contacts(config, org_id)
        return contacts[:limit]

    async def fetch_contacts(self, config: Dict[str, Any], org_id: int) -> List[Dict[str, Any]]:
        spreadsheet_id = config.get("spreadsheet_id")
        range_name = config.get("range_name", "Sheet1!A:Z")
        auth_type = config.get("auth_type", "public")
        api_key = config.get("api_key")
        service_account_json = config.get("service_account_json")
        phone_column = config.get("phone_column", "phone_number").strip().lower()

        service_account_info = None
        if auth_type == "service_account" and service_account_json:
            if isinstance(service_account_json, str):
                service_account_info = json.loads(service_account_json)
            else:
                service_account_info = service_account_json

        try:
            raw_rows = await asyncio.to_thread(
                _fetch_sheet_values,
                spreadsheet_id,
                range_name,
                service_account_info,
                api_key
            )
        except Exception as e:
            raise ValueError(f"Failed to fetch Google Sheet data: {str(e)}")

        if not raw_rows or len(raw_rows) < 2:
            return []

        headers = [h.strip().lower() for h in raw_rows[0]]
        
        # Determine phone number column index
        phone_idx = -1
        if phone_column in headers:
            phone_idx = headers.index(phone_column)
        else:
            # Try to auto-detect if user-specified field isn't exact
            for i, header in enumerate(headers):
                if header in ["phone", "phone number", "mobile", "phone_number", "number"]:
                    phone_idx = i
                    break

        if phone_idx == -1:
            raise ValueError(f"Phone number column '{phone_column}' not found in Google Sheet headers: {headers}")

        contacts = []
        for row in raw_rows[1:]:
            if len(row) <= phone_idx or not row[phone_idx].strip():
                continue

            raw_phone = row[phone_idx].strip()
            try:
                # Normalize phone number to E.164
                normalized_phone = normalize_telephony_address(raw_phone).canonical
            except Exception:
                # Fallback: remove non-digits, keep '+' if present, or ignore
                cleaned = re.sub(r"[^\d+]", "", raw_phone)
                if not cleaned.startswith("+"):
                    cleaned = "+" + cleaned
                normalized_phone = cleaned

            # Create context variables from sheet row
            context = {}
            for col_idx, col_name in enumerate(headers):
                val = row[col_idx].strip() if col_idx < len(row) else ""
                if col_name == headers[phone_idx]:
                    context["phone_number"] = normalized_phone
                else:
                    context[col_name] = val

            if "phone_number" not in context:
                context["phone_number"] = normalized_phone

            contacts.append(context)

        return contacts
