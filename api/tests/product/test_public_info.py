"""Public pages (status, changelog, API reference, SDK files) and the pieces behind them."""

import hashlib
import hmac
import importlib.util
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest_asyncio
from sqlalchemy import select

from api.db.product_models import ProductStatusCheckModel
from api.product import api_reference, public_api, status_page
from api.product import developers as dev
from api.product.changelog import CHANGELOG
from api.tests.product.support import make_client


@pytest_asyncio.fixture
async def client(monkeypatch):
    async with make_client(monkeypatch) as c:
        yield c


async def test_status_page_is_public_and_unknown_before_any_check(client):
    r = await client.get("/product/public/status")
    assert r.status_code == 200 and r.json()["overall"] == "unknown" and r.json()["components"] == []


async def test_recorded_checks_show_uptime_and_current_state(client, monkeypatch):
    monkeypatch.setenv("SWARVO_TTS_BASE_URL", "https://tts.example")
    answers = iter([(False, None)])  # the voice service does not answer

    async def pinger(url):
        return next(answers)

    async with client.session_factory() as s:
        assert await status_page.record(s, pinger) == 3  # app, models (no profile in this test db, so not ok) and voices
    r = (await client.get("/product/public/status")).json()
    names = {c["key"]: c for c in r["components"]}
    assert set(names) == {"app", "models", "voices"}
    assert names["app"]["state"] == "operational" and names["voices"]["state"] == "outage"
    assert r["overall"] == "outage"


async def test_old_checks_are_dropped_and_a_stale_part_is_unknown(client):
    old = datetime.now(UTC) - timedelta(days=200)
    async with client.session_factory() as s:
        s.add(ProductStatusCheckModel(at=old, component="app", ok=True, ms=5))
        await s.commit()

        async def pinger(url):
            return True, 1

        await status_page.record(s, pinger)
        rows = (await s.scalars(select(ProductStatusCheckModel).where(ProductStatusCheckModel.at < old + timedelta(days=1)))).all()
    assert rows == []
    assert status_page._state(True, datetime.now(UTC) - timedelta(minutes=30), datetime.now(UTC)) == "unknown"


async def test_changelog_is_newest_first_and_well_formed(client):
    r = (await client.get("/product/public/changelog")).json()
    dates = [e["date"] for e in r]
    assert dates == sorted(dates, reverse=True) and len(r) >= 5
    assert all(i["kind"] in ("new", "improved", "fixed") and i["text"] for e in r for i in e["items"])
    assert len(CHANGELOG) == len(r)


async def test_api_reference_matches_the_real_routes(client):
    ref = (await client.get("/product/public/api-reference")).json()
    real = {(m, "/public" + r.path.removeprefix("/public")) for r in public_api.router.routes for m in r.methods}
    documented = {(e["method"], e["path"]) for e in ref["endpoints"]}
    assert documented <= {(m, p) for m, p in real}
    for e in ref["endpoints"]:
        assert set(e["examples"]) == {"curl", "python", "typescript"} and "sk_test_" in e["examples"]["curl"]
    assert dev.signature_header() in ref["webhooks"]["signature"]


async def test_sdk_files_download_and_unknown_language_is_404(client):
    assert "class Swarvo" in (await client.get("/product/public/sdk/python")).text
    assert "class Swarvo" in (await client.get("/product/public/sdk/typescript")).text
    assert (await client.get("/product/public/sdk/cobol")).status_code == 404


def _sdk():
    spec = importlib.util.spec_from_file_location("swarvo_sdk", Path(api_reference.__file__).parent / "sdk" / "swarvo.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def test_python_sdk_verifies_the_same_signature_the_server_makes():
    sdk = _sdk()
    body = b'{"event":"call.ended"}'
    ts = int(time.time())
    header = f"t={ts},v1={dev.sign('whsec', ts, body)}"
    assert sdk.verify_webhook("whsec", header, body)
    assert not sdk.verify_webhook("other", header, body)
    assert not sdk.verify_webhook("whsec", header, body + b" ")
    old = f"t={ts - 4000},v1={hmac.new(b'whsec', f'{ts - 4000}.'.encode() + body, hashlib.sha256).hexdigest()}"
    assert not sdk.verify_webhook("whsec", old, body)
    assert not sdk.verify_webhook("whsec", "garbage", body)
