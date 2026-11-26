"""Tata Smartflo: payload helpers, the audio converter, the REST client, the two routes, and bringing a Smartflo number."""

import base64
import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
import pytest_asyncio
from aiohttp import web
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pipecat.frames.frames import EndFrame, InterruptionFrame, OutputAudioRawFrame, StartFrame
from pipecat.serializers.call_strategies import HangupStrategy, TransferStrategy
from pipecat.utils.enums import EndTaskReason
from sqlalchemy import select

from api.db import models
from api.product import numbers_router
from api.services.telephony.providers.smartflo import api_client, payload as pl, routes
from api.services.telephony.providers.smartflo.provider import SmartfloProvider
from api.services.telephony.providers.smartflo.serializers import SmartfloFrameSerializer
from api.tests.product.support import bearer, make_client, signup


# ---------- payload helpers ----------
def test_stream_token_is_per_call_and_cannot_be_forged():
    t = pl.ws_token(41)
    assert pl.ws_token_ok(41, t) and not pl.ws_token_ok(42, t) and not pl.ws_token_ok(41, "") and not pl.ws_token_ok(41, None)


def test_flatten_reads_dollar_keys_json_strings_and_nested_objects():
    d = pl.flatten({"$call_id": "c1", "$ref_id": "r1", "custom_identifier": '{"run": "77"}', "answered_agent": {"name": "Asha"}, "start": {"direction": "inbound"}})
    assert d["call_id"] == "c1" and d["ref_id"] == "r1" and pl.custom_run_id(d) == 77 and d["direction"] == "inbound"
    assert pl.custom_run_id({"custom_identifier": {"run": "abc"}}) is None and pl.custom_run_id({}) is None


def test_number_candidates_and_call_status():
    assert pl.number_candidates("9876543210") == ["9876543210", "+9876543210", "+919876543210", "919876543210"]
    assert "+919876543210" in pl.number_candidates("919876543210") and pl.number_candidates("") == []
    assert pl.call_status({"call_status": "Answered"}) == "completed" and pl.call_status({"call_status": "Missed"}) == "no-answer"
    assert pl.call_status({"call_status": "Answered by customer"}) == "completed" and pl.call_status({"call_status": "busy"}) == "busy"
    assert pl.is_final({"hangup_cause_code": 16}) and not pl.is_final({"call_status": "Answered"})


def test_the_click_to_call_run_is_matched_to_the_connection():
    now = datetime.now(UTC)

    def run(i, number, age=30, **gc):
        return {"id": i, "created_at": now - timedelta(seconds=age), "initial_context": {"provider": "smartflo", "telephony_configuration_id": 5, "called_number": number}, "gathered_context": gc}

    runs = [run(1, "+919800000001"), run(2, "+919800000002", age=10), run(3, "+919800000002", age=400), run(4, "+919800000002", age=5, smartflo_connected=True)]
    assert pl.pick_pending_outbound(runs, 5, ["+919800000002"], now) == 2  # not too old, not already taken
    assert pl.pick_pending_outbound(runs, 6, ["+919800000002"], now) is None  # another account's
    assert pl.pick_pending_outbound(runs, 5, ["99999 99999"], now) is None
    assert pl.pick_pending_outbound(runs, 5, ["", "9800000001"], now) == 1  # the number may arrive without its country code


# ---------- audio converter ----------
class Hang(HangupStrategy):
    def __init__(self):
        self.ctx = None

    async def execute_hangup(self, context):
        self.ctx = context
        return True


class Xfer(TransferStrategy):
    def __init__(self):
        self.ctx = None

    async def execute_transfer(self, context):
        self.ctx = context
        return True


async def _serializer(**kw):
    s = SmartfloFrameSerializer(stream_sid="MZ1", call_id="c1", ref_id="r1", account_token="tok", params=SmartfloFrameSerializer.InputParams(sample_rate=8000), **kw)
    await s.setup(StartFrame(audio_in_sample_rate=8000, audio_out_sample_rate=8000))
    return s


@pytest.mark.asyncio
async def test_audio_goes_out_in_whole_160_byte_frames_with_a_chunk_counter():
    s = await _serializer()
    sent = []
    for _ in range(5):  # 5 x 10 ms of speech
        out = await s.serialize(OutputAudioRawFrame(audio=b"\x10\x00" * 80, sample_rate=8000, num_channels=1))
        if out:
            sent.append(json.loads(out))
    assert sent and all(m["event"] == "media" and m["streamSid"] == "MZ1" for m in sent)
    sizes = [len(base64.b64decode(m["media"]["payload"])) for m in sent]
    assert all(n % 160 == 0 and n >= 160 for n in sizes) and [m["media"]["chunk"] for m in sent] == list(range(1, len(sent) + 1))
    assert sum(sizes) <= 400  # a partial frame is held back, never sent short
    clear = json.loads(await s.serialize(InterruptionFrame()))
    assert clear == {"event": "clear", "streamSid": "MZ1"}


@pytest.mark.asyncio
async def test_caller_audio_and_keypad_come_in_and_other_events_are_ignored():
    s = await _serializer()
    frame = await s.deserialize(json.dumps({"event": "media", "streamSid": "MZ1", "media": {"chunk": "1", "timestamp": "5", "payload": base64.b64encode(b"\xff" * 800).decode()}}))
    assert frame is not None and frame.sample_rate == 8000 and len(frame.audio) == 1600  # 800 μ-law bytes -> 800 samples of 16-bit
    dtmf = await s.deserialize(json.dumps({"event": "dtmf", "streamSid": "MZ1", "dtmf": {"digit": "5"}}))
    assert dtmf is not None and dtmf.button.value == "5"
    for ev in ("connected", "start", "stop", "mark"):
        assert await s.deserialize(json.dumps({"event": ev})) is None
    assert await s.deserialize("not json") is None


@pytest.mark.asyncio
async def test_the_end_of_the_call_hangs_up_through_smartflo_and_a_transfer_does_not():
    h, t = Hang(), Xfer()
    s = await _serializer(hangup_strategy=h, transfer_strategy=t)
    await s.serialize(EndFrame())
    assert h.ctx == {"call_id": "c1", "ref_id": "r1", "account_token": "tok"} and t.ctx is None
    await s.serialize(EndFrame())  # only once
    h2, t2 = Hang(), Xfer()
    s2 = await _serializer(hangup_strategy=h2, transfer_strategy=t2)
    await s2.serialize(EndFrame(reason=EndTaskReason.TRANSFER_CALL.value))
    assert t2.ctx is not None and h2.ctx is None  # a transferred call must stay up


# ---------- REST client against a fake Smartflo ----------
@pytest_asyncio.fixture
async def fake_smartflo(aiohttp_server=None):
    from aiohttp.test_utils import TestServer

    seen = []
    state = {"bearer_ok": True, "good_ids": {"ref_id": {"R-1"}, "call_id": {"C-1"}}}

    async def handler(request: web.Request):
        body = await request.json() if request.can_read_body else {}
        auth = request.headers.get("Authorization", "")
        seen.append((request.method, request.path, auth, body, dict(request.query)))
        if state["bearer_ok"] and not auth.startswith("Bearer "):
            return web.json_response({"message": "bad"}, status=401)
        if not state["bearer_ok"] and auth.startswith("Bearer "):
            return web.json_response({"message": "no"}, status=401)
        if request.path == "/v1/click_to_call_support":
            if body.get("customer_number") == "9100000000":
                return web.json_response({"success": False, "message": "Provide a valid caller_id."}, status=400)
            return web.json_response({"success": True, "message": "Originate successfully queued", "ref_id": "R-1"})
        if request.path in ("/v1/call/hangup", "/v1/call/options"):
            for kind, good in state["good_ids"].items():
                if body.get(kind) in good:
                    return web.json_response({"success": True, "message": "ok"})
            return web.json_response({"success": False, "message": "Invalid Call ID."}, status=400)
        if request.path == "/v1/call/records":
            return web.json_response({"count": 1, "results": [{"call_id": request.query.get("call_id"), "status": "answered", "call_duration": 48, "answered_seconds": 31, "charges": 1.5, "recording_url": "https://rec.test/x"}]})
        if request.path == "/v1/live_calls":
            return web.json_response([])
        return web.json_response({}, status=404)

    app = web.Application()
    app.router.add_route("*", "/{tail:.*}", handler)
    server = TestServer(app)
    await server.start_server()
    yield SimpleNamespace(base=f"http://{server.host}:{server.port}", seen=seen, state=state)
    await server.close()


@pytest.mark.asyncio
async def test_click_to_call_hangup_transfer_and_records(fake_smartflo):
    f = fake_smartflo
    p = SmartfloProvider({"account_token": "tok", "click_to_call_key": "default-key", "click_to_call_keys": {"+918000000002": "second-key"}, "from_numbers": ["+918000000001", "+918000000002"], "api_base": f.base})
    assert p.validate_config() and p.key_for("+918000000002") == "second-key" and p.key_for("+918000000001") == "default-key"
    res = await p.initiate_call("+919800000001", "unused", workflow_run_id=77, from_number="+918000000002")
    assert res.call_id == "R-1" and res.provider_metadata["smartflo_ref_id"] == "R-1" and res.caller_number == "+918000000002"
    method, path, auth, body, _ = f.seen[-1]
    assert path == "/v1/click_to_call_support" and auth == "Bearer tok" and body["api_key"] == "second-key" and body["async"] == 1
    assert body["customer_number"] == "919800000001" and body["caller_id"] == "918000000002" and body["custom_identifier"] == {"run": "77"}
    with pytest.raises(Exception, match="valid caller_id"):
        await p.initiate_call("9100000000", "unused", from_number="+918000000001")

    # hangup tries every identifier we have until Smartflo accepts one
    assert await api_client.hangup("tok", [("ref_id", "nope"), ("call_id", "C-1")], base=f.base)
    assert [b for _, path, _, b, _ in f.seen if path == "/v1/call/hangup"][-2:] == [{"ref_id": "nope"}, {"call_id": "C-1"}]
    assert not await api_client.hangup("tok", [("ref_id", "zzz")], base=f.base) and not await api_client.hangup("tok", [], base=f.base)
    assert await api_client.transfer("tok", [("ref_id", "R-1")], "919876543210", base=f.base)
    assert f.seen[-1][3] == {"ref_id": "R-1", "type": 4, "intercom": "919876543210"}

    rec = await p.get_call_cost("C-9")
    assert rec["duration"] == 31 and rec["cost_inr"] == 1.5 and rec["status"] == "answered"
    assert (await api_client.token_works("tok", base=f.base))[0]


@pytest.mark.asyncio
async def test_a_token_sent_bare_is_tried_when_bearer_is_refused(fake_smartflo):
    f = fake_smartflo
    f.state["bearer_ok"] = False  # this Smartflo wants the bare token
    ok, data = await api_client.click_to_call("tok", api_key="k", customer_number="9800000001", base=f.base)
    assert ok and data["ref_id"] == "R-1"
    auths = [a for _, _, a, _, _ in f.seen]
    assert auths[-2:] == ["Bearer tok", "tok"]


# ---------- the two routes ----------
class FakeDB:
    def __init__(self):
        self.updates = {}
        self.run = SimpleNamespace(id=7, workflow_id=3, gathered_context={}, initial_context={}, created_at=datetime.now(UTC))
        self.wf = SimpleNamespace(id=3, user_id=9, organization_id=1)

    async def get_workflow_run_by_id(self, i):
        return self.run

    async def get_workflow_by_id(self, i):
        return self.wf

    async def update_workflow_run(self, run_id, **kw):
        self.updates[run_id] = {**self.updates.get(run_id, {}), **kw}


@pytest_asyncio.fixture
async def route_client(monkeypatch):
    app = FastAPI()
    app.include_router(routes.router, prefix="/api/v1/telephony")
    db = FakeDB()
    cfg = SimpleNamespace(id=5, organization_id=1, credentials={"endpoint_key": "KEY123"})

    async def find(key):
        return cfg if key == "KEY123" else None

    async def base():
        return "https://api.test", "wss://api.test"

    monkeypatch.setattr(routes, "db_client", db)
    monkeypatch.setattr(routes, "find_config", find)
    monkeypatch.setattr(routes, "get_backend_endpoints", base)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        c.db, c.mp = db, monkeypatch
        yield c


@pytest.mark.asyncio
async def test_dynamic_endpoint_answers_an_outbound_call_with_a_signed_stream_address(route_client):
    c = route_client

    async def recent(org):
        return [{"id": 7, "workflow_id": 3, "created_at": datetime.now(UTC), "initial_context": {"provider": "smartflo", "telephony_configuration_id": 5, "called_number": "+919800000001"}, "gathered_context": {}}]

    c.mp.setattr(routes, "_recent_runs", recent)
    r = await c.post("/api/v1/telephony/smartflo/dynamic/KEY123", json={"callId": "c-3f9e17", "fromNumber": "+919800000001", "toNumber": "+918000000001", "status": "ringing"})
    body = r.json()
    assert r.status_code == 200 and set(body) == {"success", "wss_url"} and body["success"] is True  # exactly what Smartflo accepts
    assert body["wss_url"] == f"wss://api.test/api/v1/telephony/ws/3/9/7?token={pl.ws_token(7)}"
    assert c.db.updates[7]["gathered_context"]["smartflo_connected"] is True and c.db.updates[7]["gathered_context"]["smartflo_call_id"] == "c-3f9e17"
    assert (await c.post("/api/v1/telephony/smartflo/dynamic/WRONG", json={})).status_code == 404  # an unknown key learns nothing


@pytest.mark.asyncio
async def test_dynamic_endpoint_declines_a_call_to_a_number_that_is_not_set_up(route_client):
    c = route_client

    async def none(org):
        return []

    async def no_number(org, addr, provider, country_hint=None):
        return None

    c.mp.setattr(routes, "_recent_runs", none)
    c.db.find_active_phone_number_for_inbound = no_number
    r = await c.get("/api/v1/telephony/smartflo/dynamic/KEY123", params={"callId": "c1", "fromNumber": "+919800000009", "toNumber": "+918000000009"})
    assert r.status_code == 404 and r.json()["success"] is False  # Smartflo hangs up on anything but a 200 with a stream address


@pytest.mark.asyncio
async def test_webhook_stores_the_recording_and_reports_the_end_of_the_call(route_client):
    c = route_client
    seen = []

    async def find_run(config, d):
        return 7

    async def process(run_id, status):
        seen.append((run_id, status))

    c.mp.setattr(routes, "find_run", find_run)
    c.mp.setattr(routes, "_process_status_update", process)
    mid = await c.post("/api/v1/telephony/smartflo/webhook/KEY123", json={"$call_id": "c1", "$call_status": "Answered"})
    assert mid.json()["status"] == "stored" and not seen  # not over yet
    end = await c.post("/api/v1/telephony/smartflo/webhook/KEY123", json={"$ref_id": "r1", "$call_status": "Answered", "$billsec": "31", "$recording_url": "https://rec.test/x", "hangup_cause_code": 16, "$direction": "click_to_call"})
    assert end.json()["status"] == "success" and seen[0][0] == 7 and seen[0][1].status == "completed" and seen[0][1].duration == "31"
    assert c.db.updates[7]["gathered_context"]["smartflo"]["recording_url"] == "https://rec.test/x"
    assert (await c.post("/api/v1/telephony/smartflo/webhook/WRONG", json={})).status_code == 404


# ---------- bring your Smartflo number ----------
@pytest_asyncio.fixture
async def client(monkeypatch):
    async with make_client(monkeypatch) as c:
        async def good(token):
            return (token != "bad-token"), ("Smartflo did not accept that API token." if token == "bad-token" else "")

        monkeypatch.setattr(numbers_router, "smartflo_check", good)
        c.mp = monkeypatch
        yield c


@pytest.mark.asyncio
async def test_a_customer_brings_smartflo_numbers_and_gets_the_setup_addresses(client):
    _, tok = await signup(client, "a@x.com")
    live = {**bearer(tok), "X-Environment": "live"}
    carriers = {c["id"]: c for c in (await client.get("/product/numbers/carriers", headers=live)).json()}
    assert carriers["smartflo"]["name"] == "Tata Smartflo" and [f["key"] for f in carriers["smartflo"]["fields"]] == ["account_token", "click_to_call_key"]

    bad = await client.post("/product/numbers/bring", json={"carrier": "smartflo", "number": "+918000000001", "details": {"account_token": "bad-token"}}, headers=live)
    assert bad.status_code == 400 and "did not accept" in bad.json()["detail"]["message"]
    assert (await client.post("/product/numbers/bring", json={"carrier": "smartflo", "number": "+918000000001", "details": {}}, headers=live)).status_code == 400

    one = (await client.post("/product/numbers/bring", json={"carrier": "smartflo", "number": "+918000000001", "details": {"account_token": "T1", "click_to_call_key": "K1"}}, headers=live)).json()
    assert one["carrier"] == "smartflo" and one["setup"]["endpoint_url"].endswith("/api/v1/telephony/smartflo/dynamic/" + one["setup"]["endpoint_url"].rsplit("/", 1)[1])
    key = one["setup"]["endpoint_url"].rsplit("/", 1)[1]
    assert len(key) >= 24 and one["setup"]["webhook_url"].endswith("/smartflo/webhook/" + key) and len(one["setup"]["steps"]) >= 4

    # a second number on the same account joins the same connection: one endpoint to set up, not one per number
    two = (await client.post("/product/numbers/bring", json={"carrier": "smartflo", "number": "+918000000002", "details": {"account_token": "T1", "click_to_call_key": "K2"}}, headers=live)).json()
    assert two["setup"]["endpoint_url"] == one["setup"]["endpoint_url"]
    async with client.session_factory() as s:
        cfgs = (await s.execute(select(models.TelephonyConfigurationModel).where(models.TelephonyConfigurationModel.provider == "smartflo"))).scalars().all()
        assert len(cfgs) == 1
        creds = cfgs[0].credentials
        assert creds["from_numbers"] == ["+918000000001", "+918000000002"] and creds["click_to_call_keys"] == {"+918000000001": "K1", "+918000000002": "K2"}
    # another account token is a separate connection with its own key
    other = (await client.post("/product/numbers/bring", json={"carrier": "smartflo", "number": "+918000000003", "details": {"account_token": "T2"}}, headers=live)).json()
    assert other["setup"]["endpoint_url"] != one["setup"]["endpoint_url"]

    # the setup can be looked at again; an agent can answer the number; a menu cannot (menus need Plivo)
    again = (await client.get(f"/product/numbers/{one['id']}/smartflo-setup", headers=live)).json()
    assert again["endpoint_url"] == one["setup"]["endpoint_url"]
    ivr = await client.post(f"/product/numbers/{one['id']}/ivr", json={"ivr_id": "ivr_x"}, headers=live)
    assert ivr.status_code in (400, 404)
    listed = (await client.get("/product/numbers", headers=live)).json()
    assert all(n["setup"] is None for n in listed)  # the secret addresses are shown on request, not in the list

    # releasing a number takes it off the connection
    assert (await client.delete(f"/product/numbers/{two['id']}", headers=live)).status_code == 204
    async with client.session_factory() as s:
        cfg = (await s.execute(select(models.TelephonyConfigurationModel).where(models.TelephonyConfigurationModel.provider == "smartflo", models.TelephonyConfigurationModel.id == cfgs[0].id))).scalar_one()
        assert cfg.credentials["from_numbers"] == ["+918000000001"] and "+918000000002" not in cfg.credentials["click_to_call_keys"]
