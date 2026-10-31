"""API keys and outbound webhooks.

Keys: ``sk_test_…`` reach the Test side, ``sk_live_…`` the Live side. Only a hash is stored; the full key is shown once.
Webhooks: events are written as delivery rows first (so none are lost), then sent with a signature and retried with
back-off. Nothing here runs by itself: ``tick`` (see developers_router) must be called on a schedule.
"""

import asyncio
import hashlib
import hmac
import ipaddress
import json
import os
import secrets
import socket
from datetime import UTC, datetime, timedelta
from typing import Awaitable, Callable
from urllib.parse import urlsplit

from sqlalchemy import select

from api.db.models import WorkflowModel, WorkflowRunModel
from api.db.product_models import ProductAgentModel, ProductApiKeyModel, ProductDeliveryModel, ProductWebhookModel, ProductWorkspaceModel
from api.product import config
from api.product import conversations as conv
from api.product.ids import encode_call_id, encode_id

EVENTS = ("call.started", "call.ended", "tool.failed", "campaign.completed")
MAX_ATTEMPTS = 6
BACKOFF = [60, 300, 1800, 7200, 43200]  # seconds before attempts 2..6
SCAN_RUNS = 200

Sender = Callable[[str, dict, bytes], Awaitable[tuple[int | None, str | None]]]


# ---- keys -----------------------------------------------------------------

def hash_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def make_key(environment: str) -> tuple[str, str, str]:
    raw = f"sk_{environment}_" + secrets.token_urlsafe(24)
    return raw, hash_key(raw), f"{raw[:8]}…{raw[-4:]}"


async def authenticate(session, raw: str | None) -> ProductApiKeyModel | None:
    if not raw or not raw.startswith(("sk_test_", "sk_live_")):
        return None
    return await session.scalar(select(ProductApiKeyModel).where(ProductApiKeyModel.key_hash == hash_key(raw), ProductApiKeyModel.revoked_at.is_(None)))


# ---- webhook plumbing -------------------------------------------------------

def signature_header() -> str:
    return f"X-{config.PRODUCT_NAME.replace(' ', '-')}-Signature"


def sign(secret: str, ts: int, body: bytes) -> str:
    return hmac.new(secret.encode(), f"{ts}.".encode() + body, "sha256").hexdigest()


def _private(host: str) -> bool:
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return host.lower() in ("localhost",) or host.lower().endswith((".local", ".internal"))
    return ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved


def check_url(url: str) -> str | None:
    """A reason the address can't be used, or None. Stops webhooks being pointed at the server's own network."""
    p = urlsplit(url.strip())
    if p.scheme != "https" and not (p.scheme == "http" and os.getenv("PRODUCT_ALLOW_PRIVATE_WEBHOOKS") == "true"):
        return "Use an https:// address."
    if not p.hostname:
        return "That doesn't look like a web address."
    if _private(p.hostname) and os.getenv("PRODUCT_ALLOW_PRIVATE_WEBHOOKS") != "true":
        return "That address points inside a private network, so we can't send to it."
    return None


async def default_sender(url: str, headers: dict, body: bytes) -> tuple[int | None, str | None]:
    import httpx

    host = urlsplit(url).hostname or ""
    if os.getenv("PRODUCT_ALLOW_PRIVATE_WEBHOOKS") != "true":
        try:  # the name may resolve somewhere private even if it looks public
            infos = await asyncio.get_running_loop().getaddrinfo(host, None, type=socket.SOCK_STREAM)
            if any(_private(i[4][0]) for i in infos):
                return None, "The address points inside a private network."
        except OSError:
            return None, "We couldn't find that address."
    try:
        async with httpx.AsyncClient(timeout=8, follow_redirects=False) as c:
            r = await c.post(url, content=body, headers=headers)
        return r.status_code, None if r.is_success else f"Your server answered {r.status_code}."
    except Exception as e:  # noqa: BLE001
        return None, f"Couldn't reach your server ({type(e).__name__})."


def get_sender() -> Sender:
    return default_sender


async def enqueue(session, wh: ProductWebhookModel, event: str, data: dict, dedupe_key: str | None = None) -> ProductDeliveryModel | None:
    if event not in EVENTS + ("webhook.test",):
        return None
    if dedupe_key and await session.scalar(select(ProductDeliveryModel.id).where(ProductDeliveryModel.webhook_id == wh.id, ProductDeliveryModel.dedupe_key == dedupe_key)):
        return None
    d = ProductDeliveryModel(webhook_id=wh.id, event=event, dedupe_key=dedupe_key, payload=data, status="pending", attempts=0, next_attempt_at=datetime.now(UTC))
    session.add(d)
    await session.flush()
    return d


async def deliver(session, wh: ProductWebhookModel, d: ProductDeliveryModel, sender: Sender, now: datetime | None = None) -> None:
    now = now or datetime.now(UTC)
    ts = int(now.timestamp())
    body = json.dumps({"id": encode_id("evt", d.id), "type": d.event, "created": now.isoformat(), "environment": wh.environment, "data": d.payload}, separators=(",", ":")).encode()
    headers = {"Content-Type": "application/json", signature_header(): f"t={ts},v1={sign(wh.secret, ts, body)}", "User-Agent": f"{config.PRODUCT_NAME}-Webhooks/1"}
    code, err = await sender(wh.url, headers, body)
    d.attempts += 1
    d.response_code = code
    d.error = err
    if code is not None and 200 <= code < 300:
        d.status, d.next_attempt_at, d.error = "ok", None, None
    elif d.attempts >= MAX_ATTEMPTS:
        d.status, d.next_attempt_at = "failed", None
    else:
        d.status, d.next_attempt_at = "pending", now + timedelta(seconds=BACKOFF[min(d.attempts - 1, len(BACKOFF) - 1)])
    await session.flush()


async def deliver_due(session, sender: Sender, now: datetime | None = None, workspace_id: int | None = None, limit: int = 100) -> int:
    from api.product.notifications import notify

    now = now or datetime.now(UTC)
    q = (select(ProductDeliveryModel, ProductWebhookModel).join(ProductWebhookModel, ProductDeliveryModel.webhook_id == ProductWebhookModel.id)
         .where(ProductDeliveryModel.status == "pending", ProductDeliveryModel.next_attempt_at <= now, ProductWebhookModel.active.is_(True)))
    if workspace_id:
        q = q.where(ProductWebhookModel.workspace_id == workspace_id)
    sent = 0
    for d, wh in (await session.execute(q.order_by(ProductDeliveryModel.id).limit(limit))).all():
        await deliver(session, wh, d, sender, now)
        sent += 1
        if d.status == "failed":
            await notify(session, wh.workspace_id, "webhook", "A webhook stopped working", f"We couldn't reach {wh.url} after {MAX_ATTEMPTS} tries. Fix it, then resend from Developers.", "/developers", f"webhook-failed:{wh.public_id}")
    return sent


async def scan_events(session, ws: ProductWorkspaceModel, wh: ProductWebhookModel, campaigns=None) -> int:
    """Turn recent calls (and finished campaigns) into events, once each."""
    org = ws.test_org_id if wh.environment == "test" else ws.live_org_id
    agents = {(a.test_workflow_id if wh.environment == "test" else a.live_workflow_id): a for a in
              (await session.scalars(select(ProductAgentModel).where(ProductAgentModel.workspace_id == ws.id))).all()}
    runs = (await session.scalars(select(WorkflowRunModel).join(WorkflowModel, WorkflowRunModel.workflow_id == WorkflowModel.id)
                                  .where(WorkflowModel.organization_id == org).order_by(WorkflowRunModel.id.desc()).limit(SCAN_RUNS))).all()
    n = 0
    for r in reversed(runs):
        a = agents.get(r.workflow_id)
        base = {"call_id": encode_call_id(r.id), "agent_id": a.public_id if a else None, "test": wh.environment == "test"}
        if "call.started" in wh.events and await enqueue(session, wh, "call.started", base, f"started:{r.id}"):
            n += 1
        if r.is_completed and "call.ended" in wh.events:
            gathered = r.gathered_context or {}
            dur = conv.duration_seconds(r.cost_info, r.usage_info)
            outcome = conv.product_outcome(disposition=gathered.get("mapped_call_disposition") or gathered.get("call_disposition"), completed=True, duration=dur)
            if await enqueue(session, wh, "call.ended", {**base, "duration": int(round(dur or 0)), "outcome": outcome}, f"ended:{r.id}"):
                n += 1
    if campaigns is not None and "campaign.completed" in wh.events and wh.environment == "live":
        for c in await campaigns.list(org, ws.owner_user_id):
            if c.get("state") == "completed" and await enqueue(session, wh, "campaign.completed", {"campaign_id": encode_id("cmp", c["ref"]), "name": c.get("name", "")}, f"campaign:{c['ref']}"):
                n += 1
    return n


async def tick(session, sender: Sender, campaigns=None, workspace_id: int | None = None) -> dict:
    q = select(ProductWebhookModel, ProductWorkspaceModel).join(ProductWorkspaceModel, ProductWebhookModel.workspace_id == ProductWorkspaceModel.id).where(ProductWebhookModel.active.is_(True))
    if workspace_id:
        q = q.where(ProductWebhookModel.workspace_id == workspace_id)
    queued = 0
    for wh, ws in (await session.execute(q)).all():
        queued += await scan_events(session, ws, wh, campaigns)
    sent = await deliver_due(session, sender, workspace_id=workspace_id)
    await session.commit()
    return {"queued": queued, "sent": sent}
