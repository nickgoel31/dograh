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

    async def link_existing(self, number, webhook_url):
        """Point a number the customer already owns at the platform. Returns nothing to release later (it stays theirs)."""
        def run():
            found = self._client().incoming_phone_numbers.list(phone_number=number, limit=1)
            if not found:
                raise NumberError("That number isn't on this Twilio account. Check the number and the account details.")
            found[0].update(voice_url=webhook_url, voice_method="POST")

        try:
            await asyncio.to_thread(run)
        except NumberError:
            raise
        except Exception as e:  # noqa: BLE001
            raise NumberError("Twilio didn't accept those account details. Check them and try again.") from e

    async def release(self, provider_ref):
        try:
            await asyncio.to_thread(lambda: self._client().incoming_phone_numbers(provider_ref).delete())
        except Exception as e:  # noqa: BLE001
            raise NumberError("We couldn't release that number right now. Please try again.") from e


class PlivoNumbers:
    """Buys and releases numbers on the operator's Plivo account. Inbound calls are sent to the platform through one shared Plivo application."""

    name = "plivo"
    APP_NAME = "swarvo-inbound"
    _TYPES = {"local": "local", "toll_free": "tollfree"}

    def __init__(self, auth_id: str, auth_token: str, transport=None):
        self._id, self._token, self._transport = auth_id, auth_token, transport

    def _client(self):
        import httpx

        return httpx.AsyncClient(base_url=f"https://api.plivo.com/v1/Account/{self._id}/", auth=(self._id, self._token), timeout=20, transport=self._transport)

    async def search(self, country, kind, contains):
        params = {"country_iso": country.upper(), "type": self._TYPES.get(kind, "local"), "services": "voice", "limit": 10}
        if contains:
            params["pattern"] = contains
        try:
            async with self._client() as c:
                r = await c.get("PhoneNumber/", params=params)
            r.raise_for_status()
            rows = r.json().get("objects", [])
        except Exception as e:  # noqa: BLE001
            raise NumberError("We couldn't look up numbers right now. Please try again in a moment.") from e
        return [Offer("+" + str(o["number"]).lstrip("+"), o.get("region") or o.get("city") or o.get("country")) for o in rows if o.get("number") and o.get("voice_enabled", True)]

    async def _app_id(self, c, webhook_url: str) -> str:
        """The one shared application whose answer address is the platform's inbound webhook (created on first use)."""
        r = await c.get("Application/", params={"limit": 20})
        r.raise_for_status()
        found = next((a for a in r.json().get("objects", []) if a.get("app_name") == self.APP_NAME), None)
        if found:
            if found.get("answer_url") != webhook_url:
                (await c.post(f"Application/{found['app_id']}/", json={"answer_url": webhook_url, "answer_method": "POST"})).raise_for_status()
            return found["app_id"]
        r = await c.post("Application/", json={"app_name": self.APP_NAME, "answer_url": webhook_url, "answer_method": "POST"})
        r.raise_for_status()
        return r.json()["app_id"]

    async def purchase(self, number, webhook_url):
        digits = number.lstrip("+")
        try:
            async with self._client() as c:
                app_id = await self._app_id(c, webhook_url)
                r = await c.post(f"PhoneNumber/{digits}/", json={"app_id": app_id})
            body = r.json() if r.content else {}
        except Exception as e:  # noqa: BLE001
            raise NumberError("We couldn't buy that number. It may have just been taken. Try another.") from e
        if r.status_code not in (200, 201, 202):
            text = str(body.get("error") or body.get("message") or "").lower()
            if any(w in text for w in ("document", "kyc", "verif", "address")):
                raise NumberError("This number needs identity verification before it can be activated. Please contact support to complete it.")
            raise NumberError("We couldn't buy that number. It may have just been taken. Try another.")
        return digits

    async def link_existing(self, number, webhook_url):
        digits = number.lstrip("+")
        try:
            async with self._client() as c:
                have = await c.get(f"Number/{digits}/")
                if have.status_code == 404:
                    raise NumberError("That number isn't on this Plivo account. Check the number and the account details.")
                have.raise_for_status()
                r = await c.post(f"Number/{digits}/", json={"app_id": await self._app_id(c, webhook_url)})
                r.raise_for_status()
        except NumberError:
            raise
        except Exception as e:  # noqa: BLE001
            raise NumberError("Plivo didn't accept those account details. Check them and try again.") from e

    async def release(self, provider_ref):
        try:
            async with self._client() as c:
                r = await c.delete(f"Number/{provider_ref}/")
            if r.status_code not in (200, 202, 204, 404):
                r.raise_for_status()
        except Exception as e:  # noqa: BLE001
            raise NumberError("We couldn't release that number right now. Please try again.") from e


def plivo_credentials() -> dict | None:
    i, t = os.getenv("PRODUCT_PLIVO_AUTH_ID"), os.getenv("PRODUCT_PLIVO_AUTH_TOKEN")
    return {"auth_id": i, "auth_token": t, "application_id": None, "from_numbers": []} if i and t else None


def live_config() -> tuple[str, dict] | None:
    """Which carrier real numbers come from: Plivo if configured (or chosen with PRODUCT_NUMBER_PROVIDER), else Twilio."""
    want = os.getenv("PRODUCT_NUMBER_PROVIDER", "").lower()
    if want != "twilio" and (c := plivo_credentials()):
        return "plivo", c
    if want != "plivo" and (c := twilio_credentials()):
        return "twilio", c
    return None


def twilio_credentials() -> dict | None:
    sid, token = os.getenv("PRODUCT_TWILIO_ACCOUNT_SID"), os.getenv("PRODUCT_TWILIO_AUTH_TOKEN")
    return {"account_sid": sid, "auth_token": token, "from_numbers": []} if sid and token else None


def provider_for(environment: str) -> NumberProvider | None:
    """None when the operator hasn't configured live numbers yet."""
    if environment == "test":
        return SandboxNumbers()
    live = live_config()
    if live is None:
        return None
    name, creds = live
    return PlivoNumbers(creds["auth_id"], creds["auth_token"]) if name == "plivo" else TwilioNumbers(creds["account_sid"], creds["auth_token"])
