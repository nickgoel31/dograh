"""WhatsApp number check for new accounts.

A new account must prove it owns a WhatsApp number before it gets the sign-up bonus, and one number can only ever be used by one
account. This stops one person making many accounts to collect the free money. We send a 6-digit code to the number on WhatsApp.

The code goes out as a WhatsApp "authentication" template from OUR business number (Meta Cloud API):
  PRODUCT_WA_OTP_PHONE_ID   the sending number's id         PRODUCT_WA_OTP_TOKEN     its access token
  PRODUCT_WA_OTP_TEMPLATE   approved template name (default swarvo_verify)   PRODUCT_WA_OTP_LANG   its language (default en)
  PRODUCT_REQUIRE_PHONE_VERIFY  1 = always ask, 0 = never ask; unset = ask only once the sending number above is configured
  PRODUCT_PHONE_VERIFY_FROM     only workspaces created on/after this date are asked (default 2026-11-05), so existing customers are untouched
"""

import hmac
import logging
import os
import re
import secrets
from datetime import UTC, datetime, timedelta
from hashlib import sha256

from api.db.product_models import ProductBillingSettingsModel, ProductWorkspaceModel

log = logging.getLogger(__name__)

CODE_LIFE = timedelta(minutes=10)
RESEND_AFTER = timedelta(seconds=45)
MAX_TRIES = 5
MAX_SENDS_PER_DAY = 5


class VerifyError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def now() -> datetime:
    return datetime.now(UTC)


def _aware(d: datetime | None) -> datetime | None:
    return d if d is None or d.tzinfo else d.replace(tzinfo=UTC)


def configured() -> bool:
    return bool(os.getenv("PRODUCT_WA_OTP_PHONE_ID") and os.getenv("PRODUCT_WA_OTP_TOKEN"))


def enabled() -> bool:
    flag = os.getenv("PRODUCT_REQUIRE_PHONE_VERIFY", "").strip()
    return flag == "1" if flag in ("0", "1") else configured()


def _since() -> datetime:
    raw = os.getenv("PRODUCT_PHONE_VERIFY_FROM", "2026-11-05")
    try:
        return datetime.fromisoformat(raw).replace(tzinfo=UTC)
    except ValueError:
        return datetime(2026, 11, 5, tzinfo=UTC)


def is_new(ws: ProductWorkspaceModel) -> bool:
    """Only brand-new, self-serve workspaces are asked. Brought-over customers, sub-accounts and older workspaces are not."""
    created = _aware(ws.created_at)
    return not ws.adopted and ws.parent_workspace_id is None and (created is None or created >= _since())


def required(ws: ProductWorkspaceModel, s: ProductBillingSettingsModel) -> bool:
    return enabled() and is_new(ws) and s.phone_verified_at is None


def normalize(raw: str) -> str:
    """'98111 12222', '+91 98111-12222' and '09811112222' all become '919811112222'. Other countries need their country code."""
    digits = re.sub(r"\D", "", raw or "")
    if len(digits) == 10 and digits[0] in "6789":
        digits = "91" + digits
    elif len(digits) == 11 and digits[0] == "0":
        digits = "91" + digits[1:]
    if not 11 <= len(digits) <= 15 or digits.startswith("0"):
        raise VerifyError(400, "bad_phone", "Enter your WhatsApp number with its country code, for example +91 98111 12222.")
    return digits


def mask(phone: str | None) -> str | None:
    return f"+{phone[:2]} •••••• {phone[-4:]}" if phone and len(phone) > 6 else None


def _hash(ws_id: int, phone: str, code: str) -> str:
    return sha256(f"{ws_id}:{phone}:{code}".encode()).hexdigest()


class OtpSender:
    """Sends the code on WhatsApp from our own business number."""

    def __init__(self, transport=None):
        self._transport = transport

    async def send(self, phone: str, code: str) -> None:
        import httpx

        pid, token = os.getenv("PRODUCT_WA_OTP_PHONE_ID", ""), os.getenv("PRODUCT_WA_OTP_TOKEN", "")
        if not pid or not token:
            raise RuntimeError("the WhatsApp sender is not set up")
        body = {
            "messaging_product": "whatsapp", "to": phone, "type": "template",
            "template": {"name": os.getenv("PRODUCT_WA_OTP_TEMPLATE", "swarvo_verify"), "language": {"code": os.getenv("PRODUCT_WA_OTP_LANG", "en")},
                         "components": [{"type": "body", "parameters": [{"type": "text", "text": code}]},
                                        {"type": "button", "sub_type": "url", "index": "0", "parameters": [{"type": "text", "text": code}]}]},
        }
        async with httpx.AsyncClient(timeout=20, transport=self._transport) as c:
            r = await c.post(f"https://graph.facebook.com/v20.0/{pid}/messages", headers={"Authorization": f"Bearer {token}"}, json=body)
        if r.status_code >= 400:
            raise RuntimeError(f"whatsapp code send failed {r.status_code}: {r.text[:200]}")


_sender = OtpSender()


def get_sender() -> OtpSender:
    """The seam tests replace."""
    return _sender


async def start(session, ws: ProductWorkspaceModel, s: ProductBillingSettingsModel, raw_phone: str, sender: OtpSender) -> str:
    """Send a code to the number. Returns the cleaned number. Caller commits."""
    if s.phone_verified_at is not None:
        raise VerifyError(409, "already_verified", "Your number is already verified.")
    phone = normalize(raw_phone)
    from sqlalchemy import select

    taken = await session.scalar(select(ProductBillingSettingsModel.workspace_id).where(ProductBillingSettingsModel.verified_phone == phone, ProductBillingSettingsModel.workspace_id != ws.id))
    if taken:
        raise VerifyError(409, "phone_in_use", "That number is already used by another account. Use a different WhatsApp number.")
    t = now()
    last = _aware(s.otp_sent_at)
    if last and t - last < RESEND_AFTER and s.otp_phone == phone:
        raise VerifyError(429, "too_soon", "A code was just sent. Wait a moment before asking for another.")
    sends = (s.otp_sends_today or 0) if last and last.date() == t.date() else 0
    if sends >= MAX_SENDS_PER_DAY:
        raise VerifyError(429, "too_many", "Too many codes asked for today. Please try again tomorrow or contact support.")
    code = f"{secrets.randbelow(1_000_000):06d}"
    try:
        await sender.send(phone, code)
    except Exception:  # noqa: BLE001 - the person sees a plain message; the detail is in the log
        log.warning("could not send the WhatsApp code to workspace %s", ws.id, exc_info=True)
        raise VerifyError(502, "send_failed", "We couldn't send the code on WhatsApp. Check the number has WhatsApp and try again.")
    s.otp_phone, s.otp_hash, s.otp_expires_at, s.otp_sent_at = phone, _hash(ws.id, phone, code), t + CODE_LIFE, t
    s.otp_tries, s.otp_sends_today = 0, sends + 1
    return phone


def check(ws: ProductWorkspaceModel, s: ProductBillingSettingsModel, code: str) -> None:
    """Accept the code or raise. On success the number is saved on the account. Caller commits (and handles a number claimed twice)."""
    if s.phone_verified_at is not None:
        return
    if not s.otp_hash or not s.otp_phone or not s.otp_expires_at:
        raise VerifyError(400, "no_code", "Ask for a code first.")
    if now() > _aware(s.otp_expires_at):
        raise VerifyError(400, "code_expired", "That code has expired. Ask for a new one.")
    if (s.otp_tries or 0) >= MAX_TRIES:
        raise VerifyError(429, "too_many_tries", "Too many wrong codes. Ask for a new code.")
    s.otp_tries = (s.otp_tries or 0) + 1
    if not hmac.compare_digest(s.otp_hash, _hash(ws.id, s.otp_phone, re.sub(r"\D", "", code or ""))):
        raise VerifyError(400, "wrong_code", "That code isn't right. Check it and try again.")
    s.verified_phone, s.phone_verified_at = s.otp_phone, now()
    s.otp_hash = s.otp_phone = s.otp_expires_at = None
