"""Push notifications to the phone app through Firebase Cloud Messaging.

Every alert the app raises with ``notifications.notify`` (a failed call, a low balance, a new booking, ...) can also reach the team's phones. The scheduled tick
calls ``deliver_pending`` every minute: it finds alerts not yet pushed, works out which team members should get each one (their role, and the categories they
switched on), and sends it to each of their phones. Tapping it opens the right screen (the alert's ``link``).

Set up: a Firebase project, and a service account key for it in PRODUCT_FCM_SA_B64 (the key file, base64 on one line) or PRODUCT_FCM_SA_JSON (the JSON itself, or a
path to the file). The project id comes from the key (PRODUCT_FCM_PROJECT overrides it). Without a key nothing is sent and nothing breaks.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select

from api.db.product_models import ProductDeviceModel, ProductMembershipModel, ProductNotificationModel, ProductUserProfileModel
from api.product.deps import Ctx, get_ctx

log = logging.getLogger(__name__)
router = APIRouter(prefix="/product/mobile", tags=["mobile"])

FRESH = timedelta(minutes=30)  # an alert older than this is never pushed (a late buzz about old news is worse than none)

# category key -> (label, what it covers, on by default, only owners and admins)
CATEGORIES: dict[str, tuple[str, str, bool, bool]] = {
    "attention": ("Calls that need you", "A call failed, or a caller was passed to a person.", True, False),
    "leads": ("Bookings and leads", "A call ended in a booking or a qualified lead.", True, False),
    "all_calls": ("Every finished call", "A short note after each call. Busy accounts may prefer this off.", False, False),
    "chat": ("Chat messages", "A customer needs a person, or writes in a chat you took over.", True, False),
    "money": ("Wallet and billing", "Low balance, spending limit, top-ups and invoices.", True, True),
    "campaigns": ("Campaigns", "A campaign finished or failed.", True, False),
    "milestones": ("Milestones", "Your first call, and every big round number after it.", True, False),
    "team": ("Team and agents", "Someone joined, or an agent went live or was paused.", True, False),
    "security": ("Security", "A password change, a new API key, or a webhook that stopped working.", True, True),
    "numbers": ("Phone numbers and verification", "Your ID check was reviewed, or a number was added.", True, True),
    "reports": ("Weekly report", "Your weekly summary is ready.", True, False),
}
KIND_CATEGORY = {
    "call": "attention", "handoff": "attention", "dnc": "attention", "lead": "leads", "every_call": "all_calls", "chat": "chat",
    "balance": "money", "spend": "money", "billing": "money", "topup": "money", "invoice": "money", "campaign": "campaigns", "milestone": "milestones",
    "agent": "team", "team": "team", "security": "security", "webhook": "security", "kyc": "numbers", "number": "numbers", "report": "reports",
}
CHANNELS = {"attention": "calls", "leads": "calls", "all_calls": "calls", "chat": "chat", "money": "account", "security": "account", "numbers": "account"}


def category_of(kind: str) -> str:
    return KIND_CATEGORY.get(kind, "team")


def channel_of(category: str) -> str:
    return CHANNELS.get(category, "general")


def wants(prefs: dict | None, category: str) -> bool:
    p = prefs or {}
    if p.get("enabled") is False:
        return False
    on = (p.get("categories") or {}).get(category)
    return CATEGORIES[category][2] if on is None else bool(on)


# ---------------------------------------------------------------- sending
def _service_account() -> dict | None:
    raw = os.getenv("PRODUCT_FCM_SA_B64", "").strip()
    try:
        if raw:
            return json.loads(base64.b64decode(raw).decode())
        raw = os.getenv("PRODUCT_FCM_SA_JSON", "").strip()
        if not raw:
            return None
        if raw.startswith("{"):
            return json.loads(raw)
        with open(raw, encoding="utf-8") as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        log.warning("the Firebase service account key could not be read", exc_info=True)
        return None


def configured() -> bool:
    info = _service_account()
    return bool(info and info.get("private_key") and (os.getenv("PRODUCT_FCM_PROJECT") or info.get("project_id")))


class FcmSender:
    """Sends one push. ``send`` returns "ok", "invalid" (the phone's token is no longer valid) or "error"."""

    def __init__(self, transport=None):
        self._transport = transport
        self._creds = None

    def _token(self) -> str:
        from google.auth.transport.requests import Request
        from google.oauth2 import service_account

        if self._creds is None or not self._creds.valid:
            if self._creds is None:
                self._creds = service_account.Credentials.from_service_account_info(_service_account(), scopes=["https://www.googleapis.com/auth/firebase.messaging"])
            self._creds.refresh(Request())
        return self._creds.token

    async def send(self, token: str, title: str, body: str, data: dict, channel: str) -> str:
        import httpx

        info = _service_account() or {}
        project = os.getenv("PRODUCT_FCM_PROJECT") or info.get("project_id")
        try:
            access = await asyncio.to_thread(self._token)
            msg = {"message": {"token": token, "notification": {"title": title[:120], "body": body[:240]}, "data": {k: str(v) for k, v in data.items()},
                               "android": {"priority": "HIGH", "notification": {"channel_id": channel, "tag": data.get("tag", "")}}}}
            async with httpx.AsyncClient(timeout=15, transport=self._transport) as c:
                r = await c.post(f"https://fcm.googleapis.com/v1/projects/{project}/messages:send", json=msg, headers={"Authorization": f"Bearer {access}"})
        except Exception:  # noqa: BLE001
            log.warning("push could not be sent", exc_info=True)
            return "error"
        if r.status_code == 200:
            return "ok"
        if r.status_code in (400, 404) and any(x in r.text for x in ("UNREGISTERED", "INVALID_ARGUMENT", "NOT_FOUND")):
            return "invalid"
        log.warning("push refused %s: %s", r.status_code, r.text[:200])
        return "error"


_sender = FcmSender()


def get_sender() -> FcmSender:
    """The seam tests replace."""
    return _sender


# ---------------------------------------------------------------- who gets what
async def recipients(session, workspace_id: int, category: str) -> list[int]:
    """User ids on the team who should hear about this category, by role and by their own switches."""
    owners_only = CATEGORIES[category][3]
    rows = (await session.execute(select(ProductMembershipModel.user_id, ProductMembershipModel.role).where(ProductMembershipModel.workspace_id == workspace_id))).all()
    out = []
    for uid, role in rows:
        if owners_only and role not in ("owner", "admin"):
            continue
        prof = await session.get(ProductUserProfileModel, uid)
        if wants(getattr(prof, "push_prefs", None), category):
            out.append(uid)
    return out


async def push_to_user(session, sender, user_id: int, title: str, body: str, data: dict, channel: str) -> int:
    """Send to each of one person's phones; forget phones that say their token is dead. Returns how many were reached."""
    sent = 0
    for d in (await session.scalars(select(ProductDeviceModel).where(ProductDeviceModel.user_id == user_id))).all():
        res = await sender.send(d.token, title, body, data, channel)
        if res == "ok":
            sent += 1
        elif res == "invalid":
            await session.delete(d)
    return sent


async def deliver_pending(session, sender, now: datetime | None = None, limit: int = 100) -> int:
    """Push the alerts raised since the last run. Returns how many phone messages were sent."""
    if not configured():
        return 0
    now = now or datetime.now(UTC)
    rows = (await session.scalars(select(ProductNotificationModel).where(ProductNotificationModel.pushed_at.is_(None), ProductNotificationModel.created_at > now - FRESH)
                                  .order_by(ProductNotificationModel.id).limit(limit))).all()
    sent = 0
    for n in rows:
        n.pushed_at = now
        cat = category_of(n.kind)
        data = {"link": n.link or "", "kind": n.kind, "tag": f"{n.kind}:{n.id}"}
        for uid in await recipients(session, n.workspace_id, cat):
            if uid == n.actor_id:
                continue
            sent += await push_to_user(session, sender, uid, n.title, n.body or "", data, channel_of(cat))
    await session.commit()
    return sent


# ---------------------------------------------------------------- the app's switches
class PrefsOut(BaseModel):
    enabled: bool
    configured: bool
    categories: list[dict]


class PrefsIn(BaseModel):
    enabled: bool | None = None
    categories: dict[str, bool] = Field(default_factory=dict)


async def _prefs_out(ctx: Ctx) -> PrefsOut:
    prof = await ctx.session.get(ProductUserProfileModel, ctx.user.id)
    p = getattr(prof, "push_prefs", None) or {}
    admin = ctx.role in ("owner", "admin")
    cats = [{"key": k, "label": v[0], "description": v[1], "on": wants(p, k) if p.get("enabled") is not False else bool((p.get("categories") or {}).get(k, v[2])), "default": v[2]}
            for k, v in CATEGORIES.items() if admin or not v[3]]
    return PrefsOut(enabled=p.get("enabled") is not False, configured=configured(), categories=cats)


@router.get("/push-prefs", response_model=PrefsOut)
async def get_prefs(ctx: Ctx = Depends(get_ctx)):
    return await _prefs_out(ctx)


@router.put("/push-prefs", response_model=PrefsOut)
async def put_prefs(body: PrefsIn, ctx: Ctx = Depends(get_ctx)):
    prof = await ctx.session.get(ProductUserProfileModel, ctx.user.id)
    if prof is None:
        prof = ProductUserProfileModel(user_id=ctx.user.id)
        ctx.session.add(prof)
    cur = dict(prof.push_prefs or {})
    cats = dict(cur.get("categories") or {})
    cats.update({k: bool(v) for k, v in body.categories.items() if k in CATEGORIES})
    cur["categories"] = cats
    if body.enabled is not None:
        cur["enabled"] = body.enabled
    prof.push_prefs = cur  # a new dict: a JSON value changed in place would not be saved
    await ctx.session.commit()
    return await _prefs_out(ctx)


@router.post("/push-test")
async def push_test(ctx: Ctx = Depends(get_ctx), sender: FcmSender = Depends(get_sender)):
    """A test message to this person's own phones, so they can see it working."""
    if not configured():
        return {"sent": 0, "configured": False}
    n = await push_to_user(ctx.session, sender, ctx.user.id, "Swarvo AI is connected", "This is a test notification. You will get alerts like this on this phone.", {"link": "/", "kind": "test"}, "general")
    await ctx.session.commit()
    return {"sent": n, "configured": True}


class ForgetIn(BaseModel):
    token: str = Field(min_length=10, max_length=512)


@router.post("/push-token/forget")
async def forget_token(body: ForgetIn, ctx: Ctx = Depends(get_ctx)):
    """Called when someone signs out of the app, so the next person on this phone does not get their alerts."""
    d = await ctx.session.scalar(select(ProductDeviceModel).where(ProductDeviceModel.token == body.token, ProductDeviceModel.user_id == ctx.user.id))
    if d is not None:
        await ctx.session.delete(d)
        await ctx.session.commit()
    return {"ok": True}

