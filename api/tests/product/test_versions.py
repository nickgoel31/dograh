"""Version history, diff and restore."""

import pytest_asyncio

from api.product.definition import build_definition, with_prompt
from api.product.versions import node_diff, prompt_diff
from api.tests.product.support import bearer, make_client, signup


@pytest_asyncio.fixture
async def client(monkeypatch):
    async with make_client(monkeypatch) as c:
        yield c


def test_prompt_diff_marks_added_removed_same():
    d = prompt_diff("a\nb\nc", "a\nB\nc\nd")
    assert [x["op"] for x in d if x["op"] != "same"] == ["del", "add", "add"]
    assert {"op": "same", "text": "a"} in d and {"op": "add", "text": "d"} in d
    assert prompt_diff("x", "x") == [{"op": "same", "text": "x"}]


def test_node_diff_finds_added_removed_changed():
    a = build_definition(name="A", prompt="p", greeting="g")
    b = with_prompt(a, prompt="p2")
    b["nodes"].append({"id": "new", "type": "agentNode", "data": {"name": "Ask"}})
    b["nodes"] = [n for n in b["nodes"] if n["id"] != "end"]
    d = node_diff(a, b)
    assert d["added"] == [{"id": "new", "name": "Ask"}]
    assert d["removed"] == [{"id": "end", "name": "Goodbye"}]
    assert d["changed"] == [{"id": "start", "name": "A", "fields": ["prompt"]}]
    assert node_diff(a, a) == {"added": [], "removed": [], "changed": []}


async def test_versions_diff_restore_flow(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    a = (await client.post("/product/agents", json={"name": "P", "template": "receptionist"}, headers=h)).json()["id"]
    await client.patch(f"/product/agents/{a}", json={"prompt": "Version two words."}, headers=h)
    await client.post(f"/product/agents/{a}/publish", headers=h)
    await client.patch(f"/product/agents/{a}", json={"prompt": "Draft three words."}, headers=h)

    vs = (await client.get(f"/product/agents/{a}/versions", headers=h)).json()
    assert [v["status"] for v in vs] == ["draft", "published", "archived"]
    assert vs[0]["prompt"] == "Draft three words." and vs[1]["prompt"] == "Version two words."

    d = (await client.get(f"/product/agents/{a}/versions/{vs[1]['number']}/diff", headers=h)).json()
    assert {"op": "del", "text": "Version two words."} in d["prompt"]
    assert {"op": "add", "text": "Draft three words."} in d["prompt"]
    assert d["steps"]["changed"][0]["fields"] == ["prompt"]

    r = await client.post(f"/product/agents/{a}/versions/{vs[1]['number']}/restore", headers=h)
    assert r.status_code == 200 and r.json()["prompt"] == "Version two words."
    assert r.json()["prompt_mode"] == "custom"
    # Restoring only changes the working copy; nothing goes live until Go live.
    assert client.fake.drafts


async def test_versions_are_tenant_scoped_and_unknown_version_404s(client):
    _, tok_a = await signup(client, "a@x.com")
    _, tok_b = await signup(client, "b@x.com")
    client.cookies.clear()
    a = (await client.post("/product/agents", json={"name": "P"}, headers=bearer(tok_a))).json()["id"]
    hb = bearer(tok_b)
    for method, path in [
        ("get", f"/product/agents/{a}/versions"),
        ("get", f"/product/agents/{a}/versions/1/diff"),
        ("post", f"/product/agents/{a}/versions/1/restore"),
    ]:
        r = await getattr(client, method)(path, headers=hb)
        assert r.status_code == 404 and r.json()["detail"]["code"] == "agent_not_found"
    r = await client.post(f"/product/agents/{a}/versions/99/restore", headers=bearer(tok_a))
    assert r.status_code == 404 and r.json()["detail"]["code"] == "version_not_found"
