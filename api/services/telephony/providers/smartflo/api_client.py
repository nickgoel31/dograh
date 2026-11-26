"""Tata Smartflo REST client: click to call, hangup, call operations (transfer) and call records.

Base URL and request shapes follow https://docs.smartflo.tatatelebusiness.com. Two points are not clear in those docs, so the client copes with both:
the Authorization header is sent as "Bearer <token>" first and as the bare token if Smartflo answers 401 or 403, and a call can be named by
``ref_id`` or ``call_id`` depending on how it started, so callers pass every identifier they have and the first one Smartflo accepts wins.
"""

from __future__ import annotations

from typing import Any, Iterable

import aiohttp
from loguru import logger

SMARTFLO_API_BASE = "https://api-smartflo.tatateleservices.com"
TIMEOUT = aiohttp.ClientTimeout(total=15)


async def request(token: str, method: str, path: str, *, json: dict | None = None, params: dict | None = None, base: str = SMARTFLO_API_BASE) -> tuple[int, Any]:
    """One call to the Smartflo API. Returns (HTTP status, parsed JSON or {"raw": text})."""
    status, data = 0, {}
    for scheme in ("Bearer ", ""):
        headers = {"Authorization": f"{scheme}{token}", "Accept": "application/json"}
        async with aiohttp.ClientSession(timeout=TIMEOUT) as s:
            async with s.request(method, f"{base}{path}", json=json, params=params, headers=headers) as r:
                text = await r.text()
                status = r.status
                try:
                    data = await r.json(content_type=None) if text else {}
                except Exception:  # noqa: BLE001 - an HTML or empty error page
                    data = {"raw": text[:300]}
        if status not in (401, 403):
            break
    return status, data


def ok(status: int, data: Any) -> bool:
    return status == 200 and isinstance(data, dict) and data.get("success") is not False


async def click_to_call(token: str, *, api_key: str, customer_number: str, caller_id: str | None = None, custom: dict | None = None,
                        ring_timeout: int = 30, call_timeout: int | None = None, base: str = SMARTFLO_API_BASE) -> tuple[bool, dict]:
    """Smartflo rings the customer first, then connects the call to the destination the key points at (our Voice Streaming endpoint)."""
    body: dict[str, Any] = {"customer_number": "".join(c for c in customer_number if c.isdigit()), "api_key": api_key, "async": 1, "customer_ring_timeout": max(10, min(30, ring_timeout))}
    if caller_id:
        body["caller_id"] = "".join(c for c in caller_id if c.isdigit())
    if call_timeout:
        body["call_timeout"] = int(call_timeout)
    if custom:
        body["custom_identifier"] = custom
    status, data = await request(token, "POST", "/v1/click_to_call_support", json=body, base=base)
    return ok(status, data) and bool(data.get("ref_id")), data if isinstance(data, dict) else {}


def _bodies(ids: Iterable[tuple[str, str]], extra: dict) -> list[dict]:
    out, seen = [], set()
    for kind, value in ids:
        if value and (kind, value) not in seen:
            seen.add((kind, value))
            out.append({kind: str(value), **extra})
    return out


async def hangup(token: str, ids: Iterable[tuple[str, str]], base: str = SMARTFLO_API_BASE) -> bool:
    """Hang up a live call. `ids` is a list of ("ref_id" | "call_id", value) to try in order."""
    for body in _bodies(ids, {}):
        status, data = await request(token, "POST", "/v1/call/hangup", json=body, base=base)
        if ok(status, data):
            return True
        logger.warning(f"[Smartflo] hangup with {list(body)} failed: {status} {data}")
    return False


async def transfer(token: str, ids: Iterable[tuple[str, str]], destination: str, base: str = SMARTFLO_API_BASE) -> bool:
    """Call Operations type 4 (Transfer) to a mobile number or extension (`intercom`)."""
    for body in _bodies(ids, {"type": 4, "intercom": destination}):
        status, data = await request(token, "POST", "/v1/call/options", json=body, base=base)
        if ok(status, data):
            return True
        logger.warning(f"[Smartflo] transfer with {[k for k in body if k in ('ref_id', 'call_id')]} failed: {status} {data}")
    return False


async def call_record(token: str, call_id: str, base: str = SMARTFLO_API_BASE) -> dict:
    """The call detail record for one call (duration, status, charges, recording), or {}."""
    status, data = await request(token, "GET", "/v1/call/records", params={"call_id": call_id}, base=base)
    rows = data.get("results") if isinstance(data, dict) else None
    return rows[0] if status == 200 and rows else {}


async def token_works(token: str, base: str = SMARTFLO_API_BASE) -> tuple[bool, str]:
    """A cheap read-only call that tells a wrong token apart from a right one."""
    try:
        status, data = await request(token, "GET", "/v1/live_calls", base=base)
    except Exception as e:  # noqa: BLE001
        return False, f"We couldn't reach Smartflo: {e.__class__.__name__}."
    if status in (401, 403):
        return False, "Smartflo did not accept that API token."
    if status >= 500:
        return False, "Smartflo is not answering right now. Try again in a moment."
    return True, ""
