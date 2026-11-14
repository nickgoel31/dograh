"""The customer-facing MCP server: tokens, tools that run the account, and what it refuses."""

import json

import pytest
import pytest_asyncio
from fastmcp import Client
from fastmcp.exceptions import ToolError

from api.product import mcp_server as ms
from api.tests.product.support import bearer, make_client, signup


@pytest_asyncio.fixture
async def client(monkeypatch):
    async with make_client(monkeypatch) as c:
        monkeypatch.setattr(ms, "_app_override", c._transport.app)
        monkeypatch.setattr(ms, "API_PREFIX", "")
        monkeypatch.setattr(ms, "session_factory", lambda: c.session_factory)
        yield c


class Holder:
    token: str | None = None


@pytest.fixture
def held(monkeypatch):
    h = Holder()
    monkeypatch.setattr(ms, "_raw_token", lambda: h.token)
    return h


async def make_token(client, tok, access="full", name="Claude"):
    r = await client.post("/product/developers/mcp-tokens", json={"name": name, "access": access}, headers=bearer(tok))
    assert r.status_code == 201, r.text
    return r.json()


async def use(tool, **args):
    async with Client(ms.mcp) as c:
        res = await c.call_tool(tool, args)
    if res.data is not None:
        return res.data
    sc = res.structured_content
    if isinstance(sc, dict):
        return sc["result"] if set(sc) == {"result"} else sc
    return json.loads(res.content[0].text) if res.content else []  # an empty list comes back with no content


# ---------- tokens ----------
async def test_tokens_are_shown_once_listed_without_the_secret_and_can_be_revoked(client):
    _, tok = await signup(client, "a@x.com")
    made = await make_token(client, tok)
    assert made["token"].startswith("swm_f_") and made["access"] == "full" and made["url"].endswith(made["token"] + "/")
    ro = await make_token(client, tok, "read", "Reader")
    assert ro["token"].startswith("swm_r_") and ro["access"] == "read"
    rows = (await client.get("/product/developers/mcp-tokens", headers=bearer(tok))).json()
    assert {r["name"] for r in rows} == {"Claude", "Reader"} and all(r["token"] is None for r in rows) and made["token"] not in json.dumps(rows)
    assert (await client.get("/product/developers/keys", headers=bearer(tok))).json() == []  # they are not ordinary API keys
    assert (await client.delete(f"/product/developers/mcp-tokens/{made['id']}", headers=bearer(tok))).status_code == 200
    assert [r["name"] for r in (await client.get("/product/developers/mcp-tokens", headers=bearer(tok))).json()] == ["Reader"]
    assert (await client.post("/product/developers/mcp-tokens", json={"name": "x", "access": "root"}, headers=bearer(tok))).status_code == 422


async def test_an_mcp_token_is_not_an_api_key_and_a_bad_token_gets_nowhere(client, held):
    _, tok = await signup(client, "a@x.com")
    made = await make_token(client, tok)
    r = await client.get("/public/me", headers=bearer(made["token"]))
    assert r.status_code == 401  # the public API does not accept it
    for bad in (None, "", "swm_f_short", "sk_live_" + "a" * 30, made["token"] + "x"):
        held.token = bad
        with pytest.raises(ToolError):
            await use("whoami")
    held.token = made["token"]
    await client.delete(f"/product/developers/mcp-tokens/{made['id']}", headers=bearer(tok))
    with pytest.raises(ToolError, match="isn't valid"):
        await use("whoami")


# ---------- tools ----------
async def test_a_full_token_runs_the_account_through_tools(client, held):
    _, tok = await signup(client, "a@x.com")
    held.token = (await make_token(client, tok))["token"]
    me = await use("whoami")
    assert me["user"]["email"] == "a@x.com"
    a = await use("create_agent", name="Mira", template="receptionist", business="Acme")
    assert a["name"] == "Mira" and a["status"] == "draft"
    assert [x["id"] for x in await use("list_agents")] == [a["id"]]
    await use("update_agent", agent_id=a["id"], tone="Playful", script="1. Greet.")
    got = await use("get_agent", agent_id=a["id"])
    assert got["tone"] == "Playful" and got["script"] == "1. Greet."
    await use("set_agent_style", agent_id=a["id"], style={"languages": ["Hindi", "English"], "voicemail_detect": True})
    assert (await use("get_agent", agent_id=a["id"]))["style"]["languages"] == ["Hindi", "English"]
    doc = await use("export_agent", agent_id=a["id"])
    assert doc["format"] == "swarvo-agent"
    copy = await use("import_agent", document=doc, name="Mira 2")
    assert copy["agent"]["name"] == "Mira 2" and len(await use("list_agents")) == 2
    flow = await use("get_agent_flow", agent_id=a["id"])
    assert flow["definition"]["nodes"]
    assert (await use("agent_readiness", agent_id=a["id"]))
    await use("delete_agent", agent_id=copy["agent"]["id"])
    assert len(await use("list_agents")) == 1
    voices = await use("list_voices", limit=5)
    assert isinstance(voices, (list, dict))
    tpl = await use("list_templates")
    assert len(tpl) > 20


async def test_the_one_message_setup_runs_from_mcp_too(client, held):
    _, tok = await signup(client, "a@x.com")
    held.token = (await make_token(client, tok))["token"]
    r = await use("setup_agent", text="We run a small dental clinic in Pune and want to book check-ups.", publish=False)
    assert r["agent"]["name"] and any(s["id"] == "agent" and s["status"] == "ok" for s in r["steps"])
    assert len(await use("list_agents")) == 1


async def test_a_read_only_token_can_look_but_not_touch(client, held):
    _, tok = await signup(client, "a@x.com")
    a = (await client.post("/product/agents", json={"name": "P", "template": "receptionist"}, headers=bearer(tok))).json()
    held.token = (await make_token(client, tok, "read"))["token"]
    assert [x["id"] for x in await use("list_agents")] == [a["id"]]
    assert (await use("get_wallet")) is not None
    for tool, args in (("create_agent", {"name": "X"}), ("delete_agent", {"agent_id": a["id"]}), ("publish_agent", {"agent_id": a["id"]}), ("setup_agent", {"text": "a dental clinic website x.com"}),
                       ("api_request", {"method": "POST", "path": "/agents", "body": {"name": "Y"}})):
        with pytest.raises(ToolError, match="read-only"):
            await use(tool, **args)
    assert len(await use("list_agents")) == 1
    assert (await use("api_request", method="GET", path="/agents"))[0]["id"] == a["id"]  # reading through the generic tool is fine


async def test_some_parts_of_the_api_are_never_reachable(client, held):
    _, tok = await signup(client, "a@x.com")
    held.token = (await make_token(client, tok))["token"]
    for path in ("/admin/overview", "/auth/logout", "/ops/tick", "/account/password", "/team/2fa/disable", "/product/admin/workspaces"):
        with pytest.raises(ToolError, match="not available through MCP"):
            await use("api_request", method="GET" if "overview" in path else "POST", path=path)


async def test_the_generic_request_and_search_cover_everything_else(client, held):
    _, tok = await signup(client, "a@x.com")
    held.token = (await make_token(client, tok))["token"]
    found = await use("search_api", query="webhook")
    assert any("/developers/webhooks" in e["path"] for e in found) and not any(e["path"].startswith("/admin") for e in found)
    pricing = await use("api_request", method="GET", path="/billing/pricing")
    assert pricing["slabs"]
    w = await use("create_webhook", url="https://example.com/hook")
    assert w["secret"] and len(await use("list_webhooks")) == 1
    k = await use("create_api_key", name="CI", environment="test")
    assert k["key"].startswith("sk_test_")
    err = None
    try:
        await use("get_agent", agent_id="agt_doesnotexist")
    except ToolError as e:
        err = str(e)
    assert err and "couldn't find that agent" in err.lower() and "404" in err


async def test_one_token_never_sees_another_workspace(client, held):
    _, tok_a = await signup(client, "a@x.com")
    await client.post("/product/agents", json={"name": "Mine", "template": "receptionist"}, headers=bearer(tok_a))
    client.cookies.clear()
    _, tok_b = await signup(client, "b@x.com")
    held.token = (await make_token(client, tok_b))["token"]
    assert await use("list_agents") == []
    assert (await use("whoami"))["user"]["email"] == "b@x.com"


# ---------- the token in the address ----------
async def test_a_token_in_the_address_becomes_the_authorization_header():
    seen = {}

    async def inner(scope, receive, send):
        seen.update(path=scope["path"], headers=dict(scope["headers"]))

    app = ms.TokenInPath(inner)
    tok = "swm_f_" + "A" * 43
    await app({"type": "http", "path": f"/api/v1/swarvo-mcp/t/{tok}/", "root_path": "/api/v1/swarvo-mcp", "headers": [(b"authorization", b"Bearer other")]}, None, None)
    assert seen["path"] == "/api/v1/swarvo-mcp/" and seen["headers"][b"authorization"] == f"Bearer {tok}".encode()
    seen.clear()
    await app({"type": "http", "path": "/api/v1/swarvo-mcp/", "root_path": "/api/v1/swarvo-mcp", "headers": [(b"authorization", b"Bearer keep")]}, None, None)
    assert seen["path"] == "/api/v1/swarvo-mcp/" and seen["headers"][b"authorization"] == b"Bearer keep"  # a normal connection is left alone


# ---------- the whole chain over HTTP, the way Claude or ChatGPT connects ----------
async def test_a_connector_can_talk_to_the_mounted_server_with_the_token_in_the_address_or_a_header(client):
    import httpx
    from starlette.applications import Starlette
    from starlette.routing import Mount

    _, tok = await signup(client, "a@x.com")
    await client.post("/product/agents", json={"name": "Mira", "template": "receptionist"}, headers=bearer(tok))
    token = (await make_token(client, tok))["token"]
    wrapped, inner = ms.http_app()
    host = Starlette(routes=[Mount("/api/v1/swarvo-mcp", app=wrapped)])
    hdr = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}
    init = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}}}
    call = {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "list_agents", "arguments": {}}}

    def parse(r):
        body = r.text
        data = [ln[5:].strip() for ln in body.splitlines() if ln.startswith("data:")]
        return json.loads(data[-1] if data else body)

    async with inner.lifespan(host):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=host), base_url="http://t") as http:
            for url, extra in ((f"/api/v1/swarvo-mcp/t/{token}/", {}), ("/api/v1/swarvo-mcp/", {"Authorization": f"Bearer {token}"})):
                r = await http.post(url, json=init, headers={**hdr, **extra})
                assert r.status_code == 200, (url, r.text[:200])
                assert parse(r)["result"]["serverInfo"]["name"] == "swarvo"
                r = await http.post(url, json=call, headers={**hdr, **extra})
                out = parse(r)["result"]
                assert not out.get("isError") and "Mira" in json.dumps(out), (url, out)
            bad = await http.post("/api/v1/swarvo-mcp/", json=call, headers=hdr)
            assert "token" in json.dumps(parse(bad)).lower()  # no token: a clear message, not a crash
