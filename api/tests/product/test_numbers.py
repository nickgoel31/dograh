"""Phone numbers: sandbox purchase, assignment rules, hours gate, tenant scoping."""

from datetime import datetime, timezone

import pytest_asyncio

from api.product import hours
from api.product.ids import decode_id, encode_id
from api.tests.product.support import bearer, make_client, signup


@pytest_asyncio.fixture
async def client(monkeypatch):
    async with make_client(monkeypatch) as c:
        yield c


def utc(y, m, d, hh, mm=0):
    return datetime(y, m, d, hh, mm, tzinfo=timezone.utc)


MON_FRI = {"enabled": True, "tz": "Asia/Kolkata", "windows": [{"days": [0, 1, 2, 3, 4], "start": "09:00", "end": "18:00"}]}


def test_hours_open_closed_in_the_businesss_time_zone():
    h = hours.validate_hours(MON_FRI)
    assert hours.is_open(h, utc(2026, 11, 2, 5, 0))       # Mon 10:30 IST
    assert not hours.is_open(h, utc(2026, 11, 2, 13, 0))  # Mon 18:30 IST
    assert not hours.is_open(h, utc(2026, 11, 1, 6, 0))   # Sunday
    assert hours.is_open(None, utc(2026, 11, 1, 6, 0)) and hours.is_open({"enabled": False}, utc(2026, 11, 1, 6, 0))


def test_hours_validation_and_gate_messages():
    import pytest

    for bad in ({"enabled": True, "windows": []}, {"tz": "Mars/Base"}, {"windows": [{"days": [9], "start": "09:00", "end": "10:00"}]},
                {"windows": [{"days": [1], "start": "18:00", "end": "09:00"}]}):
        with pytest.raises(ValueError):
            hours.validate_hours(bad)
    meta = {"hours": hours.validate_hours({**MON_FRI, "closed_message": "Back at nine!"})}
    assert hours.gate_message(meta, "live", utc(2026, 11, 1, 6)) == "Back at nine!"
    assert hours.gate_message(meta, "live", utc(2026, 11, 2, 5)) is None
    assert hours.gate_message({}, "paused", utc(2026, 11, 2, 5)) == hours.DEFAULT_PAUSED
    assert hours.gate_message({}, "live", utc(2026, 11, 2, 5)) is None


def test_public_ids_are_tamper_proof():
    nid = encode_id("num", 42)
    assert decode_id("num", nid) == 42 and decode_id("call", nid) is None
    assert decode_id("num", nid[:-1] + ("0" if nid[-1] != "0" else "1")) is None


async def test_sandbox_buy_assign_settings_release(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    agent = (await client.post("/product/agents", json={"name": "P", "template": "receptionist"}, headers=h)).json()["id"]

    offers = (await client.get("/product/numbers/available?country=IN", headers=h)).json()
    assert offers and offers[0]["number"].startswith("+91")
    n = (await client.post("/product/numbers", json={"number": offers[0]["number"]}, headers=h)).json()
    assert n["sandbox"] is True and n["reputation"] == "unknown" and n["agent_id"] is None
    assert (await client.post("/product/numbers", json={"number": offers[0]["number"]}, headers=h)).status_code == 409
    assert (await client.post("/product/numbers", json={"number": "12345"}, headers=h)).status_code == 400

    a = (await client.post(f"/product/numbers/{n['id']}/assign", json={"agent_id": agent}, headers=h)).json()
    assert a["agent_id"] == agent
    unassigned = (await client.post(f"/product/numbers/{n['id']}/assign", json={"agent_id": None}, headers=h)).json()
    assert unassigned["agent_id"] is None

    s = (await client.patch(f"/product/numbers/{n['id']}", json={"hours": MON_FRI, "fallback": "+919876543210"}, headers=h)).json()
    assert s["hours"]["tz"] == "Asia/Kolkata" and s["fallback"] == "+919876543210"
    assert (await client.patch(f"/product/numbers/{n['id']}", json={"fallback": "98765"}, headers=h)).json()["detail"]["code"] == "bad_fallback"
    assert (await client.patch(f"/product/numbers/{n['id']}", json={"hours": {"enabled": True}}, headers=h)).json()["detail"]["code"] == "bad_hours"
    assert (await client.patch(f"/product/numbers/{n['id']}", json={"clear_fallback": True}, headers=h)).json()["fallback"] is None

    assert len((await client.get("/product/numbers", headers=h)).json()) == 1
    assert (await client.delete(f"/product/numbers/{n['id']}", headers=h)).status_code == 204
    assert (await client.get("/product/numbers", headers=h)).json() == []


async def test_live_needs_a_live_agent_and_configured_provider(client, monkeypatch):
    _, tok = await signup(client, "a@x.com")
    live = {**bearer(tok), "X-Environment": "live"}
    monkeypatch.delenv("PRODUCT_TWILIO_ACCOUNT_SID", raising=False)
    r = await client.get("/product/numbers/available", headers=live)
    assert r.status_code == 503 and r.json()["detail"]["code"] == "numbers_unavailable"

    # Live number rows need a real provider; add one directly, then check the assign rule.
    from sqlalchemy import select

    from api.db import models, product_models

    agent = (await client.post("/product/agents", json={"name": "P"}, headers=bearer(tok))).json()["id"]
    async with client.session_factory() as s:
        ws = (await s.execute(select(product_models.ProductWorkspaceModel))).scalar_one()
        cfg = models.TelephonyConfigurationModel(organization_id=ws.live_org_id, name="c", provider="twilio", credentials={})
        s.add(cfg)
        await s.flush()
        row = models.TelephonyPhoneNumberModel(organization_id=ws.live_org_id, telephony_configuration_id=cfg.id,
                                               address="+14155550100", address_normalized="+14155550100", address_type="pstn", extra_metadata={})
        s.add(row)
        await s.commit()
        nid = encode_id("num", row.id)
    r = await client.post(f"/product/numbers/{nid}/assign", json={"agent_id": agent}, headers=live)
    assert r.status_code == 400 and r.json()["detail"]["code"] == "not_live_yet"
    await client.post(f"/product/agents/{agent}/publish", headers=bearer(tok))
    ok = await client.post(f"/product/numbers/{nid}/assign", json={"agent_id": agent}, headers=live)
    assert ok.status_code == 200 and ok.json()["agent_id"] == agent


async def test_numbers_are_tenant_and_environment_scoped(client):
    _, tok_a = await signup(client, "a@x.com")
    _, tok_b = await signup(client, "b@x.com")
    client.cookies.clear()
    ha = bearer(tok_a)
    off = (await client.get("/product/numbers/available", headers=ha)).json()[0]["number"]
    nid = (await client.post("/product/numbers", json={"number": off}, headers=ha)).json()["id"]
    hb = bearer(tok_b)
    assert (await client.get("/product/numbers", headers=hb)).json() == []
    for m, p, kw in [("patch", f"/product/numbers/{nid}", {"json": {"label": "x"}}), ("delete", f"/product/numbers/{nid}", {}),
                     ("post", f"/product/numbers/{nid}/assign", {"json": {"agent_id": None}})]:
        r = await getattr(client, m)(p, headers=hb, **kw)
        assert r.status_code == 404 and r.json()["detail"]["code"] == "number_not_found"
    # the same owner sees sandbox numbers only in Test mode
    assert (await client.get("/product/numbers", headers={**ha, "X-Environment": "live"})).json() == []
