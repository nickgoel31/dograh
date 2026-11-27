"""Swarvo IVR over HTTP: the workspace's menus (build, test, publish), their calls, and the signed Plivo callbacks that run a live call."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response
from loguru import logger
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from api.db.product_models import ProductAgentModel, ProductBillingSettingsModel, ProductIvrCallModel, ProductIvrModel
from api.product import ivr as ivr_mod
from api.product import ivr_engine as eng
from api.product.deps import Ctx, get_ctx, get_session, require
from api.product.errors import product_error
from api.product.ids import new_public_id
from api.product.roles import Perm
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/product/ivr", tags=["ivr"])
public = APIRouter(prefix="/ivr", tags=["ivr-callbacks"], include_in_schema=False)


def _starter() -> dict:
    """A menu most businesses want on day one: open or closed, then sales / support / a person."""
    return eng.clean({"start": "hours", "nodes": {
        "hours": {"type": "hours", "label": "Are we open?", "open": "main", "closed": "closed"},
        "main": {"type": "menu", "label": "Main menu", "say": "Thank you for calling. For sales, press 1. For support, press 2. To leave a message, press 3.",
                 "options": {"1": "sales", "2": "support", "3": "vm"}, "retries": 2},
        "sales": {"type": "say", "label": "Sales", "say": "Our sales team will be happy to help. Please leave your name and number after the beep.", "next": "vm"},
        "support": {"type": "say", "label": "Support", "say": "For support, please leave a message and we will call you back today.", "next": "vm"},
        "closed": {"type": "say", "label": "We are closed", "say": "We are closed right now. Please leave a message and we will call you back.", "next": "vm"},
        "vm": {"type": "voicemail", "label": "Voicemail", "say": "Please leave your message after the beep, then press hash.", "seconds": 60, "next": "bye"},
        "bye": {"type": "hangup", "label": "Goodbye", "say": "Thank you. Goodbye."},
    }})


class IvrOut(BaseModel):
    id: str
    name: str
    status: str
    flow: dict
    settings: dict
    problems: list[str]
    numbers: list[str]
    calls: int
    pulse_locked: bool = False  # the platform owner set this customer's IVR billing cycle
    updated: str | None


class CreateBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    starter: bool = True


class ChangeBody(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    flow: dict | None = None
    settings: dict | None = None


class TestCallBody(BaseModel):
    number: str = Field(max_length=24)
    mine: bool = False  # the person confirms the number is theirs


class SimBody(BaseModel):
    node: str | None = None
    digits: str = ""
    speech: str = ""
    tries: int = 0
    vars: dict = Field(default_factory=dict)
    open: bool = True


async def _get(ctx: Ctx, public_id: str) -> ProductIvrModel:
    row = await ctx.session.scalar(select(ProductIvrModel).where(ProductIvrModel.public_id == public_id, ProductIvrModel.workspace_id == ctx.workspace.id))
    if row is None:
        raise product_error(404, "ivr_not_found", "We couldn't find that menu.")
    return row


async def _numbers_of(ctx: Ctx, public_id: str) -> list[str]:
    from api.db.models import TelephonyPhoneNumberModel

    rows = (await ctx.session.scalars(select(TelephonyPhoneNumberModel).where(TelephonyPhoneNumberModel.organization_id == ctx.workspace.live_org_id))).all()
    return [r.address for r in rows if (r.extra_metadata or {}).get("ivr_id") == public_id]


async def _out(ctx: Ctx, r: ProductIvrModel) -> IvrOut:
    calls = await ctx.session.scalar(select(func.count(ProductIvrCallModel.id)).where(ProductIvrCallModel.ivr_id == r.id)) or 0
    owner = await ctx.session.get(ProductBillingSettingsModel, ctx.workspace.id)
    st = ivr_mod.settings_of(r)
    locked = owner is not None and owner.ivr_pulse in (30, 60)
    if locked:
        st["pulse"] = owner.ivr_pulse
    return IvrOut(id=r.public_id, name=r.name, status=r.status, flow=r.flow or {}, settings=st, pulse_locked=locked, problems=eng.problems(r.flow) if r.flow else [],
                  numbers=await _numbers_of(ctx, r.public_id), calls=int(calls), updated=r.updated_at.isoformat() if r.updated_at else None)


@router.get("/options")
async def options(ctx: Ctx = Depends(get_ctx)):
    """What the builder offers: voices, languages, billing choices and today's prices."""
    return {"voices": ivr_mod.VOICES, "languages": ivr_mod.LANGUAGES, "types": list(eng.TYPES),
            "pricing": [{"pulse": p, "per_minute": ivr_mod.rate_per_minute(p)} for p in (60, 30)]}


@router.get("", response_model=list[IvrOut])
async def list_ivrs(ctx: Ctx = Depends(get_ctx)):
    rows = (await ctx.session.scalars(select(ProductIvrModel).where(ProductIvrModel.workspace_id == ctx.workspace.id).order_by(ProductIvrModel.id))).all()
    return [await _out(ctx, r) for r in rows]


@router.post("", response_model=IvrOut, status_code=201)
async def create(body: CreateBody, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE))):
    n = await ctx.session.scalar(select(func.count(ProductIvrModel.id)).where(ProductIvrModel.workspace_id == ctx.workspace.id)) or 0
    if n >= 25:
        raise product_error(400, "too_many", "You can have up to 25 menus. Delete one you no longer use.")
    flow = _starter() if body.starter else eng.clean({"start": "hello", "nodes": {"hello": {"type": "say", "label": "Greeting", "say": "Hello, thank you for calling.", "next": "bye"}, "bye": {"type": "hangup", "label": "Goodbye", "say": "Goodbye."}}})
    row = ProductIvrModel(public_id=new_public_id("ivr"), workspace_id=ctx.workspace.id, name=body.name.strip(), status="draft", flow=flow, settings={})
    ctx.session.add(row)
    await ctx.session.commit()
    return await _out(ctx, row)


@router.get("/calls")
async def all_calls(ivr: str | None = None, limit: int = Query(default=50, le=200), ctx: Ctx = Depends(get_ctx)):
    q = select(ProductIvrCallModel, ProductIvrModel.name, ProductIvrModel.public_id).join(ProductIvrModel, ProductIvrModel.id == ProductIvrCallModel.ivr_id).where(ProductIvrCallModel.workspace_id == ctx.workspace.id)
    if ivr:
        q = q.where(ProductIvrModel.public_id == ivr)
    rows = (await ctx.session.execute(q.order_by(ProductIvrCallModel.id.desc()).limit(limit))).all()
    return [{"id": c.id, "ivr": name, "ivr_id": pid, "from": c.from_number, "to": c.to_number, "started": c.started_at.isoformat() if c.started_at else None,
             "seconds": ivr_mod.duration_seconds(c), "outcome": c.outcome, "path": [t["node"] for t in (c.trail or [])], "voicemail_url": c.voicemail_url, "cost": c.amount, "billed": c.billed}
            for c, name, pid in rows]


@router.get("/overview")
async def overview(ctx: Ctx = Depends(get_ctx)):
    ws = ctx.workspace.id
    total = await ctx.session.scalar(select(func.count(ProductIvrCallModel.id)).where(ProductIvrCallModel.workspace_id == ws)) or 0
    by = (await ctx.session.execute(select(ProductIvrCallModel.outcome, func.count(ProductIvrCallModel.id)).where(ProductIvrCallModel.workspace_id == ws).group_by(ProductIvrCallModel.outcome))).all()
    spent = await ctx.session.scalar(select(func.coalesce(func.sum(ProductIvrCallModel.amount), 0.0)).where(ProductIvrCallModel.workspace_id == ws)) or 0.0
    menus = await ctx.session.scalar(select(func.count(ProductIvrModel.id)).where(ProductIvrModel.workspace_id == ws)) or 0
    return {"menus": int(menus), "calls": int(total), "outcomes": {k: int(v) for k, v in by}, "spent": round(float(spent), 2)}


@router.get("/{ivr_id}", response_model=IvrOut)
async def get_one(ivr_id: str, ctx: Ctx = Depends(get_ctx)):
    return await _out(ctx, await _get(ctx, ivr_id))


@router.patch("/{ivr_id}", response_model=IvrOut)
async def change(ivr_id: str, body: ChangeBody, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE))):
    row = await _get(ctx, ivr_id)
    try:
        if body.name is not None:
            row.name = body.name.strip()
        if body.flow is not None:
            row.flow = eng.clean(body.flow)
            if row.status == "live" and eng.problems(row.flow):
                row.status = "draft"  # a menu with a dead end never stays live
        if body.settings is not None:
            row.settings = ivr_mod.clean_settings(body.settings, ivr_mod.settings_of(row))
    except (eng.FlowError, ValueError) as e:
        raise product_error(400, "bad_menu", str(e))
    row.updated_at = datetime.now(UTC)
    await ctx.session.commit()
    return await _out(ctx, row)


@router.post("/{ivr_id}/status", response_model=IvrOut)
async def set_status(ivr_id: str, status: str = Query(pattern="^(live|paused|draft)$"), ctx: Ctx = Depends(require(Perm.AGENTS_WRITE))):
    row = await _get(ctx, ivr_id)
    if status == "live":
        issues = eng.problems(row.flow)
        if issues:
            raise product_error(400, "not_ready", "Fix this first: " + issues[0])
    row.status = status
    await ctx.session.commit()
    return await _out(ctx, row)


@router.delete("/{ivr_id}", status_code=204)
async def remove(ivr_id: str, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE))):
    from api.db.models import TelephonyPhoneNumberModel

    row = await _get(ctx, ivr_id)
    for n in (await ctx.session.scalars(select(TelephonyPhoneNumberModel).where(TelephonyPhoneNumberModel.organization_id == ctx.workspace.live_org_id))).all():
        if (n.extra_metadata or {}).get("ivr_id") == ivr_id:
            n.extra_metadata = {k: v for k, v in (n.extra_metadata or {}).items() if k != "ivr_id"}
    await ctx.session.delete(row)
    await ctx.session.commit()


@router.post("/{ivr_id}/simulate")
async def simulate(ivr_id: str, body: SimBody, ctx: Ctx = Depends(get_ctx)):
    """Try the menu in the browser, free: what a caller would hear, and where each answer leads."""
    row = await _get(ctx, ivr_id)
    flow, s = row.flow, ivr_mod.settings_of(row)
    node = body.node or flow["start"]
    if node not in flow["nodes"]:
        raise product_error(400, "bad_step", "That step doesn't exist.")
    common = dict(vars=body.vars, is_open=lambda _h: body.open, hours=s.get("hours"))
    if body.node and (body.digits or body.speech or body.tries):
        st = eng.answer(flow, node, digits=body.digits, speech=body.speech, tries=body.tries, **common)
    else:
        st = eng.step(flow, node, **common)
    return {"say": st.say, "then": st.then, "trail": st.trail}


@router.post("/{ivr_id}/test-call")
async def test_call(ivr_id: str, body: TestCallBody, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE))):
    """Ring the number the person typed with this menu, as a real call from one of their own numbers. It is billed like any menu call."""
    import re

    from api.product import audit
    from api.product import contacts as ct
    from api.utils import rate_limit
    from api.utils.common import get_backend_endpoints

    row = await _get(ctx, ivr_id)
    number = re.sub(r"[\s()-]", "", body.number)
    if not re.fullmatch(r"\+[1-9]\d{7,14}", number):
        raise product_error(400, "bad_number", "Enter your number with its country code, like +919876543210.")
    if not body.mine:
        raise product_error(400, "confirm_number", "Tick the box to confirm this number is yours. We only ring your own phone for a test.")
    issues = eng.problems(row.flow)
    if issues:
        raise product_error(400, "not_ready", "Fix this first: " + issues[0])
    if ct.normalize(number) in await ct.blocked_set(ctx.session, ctx.workspace.id):
        raise product_error(400, "blocked_number", "That number is on your do-not-call list.")
    cfg, num = await ivr_mod.caller_number(ctx.session, ctx.workspace, row)
    if cfg is None:
        raise product_error(400, "no_number", "To get a test call you need a phone number first. Get one in Phone Numbers, then try again.")
    await rate_limit.enforce(f"ivrtest:{ctx.workspace.id}", 5, 3600, "You have asked for a lot of test calls. Please try again in an hour.")
    base, _ = await get_backend_endpoints()
    try:
        await ivr_mod.dial_out(cfg, num.address, number, ivr_mod.start_url(base, row.public_id, cfg.id, num.id))
    except Exception as e:  # noqa: BLE001
        detail = getattr(e, "detail", None) or str(e)
        logger.warning(f"IVR test call failed: {detail}")
        raise product_error(502, "call_failed", "We couldn't place the call. If your phone provider is on a trial, it may only call numbers you have verified with them.")
    await audit.record(ctx.session, ctx.workspace.id, ctx.user.id, "ivr.test_call", row.public_id, {"to_last4": number[-4:]})
    await ctx.session.commit()
    return {"ok": True, "from": num.address}


@router.get("/{ivr_id}/calls")
async def calls_of(ivr_id: str, limit: int = Query(default=50, le=200), ctx: Ctx = Depends(get_ctx)):
    return await all_calls(ivr=ivr_id, limit=limit, ctx=ctx)


# ---------------- Plivo callbacks (signed) ----------------
def _xml(body: str) -> Response:
    return Response(content=body, media_type="application/xml")


@public.post("/plivo/{pid}/step")
async def plivo_step(pid: str, request: Request, k: str, node: str = "", tries: int = 0, sig: str = "", session: AsyncSession = Depends(get_session)):
    """Every step after the first. Plivo posts here when the caller answers, says nothing, or a transfer or recording finishes."""
    from api.utils.common import get_backend_endpoints

    if not ivr_mod.sig_ok(pid, k, node, tries, sig):
        logger.warning(f"IVR step with a bad signature for {pid}")
        return _xml(ivr_mod.say_and_hangup("Sorry, something went wrong. Goodbye."))
    form = dict(await request.form())
    uuid = str(form.get("CallUUID") or "")
    ivr = await session.scalar(select(ProductIvrModel).where(ProductIvrModel.public_id == pid))
    call = await session.scalar(select(ProductIvrCallModel).where(ProductIvrCallModel.call_uuid == uuid)) if uuid else None
    if ivr is None or call is None:
        return _xml(ivr_mod.say_and_hangup("Sorry, something went wrong. Goodbye."))
    base, _ = await get_backend_endpoints()
    if k == "agent":
        return await _hand_to_agent(session, ivr, call, node, form, request)
    st, body = await ivr_mod.carry_on(session, ivr, call, k, node, tries, form, base)
    return _xml(body)


@public.post("/plivo/{pid}/start")
async def plivo_start(pid: str, request: Request, cfg: int, num: int, sig: str = "", session: AsyncSession = Depends(get_session)):
    """A test call was answered: begin the menu for the person who was rung."""
    from api.db.product_models import ProductWorkspaceModel
    from api.utils.common import get_backend_endpoints

    if not ivr_mod.start_sig_ok(pid, cfg, num, sig):
        logger.warning(f"IVR test start with a bad signature for {pid}")
        return _xml(ivr_mod.say_and_hangup("Sorry, something went wrong. Goodbye."))
    form = dict(await request.form())
    ivr = await session.scalar(select(ProductIvrModel).where(ProductIvrModel.public_id == pid))
    ws = await session.get(ProductWorkspaceModel, ivr.workspace_id) if ivr else None
    if ivr is None or ws is None or not form.get("CallUUID"):
        return _xml(ivr_mod.say_and_hangup("Sorry, something went wrong. Goodbye."))
    base, _ = await get_backend_endpoints()
    body = await ivr_mod.begin(session, ivr, org_id=ws.live_org_id, number_id=num, config_id=cfg, call_uuid=str(form["CallUUID"]),
                               from_number=str(form.get("To") or ""), to_number=str(form.get("From") or ""), base=base, test=True)
    return _xml(body)


async def _hand_to_agent(session, ivr: ProductIvrModel, call: ProductIvrCallModel, node: str, form: dict, request: Request) -> Response:
    """The menu passes the call to an AI voice agent: it becomes a normal agent call (same pipeline, recording, summary and billing)."""
    from api.db import db_client
    from api.routes.telephony import _create_inbound_workflow_run
    from api.services.telephony.factory import get_telephony_provider_by_id
    from api.services.telephony.providers.plivo.provider import PlivoProvider
    from api.services.campaign.rate_limiter import rate_limiter
    from api.services.quota_service import check_dograh_quota_by_user_id
    from api.utils.common import get_backend_endpoints

    s = ivr_mod.settings_of(ivr)
    sorry = lambda: _xml(ivr_mod.say_and_hangup("Sorry, we can't connect you right now. Goodbye.", s))  # noqa: E731
    n = ivr.flow["nodes"].get(node) or {}
    agent_pid = n.get("agent_id")
    wid = await ivr_mod.agent_workflow(session, ivr, agent_pid) if agent_pid else None
    if not wid or not call.config_id:
        return sorry()
    workflow = await db_client.get_workflow_by_id(wid)
    if workflow is None:
        return sorry()
    user_id = workflow.user_id
    if not (await check_dograh_quota_by_user_id(user_id, workflow_id=wid)).has_quota:
        return _xml(ivr_mod.say_and_hangup("Sorry, we can't take your call right now. Goodbye.", s))
    org_id = workflow.organization_id
    slot = await rate_limiter.try_acquire_concurrent_slot(org_id, wid, await _org_limit(org_id), await _wf_limit(wid))
    if not slot:
        return sorry()
    normalized = PlivoProvider.parse_inbound_webhook(form)
    run_id = await _create_inbound_workflow_run(wid, user_id, "plivo", normalized, telephony_configuration_id=call.config_id, from_phone_number_id=call.number_id,
                                                extra_context={"ivr": ivr.public_id, "ivr_call": call.id})
    await rate_limiter.store_workflow_slot_mapping(run_id, org_id, wid, slot)
    call.run_id, call.outcome, call.last_at = run_id, "agent", datetime.now(UTC)
    await session.commit()
    backend, wss = await get_backend_endpoints()
    provider = await get_telephony_provider_by_id(call.config_id, call.org_id)
    return await provider.start_inbound_stream(websocket_url=f"{wss}/api/v1/telephony/ws/{wid}/{user_id}/{run_id}", workflow_run_id=run_id, normalized_data=normalized, backend_endpoint=backend)


async def _org_limit(org_id: int):
    from api.services.campaign.campaign_call_dispatcher import campaign_call_dispatcher

    return await campaign_call_dispatcher.get_org_concurrent_limit(org_id)


async def _wf_limit(wid: int):
    from api.services.campaign.campaign_call_dispatcher import campaign_call_dispatcher

    return await campaign_call_dispatcher.get_workflow_concurrent_limit(wid)
