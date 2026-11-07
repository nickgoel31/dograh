"""Tools: webhook tools the agent can call (book, look up, notify...). Other integrations are listed honestly as coming soon."""

from __future__ import annotations

import re
import time
from types import SimpleNamespace
from typing import Protocol

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api.product import agents as agent_svc
from api.product import connectors
from api.product.deps import Ctx, get_ctx, require
from api.product.errors import product_error
from api.product.gateway import PlatformGateway, get_gateway
from api.product.ids import decode_id, encode_id
from api.product.roles import Perm

router = APIRouter(prefix="/product/tools", tags=["tools"])
MASK = "••••••"
_NODES = ("startCall", "agentNode")


class ToolsGateway(Protocol):
    async def list(self, org_id: int, user_id: int) -> list[dict]: ...
    async def create_http(self, org_id: int, user_id: int, spec: dict) -> dict: ...
    async def create_transfer(self, org_id: int, user_id: int, spec: dict) -> dict: ...
    async def archive(self, org_id: int, user_id: int, tool_uuid: str) -> None: ...


class CoreTools:
    @staticmethod
    def _user(org_id, user_id):
        return SimpleNamespace(id=user_id, provider_id=f"u{user_id}", selected_organization_id=org_id, is_superuser=False, role="admin")

    @staticmethod
    async def _call(coro):
        try:
            return await coro
        except HTTPException as e:
            raise product_error(400 if e.status_code < 500 else 502, "tool_failed", "We couldn't save that tool. Check the web address and try again.")
        except Exception as e:  # noqa: BLE001 - core tool errors carry a message meant for operators
            if type(e).__name__ == "ToolManagementError":
                raise product_error(400, "tool_failed", "We couldn't save that tool. Check the web address and try again.")
            raise

    async def list(self, org_id, user_id):
        from api.routes import tool as core

        rows = []
        for cat in ("http_api", "transfer_call"):
            rows += await self._call(core.list_tools(status="active", category=cat, user=self._user(org_id, user_id)))
        return [{"id": t.id, "uuid": t.tool_uuid, "name": t.name, "description": t.description or "", "definition": t.definition} for t in rows]

    async def create_transfer(self, org_id, user_id, spec):
        from api.schemas.tool import CreateToolRequest
        from api.services.tool_management import create_tool_for_user

        req = CreateToolRequest(name=spec["name"], description=spec["description"], category="transfer_call", definition={
            "type": "transfer_call", "config": {"destination": spec["number"], "messageType": "custom", "customMessage": "One moment, I'll connect you now.", "timeout": 30}})
        t = await self._call(create_tool_for_user(req, self._user(org_id, user_id), source="product"))
        return {"id": t.id, "uuid": t.tool_uuid, "name": t.name}

    async def create_http(self, org_id, user_id, spec):
        from api.schemas.tool import CreateToolRequest
        from api.services.tool_management import create_tool_for_user

        req = CreateToolRequest(name=spec["name"], description=spec["description"], category="http_api", definition={
            "type": "http_api", "config": {"method": spec["method"], "url": spec["url"], "headers": spec["headers"] or None,
                                           "parameters": spec["parameters"], "timeout_ms": 10000}})
        t = await self._call(create_tool_for_user(req, self._user(org_id, user_id), source="product"))
        return {"id": t.id, "uuid": t.tool_uuid, "name": t.name}

    async def archive(self, org_id, user_id, tool_uuid):
        from api.routes import tool as core

        await self._call(core.delete_tool(tool_uuid, user=self._user(org_id, user_id)))


# Not called "_tools": a helper further down has that name, and it replaced this object, so get_tools() handed back a function and publishing broke.
_tools_gateway: ToolsGateway = CoreTools()


def get_tools() -> ToolsGateway:
    return _tools_gateway


class ParamIn(BaseModel):
    name: str = Field(pattern=r"^[a-z][a-z0-9_]{0,40}$")
    type: str = Field(default="string", pattern="^(string|number|boolean)$")
    description: str = Field(min_length=1, max_length=300)
    required: bool = True


class ToolBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(min_length=1, max_length=500)  # what it does and when the agent should use it
    url: str = Field(max_length=2048)
    method: str = Field(default="POST", pattern="^(GET|POST|PUT|PATCH|DELETE)$")
    headers: dict[str, str] = Field(default_factory=dict, max_length=10)
    parameters: list[ParamIn] = Field(default_factory=list, max_length=20)


class ToolOut(BaseModel):
    id: str
    name: str
    description: str
    url: str
    method: str
    headers: dict[str, str]  # values are always hidden
    parameters: list[dict]
    kind: str = "web"  # web | transfer
    number: str | None = None


class TestBody(BaseModel):
    url: str = Field(max_length=2048)
    method: str = Field(default="POST", pattern="^(GET|POST|PUT|PATCH|DELETE)$")
    headers: dict[str, str] = Field(default_factory=dict, max_length=10)
    sample: dict = Field(default_factory=dict)


class CatalogItem(BaseModel):
    id: str
    name: str
    blurb: str
    status: str  # available | coming_soon


CATALOG = [
    CatalogItem(id="calcom", name="Cal.com appointments", blurb="Check free times and book appointments while on the call.", status="available"),
    CatalogItem(id="webhook", name="Zapier, n8n or any web address", blurb="Send what the agent learned to any tool that accepts a webhook.", status="available"),
    *[CatalogItem(id=c.id, name=c.name, blurb=c.blurb, status="available") for c in connectors.REGISTRY.values()],
]


def _view(t: dict) -> ToolOut:
    cfg = (t["definition"] or {}).get("config", {})
    if (t["definition"] or {}).get("type") == "transfer_call":
        return ToolOut(id=encode_id("tool", t["id"]), name=t["name"], description=t["description"], url="", method="", headers={}, parameters=[], kind="transfer", number=cfg.get("destination"))
    return ToolOut(id=encode_id("tool", t["id"]), name=t["name"], description=t["description"], url=cfg.get("url", ""), method=cfg.get("method", "POST"),
                   headers={k: MASK for k in (cfg.get("headers") or {})}, parameters=[{k: p.get(k) for k in ("name", "type", "description", "required")} for p in cfg.get("parameters") or []])


async def _tools(ctx: Ctx, gw: ToolsGateway) -> list[dict]:
    """The Test organization holds the canonical set; Live gets a same-named twin."""
    return await gw.list(ctx.workspace.test_org_id, ctx.user.id)


async def _find(ctx: Ctx, gw: ToolsGateway, public_id: str) -> dict:
    n = decode_id("tool", public_id)
    t = next((t for t in await _tools(ctx, gw) if t["id"] == n), None) if n else None
    if t is None:
        raise product_error(404, "tool_not_found", "We couldn't find that tool.")
    return t


async def remap_tools_for_live(graph: dict, gw: ToolsGateway, ws, user_id: int) -> dict:
    test = {t["uuid"]: t["name"] for t in await gw.list(ws.test_org_id, user_id)}
    live = {t["name"]: t["uuid"] for t in await gw.list(ws.live_org_id, user_id)}
    out = {**graph, "nodes": []}
    for n in graph.get("nodes", []):
        d = dict(n.get("data") or {})
        if d.get("tool_uuids"):
            d["tool_uuids"] = [live[test[u]] for u in d["tool_uuids"] if u in test and test[u] in live]
        out["nodes"].append({**n, "data": d})
    return out


@router.get("/catalog", response_model=list[CatalogItem])
async def catalog(ctx: Ctx = Depends(get_ctx)):
    return CATALOG


@router.get("", response_model=list[ToolOut])
async def list_tools(ctx: Ctx = Depends(get_ctx), gw: ToolsGateway = Depends(get_tools)):
    return [_view(t) for t in await _tools(ctx, gw)]


@router.post("", response_model=ToolOut, status_code=201)
async def create(body: ToolBody, ctx: Ctx = Depends(require(Perm.TOOLS_WRITE)), gw: ToolsGateway = Depends(get_tools)):
    if not body.url.lower().startswith(("http://", "https://")):
        raise product_error(400, "bad_url", "Enter the full web address, starting with http:// or https://.")
    if any(t["name"].lower() == body.name.strip().lower() for t in await _tools(ctx, gw)):
        raise product_error(409, "name_taken", "You already have a tool with that name.")
    spec = {**body.model_dump(), "name": body.name.strip()}
    made = await gw.create_http(ctx.workspace.test_org_id, ctx.user.id, spec)
    try:
        await gw.create_http(ctx.workspace.live_org_id, ctx.user.id, spec)
    except Exception:  # noqa: BLE001 - the Live twin is repaired when an agent using it goes live
        pass
    return next(_view(t) for t in await _tools(ctx, gw) if t["id"] == made["id"])


@router.delete("/{tool_id}", status_code=204)
async def remove(tool_id: str, ctx: Ctx = Depends(require(Perm.TOOLS_WRITE)), gw: ToolsGateway = Depends(get_tools)):
    t = await _find(ctx, gw, tool_id)
    await gw.archive(ctx.workspace.test_org_id, ctx.user.id, t["uuid"])
    try:
        twin = next((x for x in await gw.list(ctx.workspace.live_org_id, ctx.user.id) if x["name"] == t["name"]), None)
        if twin:
            await gw.archive(ctx.workspace.live_org_id, ctx.user.id, twin["uuid"])
    except Exception:  # noqa: BLE001
        pass


@router.post("/test")
async def test_tool(body: TestBody, ctx: Ctx = Depends(require(Perm.TOOLS_WRITE))):
    """Call the address for real with sample values. Private addresses are refused; the user's session is never forwarded."""
    from api.utils.safe_fetch import UnsafeURLError, validate_public_url

    try:
        await validate_public_url(body.url)
    except (UnsafeURLError, ValueError):
        raise product_error(400, "unsafe_url", "That address can't be reached from here. Use a public https:// address.")
    started = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=False) as c:
            kw = {"params": body.sample} if body.method == "GET" else {"json": body.sample}
            r = await c.request(body.method, body.url, headers={k: v for k, v in body.headers.items() if v != MASK}, **kw)
    except httpx.HTTPError:
        raise product_error(502, "tool_unreachable", "We couldn't reach that address. Check it and try again.")
    return {"ok": r.status_code < 400, "status": r.status_code, "ms": int((time.monotonic() - started) * 1000), "response": r.text[:2000]}


# ---------------- attach to an agent ----------------
class AttachBody(BaseModel):
    tool_ids: list[str] = Field(max_length=50)


@router.get("/agent/{agent_id}", response_model=list[str])
async def attached(agent_id: str, ctx: Ctx = Depends(get_ctx), gw: ToolsGateway = Depends(get_tools), pg: PlatformGateway = Depends(get_gateway)):
    agent = await agent_svc.get_agent(ctx.session, ctx.workspace, agent_id)
    graph = await agent_svc.get_flow(pg, ctx.workspace, agent)
    have = {u for n in graph.get("nodes", []) if n.get("type") in _NODES for u in (n.get("data") or {}).get("tool_uuids") or []}
    return [encode_id("tool", t["id"]) for t in await _tools(ctx, gw) if t["uuid"] in have]


@router.put("/agent/{agent_id}", response_model=list[str])
async def attach(agent_id: str, body: AttachBody, ctx: Ctx = Depends(require(Perm.TOOLS_WRITE)),
                 gw: ToolsGateway = Depends(get_tools), pg: PlatformGateway = Depends(get_gateway)):
    agent = await agent_svc.get_agent(ctx.session, ctx.workspace, agent_id)
    by_id = {encode_id("tool", t["id"]): t["uuid"] for t in await _tools(ctx, gw)}
    if any(i not in by_id for i in body.tool_ids):
        raise product_error(404, "tool_not_found", "One of those tools no longer exists.")
    uuids = [by_id[i] for i in dict.fromkeys(body.tool_ids)]
    graph = await agent_svc.get_flow(pg, ctx.workspace, agent)
    for n in graph.get("nodes", []):
        if n.get("type") in _NODES:
            n.setdefault("data", {})["tool_uuids"] = list(uuids)
    await pg.save_draft(ctx.workspace.test_org_id, agent.test_workflow_id, agent.name, graph)
    agent.version += 1
    await ctx.session.commit()
    return list(dict.fromkeys(body.tool_ids))

# ---------------- hand over to a person ----------------
_E164 = re.compile(r"^\+[1-9]\d{6,14}$")


class HandoverBody(BaseModel):
    number: str = Field(max_length=20)
    when: str = Field(default="The caller asks to speak to a person, or the agent cannot help.", min_length=5, max_length=400)


def _handover_name(agent) -> str:
    return f"Hand over to a person ({agent.public_id[-5:]})"


async def _agent_graph(ctx, pg, agent_id):
    agent = await agent_svc.get_agent(ctx.session, ctx.workspace, agent_id)
    return agent, await agent_svc.get_flow(pg, ctx.workspace, agent)


def _set_tools(graph: dict, fn) -> dict:
    for n in graph.get("nodes", []):
        if n.get("type") in _NODES:
            d = n.setdefault("data", {})
            d["tool_uuids"] = fn(list(d.get("tool_uuids") or []))
    return graph


@router.get("/handover/{agent_id}")
async def handover_get(agent_id: str, ctx: Ctx = Depends(get_ctx), gw: ToolsGateway = Depends(get_tools), pg: PlatformGateway = Depends(get_gateway)):
    agent, graph = await _agent_graph(ctx, pg, agent_id)
    mine = next((t for t in await _tools(ctx, gw) if t["name"] == _handover_name(agent)), None)
    on = mine is not None and any(mine["uuid"] in ((n.get("data") or {}).get("tool_uuids") or []) for n in graph.get("nodes", []))
    return {"enabled": on, "number": _view(mine).number if on else None, "when": mine["description"] if on else None}


@router.put("/handover/{agent_id}")
async def handover_set(agent_id: str, body: HandoverBody, ctx: Ctx = Depends(require(Perm.TOOLS_WRITE)), gw: ToolsGateway = Depends(get_tools), pg: PlatformGateway = Depends(get_gateway)):
    if not _E164.match(body.number.strip()):
        raise product_error(400, "bad_number", "Enter the number with its country code, like +919876543210.")
    agent, graph = await _agent_graph(ctx, pg, agent_id)
    name = _handover_name(agent)
    old = next((t for t in await _tools(ctx, gw) if t["name"] == name), None)
    if old:
        await gw.archive(ctx.workspace.test_org_id, ctx.user.id, old["uuid"])
    spec = {"name": name, "description": body.when.strip(), "number": body.number.strip()}
    made = await gw.create_transfer(ctx.workspace.test_org_id, ctx.user.id, spec)
    try:  # the Live twin is matched by name when the agent goes live
        for t in await gw.list(ctx.workspace.live_org_id, ctx.user.id):
            if t["name"] == name:
                await gw.archive(ctx.workspace.live_org_id, ctx.user.id, t["uuid"])
        await gw.create_transfer(ctx.workspace.live_org_id, ctx.user.id, spec)
    except Exception:  # noqa: BLE001
        pass
    drop = old["uuid"] if old else None
    graph = _set_tools(graph, lambda u: list(dict.fromkeys([x for x in u if x != drop] + [made["uuid"]])))
    await pg.save_draft(ctx.workspace.test_org_id, agent.test_workflow_id, agent.name, graph)
    agent.version += 1
    await ctx.session.commit()
    return {"enabled": True, "number": spec["number"], "when": spec["description"]}


@router.delete("/handover/{agent_id}", status_code=204)
async def handover_off(agent_id: str, ctx: Ctx = Depends(require(Perm.TOOLS_WRITE)), gw: ToolsGateway = Depends(get_tools), pg: PlatformGateway = Depends(get_gateway)):
    agent, graph = await _agent_graph(ctx, pg, agent_id)
    old = next((t for t in await _tools(ctx, gw) if t["name"] == _handover_name(agent)), None)
    if old:
        graph = _set_tools(graph, lambda u: [x for x in u if x != old["uuid"]])
        await pg.save_draft(ctx.workspace.test_org_id, agent.test_workflow_id, agent.name, graph)
        await gw.archive(ctx.workspace.test_org_id, ctx.user.id, old["uuid"])
        agent.version += 1
        await ctx.session.commit()
