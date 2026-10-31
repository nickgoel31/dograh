"""Connect outside services, and the secret-address endpoints the agent's tools call during a call."""

import hashlib
import secrets

import httpx
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from api.db.product_models import ProductIntegrationModel
from api.product import audit, connectors
from api.product.deps import Ctx, get_ctx, get_session, require
from api.product.errors import product_error
from api.product.roles import Perm
from api.product.tools_router import ToolsGateway, get_tools
from api.utils import rate_limit

router = APIRouter(prefix="/product/connectors", tags=["integrations"])
hooks = APIRouter(prefix="/product/hooks/c", tags=["integrations"])
MASK = "••••••••"


def get_transport() -> httpx.AsyncBaseTransport | None:
    """Seam for tests: a fake network."""
    return None


def _h(t: str) -> str:
    return hashlib.sha256(t.encode()).hexdigest()


def _base() -> str:
    from api.constants import BACKEND_API_ENDPOINT

    return BACKEND_API_ENDPOINT.rstrip("/")


def _spec(c: connectors.Connector, a: connectors.Action, token: str) -> dict:
    return {"name": f"{c.name}: {a.name}", "description": a.description, "url": f"{_base()}/api/v1/product/hooks/c/{token}/{a.key}", "method": "POST", "headers": {}, "parameters": a.params}


async def _row(session, ws_id: int, kind: str) -> ProductIntegrationModel | None:
    return await session.scalar(select(ProductIntegrationModel).where(ProductIntegrationModel.workspace_id == ws_id, ProductIntegrationModel.kind == kind))


async def _drop_tools(ctx: Ctx, gw: ToolsGateway, c: connectors.Connector) -> None:
    names = {f"{c.name}: {a.name}" for a in c.actions}
    for org in (ctx.workspace.test_org_id, ctx.workspace.live_org_id):
        try:
            for t in await gw.list(org, ctx.user.id):
                if t["name"] in names:
                    await gw.archive(org, ctx.user.id, t["uuid"])
        except Exception:  # noqa: BLE001
            pass


class ConnectBody(BaseModel):
    config: dict[str, str] = Field(default_factory=dict)


@router.get("")
async def catalog(ctx: Ctx = Depends(get_ctx)):
    rows = {r.kind: r for r in (await ctx.session.scalars(select(ProductIntegrationModel).where(ProductIntegrationModel.workspace_id == ctx.workspace.id))).all()}
    out = []
    for c in connectors.REGISTRY.values():
        cfg = (rows[c.id].config if c.id in rows else None) or {}
        out.append({"id": c.id, "name": c.name, "blurb": c.blurb, "connected": c.id in rows, "info": connectors.info(c.id),
                    "does": [a.name for a in c.actions] + (["Sends every call to it"] if c.push else []),
                    "fields": [{"key": f.key, "label": f.label, "secret": f.secret, "hint": f.hint, "optional": f.optional, "value": (MASK if cfg.get(f.key) else "") if f.secret else cfg.get(f.key, f.default)} for f in c.fields]})
    return out


@router.put("/{cid}")
async def connect(cid: str, body: ConnectBody, ctx: Ctx = Depends(require(Perm.TOOLS_WRITE)), gw: ToolsGateway = Depends(get_tools), transport=Depends(get_transport)):
    c = connectors.REGISTRY.get(cid)
    if c is None:
        raise product_error(404, "not_found", "We don't know that service.")
    row = await _row(ctx.session, ctx.workspace.id, cid)
    cfg = {f.key: (body.config.get(f.key) or "").strip() for f in c.fields}
    for f in c.fields:  # an untouched secret keeps its saved value
        if f.secret and cfg[f.key] in ("", MASK) and row is not None:
            cfg[f.key] = (row.config or {}).get(f.key, "")
        if not cfg[f.key] and f.default:
            cfg[f.key] = f.default
    gaps = connectors.missing(c, cfg)
    if gaps:
        raise product_error(400, "missing_fields", "Please fill in: " + ", ".join(gaps) + ".")
    try:
        async with connectors.client(transport) as http:
            await c.check(cfg, http)
    except connectors.ConnectorError as e:
        raise product_error(400, "connector_failed", str(e))
    except Exception:  # noqa: BLE001 - bad time zone, unreachable address, malformed answer...
        raise product_error(400, "connector_failed", f"We couldn't connect to {c.name} with those details. Check them and try again.")
    token = secrets.token_urlsafe(24)
    if row is None:
        row = ProductIntegrationModel(workspace_id=ctx.workspace.id, kind=cid, token_hash=_h(token), config=cfg)
        ctx.session.add(row)
    else:
        row.token_hash, row.config = _h(token), cfg
    if c.actions:
        await _drop_tools(ctx, gw, c)
        for org in (ctx.workspace.test_org_id, ctx.workspace.live_org_id):
            try:
                for a in c.actions:
                    await gw.create_http(org, ctx.user.id, _spec(c, a, token))
            except Exception:  # noqa: BLE001 - the Live copy is repaired when an agent using it goes live
                pass
    await audit.record(ctx.session, ctx.workspace.id, ctx.user.id, "integration.connected", cid)
    await ctx.session.commit()
    return {"connected": True}


@router.delete("/{cid}", status_code=204)
async def disconnect(cid: str, ctx: Ctx = Depends(require(Perm.TOOLS_WRITE)), gw: ToolsGateway = Depends(get_tools)):
    c = connectors.REGISTRY.get(cid)
    if c is None:
        raise product_error(404, "not_found", "We don't know that service.")
    row = await _row(ctx.session, ctx.workspace.id, cid)
    if row is not None:
        await ctx.session.delete(row)
    await _drop_tools(ctx, gw, c)
    await audit.record(ctx.session, ctx.workspace.id, ctx.user.id, "integration.removed", cid)
    await ctx.session.commit()


@hooks.post("/{token}/{action}")
async def run_action(token: str, action: str, request: Request, session=Depends(get_session), transport=Depends(get_transport)):
    await rate_limit.enforce(f"chook:{token[:12]}", 120, 60, "Too many requests.")
    row = await session.scalar(select(ProductIntegrationModel).where(ProductIntegrationModel.token_hash == _h(token)))
    c = connectors.REGISTRY.get(row.kind) if row else None
    a = next((x for x in c.actions if x.key == action), None) if c else None
    if row is None or a is None:
        raise product_error(404, "not_found", "Not found.")
    try:
        args = await request.json()
    except ValueError:
        args = {}
    try:
        async with connectors.client(transport) as http:
            return await a.run(row.config, http, args if isinstance(args, dict) else {})
    except Exception as e:  # noqa: BLE001 - the agent should say something sensible, never see an error page
        return {"ok": False, "message": str(e) if isinstance(e, connectors.ConnectorError) else f"I couldn't do that with {c.name} right now."}
