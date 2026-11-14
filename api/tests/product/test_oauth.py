"""Connecting an AI assistant with one click: discovery, registering, consent, the code-for-token swap with PKCE, refreshing, and ending a connection."""

import base64
import hashlib
import json
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlparse

import pytest
import pytest_asyncio
from sqlalchemy import select, update

from api.db.product_models import ProductApiKeyModel
from api.product import mcp_server as ms
from api.tests.product.support import bearer, make_client, signup

REDIRECT = "https://claude.ai/api/mcp/auth_callback"
VERIFIER = "v" * 60
CHALLENGE = base64.urlsafe_b64encode(hashlib.sha256(VERIFIER.encode()).digest()).rstrip(b"=").decode()


@pytest_asyncio.fixture
async def client(monkeypatch):
    async with make_client(monkeypatch) as c:
        monkeypatch.setattr(ms, "_app_override", c._transport.app)
        monkeypatch.setattr(ms, "API_PREFIX", "")
        monkeypatch.setattr(ms, "session_factory", lambda: c.session_factory)
        yield c


async def register(client, uris=(REDIRECT,)):
    r = await client.post("/product/oauth/register", json={"client_name": "Claude", "redirect_uris": list(uris)})
    return r


async def approve(client, tok, cid, access="full", **over):
    body = {"client_id": cid, "redirect_uri": REDIRECT, "state": "xyz", "code_challenge": CHALLENGE, "code_challenge_method": "S256", "access": access, **over}
    return await client.post("/product/oauth/approve", json=body, headers=bearer(tok))


def code_from(resp) -> str:
    return parse_qs(urlparse(resp.json()["redirect_url"]).query)["code"][0]


async def exchange(client, cid, code, verifier=VERIFIER, redirect=REDIRECT):
    return await client.post("/product/oauth/token", data={"grant_type": "authorization_code", "code": code, "client_id": cid, "redirect_uri": redirect, "code_verifier": verifier})


async def sign_in(client, tok, access="full"):
    cid = (await register(client)).json()["client_id"]
    code = code_from(await approve(client, tok, cid, access))
    r = await exchange(client, cid, code)
    assert r.status_code == 200, r.text
    return cid, r.json()


async def test_discovery_tells_an_app_where_everything_is(client):
    meta = (await client.get("/product/oauth/.well-known/oauth-authorization-server", headers={"host": "app.example.com"})).json()
    assert meta["issuer"] == "https://app.example.com/api/v1/product/oauth"
    assert meta["token_endpoint"].endswith("/product/oauth/token") and meta["registration_endpoint"].endswith("/product/oauth/register")
    assert meta["authorization_endpoint"] == "https://app.example.com/connect/authorize" and meta["code_challenge_methods_supported"] == ["S256"]
    assert (await client.get("/product/oauth/.well-known/openid-configuration", headers={"host": "app.example.com"})).json() == meta
    res = (await client.get("/product/oauth/.well-known/oauth-protected-resource", headers={"host": "app.example.com"})).json()
    assert res["resource"] == "https://app.example.com/api/v1/swarvo-mcp" and res["authorization_servers"] == [meta["issuer"]]


async def test_only_safe_return_addresses_can_be_registered(client):
    assert (await register(client)).status_code == 201
    assert (await register(client, ("http://localhost:6274/callback",))).status_code == 201
    for bad in ("http://evil.example.com/cb", "javascript:alert(1)", "https://x.example.com/cb#frag"):
        assert (await register(client, (bad,))).status_code == 400
    assert (await client.post("/product/oauth/register", json={"redirect_uris": []})).status_code == 422


async def test_the_whole_sign_in_then_use_then_refresh(client, monkeypatch):
    _, tok = await signup(client, "a@x.com")
    await client.post("/product/agents", json={"name": "Mira", "template": "receptionist"}, headers=bearer(tok))
    cid, t = await sign_in(client, tok)
    assert t["token_type"] == "Bearer" and t["expires_in"] == 3600 and t["access_token"].startswith("swm_f_") and t["refresh_token"].startswith("swr_")
    monkeypatch.setattr(ms, "_raw_token", lambda: t["access_token"])
    from fastmcp import Client

    async with Client(ms.mcp) as c:
        res = await c.call_tool("list_agents", {})
    assert "Mira" in json.dumps(res.structured_content or res.content[0].text)
    # They are not listed as ordinary tokens, but as connections.
    assert (await client.get("/product/developers/mcp-tokens", headers=bearer(tok))).json() == []
    conns = (await client.get("/product/oauth/connections", headers=bearer(tok))).json()
    assert [c["app"] for c in conns] == ["Claude"] and conns[0]["access"] == "full"
    # Refreshing gives a new pair, and the old refresh token stops working.
    r = await client.post("/product/oauth/token", data={"grant_type": "refresh_token", "refresh_token": t["refresh_token"], "client_id": cid})
    assert r.status_code == 200 and r.json()["refresh_token"] != t["refresh_token"]
    again = await client.post("/product/oauth/token", data={"grant_type": "refresh_token", "refresh_token": t["refresh_token"], "client_id": cid})
    assert again.status_code == 400 and again.json()["error"] == "invalid_grant"
    assert len((await client.get("/product/oauth/connections", headers=bearer(tok))).json()) == 1  # still one connection


async def test_a_read_only_choice_is_kept(client, monkeypatch):
    _, tok = await signup(client, "a@x.com")
    _, t = await sign_in(client, tok, "read")
    assert t["access_token"].startswith("swm_r_")
    monkeypatch.setattr(ms, "_raw_token", lambda: t["access_token"])
    from fastmcp import Client
    from fastmcp.exceptions import ToolError

    async with Client(ms.mcp) as c:
        with pytest.raises(ToolError, match="read-only"):
            await c.call_tool("create_agent", {"name": "X"})


async def test_the_code_only_works_once_with_the_right_proof_and_place(client):
    _, tok = await signup(client, "a@x.com")
    cid = (await register(client)).json()["client_id"]
    code = code_from(await approve(client, tok, cid))
    assert (await exchange(client, cid, code, verifier="w" * 60)).json()["error"] == "invalid_grant"  # wrong proof
    assert (await exchange(client, cid, code, redirect="https://claude.ai/other")).json()["error"] == "invalid_grant"
    assert (await exchange(client, "swc_other", code)).json()["error"] == "invalid_grant"
    assert (await exchange(client, cid, code)).status_code == 200
    assert (await exchange(client, cid, code)).status_code == 400  # already used
    assert (await exchange(client, cid, "nonsense")).status_code == 400
    assert (await client.post("/product/oauth/token", data={"grant_type": "password"})).json()["error"] == "unsupported_grant_type"


async def test_consent_checks_the_app_and_needs_a_signed_in_person(client):
    _, tok = await signup(client, "a@x.com")
    cid = (await register(client)).json()["client_id"]
    assert (await approve(client, tok, cid, redirect_uri="https://evil.example.com/cb")).status_code == 400
    assert (await approve(client, tok, "swc_unknown")).status_code == 400
    assert (await approve(client, tok, cid, code_challenge=None)).status_code == 400  # PKCE is required
    assert (await approve(client, tok, cid, code_challenge_method="plain")).status_code == 400
    client.cookies.clear()
    assert (await client.post("/product/oauth/approve", json={"client_id": cid, "redirect_uri": REDIRECT, "code_challenge": CHALLENGE})).status_code == 401
    info = (await client.get("/product/oauth/client", params={"client_id": cid, "redirect_uri": REDIRECT})).json()
    assert info == {"name": "Claude", "host": "claude.ai"}


async def test_saying_no_sends_the_app_back_with_an_error(client):
    _, tok = await signup(client, "a@x.com")
    cid = (await register(client)).json()["client_id"]
    r = await approve(client, tok, cid, approve=False)
    q = parse_qs(urlparse(r.json()["redirect_url"]).query)
    assert q["error"] == ["access_denied"] and q["state"] == ["xyz"] and "code" not in q


async def test_ending_a_connection_stops_it_at_once(client, monkeypatch):
    _, tok = await signup(client, "a@x.com")
    cid, t = await sign_in(client, tok)
    conn = (await client.get("/product/oauth/connections", headers=bearer(tok))).json()[0]
    assert (await client.delete(f"/product/oauth/connections/{conn['id']}", headers=bearer(tok))).status_code == 200
    assert (await client.get("/product/oauth/connections", headers=bearer(tok))).json() == []
    assert await ms.token_state(t["access_token"]) == "invalid"
    r = await client.post("/product/oauth/token", data={"grant_type": "refresh_token", "refresh_token": t["refresh_token"], "client_id": cid})
    assert r.status_code == 400
    assert (await client.delete("/product/oauth/connections/nope", headers=bearer(tok))).status_code == 404


async def test_an_hour_later_the_token_is_expired_and_the_app_is_told_to_refresh(client):
    _, tok = await signup(client, "a@x.com")
    _, t = await sign_in(client, tok)
    assert await ms.token_state(t["access_token"]) == "ok"
    async with client.session_factory() as s:
        await s.execute(update(ProductApiKeyModel).where(ProductApiKeyModel.environment == "mcp").values(expires_at=datetime.now(UTC) - timedelta(minutes=1)))
        await s.commit()
    assert await ms.token_state(t["access_token"]) == "expired"
    assert await ms.token_state(None) == "missing" and await ms.token_state("junk") == "invalid"


async def test_a_connection_without_a_token_gets_401_with_the_way_to_sign_in(client):
    import httpx

    wrapped, _inner = ms.http_app()
    sent = []

    async def send(m):
        sent.append(m)

    scope = {"type": "http", "path": "/", "root_path": "", "headers": [(b"host", b"app.example.com")]}
    await wrapped(scope, None, send)
    start = next(m for m in sent if m["type"] == "http.response.start")
    hdr = {k.decode(): v.decode() for k, v in start["headers"]}
    assert start["status"] == 401 and 'resource_metadata="https://app.example.com' in hdr["www-authenticate"] and "oauth-protected-resource" in hdr["www-authenticate"]
    assert "invalid_token" not in hdr["www-authenticate"]  # nothing was presented, so no error code
    sent.clear()
    await wrapped({**scope, "headers": [(b"host", b"app.example.com"), (b"authorization", b"Bearer swm_f_" + b"A" * 43)]}, None, send)
    assert 'error="invalid_token"' in next(m for m in sent if m["type"] == "http.response.start")["headers"][2][1].decode()
    assert httpx  # (imported so a missing HTTP stack fails here, not in production)
