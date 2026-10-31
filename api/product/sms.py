"""A text message to the caller after a call, through the operator's Plivo account. India needs the sender and the wording registered (DLT)."""

import httpx


async def send(auth_id: str, auth_token: str, src: str, dst: str, text: str, transport=None) -> bool:
    try:
        async with httpx.AsyncClient(timeout=15, transport=transport, auth=(auth_id, auth_token)) as c:
            r = await c.post(f"https://api.plivo.com/v1/Account/{auth_id}/Message/", json={"src": src.lstrip("+"), "dst": dst.lstrip("+"), "text": text})
        return r.status_code in (200, 201, 202)
    except Exception:  # noqa: BLE001
        return False
