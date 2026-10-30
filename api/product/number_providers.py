"""Where phone numbers come from. Live uses the operator's Twilio account; Test uses a sandbox that can never buy or ring anything."""

import asyncio
import os
import random
from dataclasses import dataclass
from typing import Protocol


class NumberError(Exception):
    """A problem with a message that is safe to show customers."""


@dataclass
class Offer:
    number: str  # E.164
    region: str | None = None


class NumberProvider(Protocol):
    name: str

    async def search(self, country: str, kind: str, contains: str | None) -> list[Offer]: ...

    async def purchase(self, number: str, webhook_url: str) -> str:
        """Returns the provider's id for the number."""
        ...

    async def release(self, provider_ref: str) -> None: ...


class SandboxNumbers:
    """Fake numbers for Test mode. Nothing here touches a real provider."""

    name = "sandbox"
    _PREFIX = {"IN": "+9155", "US": "+1555", "GB": "+44555"}

    async def search(self, country, kind, contains):
        base = self._PREFIX.get(country.upper(), "+1555")
        rnd = random.Random(f"{country}{kind}{contains}")
        digits = lambda: "".join(rnd.choice("0123456789") for _ in range(6))
        out = [Offer(base + digits(), "Sandbox") for _ in range(6)]
        return [o for o in out if not contains or contains in o.number] or out[:3]

    async def purchase(self, number, webhook_url):
        return f"sandbox-{number}"

    async def release(self, provider_ref):
        return None


class TwilioNumbers:
    """Buys and releases numbers on the operator's Twilio account."""

    name = "twilio"

    def __init__(self, account_sid: str, auth_token: str):
        self._sid, self._token = account_sid, auth_token

    def _client(self):
        from twilio.rest import Client

        return Client(self._sid, self._token)

    async def search(self, country, kind, contains):
        def run():
            res = self._client().available_phone_numbers(country.upper())
            res = res.toll_free if kind == "toll_free" else res.local
            return res.list(limit=10, **({"contains": contains} if contains else {}))

        try:
            found = await asyncio.to_thread(run)
        except Exception as e:  # noqa: BLE001
            raise NumberError("We couldn't look up numbers right now. Please try again in a moment.") from e
        return [Offer(n.phone_number, getattr(n, "region", None) or getattr(n, "locality", None)) for n in found]

    async def purchase(self, number, webhook_url):
        def run():
            return self._client().incoming_phone_numbers.create(phone_number=number, voice_url=webhook_url, voice_method="POST").sid

        try:
            return await asyncio.to_thread(run)
        except Exception as e:  # noqa: BLE001
            raise NumberError("We couldn't buy that number. It may have just been taken. Try another.") from e

    async def release(self, provider_ref):
        try:
            await asyncio.to_thread(lambda: self._client().incoming_phone_numbers(provider_ref).delete())
        except Exception as e:  # noqa: BLE001
            raise NumberError("We couldn't release that number right now. Please try again.") from e


def twilio_credentials() -> dict | None:
    sid, token = os.getenv("PRODUCT_TWILIO_ACCOUNT_SID"), os.getenv("PRODUCT_TWILIO_AUTH_TOKEN")
    return {"account_sid": sid, "auth_token": token, "from_numbers": []} if sid and token else None


def provider_for(environment: str) -> NumberProvider | None:
    """None when the operator hasn't configured live numbers yet."""
    if environment == "test":
        return SandboxNumbers()
    creds = twilio_credentials()
    return TwilioNumbers(creds["account_sid"], creds["auth_token"]) if creds else None
