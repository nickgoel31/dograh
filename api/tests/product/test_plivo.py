"""Buying real numbers from Plivo (the carrier is faked with a mock transport)."""

import json

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import select

from api.db import models
from api.product import number_providers as np
from api.product.number_providers import PlivoNumbers as RealPlivo
from api.tests.product.support import bearer, make_client, signup


class FakePlivo:
    def __init__(self):
        self.calls: list[tuple[str, str, dict]] = []
        self.apps: list[dict] = []
        self.buy_status = 201
        self.buy_body = {"api_id": "x", "message": "created", "numbers": [{"number": "918012345678", "status": "Success"}], "status": "fulfilled"}

    def handler(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content) if request.content else {}
        self.calls.append((request.method, request.url.path, body))
        path = request.url.path.split("/Account/")[1].split("/", 1)[1]
        if request.method == "GET" and path == "PhoneNumber/":
            return httpx.Response(200, json={"objects": [{"number": "918012345678", "region": "Bengaluru", "voice_enabled": True}, {"number": "918099999999", "voice_enabled": False}]})
        if request.method == "GET" and path == "Application/":
            return httpx.Response(200, json={"objects": self.apps})
        if request.method == "POST" and path == "Application/":
            app = {"app_id": "APP1", "app_name": body["app_name"], "answer_url": body["answer_url"]}
            self.apps.append(app)
            return httpx.Response(201, json=app)
        if request.method == "POST" and path.startswith("PhoneNumber/"):
            return httpx.Response(self.buy_status, json=self.buy_body)
        if request.method == "DELETE" and path.startswith("Number/"):
            return httpx.Response(204)
        return httpx.Response(404, json={"error": "nope"})


@pytest.fixture
def plivo(monkeypatch):
    fake = FakePlivo()
    transport = httpx.MockTransport(fake.handler)
    monkeypatch.setenv("PRODUCT_PLIVO_AUTH_ID", "MAXXXXXXXXXXXXXXXX")
    monkeypatch.setenv("PRODUCT_PLIVO_AUTH_TOKEN", "secret-token")
    real = np.PlivoNumbers
    monkeypatch.setattr(np, "PlivoNumbers", lambda i, t: real(i, t, transport=transport))
    return fake


@pytest_asyncio.fixture
async def client(monkeypatch):
    async with make_client(monkeypatch) as c:
        yield c


async def test_search_buy_and_release(plivo):
    p = RealPlivo("MAX", "tok", transport=httpx.MockTransport(plivo.handler))
    offers = await p.search("IN", "local", None)
    assert [o.number for o in offers] == ["+918012345678"] and offers[0].region == "Bengaluru"  # voice-less numbers are left out
    ref = await p.purchase("+918012345678", "https://api.example.com/api/v1/telephony/inbound/run")
    assert ref == "918012345678"
    assert plivo.apps[0]["answer_url"].endswith("/telephony/inbound/run")
    await p.purchase("+918012345679", "https://api.example.com/api/v1/telephony/inbound/run")
    assert len(plivo.apps) == 1  # the shared application is reused
    await p.release(ref)
    assert any(m == "DELETE" for m, _, _ in plivo.calls)


async def test_numbers_that_need_verification_say_so(plivo):
    plivo.buy_status, plivo.buy_body = 400, {"error": "Documents required for this number"}
    p = RealPlivo("MAX", "tok", transport=httpx.MockTransport(plivo.handler))
    with pytest.raises(np.NumberError, match="identity verification"):
        await p.purchase("+918012345678", "https://x/in")


async def test_live_numbers_come_from_plivo_when_configured(client, plivo, monkeypatch):
    monkeypatch.setenv("PRODUCT_KYC_PREFIXES", "none")  # KYC is covered in test_phase_e
    _, tok = await signup(client, "a@x.com")
    live = bearer(tok, **{"X-Environment": "live"})
    offers = (await client.get("/product/numbers/available?country=IN", headers=live)).json()
    assert [(o["number"], o["region"]) for o in offers] == [("+918012345678", "Bengaluru")]
    n = (await client.post("/product/numbers", json={"number": "+918012345678"}, headers=live)).json()
    assert n["sandbox"] is False and n["number"] == "+918012345678"
    async with client.session_factory() as s:
        cfg = (await s.execute(select(models.TelephonyConfigurationModel).where(models.TelephonyConfigurationModel.provider == "plivo"))).scalar_one()
        assert cfg.credentials["auth_id"] == "MAXXXXXXXXXXXXXXXX"
        row = (await s.execute(select(models.TelephonyPhoneNumberModel))).scalar_one()
        assert row.extra_metadata["provider_ref"] == "918012345678"
    assert (await client.delete(f"/product/numbers/{n['id']}", headers=live)).status_code == 204
