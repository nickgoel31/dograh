"""Signing in with Google from the phone app: the redirect to Google, the one-time code back to the app, the exchange for a token, and what it refuses."""

import base64
import hashlib
from urllib.parse import parse_qs, urlparse

import pytest_asyncio

from api.product import google_auth, mobile_google
from api.tests.product.support import bearer, make_client, signup

VERIFIER = "v" * 64
CHALLENGE = base64.urlsafe_b64encode(hashlib.sha256(VERIFIER.encode()).digest()).rstrip(b"=").decode()


@pytest_asyncio.fixture
async def client(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "web-client.apps.googleusercontent.com")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "secret")
    async with make_client(monkeypatch) as c:
        yield c


def claims(email="new@example.com", name="Nina Rao"):
    return {"email": email, "name": name, "email_verified": "true", "aud": "web-client.apps.googleusercontent.com"}


def fake_google(monkeypatch, who=None):
    async def exchange(code, redirect):
        return "id-token-for-" + code if code != "bad" else None

    async def verify(credential):
        return who if who is not None and credential.startswith("id-token-for-") else None

    monkeypatch.setattr(mobile_google, "exchange_code", exchange)
    monkeypatch.setattr(google_auth, "verify_google_token", verify)


def back(r):
    assert r.status_code == 302, r.text
    u = urlparse(r.headers["location"])
    assert u.scheme == "swarvo" and u.netloc == "auth"
    return {k: v[0] for k, v in parse_qs(u.query).items()}


async def begin(client):
    r = await client.get("/product/mobile/auth/google/start", params={"challenge": CHALLENGE}, headers={"host": "app.example.com"})
    assert r.status_code == 302
    g = urlparse(r.headers["location"])
    assert g.netloc == "accounts.google.com"
    return {k: v[0] for k, v in parse_qs(g.query).items()}


async def test_the_person_is_sent_to_google_with_our_client_and_our_return_address(client):
    q = await begin(client)
    assert q["client_id"] == "web-client.apps.googleusercontent.com" and q["response_type"] == "code" and q["scope"] == "openid email profile"
    assert q["redirect_uri"] == "https://app.example.com/api/v1/product/mobile/auth/google/callback" and q["state"] and q["prompt"] == "select_account"
    for bad in ("short", "x" * 43 + "!", ""):
        r = await client.get("/product/mobile/auth/google/start", params={"challenge": bad})
        assert back(r) == {"error": "bad_request"}


async def test_without_google_set_up_the_app_is_told_so(client, monkeypatch):
    monkeypatch.delenv("GOOGLE_CLIENT_SECRET")
    assert back(await client.get("/product/mobile/auth/google/start", params={"challenge": CHALLENGE})) == {"error": "not_set_up"}


async def test_a_new_person_gets_an_account_and_the_app_swaps_the_code_for_a_token_once(client, monkeypatch):
    fake_google(monkeypatch, claims())
    state = (await begin(client))["state"]
    out = back(await client.get("/product/mobile/auth/google/callback", params={"code": "abc", "state": state}))
    assert out["new"] == "1" and len(out["code"]) >= 20
    r = await client.post("/product/mobile/auth/google/exchange", json={"code": out["code"], "verifier": VERIFIER})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["me"]["user"]["email"] == "new@example.com" and d["me"]["workspaces"] and d["token"]
    assert (await client.get("/product/me", headers=bearer(d["token"]))).json()["user"]["email"] == "new@example.com"  # the token works like the website's
    again = await client.post("/product/mobile/auth/google/exchange", json={"code": out["code"], "verifier": VERIFIER})
    assert again.status_code == 401  # a code works once
    # coming back later is a normal sign-in, not a new account
    state = (await begin(client))["state"]
    out2 = back(await client.get("/product/mobile/auth/google/callback", params={"code": "abc", "state": state}))
    assert "new" not in out2


async def test_a_stolen_code_is_useless_without_the_apps_secret(client, monkeypatch):
    fake_google(monkeypatch, claims())
    state = (await begin(client))["state"]
    out = back(await client.get("/product/mobile/auth/google/callback", params={"code": "abc", "state": state}))
    wrong = await client.post("/product/mobile/auth/google/exchange", json={"code": out["code"], "verifier": "w" * 64})
    assert wrong.status_code == 401
    right = await client.post("/product/mobile/auth/google/exchange", json={"code": out["code"], "verifier": VERIFIER})
    assert right.status_code == 200  # the wrong guess did not use it up


async def test_cancelling_failures_and_forged_state_all_send_the_app_back_with_a_reason(client, monkeypatch):
    fake_google(monkeypatch, claims())
    state = (await begin(client))["state"]
    assert back(await client.get("/product/mobile/auth/google/callback", params={"state": state, "error": "access_denied"})) == {"error": "cancelled"}
    assert back(await client.get("/product/mobile/auth/google/callback", params={"state": "forged", "code": "abc"})) == {"error": "bad_request"}
    assert back(await client.get("/product/mobile/auth/google/callback", params={"state": state, "code": "bad"})) == {"error": "google_failed"}
    fake_google(monkeypatch, None)  # Google's answer did not check out
    assert back(await client.get("/product/mobile/auth/google/callback", params={"state": state, "code": "abc"})) == {"error": "google_failed"}


async def test_an_existing_password_account_signs_in_with_the_same_email(client, monkeypatch):
    await signup(client, "ann@example.com")
    client.cookies.clear()
    fake_google(monkeypatch, claims("ann@example.com", "Ann"))
    state = (await begin(client))["state"]
    out = back(await client.get("/product/mobile/auth/google/callback", params={"code": "abc", "state": state}))
    assert "new" not in out
    d = (await client.post("/product/mobile/auth/google/exchange", json={"code": out["code"], "verifier": VERIFIER})).json()
    assert d["me"]["user"]["email"] == "ann@example.com"


async def test_a_google_id_token_can_also_be_sent_straight_to_the_app_endpoint(client, monkeypatch):
    async def verify(credential):
        return claims("direct@example.com") if credential == "g" * 30 else None

    monkeypatch.setattr(google_auth, "verify_google_token", verify)
    ok = await client.post("/product/mobile/auth/google", json={"credential": "g" * 30})
    assert ok.status_code == 200 and ok.json()["me"]["user"]["email"] == "direct@example.com" and ok.json()["token"]
    assert (await client.post("/product/mobile/auth/google", json={"credential": "h" * 30})).status_code == 401


async def test_the_phone_apps_own_google_client_is_accepted_when_listed(client, monkeypatch):
    import httpx

    class R:
        status_code = 200

        def json(self):
            return {"aud": "android-client", "email": "m@example.com", "email_verified": "true"}

    class C:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, *a, **k):
            return R()

    monkeypatch.setattr(httpx, "AsyncClient", lambda **k: C())
    assert await google_auth.verify_google_token("t" * 30) is None  # not listed yet
    monkeypatch.setenv("GOOGLE_MOBILE_CLIENT_IDS", "other, android-client")
    assert (await google_auth.verify_google_token("t" * 30))["email"] == "m@example.com"
