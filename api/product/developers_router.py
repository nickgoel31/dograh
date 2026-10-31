"""Developers page: API keys, request log, webhooks. Also the scheduled `tick` that sends webhook events."""

import os
import secrets
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, Field
from sqlalchemy import select

from api.db.product_models import ProductApiKeyModel, ProductApiLogModel, ProductDeliveryModel, ProductWebhookModel
from api.product import audit
from api.product import developers as dev
from api.product.campaigns_router import CampaignGateway, get_campaigns
from api.product.deps import Ctx, get_ctx, get_session, require
from api.product.errors import product_error
from api.product.ids import decode_id, encode_id, new_public_id
from api.product.roles import Perm

router = APIRouter(prefix="/product/developers", tags=["developers"])
ops_router = APIRouter(prefix="/product/ops", tags=["ops"])


class KeyBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class KeyOut(BaseModel):
    id: str
    name: str
    environment: str
    hint: str
    created: str
    last_used: str | None
    key: str | None = None  # only in the response that creates it


class LogOut(BaseModel):
    time: str
    method: str
    path: str
    status: int
    ms: int
    key: str | None


class HookBody(BaseModel):
    url: str = Field(min_length=8, max_length=500)
    events: list[str] = Field(default_factory=lambda: list(dev.EVENTS), max_length=8)


class HookOut(BaseModel):
    id: str
    url: str
    events: list[str]
    active: bool
    secret: str | None = None  # only in the response that creates it
    failing: bool = False


class DeliveryOut(BaseModel):
    id: str
    event: str
    status: str
    attempts: int
    response_code: int | None
    error: str | None
    time: str
    next_attempt: str | None


def _key_out(k: ProductApiKeyModel, raw: str | None = None) -> KeyOut:
    return KeyOut(id=k.public_id, name=k.name, environment=k.environment, hint=k.hint, created=k.created_at.isoformat() if k.created_at else "",
                  last_used=k.last_used_at.isoformat() if k.last_used_at else None, key=raw)


@router.get("/keys", response_model=list[KeyOut])
async def list_keys(ctx: Ctx = Depends(require(Perm.API_KEYS_MANAGE))):
    rows = (await ctx.session.scalars(select(ProductApiKeyModel).where(
        ProductApiKeyModel.workspace_id == ctx.workspace.id, ProductApiKeyModel.environment == ctx.environment, ProductApiKeyModel.revoked_at.is_(None)).order_by(ProductApiKeyModel.id.desc()))).all()
    return [_key_out(k) for k in rows]


@router.post("/keys", response_model=KeyOut, status_code=201)
async def create_key(body: KeyBody, ctx: Ctx = Depends(require(Perm.API_KEYS_MANAGE))):
    raw, digest, hint = dev.make_key(ctx.environment)
    k = ProductApiKeyModel(workspace_id=ctx.workspace.id, public_id=new_public_id("key"), name=body.name.strip(), environment=ctx.environment,
                           hint=hint, key_hash=digest, created_by=ctx.user.id, created_at=datetime.now(UTC))
    ctx.session.add(k)
    await audit.record(ctx.session, ctx.workspace.id, ctx.user.id, "api_key.created", k.public_id, {"environment": ctx.environment})
    await ctx.session.commit()
    return _key_out(k, raw)


@router.delete("/keys/{key_id}")
async def revoke_key(key_id: str, ctx: Ctx = Depends(require(Perm.API_KEYS_MANAGE))):
    k = await ctx.session.scalar(select(ProductApiKeyModel).where(ProductApiKeyModel.public_id == key_id, ProductApiKeyModel.workspace_id == ctx.workspace.id))
    if k is None:
        raise product_error(404, "key_not_found", "We couldn't find that key.")
    k.revoked_at = k.revoked_at or datetime.now(UTC)
    await audit.record(ctx.session, ctx.workspace.id, ctx.user.id, "api_key.revoked", k.public_id)
    await ctx.session.commit()
    return {"ok": True}


@router.get("/logs", response_model=list[LogOut])
async def logs(limit: int = 50, ctx: Ctx = Depends(require(Perm.API_KEYS_MANAGE))):
    rows = (await ctx.session.execute(
        select(ProductApiLogModel, ProductApiKeyModel.hint).outerjoin(ProductApiKeyModel, ProductApiLogModel.key_id == ProductApiKeyModel.id)
        .where(ProductApiLogModel.workspace_id == ctx.workspace.id, (ProductApiKeyModel.environment == ctx.environment) | (ProductApiKeyModel.id.is_(None)))
        .order_by(ProductApiLogModel.id.desc()).limit(max(1, min(limit, 200))))).all()
    return [LogOut(time=r.created_at.isoformat() if r.created_at else "", method=r.method, path=r.path, status=r.status, ms=r.ms, key=h) for r, h in rows]


# ---- webhooks ---------------------------------------------------------------

def _hook_out(w: ProductWebhookModel, secret: str | None = None, failing: bool = False) -> HookOut:
    return HookOut(id=w.public_id, url=w.url, events=list(w.events), active=bool(w.active), secret=secret, failing=failing)


async def _hook(ctx: Ctx, hook_id: str) -> ProductWebhookModel:
    w = await ctx.session.scalar(select(ProductWebhookModel).where(
        ProductWebhookModel.public_id == hook_id, ProductWebhookModel.workspace_id == ctx.workspace.id, ProductWebhookModel.environment == ctx.environment))
    if w is None:
        raise product_error(404, "webhook_not_found", "We couldn't find that webhook.")
    return w


@router.get("/events")
async def events(ctx: Ctx = Depends(get_ctx)):
    return {"events": [{"name": e, "available": e != "tool.failed",
                        "note": "Not sent yet: the platform doesn't report tool results in a form we can rely on." if e == "tool.failed" else None} for e in dev.EVENTS],
            "signature_header": dev.signature_header()}


@router.get("/webhooks", response_model=list[HookOut])
async def list_hooks(ctx: Ctx = Depends(require(Perm.WEBHOOKS_MANAGE))):
    rows = (await ctx.session.scalars(select(ProductWebhookModel).where(
        ProductWebhookModel.workspace_id == ctx.workspace.id, ProductWebhookModel.environment == ctx.environment).order_by(ProductWebhookModel.id.desc()))).all()
    failing = set((await ctx.session.scalars(select(ProductDeliveryModel.webhook_id).where(ProductDeliveryModel.webhook_id.in_([w.id for w in rows] or [0]), ProductDeliveryModel.status == "failed"))).all())
    return [_hook_out(w, failing=w.id in failing) for w in rows]


@router.post("/webhooks", response_model=HookOut, status_code=201)
async def create_hook(body: HookBody, ctx: Ctx = Depends(require(Perm.WEBHOOKS_MANAGE))):
    why = dev.check_url(body.url)
    if why:
        raise product_error(400, "bad_webhook_url", why)
    bad = [e for e in body.events if e not in dev.EVENTS]
    if bad or not body.events:
        raise product_error(400, "bad_events", "Pick at least one of the events we send.")
    secret = "whsec_" + secrets.token_urlsafe(24)
    w = ProductWebhookModel(workspace_id=ctx.workspace.id, public_id=new_public_id("wh"), environment=ctx.environment, url=body.url.strip(), secret=secret, events=sorted(set(body.events)), active=True, created_at=datetime.now(UTC))
    ctx.session.add(w)
    await audit.record(ctx.session, ctx.workspace.id, ctx.user.id, "webhook.created", w.public_id, {"url": w.url})
    await ctx.session.commit()
    return _hook_out(w, secret)


@router.delete("/webhooks/{hook_id}")
async def delete_hook(hook_id: str, ctx: Ctx = Depends(require(Perm.WEBHOOKS_MANAGE))):
    w = await _hook(ctx, hook_id)
    await audit.record(ctx.session, ctx.workspace.id, ctx.user.id, "webhook.deleted", w.public_id)
    await ctx.session.delete(w)
    await ctx.session.commit()
    return {"ok": True}


def _delivery_out(d: ProductDeliveryModel) -> DeliveryOut:
    return DeliveryOut(id=encode_id("dlv", d.id), event=d.event, status=d.status, attempts=d.attempts, response_code=d.response_code, error=d.error,
                       time=d.created_at.isoformat() if d.created_at else "", next_attempt=d.next_attempt_at.isoformat() if d.next_attempt_at else None)


@router.get("/webhooks/{hook_id}/deliveries", response_model=list[DeliveryOut])
async def deliveries(hook_id: str, ctx: Ctx = Depends(require(Perm.WEBHOOKS_MANAGE))):
    w = await _hook(ctx, hook_id)
    rows = (await ctx.session.scalars(select(ProductDeliveryModel).where(ProductDeliveryModel.webhook_id == w.id).order_by(ProductDeliveryModel.id.desc()).limit(50))).all()
    return [_delivery_out(d) for d in rows]


@router.post("/webhooks/{hook_id}/test", response_model=DeliveryOut)
async def send_test(hook_id: str, ctx: Ctx = Depends(require(Perm.WEBHOOKS_MANAGE)), sender: dev.Sender = Depends(dev.get_sender)):
    w = await _hook(ctx, hook_id)
    d = await dev.enqueue(ctx.session, w, "webhook.test", {"message": "This is a test event."})
    await dev.deliver(ctx.session, w, d, sender)
    await ctx.session.commit()
    return _delivery_out(d)


@router.post("/webhooks/deliveries/{delivery_id}/resend", response_model=DeliveryOut)
async def resend(delivery_id: str, ctx: Ctx = Depends(require(Perm.WEBHOOKS_MANAGE)), sender: dev.Sender = Depends(dev.get_sender)):
    did = decode_id("dlv", delivery_id)
    row = (await ctx.session.execute(select(ProductDeliveryModel, ProductWebhookModel).join(ProductWebhookModel, ProductDeliveryModel.webhook_id == ProductWebhookModel.id)
                                     .where(ProductDeliveryModel.id == did, ProductWebhookModel.workspace_id == ctx.workspace.id))).first() if did else None
    if row is None:
        raise product_error(404, "delivery_not_found", "We couldn't find that delivery.")
    d, w = row
    d.attempts = 0
    await dev.deliver(ctx.session, w, d, sender)
    await ctx.session.commit()
    return _delivery_out(d)


@router.post("/webhooks/send-now")
async def send_now(ctx: Ctx = Depends(require(Perm.WEBHOOKS_MANAGE)), sender: dev.Sender = Depends(dev.get_sender), gw: CampaignGateway = Depends(get_campaigns)):
    """Check for new calls and send anything waiting, for this workspace."""
    return await dev.tick(ctx.session, sender, gw, ctx.workspace.id)


@ops_router.post("/tick")
async def ops_tick(x_ops_secret: str | None = Header(default=None), session=Depends(get_session), sender: dev.Sender = Depends(dev.get_sender), gw: CampaignGateway = Depends(get_campaigns)):
    """For the operator's scheduler (cron, every minute): send webhook events and apply data-retention for every workspace."""
    secret = os.getenv("PRODUCT_OPS_SECRET")
    if not secret:
        raise product_error(404, "not_found", "Not found.")
    if not x_ops_secret or not secrets.compare_digest(x_ops_secret, secret):
        raise product_error(401, "bad_ops_secret", "Not allowed.")
    from api.db.product_models import ProductSettingsModel, ProductWorkspaceModel
    from api.product import privacy

    out = await dev.tick(session, sender, gw)
    purged = 0
    for ws_id in (await session.scalars(select(ProductSettingsModel.workspace_id).where(ProductSettingsModel.retention_days.is_not(None)))).all():
        ws = await session.get(ProductWorkspaceModel, ws_id)
        purged += await privacy.purge_expired(session, ws) if ws else 0
    await session.commit()
    return {**out, "purged": purged}
