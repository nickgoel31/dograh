"""Saving call flows from the editor."""

from copy import deepcopy

import pytest_asyncio

from api.product.flows import check_flow, keep_agent_prompt
from api.tests.product.support import bearer, make_client, signup


@pytest_asyncio.fixture
async def client(monkeypatch):
    async with make_client(monkeypatch) as c:
        yield c


def good():
    return {
        "nodes": [
            {"id": "greeting-1", "type": "startCall", "position": {"x": 0, "y": 0},
             "data": {"name": "Hello", "prompt": "You are Priya.", "greeting": "Hi!", "is_start": True, "allow_interrupt": True, "add_global_prompt": False}},
            {"id": "ask-2", "type": "agentNode", "position": {"x": 300, "y": 0},
             "data": {"name": "Ask", "prompt": "Ask what they need.", "allow_interrupt": True, "add_global_prompt": False}},
            {"id": "end-3", "type": "endCall", "position": {"x": 600, "y": 0},
             "data": {"name": "Close", "prompt": "Say goodbye.", "is_end": True, "allow_interrupt": False, "add_global_prompt": False}},
        ],
        "edges": [
            {"id": "greeting-1>ask-2", "source": "greeting-1", "target": "ask-2", "data": {"label": "Next", "condition": "Continue to Ask"}},
            {"id": "ask-2>end-3", "source": "ask-2", "target": "end-3", "data": {"label": "Done", "condition": "They have what they need"}},
        ],
    }


def code(exc):
    return exc.value.detail["code"], exc.value.detail["message"]


def test_a_good_flow_passes():
    check_flow(good())


def test_structural_problems_get_plain_messages():
    import pytest

    cases = {}
    d = good(); d["nodes"] = [n for n in d["nodes"] if n["type"] != "startCall"]; d["edges"] = []; cases["Greeting"] = d
    d = good(); d["nodes"] = [n for n in d["nodes"] if n["type"] != "endCall"]; d["edges"] = d["edges"][:1]; cases["Close"] = d
    d = good(); d["edges"][0]["target"] = "ghost"; cases["no longer exists"] = d
    d = good(); d["nodes"].append(deepcopy(d["nodes"][1])); cases["same identity"] = d
    for needle, d in cases.items():
        with pytest.raises(Exception) as exc:
            check_flow(d)
        c, msg = code(exc)
        assert c == "flow_invalid" and needle in msg, (needle, msg)


def test_platform_validation_runs_too():
    import pytest

    d = good()
    d["edges"][0]["data"]["condition"] = ""  # the platform requires a condition
    with pytest.raises(Exception) as exc:
        check_flow(d)
    assert code(exc)[0] == "flow_invalid" and "needs fixing" in code(exc)[1]


def test_keep_agent_prompt_wins():
    cur, new = good(), good()
    new["nodes"][0]["data"]["prompt"] = "OVERWRITTEN"
    new["nodes"][0]["data"]["greeting"] = "New hello"
    out = keep_agent_prompt(new, cur)
    assert out["nodes"][0]["data"]["prompt"] == "You are Priya."
    assert out["nodes"][0]["data"]["greeting"] == "New hello"


async def test_flow_api_roundtrip_and_prompt_protection(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    a = (await client.post("/product/agents", json={"name": "P", "template": "receptionist", "business": "Sunrise"}, headers=h)).json()
    flow = (await client.get(f"/product/agents/{a['id']}/flow", headers=h)).json()
    assert [n["type"] for n in flow["definition"]["nodes"]] == ["startCall", "endCall"]

    d = flow["definition"]
    d["nodes"][0]["data"]["prompt"] = "HIJACK"  # the editor must not be able to change the persona
    d["nodes"][0]["data"]["greeting"] = "Welcome to Sunrise!"
    d["nodes"].insert(1, {"id": "ask-9", "type": "agentNode", "position": {"x": 0, "y": 100},
                          "data": {"name": "Ask", "prompt": "Ask their name.", "allow_interrupt": True, "add_global_prompt": False}})
    d["edges"] = [
        {"id": "start>ask-9", "source": "start", "target": "ask-9", "data": {"label": "Next", "condition": "Continue"}},
        {"id": "ask-9>end", "source": "ask-9", "target": "end", "data": {"label": "Done", "condition": "Name collected"}},
    ]
    r = await client.put(f"/product/agents/{a['id']}/flow", json=d, headers={**h, "If-Match": str(flow["version"])})
    assert r.status_code == 200, r.text
    saved = r.json()["definition"]
    assert saved["nodes"][0]["data"]["prompt"] != "HIJACK" and "Sunrise" in saved["nodes"][0]["data"]["prompt"]
    assert saved["nodes"][0]["data"]["greeting"] == "Welcome to Sunrise!"
    assert len(saved["nodes"]) == 3 and r.json()["version"] == flow["version"] + 1

    stale = await client.put(f"/product/agents/{a['id']}/flow", json=d, headers={**h, "If-Match": str(flow["version"])})
    assert stale.status_code == 409 and stale.json()["detail"]["code"] == "edited_elsewhere"


async def test_flow_api_is_tenant_scoped_and_write_protected(client):
    _, tok_a = await signup(client, "a@x.com")
    _, tok_b = await signup(client, "b@x.com")
    client.cookies.clear()
    a = (await client.post("/product/agents", json={"name": "P"}, headers=bearer(tok_a))).json()["id"]
    hb = bearer(tok_b)
    assert (await client.get(f"/product/agents/{a}/flow", headers=hb)).status_code == 404
    assert (await client.put(f"/product/agents/{a}/flow", json=good(), headers=hb)).status_code == 404
    bad = await client.put(f"/product/agents/{a}/flow", json={"nodes": [], "edges": []}, headers=bearer(tok_a))
    assert bad.status_code == 400 and bad.json()["detail"]["code"] == "flow_invalid"


def test_flow_with_rules_webhook_and_collected_details_is_accepted_by_the_platform():
    from api.product.flows import check_flow

    def node(i, t, **d):
        return {"id": i, "type": t, "position": {"x": 0, "y": 0}, "data": {"name": i, "prompt": "p", **d}}

    flow = {"nodes": [
        node("greeting-1", "startCall", greeting="Hi", greeting_type="text", is_start=True, allow_interrupt=True, add_global_prompt=False, delayed_start=True, delayed_start_duration=1.5),
        node("ask-2", "agentNode", allow_interrupt=False, add_global_prompt=False, extraction_enabled=True,
             extraction_variables=[{"name": "caller_name", "type": "string", "prompt": "The caller's name"}]),
        node("end-3", "endCall", is_end=True, allow_interrupt=False, add_global_prompt=False),
        node("global-4", "globalNode", allow_interrupt=True, add_global_prompt=False),
        {"id": "webhook-5", "type": "webhook", "position": {"x": 0, "y": 0}, "data": {"name": "Send", "enabled": True, "http_method": "POST", "endpoint_url": "https://example.com/hook", "payload_template": {"name": "{{caller_name}}"}}},
    ], "edges": [
        {"id": "greeting-1>ask-2", "source": "greeting-1", "target": "ask-2", "data": {"label": "Next", "condition": "Continue"}},
        {"id": "ask-2>end-3", "source": "ask-2", "target": "end-3", "data": {"label": "Done", "condition": "Finished"}},
    ]}
    check_flow(flow)
