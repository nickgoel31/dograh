"""Swarvo IVR: the menu engine, the Plivo XML, signed callbacks, billing and the product API."""

from datetime import UTC, datetime, timedelta
from xml.etree import ElementTree as ET

import pytest

from api.product import ivr as ivr_mod
from api.product import ivr_engine as eng
from api.product.ivr_router import _starter

FLOW = eng.clean({"start": "hrs", "nodes": {
    "hrs": {"type": "hours", "open": "main", "closed": "shut"},
    "main": {"type": "menu", "say": "Press 1 for sales, 2 for a person, 3 for your balance.", "options": {"1": "sales", "2": "xfer", "3": "ask"},
             "keywords": {"pricing, price": "sales"}, "retries": 1, "on_fail": "bye"},
    "sales": {"type": "say", "say": "Sales here.", "next": "bye"},
    "xfer": {"type": "transfer", "say": "Connecting you.", "number": "+91 98765-43210", "fail_say": "Nobody is free.", "on_fail": "vm"},
    "ask": {"type": "collect", "say": "Type your account number.", "digits": 4, "var": "acct", "next": "echo"},
    "echo": {"type": "say", "say": "You typed {{acct}}.", "next": "bye"},
    "vm": {"type": "voicemail", "say": "Leave a message.", "seconds": 30, "next": "bye"},
    "shut": {"type": "say", "say": "We are closed.", "next": "vm"},
    "bye": {"type": "hangup", "say": "Goodbye."},
}})


def xml_of(st, **kw):
    url = lambda kind, node, tries: f"https://x.test/step?k={kind}&node={node}&tries={tries}"  # noqa: E731
    return ET.fromstring(eng.to_xml(st, voice="Polly.Aditi", language="en-IN", url=url, **kw))


def test_clean_rejects_what_cannot_work():
    with pytest.raises(eng.FlowError):
        eng.clean({"nodes": {}})
    with pytest.raises(eng.FlowError):
        eng.clean({"start": "a", "nodes": {"a": {"type": "menu", "say": "hi"}}})  # no choices
    with pytest.raises(eng.FlowError):
        eng.clean({"start": "a", "nodes": {"a": {"type": "transfer", "number": "12345"}}})  # no country code
    with pytest.raises(eng.FlowError):
        eng.clean({"start": "a", "nodes": {"a": {"type": "agent"}}})  # no agent chosen
    assert FLOW["nodes"]["xfer"]["number"] == "+919876543210"


def test_open_goes_to_the_menu_and_closed_to_voicemail_path():
    st = eng.step(FLOW, "hrs", is_open=lambda _h: True)
    assert st.then["kind"] == "gather" and st.then["node"] == "main" and st.trail == ["hrs", "main"]
    st = eng.step(FLOW, "hrs", is_open=lambda _h: False)
    assert st.say == ["We are closed."] and st.then["kind"] == "record"


def test_pressing_digits_and_saying_words():
    assert eng.answer(FLOW, "main", digits="1").say == ["Sales here.", "Goodbye."]
    assert eng.answer(FLOW, "main", speech="what is your pricing please").say[0] == "Sales here."
    assert eng.answer(FLOW, "main", speech="two").then["kind"] == "dial"  # "two" is the digit 2
    assert eng.answer(FLOW, "main", digits="9", tries=0).then["tries"] == 1  # wrong key: asks again
    again = eng.answer(FLOW, "main", digits="9", tries=0)
    assert again.say == [eng.DEFAULT_INVALID]
    last = eng.answer(FLOW, "main", digits="9", tries=1)  # out of tries: on_fail
    assert last.say == ["Goodbye."] and last.then["kind"] == "hangup"


def test_ai_agent_catches_what_the_menu_does_not_understand():
    f = eng.clean({"start": "m", "nodes": {"m": {"type": "menu", "say": "How can I help?", "options": {"1": "m"}, "agent_id": "agt_123", "retries": 0}}})
    assert f["nodes"]["m"]["speech"] is True
    st = eng.answer(f, "m", speech="I want to change my booking")
    assert st.then == {"kind": "agent", "node": "m", "agent_id": "agt_123"}


def test_collect_keeps_digits_and_reads_them_back():
    st = eng.step(FLOW, "ask")
    assert st.then["kind"] == "gather" and st.then["num_digits"] == 4 and st.then["collect"] == "acct"
    done = eng.answer(FLOW, "ask", digits="1234", vars={})
    assert done.say[0] == "You typed 1 2 3 4."


def test_transfer_failure_goes_to_voicemail_and_success_just_ends():
    bad = eng.after_dial(FLOW, "xfer", "no-answer")
    assert bad.say == ["Nobody is free."] and bad.then["kind"] == "record"
    assert eng.after_dial(FLOW, "xfer", "completed").then == {"kind": "hangup"}
    assert eng.after_record(FLOW, "vm").say[0].startswith("Thank you")


def test_menus_with_dead_ends_are_flagged():
    f = eng.clean({"start": "a", "nodes": {"a": {"type": "say", "say": "hi", "next": None}, "b": {"type": "hours"}}})
    msgs = eng.problems(f)
    assert any("never be reached" in m for m in msgs) and any("open and when you are closed" in m for m in msgs)
    assert eng.problems(_starter()) == []


def test_plivo_xml_shapes():
    g = xml_of(eng.step(FLOW, "main"))
    gi = g.find("GetInput")
    assert gi.get("inputType") == "dtmf,speech" and gi.get("numDigits") is None and gi.get("action").endswith("tries=0")
    assert gi.find("Speak").get("voice") == "Polly.Aditi" and g.find("Redirect") is not None  # asks again if nobody answers
    d = xml_of(eng.step(FLOW, "xfer"), caller_id="+14155550100")
    assert d.find("Dial/Number").text == "+919876543210" and d.find("Dial").get("callerId") == "+14155550100"
    r = xml_of(eng.step(FLOW, "vm"))
    assert r.find("Record").get("maxLength") == "30"
    h = xml_of(eng.step(FLOW, "bye"))
    assert h.find("Hangup") is not None
    # text with XML characters is escaped, not injected
    evil = eng.Step(say=["a </Speak><Hangup/> b"], then={"kind": "hangup"})
    assert len(xml_of(evil).findall("Hangup")) == 1


def test_signatures_cannot_be_forged():
    url = ivr_mod.make_url("https://api.test", "ivr_abc")("input", "main", 1)
    q = dict(p.split("=", 1) for p in url.split("?", 1)[1].split("&"))
    assert ivr_mod.sig_ok("ivr_abc", q["k"], q["node"], int(q["tries"]), q["sig"])
    assert not ivr_mod.sig_ok("ivr_abc", "input", "main", 2, q["sig"])  # another try count
    assert not ivr_mod.sig_ok("ivr_other", "input", "main", 1, q["sig"])  # another menu
    assert not ivr_mod.sig_ok("ivr_abc", "input", "main", 1, "")


def test_billing_every_30_or_60_seconds():
    assert ivr_mod.seconds_billed(0, 60) == 0
    assert ivr_mod.seconds_billed(1, 60) == 1 and ivr_mod.seconds_billed(61, 60) == 2
    assert ivr_mod.seconds_billed(1, 30) == 0.5 and ivr_mod.seconds_billed(31, 30) == 1.0 and ivr_mod.seconds_billed(95, 30) == 2.0
    assert ivr_mod.rate_per_minute(30) == ivr_mod.rate_per_minute(60) == 1.0  # Rs 1 a minute, or Rs 0.50 for each 30 seconds


def test_settings_are_checked():
    cur = ivr_mod.settings_of(type("R", (), {"settings": {}})())
    assert cur["pulse"] == 60 and cur["voice"] == "Polly.Aditi"
    assert ivr_mod.clean_settings({"pulse": 30, "language": "hi-IN"}, cur)["pulse"] == 30
    for bad in ({"pulse": 45}, {"voice": "Robot"}, {"language": "xx"}):
        with pytest.raises(eng.FlowError):
            ivr_mod.clean_settings(bad, cur)


# ---------- through the API and the phone callbacks ----------
import pytest_asyncio  # noqa: E402
from sqlalchemy import select  # noqa: E402

from api.db import models, product_models  # noqa: E402
from api.product import ivr_router  # noqa: E402
from api.product.ids import encode_id  # noqa: E402
from api.tests.product.support import bearer, make_client, signup  # noqa: E402


@pytest_asyncio.fixture
async def client(monkeypatch):
    async with make_client(monkeypatch) as c:
        app = c._transport.app  # type: ignore[attr-defined]
        app.include_router(ivr_router.router)
        app.include_router(ivr_router.public)

        async def base():
            return "https://api.test", "wss://api.test"

        monkeypatch.setattr("api.utils.common.get_backend_endpoints", base)
        c.mp = monkeypatch
        yield c


async def _number(client):
    async with client.session_factory() as s:
        ws = (await s.execute(select(product_models.ProductWorkspaceModel))).scalar_one()
        cfg = models.TelephonyConfigurationModel(organization_id=ws.live_org_id, name="c", provider="plivo", credentials={})
        s.add(cfg)
        await s.flush()
        row = models.TelephonyPhoneNumberModel(organization_id=ws.live_org_id, telephony_configuration_id=cfg.id, address="+14155550100",
                                               address_normalized="+14155550100", address_type="pstn", extra_metadata={})
        s.add(row)
        await s.commit()
        return encode_id("num", row.id), ws.id, ws.live_org_id, row.id, cfg.id


@pytest.mark.asyncio
async def test_build_publish_attach_and_take_a_call(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    made = (await client.post("/product/ivr", json={"name": "Front desk"}, headers=h)).json()
    pid = made["id"]
    assert made["status"] == "draft" and made["problems"] == [] and made["settings"]["pulse"] == 60

    # a broken menu is refused
    bad = await client.patch(f"/product/ivr/{pid}", json={"flow": {"start": "a", "nodes": {"a": {"type": "transfer", "number": "123"}}}}, headers=h)
    assert bad.status_code == 400 and bad.json()["detail"]["code"] == "bad_menu"
    assert (await client.patch(f"/product/ivr/{pid}", json={"settings": {"pulse": 45}}, headers=h)).status_code == 400
    ok = await client.patch(f"/product/ivr/{pid}", json={"settings": {"pulse": 30, "language": "hi-IN"}}, headers=h)
    assert ok.json()["settings"]["pulse"] == 30

    # the browser simulator walks the same engine
    sim = (await client.post(f"/product/ivr/{pid}/simulate", json={}, headers=h)).json()
    assert sim["then"]["kind"] == "gather" and "press 1" in sim["then"]["prompt"].lower()
    sim = (await client.post(f"/product/ivr/{pid}/simulate", json={"node": "main", "digits": "3"}, headers=h)).json()
    assert sim["then"]["kind"] == "record"
    closed = (await client.post(f"/product/ivr/{pid}/simulate", json={"open": False}, headers=h)).json()
    assert closed["say"][0].startswith("We are closed")

    # a number answers with the menu
    nid, ws_id, org_id, num_row_id, cfg_id = await _number(client)
    live = {**h, "X-Environment": "live"}
    n = (await client.post(f"/product/numbers/{nid}/ivr", json={"ivr_id": pid}, headers=live)).json()
    assert n["ivr_id"] == pid
    assert (await client.post(f"/product/numbers/{nid}/ivr", json={"ivr_id": "ivr_nope"}, headers=live)).status_code == 404
    assert (await client.get(f"/product/ivr/{pid}", headers=h)).json()["numbers"] == ["+14155550100"]
    assert (await client.post(f"/product/ivr/{pid}/status?status=live", headers=h)).json()["status"] == "live"

    # the first step, as the number's webhook would run it
    async with client.session_factory() as s:
        ivr = (await s.execute(select(product_models.ProductIvrModel))).scalar_one()
        body = await ivr_mod.begin(s, ivr, org_id=org_id, number_id=num_row_id, config_id=cfg_id, call_uuid="u-1", from_number="+919800000001", to_number="+14155550100", base="https://api.test")
    gi = ET.fromstring(body.split("?>", 1)[1]).find("GetInput")
    assert gi.get("numDigits") == "1" and gi.get("language") == "hi-IN"

    # the caller presses 3 (leave a message); the signed address in the XML is the one Plivo posts to
    path = gi.get("action").replace("https://api.test/api/v1", "")
    r = await client.post(path, data={"CallUUID": "u-1", "Digits": "3"})
    node_xml = ET.fromstring(r.text.split("?>", 1)[-1])
    assert node_xml.find("Record") is not None
    rec = node_xml.find("Record").get("action").replace("https://api.test/api/v1", "")
    r = await client.post(rec, data={"CallUUID": "u-1", "RecordUrl": "https://rec.test/a.mp3"})
    assert ET.fromstring(r.text.split("?>", 1)[-1]).find("Hangup") is not None

    # a forged address does nothing, and neither does an unknown call
    forged = await client.post(path.replace("sig=", "sig=00"), data={"CallUUID": "u-1", "Digits": "1"})
    assert "went wrong" in forged.text
    assert "went wrong" in (await client.post(path, data={"CallUUID": "other", "Digits": "1"})).text

    calls = (await client.get(f"/product/ivr/{pid}/calls", headers=h)).json()
    assert len(calls) == 1 and calls[0]["outcome"] == "voicemail" and calls[0]["voicemail_url"] == "https://rec.test/a.mp3"
    assert calls[0]["from"] == "+919800000001" and calls[0]["path"][:2] == ["hours", "main"]

    # billed once, in 30-second blocks, and only after the call has been quiet for a while
    client.wallet.balance = 100.0
    async with client.session_factory() as s:
        assert await ivr_mod.charge_calls(s, client.wallet) == 0  # too soon
        c = (await s.execute(select(product_models.ProductIvrCallModel))).scalar_one()
        c.started_at = datetime.now(UTC) - timedelta(minutes=5)
        c.last_at = c.started_at + timedelta(seconds=44)
        await s.commit()
        assert await ivr_mod.charge_calls(s, client.wallet) == 1
        assert await ivr_mod.charge_calls(s, client.wallet) == 0
        c = (await s.execute(select(product_models.ProductIvrCallModel))).scalar_one()
        assert c.billed and c.minutes == 1.0  # 47 s -> two 30 s blocks
        assert c.amount == round(1.0 * ivr_mod.rate_per_minute(30), 4)


@pytest.mark.asyncio
async def test_a_draft_menu_does_not_answer_and_other_workspaces_cannot_touch_it(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    pid = (await client.post("/product/ivr", json={"name": "A"}, headers=h)).json()["id"]
    _, ws_id, org_id, num_row_id, cfg_id = await _number(client)
    async with client.session_factory() as s:
        ivr = (await s.execute(select(product_models.ProductIvrModel))).scalar_one()
        paused = await ivr_mod.begin(s, ivr, org_id=org_id, number_id=num_row_id, config_id=cfg_id, call_uuid="u-2", from_number="+1", to_number="+2", base="https://api.test")
    assert ET.fromstring(paused.split("?>", 1)[1]).find("Hangup") is not None
    h2 = bearer((await signup(client, "b@x.com"))[1])
    assert (await client.get("/product/ivr", headers=h2)).json() == []
    assert (await client.get(f"/product/ivr/{pid}", headers=h2)).status_code == 404
    assert (await client.delete(f"/product/ivr/{pid}", headers=h2)).status_code == 404
    assert (await client.delete(f"/product/ivr/{pid}", headers=h)).status_code == 204
    # a menu with a dead end cannot go live
    p2 = (await client.post("/product/ivr", json={"name": "B", "starter": False}, headers=h)).json()["id"]
    await client.patch(f"/product/ivr/{p2}", json={"flow": {"start": "a", "nodes": {"a": {"type": "say", "say": "hi", "next": None}, "z": {"type": "hangup"}}}}, headers=h)
    r = await client.post(f"/product/ivr/{p2}/status?status=live", headers=h)
    assert r.status_code == 400 and r.json()["detail"]["code"] == "not_ready"


def test_time_limit_is_checked_and_caps_transfers_and_voicemail():
    cur = ivr_mod.settings_of(type("R", (), {"settings": {}})())
    assert cur["max_seconds"] is None
    assert ivr_mod.clean_settings({"max_seconds": 120}, cur)["max_seconds"] == 120
    assert ivr_mod.clean_settings({"max_seconds": None}, {**cur, "max_seconds": 120})["max_seconds"] is None
    for bad in (5, 99999, "60"):
        with pytest.raises(eng.FlowError):
            ivr_mod.clean_settings({"max_seconds": bad}, cur)
    s = {**cur, "max_seconds": 100}
    call = type("C", (), {"started_at": datetime.now(UTC) - timedelta(seconds=70)})()
    assert 25 <= ivr_mod.seconds_left(call, s) <= 30 and ivr_mod.seconds_left(call, cur) is None
    # a transfer cannot ring past the limit, and voicemail cannot record past it
    d = xml_of(eng.step(FLOW, "xfer"))
    assert d.find("Dial").get("timeLimit") is None
    url = lambda kind, node, tries: "https://x.test/step"  # noqa: E731
    dial = ET.fromstring(eng.to_xml(eng.step(FLOW, "xfer"), voice="v", language="en-IN", url=url, left=28))
    assert dial.find("Dial").get("timeLimit") == "28"
    rec = ET.fromstring(eng.to_xml(eng.step(FLOW, "vm"), voice="v", language="en-IN", url=url, left=12))
    assert rec.find("Record").get("maxLength") == "12"  # asked for 30 s, only 12 s left


@pytest.mark.asyncio
async def test_a_call_past_its_time_limit_is_ended(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    pid = (await client.post("/product/ivr", json={"name": "Limited"}, headers=h)).json()["id"]
    assert (await client.patch(f"/product/ivr/{pid}", json={"settings": {"max_seconds": 60}}, headers=h)).json()["settings"]["max_seconds"] == 60
    assert (await client.patch(f"/product/ivr/{pid}", json={"settings": {"max_seconds": 3}}, headers=h)).status_code == 400
    _, ws_id, org_id, num_row_id, cfg_id = await _number(client)
    await client.post(f"/product/ivr/{pid}/status?status=live", headers=h)
    async with client.session_factory() as s:
        ivr = (await s.execute(select(product_models.ProductIvrModel))).scalar_one()
        body = await ivr_mod.begin(s, ivr, org_id=org_id, number_id=num_row_id, config_id=cfg_id, call_uuid="u-9", from_number="+91", to_number="+14155550100", base="https://api.test")
    gi = ET.fromstring(body.split("?>", 1)[1]).find("GetInput")
    path = gi.get("action").replace("https://api.test/api/v1", "")
    ok = await client.post(path, data={"CallUUID": "u-9", "Digits": "1"})
    assert "time limit" not in ok.text  # still inside the limit
    async with client.session_factory() as s:
        c = (await s.execute(select(product_models.ProductIvrCallModel))).scalar_one()
        c.started_at = datetime.now(UTC) - timedelta(seconds=90)
        await s.commit()
    late = await client.post(path, data={"CallUUID": "u-9", "Digits": "2"})
    assert "time limit" in late.text and ET.fromstring(late.text.split("?>", 1)[-1]).find("Hangup") is not None
    calls = (await client.get(f"/product/ivr/{pid}/calls", headers=h)).json()
    assert calls[0]["outcome"] == "time_limit"
