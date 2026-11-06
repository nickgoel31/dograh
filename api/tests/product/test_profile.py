"""The person's own account: name, email status, WhatsApp number, timezone and password."""

import pytest_asyncio
from sqlalchemy import select

from api.db.models import UserModel
from api.product import phone_verify as pv
from api.tests.product.support import bearer, make_client, signup


@pytest_asyncio.fixture
async def client(monkeypatch):
    async with make_client(monkeypatch) as c:
        yield c


class Sender:
    def __init__(self):
        self.sent = []

    async def send(self, phone, code):
        self.sent.append((phone, code))


def use_sender(client):
    s = Sender()
    client._transport.app.dependency_overrides[pv.get_sender] = lambda: s
    return s


async def test_the_account_shows_name_email_and_how_the_person_signs_in(client):
    h = bearer((await signup(client, "ann@x.com", name="Ann Lee"))[1])
    a = (await client.get("/product/account", headers=h)).json()
    assert a["name"] == "Ann Lee" and a["email"] == "ann@x.com" and a["sign_in"] == "password" and a["has_password"] is True
    assert a["email_verified"] is False and a["phone"] is None and a["phone_verified"] is False and a["timezone"] is None
    # someone who only ever used Google has no password, and Google already checked their address
    async with client.session_factory() as s:
        u = (await s.execute(select(UserModel).where(UserModel.email == "ann@x.com"))).scalar_one()
        u.password_hash = None
        await s.commit()
    g = (await client.get("/product/account", headers=h)).json()
    assert g["sign_in"] == "google" and g["email_verified"] is True and g["has_password"] is False


async def test_name_and_timezone_can_be_changed_and_are_checked(client):
    h = bearer((await signup(client, "ann@x.com"))[1])
    out = (await client.patch("/product/account/profile", headers=h, json={"name": "  Ann   Marie Lee ", "timezone": "Asia/Kolkata"})).json()
    assert out["name"] == "Ann Marie Lee" and out["timezone"] == "Asia/Kolkata"
    assert (await client.get("/product/me", headers=h)).json()["user"]["name"] == "Ann Marie Lee"  # the rest of the app sees the new name
    assert (await client.patch("/product/account/profile", headers=h, json={"timezone": "Mars/Olympus"})).status_code == 400
    assert (await client.patch("/product/account/profile", headers=h, json={"name": "   "})).status_code == 400
    assert (await client.patch("/product/account/profile", headers=h, json={"timezone": ""})).json()["timezone"] is None


async def test_a_whatsapp_number_is_added_proved_changed_and_removed_and_belongs_to_one_person(client):
    sender = use_sender(client)
    h = bearer((await signup(client, "ann@x.com"))[1])
    start = (await client.post("/product/account/phone/start", headers=h, json={"phone": "+91 98111-12222"})).json()
    assert sender.sent[0][0] == "919811112222" and start["phone_pending"] and start["phone_verified"] is False
    wrong = "000000" if sender.sent[0][1] != "000000" else "111111"
    assert (await client.post("/product/account/phone/check", headers=h, json={"code": wrong})).json()["detail"]["code"] == "wrong_code"
    ok = (await client.post("/product/account/phone/check", headers=h, json={"code": sender.sent[0][1]})).json()
    assert ok["phone_verified"] is True and ok["phone"].endswith("2222") and ok["phone_pending"] is None

    other = bearer((await signup(client, "bob@x.com"))[1])  # a number belongs to one person
    clash = await client.post("/product/account/phone/start", headers=other, json={"phone": "9811112222"})
    assert clash.status_code == 409 and clash.json()["detail"]["code"] == "phone_in_use"

    # changing it: the old number stays until the new one is proved
    await client.post("/product/account/phone/start", headers=h, json={"phone": "9822233333"})
    assert (await client.get("/product/account", headers=h)).json()["phone"].endswith("2222")
    changed = (await client.post("/product/account/phone/check", headers=h, json={"code": sender.sent[-1][1]})).json()
    assert changed["phone"].endswith("3333") and changed["phone_verified"] is True
    # the number given up is free for someone else
    assert (await client.post("/product/account/phone/start", headers=other, json={"phone": "9811112222"})).status_code == 200
    removed = (await client.delete("/product/account/phone", headers=h)).json()
    assert removed["phone"] is None and removed["phone_verified"] is False


async def test_changing_the_password_needs_the_current_one_and_google_only_people_can_set_a_first_one(client):
    h = bearer((await signup(client, "ann@x.com"))[1])
    assert (await client.post("/product/account/password", headers=h, json={"current": "nope-nope", "new": "A-new-pass-77"})).json()["detail"]["code"] == "wrong_password"
    assert (await client.post("/product/account/password", headers=h, json={"new": "short"})).status_code == 422
    assert (await client.post("/product/account/password", headers=h, json={"current": "password123", "new": "A-new-pass-77"})).status_code == 200
    assert (await client.post("/product/auth/login", json={"email": "ann@x.com", "password": "A-new-pass-77"})).status_code == 200
    assert (await client.post("/product/auth/login", json={"email": "ann@x.com", "password": "password123"})).status_code == 401
    async with client.session_factory() as s:
        u = (await s.execute(select(UserModel).where(UserModel.email == "ann@x.com"))).scalar_one()
        u.password_hash = None
        await s.commit()
    assert (await client.post("/product/account/password", headers=h, json={"new": "First-pass-99"})).json()["has_password"] is True
    assert (await client.post("/product/auth/login", json={"email": "ann@x.com", "password": "First-pass-99"})).status_code == 200


async def test_nobody_can_read_or_change_another_persons_account(client):
    a = bearer((await signup(client, "ann@x.com", name="Ann"))[1])
    b = bearer((await signup(client, "bob@x.com", name="Bob"))[1])
    await client.patch("/product/account/profile", headers=a, json={"name": "Ann Changed"})
    assert (await client.get("/product/account", headers=b)).json()["name"] == "Bob"
    client.cookies.clear()
    assert (await client.get("/product/account")).status_code in (401, 403)  # not signed in
