"""Mobile app support: bearer-token login, push devices, and "My Number".

My Number links a user's personal mobile number to a Swarvo agent. We do NOT take the SIM and never spoof caller ID:
the user's operator forwards inbound calls (GSM busy/no-answer/unreachable codes) to a Swarvo number, where the default
agent answers. Outbound calls always come from the user's Swarvo virtual number.

Inbound routing (`resolve_forwarded_call`): read the SIP Diversion / History-Info header to learn which linked number a
call was forwarded from. Fall back to a dedicated-DID-per-user mapping when the header is missing.
"""

import hashlib
import logging
import os
import re
import secrets
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.db.models import UserModel
from api.db.product_models import (
    ProductAgentModel,
    ProductDeviceModel,
    ProductFunnelEventModel,
    ProductLinkedNumberModel,
    ProductLinkedTestCallModel,
)
from api.product import config
from api.product import phone_verify as pv
from api.product import router as web_router
from api.product.deps import Ctx, get_ctx, get_session
from api.product.errors import product_error
from api.product.ids import new_public_id
from api.product.router import _client_ip
from api.product.schemas import LoginBody, SignupBody
from api.utils import rate_limit
from api.utils.auth import create_jwt_token

log = logging.getLogger(__name__)

mobile = APIRouter(prefix="/product/mobile", tags=["mobile"])
router = APIRouter(prefix="/product/my-number", tags=["my-number"])

CONSENT_VERSION = "2026-11-v1"
_E164 = re.compile(r"^\+[1-9]\d{9,14}$")
OTP_LIFE, OTP_TRIES = timedelta(minutes=10), 5
DEFAULT_SCHEDULE = {"windows": [{"days": [0, 1, 2, 3, 4, 5, 6], "start": "18:00", "end": "06:00"}], "timezone": "Asia/Kolkata"}


def feature_dedicated_number() -> bool:
    """Paid add-on "Dedicated number + branded caller name" (feature flag, off by default)."""
    return os.getenv("PRODUCT_FEATURE_DEDICATED_MYNUMBER", "0") == "1"


# The company's shared Plivo number that every My Number customer forwards to. Override with PRODUCT_MYNUMBER_POOL_NUMBER.
DEFAULT_POOL_NUMBER = "+918065493136"


def forward_pool_number() -> str | None:
    """The shared Swarvo number operators forward to when a user has no dedicated DID."""
    return os.getenv("PRODUCT_MYNUMBER_POOL_NUMBER") or DEFAULT_POOL_NUMBER


# ---------------------------------------------------------------- mobile auth ----


class MobileLoginOut(BaseModel):
    token: str
    me: dict


@mobile.post("/auth/login", response_model=MobileLoginOut)
async def mobile_login(body: LoginBody, request: Request, session: AsyncSession = Depends(get_session)):
    """Same checks as the web login (rate limits, 2FA, SSO rules). Returns the session JWT in the body, since a phone app
    cannot read the httpOnly cookie. The token is the same one the web sets and works as `Authorization: Bearer`."""
    result = await web_router.login(body, request, Response(), session)
    user = await session.scalar(select(UserModel).where(UserModel.email == body.email.lower()))
    if user is None or not hasattr(result, "model_dump"):
        raise product_error(401, "bad_credentials", "That email or password isn't right.")
    me = result.model_dump(mode="json")
    if me.get("setup_required"):
        raise product_error(403, "setup_required", "Finish setting up your account on the website first.")
    return MobileLoginOut(token=create_jwt_token(user.id, user.email or "", "admin", False), me=me)


@mobile.post("/auth/signup", response_model=MobileLoginOut)
async def mobile_signup(body: SignupBody, request: Request, session: AsyncSession = Depends(get_session),
                        mailer=Depends(web_router.emailer.get_mailer)):
    """Same as web sign-up (workspace, bonus rules, rate limits); returns a bearer token for the app."""
    result = await web_router.signup(body, request, Response(), session, mailer)
    user = await session.scalar(select(UserModel).where(UserModel.email == body.email.lower()))
    if user is None:
        raise product_error(400, "signup_failed", "We couldn't create your account. Please try again.")
    return MobileLoginOut(token=create_jwt_token(user.id, user.email or "", "admin", False), me=result.model_dump(mode="json"))


_CHECKOUT = """<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Add money</title><style>body{margin:0;font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:linear-gradient(135deg,#F7E9C8,#F4F1EA 45%,#DCE6F7);
min-height:100vh;display:flex;align-items:center;justify-content:center;color:#15161A}.c{background:#fffc;border-radius:24px;padding:28px;text-align:center;max-width:320px}
button{margin-top:16px;border:0;border-radius:999px;padding:14px 28px;font-size:16px;color:#fff;background:linear-gradient(90deg,#F2AE3B,#7C97E6)}</style></head>
<body><div class="c"><h2>Add __AMOUNT__ to your wallet</h2><p id="m">Opening secure payment…</p><button onclick="go()">Pay now</button></div>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script><script>
function back(q){location.href="swarvo://billing?"+q}
function go(){new Razorpay({key:"__KEY__",order_id:"__ORDER__",name:"Swarvo AI",description:"Wallet top-up",theme:{color:"#7C97E6"},
handler:function(r){back("order_id="+r.razorpay_order_id+"&payment_id="+r.razorpay_payment_id+"&signature="+r.razorpay_signature)},
modal:{ondismiss:function(){back("cancel=__ORDER__")}}}).open()}
window.onload=function(){try{go()}catch(e){document.getElementById("m").textContent="Tap Pay now to continue."}}
</script></body></html>"""


@mobile.get("/checkout", response_class=HTMLResponse)
async def checkout_page(order: str = Query(pattern=r"^order_[A-Za-z0-9]{6,40}$"), key: str = Query(pattern=r"^rzp_(test|live)_[A-Za-z0-9]{6,40}$"),
                        amount: float = Query(gt=0, le=10_000_000)):
    """Razorpay Standard Checkout for the app, which has no web page of its own. The order was created by the signed-in app
    (POST /billing/topups). Only public values appear here; the money is credited by `/billing/topups/confirm` (app) and the
    Razorpay webhook, both of which verify the payment signature."""
    html = _CHECKOUT.replace("__ORDER__", order).replace("__KEY__", key).replace("__AMOUNT__", f"₹{amount:,.0f}")
    return HTMLResponse(html, headers={"Cache-Control": "no-store"})


class PushBody(BaseModel):
    token: str = Field(min_length=10, max_length=512)
    platform: str = Field(pattern="^(android|ios)$")


@mobile.post("/push-token")
async def register_push(body: PushBody, ctx: Ctx = Depends(get_ctx)):
    row = await ctx.session.scalar(select(ProductDeviceModel).where(ProductDeviceModel.token == body.token))
    if row is None:
        ctx.session.add(ProductDeviceModel(user_id=ctx.user.id, token=body.token, platform=body.platform))
    else:
        row.user_id = ctx.user.id
    await ctx.session.commit()
    return {"ok": True}


async def send_push(session: AsyncSession, user_id: int, title: str, body: str, link: str | None = None) -> int:
    """Send to every device the user registered. FCM HTTP v1 for both platforms when `PRODUCT_FCM_PROJECT` and a bearer
    (`PRODUCT_FCM_ACCESS_TOKEN`, refreshed by deployment) are set; otherwise a no-op that logs. Returns devices attempted."""
    from api.product import fcm

    if not fcm.configured():
        log.info("push skipped (Firebase is not set up): %s", title)
        return 0
    n = await fcm.push_to_user(session, fcm.get_sender(), user_id, title, body, {"link": link or ""}, "calls")
    await session.commit()
    return n


# ----------------------------------------------------------------- My Number ----


class WindowIn(BaseModel):
    days: list[int]
    start: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    end: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")


class ScheduleIn(BaseModel):
    windows: list[WindowIn]
    timezone: str = "Asia/Kolkata"


class NumberOut(BaseModel):
    id: str
    e164: str
    operator: str | None
    verified: bool
    default_agent_id: str | None
    mode: str
    schedule: dict
    vip_count: int
    forwarding_status: dict
    routing: str
    forward_target: str | None
    enabled: bool
    paused_until: str | None
    status: str
    stats: dict


async def _stats(session: AsyncSession, row: ProductLinkedNumberModel) -> dict:
    """Tonight's numbers come from conversations tagged with this linked number (filled by the inbound hook)."""
    return {"calls_tonight": 0, "minutes_tonight": 0, "spend_tonight": 0.0}


def _target(r: ProductLinkedNumberModel) -> str | None:
    """The number the operator should forward to. Shared-pool customers always follow the CURRENT pool number, so changing it
    never leaves people forwarding to an old one; dedicated-number customers keep the number stored for them."""
    if r.routing == "dedicated":
        return r.forward_target or forward_pool_number()
    return forward_pool_number() or r.forward_target


async def _out(session: AsyncSession, r: ProductLinkedNumberModel) -> NumberOut:
    return NumberOut(
        id=r.public_id, e164=r.e164, operator=r.operator, verified=r.verified_at is not None, default_agent_id=r.default_agent_id,
        mode=r.mode, schedule=r.schedule or DEFAULT_SCHEDULE, vip_count=r.vip_count, forwarding_status=r.forwarding_status or {},
        routing=r.routing, forward_target=_target(r), enabled=r.enabled,
        paused_until=r.paused_until.isoformat() if r.paused_until else None, status=r.status, stats=await _stats(session, r))


async def _mine(ctx: Ctx, required: bool = True) -> ProductLinkedNumberModel | None:
    row = await ctx.session.scalar(select(ProductLinkedNumberModel).where(
        ProductLinkedNumberModel.workspace_id == ctx.workspace.id, ProductLinkedNumberModel.user_id == ctx.user.id,
        ProductLinkedNumberModel.status != "disconnected").order_by(ProductLinkedNumberModel.id.desc()))
    if row is None and required:
        raise product_error(404, "no_linked_number", "You haven't linked a number yet.")
    return row


@router.get("", response_model=NumberOut | None)
async def get_my_number(ctx: Ctx = Depends(get_ctx)):
    row = await _mine(ctx, required=False)
    return await _out(ctx.session, row) if row else None


class OtpStart(BaseModel):
    e164: str
    operator: str | None = None


def _hash(code: str, salt: str) -> str:
    return hashlib.sha256(f"{salt}:{code}".encode()).hexdigest()


@router.post("/otp/start")
async def otp_start(body: OtpStart, ctx: Ctx = Depends(get_ctx), sender: pv.OtpSender = Depends(pv.get_sender)):
    if not _E164.match(body.e164):
        raise product_error(400, "bad_number", "Enter the number with country code, like +919876543210.")
    await rate_limit.enforce(f"mn-otp:{ctx.user.id}", 5, 3600, "Too many codes requested. Try again in an hour.")
    taken = await ctx.session.scalar(select(ProductLinkedNumberModel.id).where(
        ProductLinkedNumberModel.e164 == body.e164, ProductLinkedNumberModel.status == "active", ProductLinkedNumberModel.user_id != ctx.user.id))
    if taken:
        raise product_error(409, "number_taken", "That number is already linked to another account.")
    row = await _mine(ctx, required=False)
    if row is None or row.e164 != body.e164:
        row = ProductLinkedNumberModel(public_id=new_public_id("lnk"), workspace_id=ctx.workspace.id, user_id=ctx.user.id, e164=body.e164, routing="shared_pool")
        ctx.session.add(row)
    code = f"{secrets.randbelow(10**6):06d}"
    row.operator, row.otp_hash, row.otp_tries = body.operator, _hash(code, row.public_id or body.e164), 0
    row.otp_expires_at = datetime.now(UTC) + OTP_LIFE
    await ctx.session.flush()
    row.otp_hash = _hash(code, row.public_id)
    try:
        await sender.send(body.e164, code)
    except Exception as e:  # noqa: BLE001
        await ctx.session.rollback()
        log.warning("my-number otp send failed: %s", e)
        raise product_error(503, "otp_unavailable", "We couldn't send the code right now. Please try again shortly.")
    await ctx.session.commit()
    return {"sent": True}


class OtpVerify(BaseModel):
    e164: str
    code: str = Field(min_length=4, max_length=8)


@router.post("/otp/verify", response_model=NumberOut)
async def otp_verify(body: OtpVerify, ctx: Ctx = Depends(get_ctx)):
    row = await _mine(ctx)
    exp = row.otp_expires_at.replace(tzinfo=UTC) if row.otp_expires_at and row.otp_expires_at.tzinfo is None else row.otp_expires_at
    if row.e164 != body.e164 or not row.otp_hash or not exp or exp < datetime.now(UTC):
        raise product_error(400, "code_expired", "That code expired. Ask for a new one.")
    if row.otp_tries >= OTP_TRIES:
        raise product_error(429, "too_many_tries", "Too many wrong codes. Ask for a new one.")
    if not secrets.compare_digest(row.otp_hash, _hash(body.code, row.public_id)):
        row.otp_tries += 1
        await ctx.session.commit()
        raise product_error(400, "bad_code", "That code isn't right.")
    row.verified_at, row.otp_hash, row.otp_expires_at = datetime.now(UTC), None, None
    row.forward_target = forward_pool_number()
    await ctx.session.commit()
    return await _out(ctx.session, row)


class ConsentIn(BaseModel):
    text_version: str
    accepted_at: str
    app_version: str


@router.post("/consent", response_model=NumberOut)
async def consent(body: ConsentIn, request: Request, ctx: Ctx = Depends(get_ctx)):
    """Stores what the user agreed to, with a timestamp, app version, text version and IP (DPDP Act record)."""
    row = await _mine(ctx)
    if row.verified_at is None:
        raise product_error(400, "not_verified", "Verify your number first.")
    row.consent = {**body.model_dump(), "ip": _client_ip(request), "recorded_at": datetime.now(UTC).isoformat()}
    await ctx.session.commit()
    return await _out(ctx.session, row)


class PatchIn(BaseModel):
    default_agent_id: str | None = None
    mode: str | None = Field(default=None, pattern="^(schedule|always|decline_only)$")
    schedule: ScheduleIn | None = None
    enabled: bool | None = None
    vip_count: int | None = Field(default=None, ge=0, le=1000)
    paused_until: str | None = None
    set_paused: bool = False


@router.patch("", response_model=NumberOut)
async def update(raw: dict, ctx: Ctx = Depends(get_ctx)):
    body = PatchIn(**raw)
    row = await _mine(ctx)
    if row.verified_at is None:
        raise product_error(400, "not_verified", "Verify your number first.")
    if body.default_agent_id is not None:
        agent = await ctx.session.scalar(select(ProductAgentModel).where(
            ProductAgentModel.public_id == body.default_agent_id, ProductAgentModel.workspace_id == ctx.workspace.id))
        if agent is None:
            raise product_error(404, "agent_not_found", "We couldn't find that agent.")
        if agent.live_workflow_id is None:
            raise product_error(400, "agent_not_live", "That agent isn't live yet. Publish it first, then choose it for My Number.")
        row.default_agent_id = agent.public_id
    if body.mode is not None:
        row.mode = body.mode
    if body.schedule is not None:
        row.schedule = body.schedule.model_dump()
    if body.vip_count is not None:
        row.vip_count = body.vip_count
    if "paused_until" in raw:
        row.paused_until = datetime.fromisoformat(raw["paused_until"]) if raw["paused_until"] else None
    if body.enabled is not None:
        if body.enabled and (row.consent is None or not row.default_agent_id):
            raise product_error(400, "setup_incomplete", "Choose an agent and accept the consent before turning this on.")
        if body.enabled:
            current = await ctx.session.scalar(select(ProductAgentModel).where(ProductAgentModel.public_id == row.default_agent_id))
            if current is None or current.live_workflow_id is None:
                raise product_error(400, "agent_not_live", "Your agent isn't live yet. Publish it first, then turn on My Number.")
        row.enabled = body.enabled
        row.status = "active" if body.enabled or row.status == "active" else row.status
    await ctx.session.commit()
    return await _out(ctx.session, row)


class FwdIn(BaseModel):
    status: dict[str, str]


@router.post("/forwarding-status", response_model=NumberOut)
async def forwarding_status(body: FwdIn, ctx: Ctx = Depends(get_ctx)):
    row = await _mine(ctx)
    row.forwarding_status = {k: v for k, v in body.status.items() if k in {"busy", "noAnswer", "unreachable", "all"}}
    await ctx.session.commit()
    return await _out(ctx.session, row)


@router.delete("", status_code=204)
async def disconnect(ctx: Ctx = Depends(get_ctx)):
    """Unlinks the number. Call history is kept (conversations are not touched)."""
    row = await _mine(ctx)
    row.status, row.enabled, row.forwarding_status, row.paused_until = "disconnected", False, {}, None
    await ctx.session.commit()


class FunnelIn(BaseModel):
    step: str = Field(max_length=40)


@router.post("/funnel", status_code=204)
async def funnel(body: FunnelIn, ctx: Ctx = Depends(get_ctx)):
    ctx.session.add(ProductFunnelEventModel(user_id=ctx.user.id, step=body.step))
    await ctx.session.commit()


# ------------------------------------------------------------------ test call ----


class TestCaller:
    """Places the onboarding test call from a Swarvo number to the user's phone. Plug in the telephony provider here."""

    async def call(self, to_e164: str, test_id: str) -> None:
        raise product_error(503, "test_call_unavailable", "Test calls aren't switched on yet. You can skip this step and try a real call.")


_caller = TestCaller()


def get_test_caller() -> TestCaller:
    return _caller


@router.post("/test-call")
async def test_call(ctx: Ctx = Depends(get_ctx), caller: TestCaller = Depends(get_test_caller)):
    row = await _mine(ctx)
    if row.verified_at is None:
        raise product_error(400, "not_verified", "Verify your number first.")
    t = ProductLinkedTestCallModel(id=new_public_id("tst"), linked_number_id=row.id)
    ctx.session.add(t)
    await ctx.session.commit()
    await caller.call(row.e164, t.id)
    return {"test_id": t.id}


@router.get("/test-call/{test_id}")
async def test_call_result(test_id: str, ctx: Ctx = Depends(get_ctx)):
    row = await _mine(ctx)
    t = await ctx.session.get(ProductLinkedTestCallModel, test_id)
    if t is None or t.linked_number_id != row.id:
        raise product_error(404, "not_found", "We couldn't find that test.")
    if t.state == "ringing" and datetime.now(UTC) - (t.created_at if t.created_at.tzinfo else t.created_at.replace(tzinfo=UTC)) > timedelta(minutes=2):
        t.state, t.reason = "failed", "timeout"
        await ctx.session.commit()
    return {"state": t.state, "reason": t.reason}


# ------------------------------------------------------------- inbound routing ----

_DIVERSION = re.compile(r"<(?:sip|tel):(\+?[\d]+)", re.I)


def forwarded_from(headers: dict[str, str]) -> str | None:
    """The number a call was forwarded from: Plivo's `ForwardedFrom` field, or SIP `Diversion` (RFC 5806) / the first `History-Info` entry (RFC 7044)."""
    lower = {k.lower(): v for k, v in headers.items()}
    # Plivo hands this over as a plain field on its webhook (ForwardedFrom=918826605360, with ForwardedReason and ForwardedCause).
    plain = "".join(ch for ch in str(lower.get("forwardedfrom", "")) if ch.isdigit())
    if len(plain) >= 8:
        return "+" + plain
    for h in ("diversion", "history-info", "p-asserted-identity-diverted"):
        # Providers prefix passed-through SIP headers (for example `sip-h-diversion` or `x-ph-diversion`), so match on the ending too.
        for key, value in lower.items():
            if key == h or key.endswith("-" + h) or key.endswith("_" + h):
                m = _DIVERSION.search(str(value))
                if m:
                    n = m.group(1)
                    return n if n.startswith("+") else "+" + n
    return None


class Routed(BaseModel):
    workspace_id: int
    linked_number_id: int
    agent_public_id: str | None
    context: dict


async def resolve_forwarded_call(session: AsyncSession, to_number: str, caller: str, headers: dict[str, str]) -> Routed | None:
    """Maps a call arriving on a Swarvo DID to the linked number it was forwarded from, its workspace and default agent.

    Strategy per number (`routing`): `dedicated` = the DID itself identifies the user; `shared_pool` = read the SIP header.
    When the header is absent, any number whose dedicated DID matches `to_number` wins. Returns None for ordinary calls.
    """
    row = None
    src = forwarded_from(headers)
    if src:
        row = await session.scalar(select(ProductLinkedNumberModel).where(
            ProductLinkedNumberModel.e164 == src, ProductLinkedNumberModel.status == "active", ProductLinkedNumberModel.enabled.is_(True)))
    if row is None:
        from api.db.models import TelephonyPhoneNumberModel

        did = await session.scalar(select(TelephonyPhoneNumberModel.id).where(TelephonyPhoneNumberModel.address_normalized == to_number))
        if did is not None:
            row = await session.scalar(select(ProductLinkedNumberModel).where(
                ProductLinkedNumberModel.dedicated_number_id == did, ProductLinkedNumberModel.status == "active"))
    if row is None:
        return None
    paused = row.paused_until and (row.paused_until if row.paused_until.tzinfo else row.paused_until.replace(tzinfo=UTC)) > datetime.now(UTC)
    if paused:
        return None
    from api.db.models import UserModel as U
    from api.product.service import get_display_name

    owner = await get_display_name(session, row.user_id) or "the owner"
    first = owner.split()[0]
    return Routed(
        workspace_id=row.workspace_id, linked_number_id=row.id, agent_public_id=row.default_agent_id,
        context={
            "original_caller": caller,
            "forwarded_from": row.e164,
            "forwarded_from_personal_number": True,
            "owner_first_name": first,
            "call_note": f"This call was forwarded from {first}'s personal number. Say that {first} is unavailable right now "
                         f"and you are their assistant, then help the caller or take a message.",
        })


async def mark_test_call_reached(session: AsyncSession, linked_number_id: int) -> None:
    """Called by the inbound hook when a forwarded call reaches the agent: flips the newest ringing test and pushes."""
    t = await session.scalar(select(ProductLinkedTestCallModel).where(
        ProductLinkedTestCallModel.linked_number_id == linked_number_id, ProductLinkedTestCallModel.state == "ringing")
        .order_by(ProductLinkedTestCallModel.created_at.desc()))
    if t:
        t.state = "reached_agent"
        await session.commit()


async def notify_call_summary(session: AsyncSession, user_id: int, caller: str, summary: str, call_id: str) -> None:
    """After the call: push the summary with a deep link to the conversation (swarvo://call/<id>)."""
    await send_push(session, user_id, f"AI answered a call from {caller}", summary[:140] or "Tap for the summary", f"/call/{call_id}")


async def after_forwarded_call(workflow_run_id: int) -> None:
    """Runs once a call has been billed. For a call forwarded from a customer's own number: push its summary (linking to the call),
    and warn the moment the wallet drops under 3 minutes. Never raises, and never sends twice for the same call."""
    try:
        from api.db import db_client
        from api.product.ids import encode_call_id
        from api.product.payments import CoreWallet
        from api.services.billing.wallet_service import _duration_from_run

        run = await db_client.get_workflow_run_by_id(workflow_run_id)
        ctx = (run.initial_context or {}) if run else {}
        if not run or not ctx.get("forwarded_from_personal_number"):
            return
        gathered = dict(run.gathered_context or {})
        if gathered.get("my_number_notified"):
            return
        secs = float(_duration_from_run(run.cost_info, run.usage_info) or 0)
        async with db_client.async_session() as s:
            link = await s.scalar(select(ProductLinkedNumberModel).where(
                ProductLinkedNumberModel.e164 == ctx.get("forwarded_from"), ProductLinkedNumberModel.status == "active"))
            if link is None:
                return
            agent = await s.scalar(select(ProductAgentModel).where(ProductAgentModel.public_id == link.default_agent_id)) if link.default_agent_id else None
            caller = ctx.get("original_caller") or ctx.get("caller_number") or "an unknown number"
            if secs >= 1:  # a call nobody spoke on is not worth a notification
                m, sec = divmod(int(secs), 60)
                await notify_call_summary(s, link.user_id, caller, f"{agent.name if agent else 'Your AI'} handled it for {m}:{sec:02d}. Tap to see what was said.", encode_call_id(workflow_run_id))
            workflow = await db_client.get_workflow_by_id(run.workflow_id)
            if workflow is not None and workflow.organization_id is not None:
                left = float((await CoreWallet().summary(workflow.organization_id)).get("minutes_available") or 0)
                if left < 3 <= left + secs / 60:  # just crossed the line: say it once, not on every call after
                    await notify_low_wallet(s, link.user_id, left)
        gathered["my_number_notified"] = True
        await db_client.update_workflow_run(workflow_run_id, gathered_context=gathered)
    except Exception as e:  # noqa: BLE001 - a notification problem must never touch billing or the call
        log.warning("my-number post-call notification skipped for run %s: %s", workflow_run_id, e)


async def notify_low_wallet(session: AsyncSession, user_id: int, minutes_left: float) -> None:
    await send_push(session, user_id, "Your wallet is almost empty", f"About {int(minutes_left)} minutes left. Callers will hear an unavailable message at zero.", "/more/billing")
