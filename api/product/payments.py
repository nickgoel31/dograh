"""Payment provider seam (Razorpay first) and the wallet seam to the platform's minutes/money ledger."""

import hashlib
import hmac
import logging
import os
from typing import Protocol

import httpx


class PaymentError(Exception):
    """A problem with a message that is safe to show customers."""


class PaymentProvider(Protocol):
    name: str
    public_key: str

    async def create_order(self, amount: float, currency: str, receipt: str) -> str:
        """Returns the provider's order id."""
        ...

    def verify_checkout(self, order_id: str, payment_id: str, signature: str) -> bool: ...

    def verify_webhook(self, body: bytes, signature: str) -> bool: ...


def _eq(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


log = logging.getLogger(__name__)


class Razorpay:
    name = "razorpay"

    def __init__(self, key_id: str, key_secret: str, webhook_secret: str | None):
        self.public_key, self._secret, self._hook = key_id, key_secret, webhook_secret

    async def create_order(self, amount, currency, receipt):
        try:
            async with httpx.AsyncClient(timeout=15) as c:
                r = await c.post(
                    "https://api.razorpay.com/v1/orders", auth=(self.public_key, self._secret),
                    json={"amount": int(round(amount * 100)), "currency": currency, "receipt": receipt},
                )
            if r.status_code in (401, 403):
                log.error("Razorpay rejected the keys (HTTP %s): %s", r.status_code, r.text[:200])
                raise PaymentError("Payments aren't set up correctly yet (the payment keys were rejected). Please contact support.")
            r.raise_for_status()
            return r.json()["id"]
        except PaymentError:
            raise
        except Exception as e:  # noqa: BLE001
            log.error("Razorpay order failed: %s", e)
            raise PaymentError("We couldn't start the payment. Please try again in a moment.") from e

    async def create_link(self, amount: float, currency: str, reference: str, email: str, description: str) -> tuple[str, str]:
        """A payment link the provider emails to the customer. Returns (link id, link address)."""
        try:
            async with httpx.AsyncClient(timeout=15) as c:
                r = await c.post("https://api.razorpay.com/v1/payment_links", auth=(self.public_key, self._secret),
                                 json={"amount": int(round(amount * 100)), "currency": currency, "reference_id": reference, "description": description, "customer": {"email": email}, "notify": {"email": True}})
            r.raise_for_status()
            d = r.json()
            return d["id"], d["short_url"]
        except Exception as e:  # noqa: BLE001
            log.error("Razorpay payment link failed: %s", e)
            raise PaymentError("We couldn't create the payment link.") from e

    def verify_checkout(self, order_id, payment_id, signature):
        want = hmac.new(self._secret.encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()
        return _eq(want, signature or "")

    def verify_webhook(self, body, signature):
        if not self._hook:
            return False
        return _eq(hmac.new(self._hook.encode(), body, hashlib.sha256).hexdigest(), signature or "")


def get_payments() -> PaymentProvider | None:
    kid, sec = os.getenv("RAZORPAY_KEY_ID"), os.getenv("RAZORPAY_KEY_SECRET")
    return Razorpay(kid, sec, os.getenv("RAZORPAY_WEBHOOK_SECRET")) if kid and sec else None


class WalletGateway(Protocol):
    async def summary(self, org_id: int) -> dict: ...

    async def credit(self, org_id: int, amount: float, description: str, key: str) -> None:
        """Add money to the wallet. Safe to repeat with the same key."""
        ...

    async def grant_minutes(self, org_id: int, minutes: float, description: str, key: str) -> None: ...

    async def charge(self, org_id: int, minutes: float, rate: float, description: str, key: str) -> float:
        """Use up `minutes`: free minutes first, then money at `rate`. Returns the money taken."""
        ...


class CoreWallet:
    """The platform's wallet (opens its own database sessions)."""

    async def summary(self, org_id):
        from api.services.billing import wallet_service

        return await wallet_service.get_summary(org_id)

    async def credit(self, org_id, amount, description, key):
        from api.services.billing import wallet_service

        await wallet_service.credit_money(org_id, amount, description=description, idempotency_key=key)

    async def grant_minutes(self, org_id, minutes, description, key):
        from api.services.billing import wallet_service

        await wallet_service.grant_minutes(org_id, minutes, kind="grant", description=description, idempotency_key=key)


_wallet: WalletGateway = CoreWallet()


def get_wallet() -> WalletGateway:
    return _wallet


async def _core_charge(self, org_id, minutes, rate, description, key):
    from api.services.billing import wallet_service

    # Free minutes only: "minutes_available" also counts the minutes the money balance could buy, which can't be removed.
    have = float((await wallet_service.get_summary(org_id)).get("minutes_remaining", 0) or 0)
    take = min(minutes, have)
    if take > 0:
        await wallet_service.remove_minutes(org_id, take, description=description)
    money = round((minutes - take) * rate, 4)
    if money > 0:
        await wallet_service.credit_money(org_id, -money, description=description, idempotency_key=key)
    return money


CoreWallet.charge = _core_charge
