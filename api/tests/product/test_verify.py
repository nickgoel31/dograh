"""The WhatsApp number check before the sign-up bonus, and who may use Google voices."""

import pytest_asyncio

from api.product import phone_verify as pv
from api.product import voices
from api.tests.product.support import bearer, make_client, signup


@pytest_asyncio.fixture
async def client(monkeypatch):
    async with make_client(monkeypatch) as c:
        yield c


class Sender:
    def __init__(self):
        self.sent = []
        self.fail = False

    async def send(self, phone, code):
        if self.fail:
            raise RuntimeError("down")
        self.sent.append((phone, code))


def use_sender(client):
    s = Sender()
    client._transport.app.dependency_overrides[pv.get_sender] = lambda: s
    return s


async def test_without_a_whatsapp_sender_nobody_is_asked_and_the_bonus_is_given(client):
    h = bearer((await signup(client, "a@x.com"))[1])
    st = (await client.get("/product/verify", headers=h)).json()
    assert st["required"] is False
    await client.get("/product/billing/summary", headers=h)
    assert client.wallet.balance == 100.0


async def test_the_bonus_waits_for_a_verified_whatsapp_number_and_a_number_works_once(client, monkeypatch):
    monkeypatch.setenv("PRODUCT_REQUIRE_PHONE_VERIFY", "1")
    sender = use_sender(client)
    h = bearer((await signup(client, "a@x.com"))[1])
    st = (await client.get("/product/verify", headers=h)).json()
    assert st["required"] and not st["verified"] and st["bonus"] == 100.0
    await client.get("/product/billing/summary", headers=h)
    assert client.wallet.balance == 0.0  # no free money yet

    assert (await client.post("/product/verify/start", headers=h, json={"phone": "12345678"})).status_code == 400
    assert (await client.post("/product/verify/check", headers=h, json={"code": "123456"})).json()["detail"]["code"] == "no_code"
    started = (await client.post("/product/verify/start", headers=h, json={"phone": "+91 98111-12222"})).json()
    assert sender.sent[0][0] == "919811112222" and started["pending_phone"] and "98111" not in started["pending_phone"]
    assert (await client.post("/product/verify/start", headers=h, json={"phone": "9811112222"})).status_code == 429  # asked again too soon
    code = sender.sent[0][1]
    wrong = "000000" if code != "000000" else "111111"
    assert (await client.post("/product/verify/check", headers=h, json={"code": wrong})).json()["detail"]["code"] == "wrong_code"
    ok = (await client.post("/product/verify/check", headers=h, json={"code": code})).json()
    assert ok["verified"] and not ok["required"] and ok["phone"].endswith("2222")
    assert client.wallet.balance == 100.0  # the bonus arrives as soon as the number is verified
    await client.get("/product/billing/summary", headers=h)
    assert client.wallet.balance == 100.0  # and only once

    # the same number cannot collect a second bonus on another account
    h2 = bearer((await signup(client, "b@x.com"))[1])
    clash = await client.post("/product/verify/start", headers=h2, json={"phone": "+919811112222"})
    assert clash.status_code == 409 and clash.json()["detail"]["code"] == "phone_in_use"


async def test_five_wrong_codes_lock_the_code_and_a_failed_send_is_explained(client, monkeypatch):
    monkeypatch.setenv("PRODUCT_REQUIRE_PHONE_VERIFY", "1")
    sender = use_sender(client)
    h = bearer((await signup(client, "a@x.com"))[1])
    sender.fail = True
    bad = await client.post("/product/verify/start", headers=h, json={"phone": "9811112222"})
    assert bad.status_code == 502 and bad.json()["detail"]["code"] == "send_failed"
    sender.fail = False
    await client.post("/product/verify/start", headers=h, json={"phone": "9811112222"})
    code = sender.sent[-1][1]
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(5):
        await client.post("/product/verify/check", headers=h, json={"code": wrong})
    locked = await client.post("/product/verify/check", headers=h, json={"code": code})
    assert locked.status_code == 429 and locked.json()["detail"]["code"] == "too_many_tries"


async def test_older_workspaces_are_never_asked(client, monkeypatch):
    monkeypatch.setenv("PRODUCT_REQUIRE_PHONE_VERIFY", "1")
    monkeypatch.setenv("PRODUCT_PHONE_VERIFY_FROM", "2099-01-01")
    h = bearer((await signup(client, "a@x.com"))[1])
    assert (await client.get("/product/verify", headers=h)).json()["required"] is False


async def test_google_voices_are_only_for_the_allowed_accounts(client, monkeypatch):
    monkeypatch.setenv("PRODUCT_VOICE_ENGINES", "inworld,google")
    mine = bearer((await signup(client, "thewalkingjumbo@gmail.com"))[1])
    team = bearer((await signup(client, "ana@twjlabs.com"))[1])
    other = bearer((await signup(client, "b@x.com"))[1])
    allv = (await client.get("/product/voices", headers=mine)).json()
    gid = next(v["id"] for v in allv if voices.find(v["id"]).engine == "google")
    assert any(voices.find(v["id"]).engine == "google" for v in (await client.get("/product/voices", headers=team)).json())
    assert not any(voices.find(v["id"]).engine == "google" for v in (await client.get("/product/voices", headers=other)).json())
    assert any(voices.find(v["id"]).engine == "inworld" for v in (await client.get("/product/voices", headers=other)).json())  # everyone else keeps the other voices
    assert (await client.put(f"/product/voices/{gid}/favorite", headers=other)).status_code == 404
    assert (await client.put(f"/product/voices/{gid}/favorite", headers=team)).status_code == 200
    assert voices.can_use(voices.find(gid), "THEWALKINGJUMBO@gmail.com") and not voices.can_use(voices.find(gid), "x@evil-twjlabs.com")


async def test_only_the_platform_owner_sees_the_admin_area_and_can_adjust_balances(client):
    from sqlalchemy import select

    from api.db.models import UserModel

    # nobody can claim the admin address by signing up
    r = await client.post("/product/auth/signup", json={"email": "admin@twjlabs.com", "password": "Secret-pass-1", "name": "X"})
    assert r.status_code == 400

    cust = bearer((await signup(client, "cust@x.com"))[1])
    assert (await client.get("/product/admin/overview", headers=cust)).status_code == 403
    assert (await client.get("/product/me", headers=cust)).json()["is_admin"] is False

    # an account that only has the right email, without superuser rights, is still refused
    owner = bearer((await signup(client, "boss@twjlabs.com"))[1])
    import os
    os.environ["PRODUCT_ADMIN_EMAILS"] = "boss@twjlabs.com"
    try:
        assert (await client.get("/product/admin/overview", headers=owner)).status_code == 403
        async with client.session_factory() as s:
            u = (await s.execute(select(UserModel).where(UserModel.email == "boss@twjlabs.com"))).scalar_one()
            u.is_superuser = True
            await s.commit()
        assert (await client.get("/product/me", headers=owner)).json()["is_admin"] is True
        ov = (await client.get("/product/admin/overview", headers=owner)).json()
        assert ov["workspaces"] >= 2 and ov["users"] >= 2
        lst = (await client.get("/product/admin/workspaces?q=cust@x.com", headers=owner)).json()
        assert lst["total"] == 1 and lst["workspaces"][0]["owner"] == "cust@x.com"
        wid = lst["workspaces"][0]["id"]
        det = (await client.get(f"/product/admin/workspaces/{wid}", headers=owner)).json()
        assert det["members"][0]["email"] == "cust@x.com"
        before = client.wallet.balance
        out = (await client.post(f"/product/admin/workspaces/{wid}/balance", headers=owner, json={"amount": 50, "note": "goodwill"})).json()
        assert out["balance"] == before + 50
        assert (await client.post(f"/product/admin/workspaces/{wid}/balance", headers=owner, json={"amount": 0, "note": "nothing"})).status_code == 400
        assert (await client.post(f"/product/admin/workspaces/{wid}/balance", headers=cust, json={"amount": 5, "note": "sneaky"})).status_code == 403
    finally:
        os.environ.pop("PRODUCT_ADMIN_EMAILS", None)
