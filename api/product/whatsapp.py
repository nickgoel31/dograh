"""WhatsApp follow-up after a call, from our business number, with the workspace's own payment link.

Business-started WhatsApp messages must use a message template Meta has approved. Two are used (names can be changed in the environment):
  * ``swarvo_followup``      body: {{1}}
  * ``swarvo_followup_pay``  body: {{1}} and {{2}} (the payment link, e.g. as "Pay here: {{2}}")
Only send to people who were told on the call that they would get a message.
"""

from __future__ import annotations

import os
import re

import httpx


def configured() -> bool:
    return bool(os.getenv("PRODUCT_WA_OTP_PHONE_ID") and os.getenv("PRODUCT_WA_OTP_TOKEN"))


def render(text: str, *, name: str | None, business: str, link: str | None) -> str:
    """Fill {name}, {business} and {payment_link}. A message that mentions the link only when there is one."""
    out = text.replace("{name}", (name or "there").split(" ")[0]).replace("{business}", business or "us").replace("{payment_link}", link or "")
    return clean(out)


def clean(text: str) -> str:
    """Template values may not hold new lines, tabs or long runs of spaces."""
    return re.sub(r"\s+", " ", text).strip()[:1000]


def params_for(text: str, link: str | None) -> tuple[str, list[str]]:
    """Which template to use and what goes in it. The link, when the message does not already carry it, goes in the second slot."""
    if link and link not in text:
        return os.getenv("PRODUCT_WA_FOLLOWUP_PAY_TEMPLATE", "swarvo_followup_pay"), [text, link]
    return os.getenv("PRODUCT_WA_FOLLOWUP_TEMPLATE", "swarvo_followup"), [text]


async def send(to_phone: str, text: str, link: str | None = None, transport=None) -> bool:
    pid, token = os.getenv("PRODUCT_WA_OTP_PHONE_ID", ""), os.getenv("PRODUCT_WA_OTP_TOKEN", "")
    if not pid or not token or not text.strip():
        return False
    name, values = params_for(text, link)
    body = {
        "messaging_product": "whatsapp", "to": to_phone.lstrip("+"), "type": "template",
        "template": {"name": name, "language": {"code": os.getenv("PRODUCT_WA_FOLLOWUP_LANG", "en")},
                     "components": [{"type": "body", "parameters": [{"type": "text", "text": v} for v in values]}]},
    }
    try:
        async with httpx.AsyncClient(timeout=20, transport=transport) as c:
            r = await c.post(f"https://graph.facebook.com/v20.0/{pid}/messages", headers={"Authorization": f"Bearer {token}"}, json=body)
        return r.status_code < 400
    except Exception:  # noqa: BLE001 - a follow-up must never break the scheduled job
        return False
