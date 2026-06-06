import base64
import json
import re
from typing import Any, Dict, List, Optional
import httpx
from loguru import logger

from api.services.campaign.contact_fetchers.base import BaseContactFetcher
from api.utils.telephony_address import normalize_telephony_address


def get_nested_value(data: Any, path: str) -> Any:
    """Helper to extract a nested value from dictionary/list using dot notation or list indices."""
    if not path:
        return data
    parts = path.split('.')
    current = data
    for part in parts:
        if isinstance(current, dict):
            current = current.get(part)
        elif isinstance(current, list):
            try:
                # If path contains index, parse it, otherwise return None
                idx = int(part)
                current = current[idx]
            except (ValueError, IndexError):
                return None
        else:
            return None
    return current


class APIEndpointContactFetcher(BaseContactFetcher):
    """Fetcher for REST API endpoints with pagination and auth configuration."""

    def _prepare_request(self, config: Dict[str, Any], page_val: Optional[Any] = None) -> Dict[str, Any]:
        url = config.get("url")
        method = config.get("method", "GET").upper()
        headers = dict(config.get("headers", {}))
        params = dict(config.get("params", {}))
        body = config.get("body")

        # Handle authentication
        auth_type = config.get("auth_type", "none")
        auth_config = config.get("auth_config", {})
        if auth_type == "bearer":
            token = auth_config.get("token")
            if token:
                headers["Authorization"] = f"Bearer {token}"
        elif auth_type == "basic":
            username = auth_config.get("username", "")
            password = auth_config.get("password", "")
            encoded = base64.b64encode(f"{username}:{password}".encode("utf-8")).decode("utf-8")
            headers["Authorization"] = f"Basic {encoded}"
        elif auth_type == "api_key":
            header_name = auth_config.get("header_name")
            api_key = auth_config.get("api_key")
            if header_name and api_key:
                headers[header_name] = api_key

        # Handle pagination parameters
        pagination_type = config.get("pagination_type", "none")
        pagination_config = config.get("pagination_config", {})
        
        if pagination_type != "none" and page_val is not None:
            if pagination_type == "page":
                page_param = pagination_config.get("page_param", "page")
                params[page_param] = page_val
            elif pagination_type == "offset":
                offset_param = pagination_config.get("offset_param", "offset")
                params[offset_param] = page_val
            elif pagination_type == "cursor":
                cursor_param = pagination_config.get("cursor_param", "cursor")
                params[cursor_param] = page_val

            # Inject limit if specified
            limit_param = pagination_config.get("limit_param")
            limit_val = pagination_config.get("limit")
            if limit_param and limit_val:
                params[limit_param] = limit_val

        # Handle body serialization
        data = None
        if body and method in ["POST", "PUT", "PATCH"]:
            if isinstance(body, str):
                try:
                    data = json.loads(body)
                except Exception:
                    data = body
            else:
                data = body

        return {
            "method": method,
            "url": url,
            "headers": headers,
            "params": params,
            "json": data if isinstance(data, dict) else None,
            "content": data if isinstance(data, str) else None
        }

    async def validate_config(self, config: Dict[str, Any], org_id: int) -> bool:
        url = config.get("url")
        if not url:
            raise ValueError("URL is required")

        req_opts = self._prepare_request(config)
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                response = await client.request(
                    method=req_opts["method"],
                    url=req_opts["url"],
                    headers=req_opts["headers"],
                    params=req_opts["params"],
                    json=req_opts["json"],
                    content=req_opts["content"]
                )
                response.raise_for_status()
                return True
            except Exception as e:
                logger.error(f"API Endpoint validation failed: {e}")
                raise ValueError(f"Failed to connect to API endpoint: {str(e)}")

    async def preview_contacts(self, config: Dict[str, Any], org_id: int, limit: int = 5) -> List[Dict[str, Any]]:
        # Run a single request to fetch first page and return limit items
        req_opts = self._prepare_request(config)
        json_path = config.get("json_path", "")
        phone_property = config.get("phone_property", "phone_number")

        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                response = await client.request(
                    method=req_opts["method"],
                    url=req_opts["url"],
                    headers=req_opts["headers"],
                    params=req_opts["params"],
                    json=req_opts["json"],
                    content=req_opts["content"]
                )
                response.raise_for_status()
                data = response.json()
            except Exception as e:
                raise ValueError(f"Failed to fetch preview data: {str(e)}")

        # Extract contacts list from response JSON
        contacts_list = get_nested_value(data, json_path) if json_path else data
        if not isinstance(contacts_list, list):
            # If the result is a dict but represents a single contact, wrap it
            if isinstance(contacts_list, dict):
                contacts_list = [contacts_list]
            else:
                raise ValueError(f"Expected a list of contacts at path '{json_path}', got {type(contacts_list)}")

        return self._parse_items(contacts_list, phone_property)[:limit]

    def _parse_items(self, items: List[Dict[str, Any]], phone_property: str) -> List[Dict[str, Any]]:
        parsed = []
        for idx, item in enumerate(items):
            if not isinstance(item, dict):
                continue

            phone_val = get_nested_value(item, phone_property)
            if not phone_val:
                # Try standard fallbacks
                for fallback in ["phone", "mobile", "phone_number", "number", "telephone"]:
                    phone_val = item.get(fallback)
                    if phone_val:
                        break

            if not phone_val:
                continue

            raw_phone = str(phone_val).strip()
            try:
                normalized_phone = normalize_telephony_address(raw_phone).canonical
            except Exception:
                cleaned = re.sub(r"[^\d+]", "", raw_phone)
                if not cleaned.startswith("+"):
                    cleaned = "+" + cleaned
                normalized_phone = cleaned

            # build contact context dict
            context = {}
            for k, v in item.items():
                if k == phone_property:
                    context["phone_number"] = normalized_phone
                else:
                    context[k] = v

            if "phone_number" not in context:
                context["phone_number"] = normalized_phone

            parsed.append(context)

        return parsed

    async def fetch_contacts(self, config: Dict[str, Any], org_id: int) -> List[Dict[str, Any]]:
        pagination_type = config.get("pagination_type", "none")
        pagination_config = config.get("pagination_config", {})
        json_path = config.get("json_path", "")
        phone_property = config.get("phone_property", "phone_number")
        
        all_contacts = []
        
        async with httpx.AsyncClient(timeout=15.0) as client:
            if pagination_type == "none":
                req_opts = self._prepare_request(config)
                try:
                    response = await client.request(**req_opts)
                    response.raise_for_status()
                    data = response.json()
                except Exception as e:
                    raise ValueError(f"HTTP request failed: {str(e)}")

                items = get_nested_value(data, json_path) if json_path else data
                if isinstance(items, list):
                    all_contacts.extend(self._parse_items(items, phone_property))

            elif pagination_type == "page":
                current_page = pagination_config.get("start_page", 1)
                limit_val = pagination_config.get("limit", 50)
                
                while True:
                    req_opts = self._prepare_request(config, page_val=current_page)
                    try:
                        response = await client.request(**req_opts)
                        response.raise_for_status()
                        data = response.json()
                    except Exception as e:
                        logger.error(f"Page fetch failed: {e}")
                        break

                    items = get_nested_value(data, json_path) if json_path else data
                    if not isinstance(items, list) or not items:
                        break

                    parsed = self._parse_items(items, phone_property)
                    all_contacts.extend(parsed)

                    if len(items) < limit_val:
                        break
                    current_page += 1

            elif pagination_type == "offset":
                current_offset = pagination_config.get("start_offset", 0)
                limit_val = pagination_config.get("limit", 50)
                
                while True:
                    req_opts = self._prepare_request(config, page_val=current_offset)
                    try:
                        response = await client.request(**req_opts)
                        response.raise_for_status()
                        data = response.json()
                    except Exception as e:
                        logger.error(f"Offset fetch failed: {e}")
                        break

                    items = get_nested_value(data, json_path) if json_path else data
                    if not isinstance(items, list) or not items:
                        break

                    parsed = self._parse_items(items, phone_property)
                    all_contacts.extend(parsed)

                    if len(items) < limit_val:
                        break
                    current_offset += limit_val

            elif pagination_type == "cursor":
                next_cursor = None
                cursor_path = pagination_config.get("cursor_path", "next_cursor")
                limit_val = pagination_config.get("limit", 50)

                first_run = True
                while first_run or next_cursor:
                    first_run = False
                    req_opts = self._prepare_request(config, page_val=next_cursor)
                    try:
                        response = await client.request(**req_opts)
                        response.raise_for_status()
                        data = response.json()
                    except Exception as e:
                        logger.error(f"Cursor fetch failed: {e}")
                        break

                    items = get_nested_value(data, json_path) if json_path else data
                    if not isinstance(items, list) or not items:
                        break

                    parsed = self._parse_items(items, phone_property)
                    all_contacts.extend(parsed)

                    next_cursor = get_nested_value(data, cursor_path)
                    if not next_cursor or len(items) < limit_val:
                        break

        return all_contacts
