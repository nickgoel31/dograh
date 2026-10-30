"""Phone numbers: find, buy, point at an agent, set opening hours and a fallback."""

import os
import re

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select

from api.db.models import TelephonyConfigurationModel, TelephonyPhoneNumberModel
from api.db.product_models import ProductAgentModel
from api.product import hours as hours_mod
from api.product import number_providers as providers
from api.product.deps import Ctx, get_ctx, require
from api.product.errors import product_error
from api.product.ids import decode_id, encode_id
from api.product.roles import Perm

router = APIRouter(prefix="/product/numbers", tags=["numbers"])

_E164 = re.compile(r"^\+[1-9]\d{6,14}$")
KINDS = {"local": "Local", "toll_free": "Toll-free"}


def _monthly(kind: str) -> float:
    return float(os.getenv(f"PRODUCT_NUMBER_MONTHLY_{kind.upper()}", "0") or 0)


class NumberOut(BaseModel):
    id: str
    number: str
    country: str | None
    type: str
    agent_id: str | None
    agent_name: str | None
    status: str
    monthly: float
    reputation: str  # "unknown" until a spam-score source is connected
    hours: dict | None
    fallback: str | None
    sandbox: bool


class OfferOut(BaseModel):
    number: str
    region: str | None


class BuyBody(BaseModel):
    number: str = Field(max_length=20)
    kind: str = "local"


class AssignBody(BaseModel):
    agent_id: str | None = None


class SettingsBody(BaseModel):
    label: str | None = Field(default=None, max_length=64)
    hours: dict | None = None
    fallback: str | None = Field(default=None, max_length=20)
    clear_fallback: bool = False


async def _agents_by_workflow(ctx: Ctx) -> dict[int, ProductAgentModel]:
    rows = (await ctx.session.scalars(select(ProductAgentModel).where(ProductAgentModel.workspace_id == ctx.workspace.id))).all()
    out = {}
    for a in rows:
        wid = a.test_workflow_id if ctx.environment == "test" else a.live_workflow_id
        if wid is not None:
            out[wid] = a
    return out


def _out(row: TelephonyPhoneNumberModel, agents: dict[int, ProductAgentModel]) -> NumberOut:
    m = row.extra_metadata or {}
    a = agents.get(row.inbound_workflow_id) if row.inbound_workflow_id else None
    return NumberOut(
        id=encode_id("num", row.id), number=row.address, country=row.country_code,
        type=KINDS.get(m.get("kind", "local"), "Local"), agent_id=a.public_id if a else None,
        agent_name=a.name if a else None, status="active" if row.is_active else "pending",
        monthly=float(m.get("monthly") or 0), reputation=m.get("reputation", "unknown"),
        hours=m.get("hours"), fallback=m.get("fallback"), sandbox=bool(m.get("sandbox")),
    )


async def _row(ctx: Ctx, public_id: str) -> TelephonyPhoneNumberModel:
    rid = decode_id("num", public_id)
    row = await ctx.session.scalar(
        select(TelephonyPhoneNumberModel).where(
            TelephonyPhoneNumberModel.id == rid, TelephonyPhoneNumberModel.organization_id == ctx.org_id
        )
    ) if rid else None
    if row is None:
        raise product_error(404, "number_not_found", "We couldn't find that phone number.")
    return row


def _provider(ctx: Ctx) -> providers.NumberProvider:
    p = providers.provider_for(ctx.environment)
    if p is None:
        raise product_error(503, "numbers_unavailable", "Phone numbers aren't enabled for your workspace yet. Please contact support.")
    return p


async def _config(ctx: Ctx) -> TelephonyConfigurationModel:
    """The organization's telephony connection, created on first use from the operator's account."""
    cfg = await ctx.session.scalar(
        select(TelephonyConfigurationModel).where(TelephonyConfigurationModel.organization_id == ctx.org_id).limit(1)
    )
    if cfg is not None:
        return cfg
    creds = providers.twilio_credentials() if ctx.environment == "live" else {
        "account_sid": f"SANDBOX{ctx.workspace.id}", "auth_token": "sandbox", "from_numbers": []}
    cfg = TelephonyConfigurationModel(
        organization_id=ctx.org_id, name="Phone numbers", provider="twilio", credentials=creds or {}, is_default_outbound=True,
    )
    ctx.session.add(cfg)
    await ctx.session.flush()
    return cfg


@router.get("", response_model=list[NumberOut])
async def list_numbers(ctx: Ctx = Depends(get_ctx)):
    rows = (await ctx.session.scalars(
        select(TelephonyPhoneNumberModel).where(TelephonyPhoneNumberModel.organization_id == ctx.org_id).order_by(TelephonyPhoneNumberModel.id)
    )).all()
    agents = await _agents_by_workflow(ctx)
    return [_out(r, agents) for r in rows]


@router.get("/available", response_model=list[OfferOut])
async def available(
    country: str = Query(default="IN", pattern="^[A-Za-z]{2}$"),
    kind: str = Query(default="local"),
    contains: str | None = Query(default=None, max_length=10, pattern=r"^\d*$"),
    ctx: Ctx = Depends(get_ctx),
):
    if kind not in KINDS:
        raise product_error(400, "bad_kind", "Choose a local or a toll-free number.")
    try:
        found = await _provider(ctx).search(country, kind, contains)
    except providers.NumberError as e:
        raise product_error(502, "lookup_failed", str(e))
    return [OfferOut(number=o.number, region=o.region) for o in found]


@router.post("", response_model=NumberOut, status_code=201)
async def buy(body: BuyBody, ctx: Ctx = Depends(require(Perm.BILLING_MANAGE))):
    from api.constants import BACKEND_API_ENDPOINT
    from api.utils.telephony_address import normalize_telephony_address

    if body.kind not in KINDS or not _E164.match(body.number):
        raise product_error(400, "bad_number", "That doesn't look like a phone number we can buy.")
    prov = _provider(ctx)
    cfg = await _config(ctx)
    canonical = normalize_telephony_address(body.number).canonical
    taken = await ctx.session.scalar(select(TelephonyPhoneNumberModel.id).where(
        TelephonyPhoneNumberModel.organization_id == ctx.org_id, TelephonyPhoneNumberModel.address_normalized == canonical))
    if taken:
        raise product_error(409, "already_yours", "You already have that number.")
    try:
        ref = await prov.purchase(body.number, f"{BACKEND_API_ENDPOINT}/api/v1/telephony/inbound/run")
    except providers.NumberError as e:
        raise product_error(409, "purchase_failed", str(e))
    try:
        n = normalize_telephony_address(body.number)
        row = TelephonyPhoneNumberModel(
            organization_id=ctx.org_id, telephony_configuration_id=cfg.id, address=body.number,
            address_normalized=n.canonical, address_type=n.address_type, country_code=n.country_code,
            is_active=True, extra_metadata={
                "kind": body.kind, "provider_ref": ref, "sandbox": prov.name == "sandbox",
                "monthly": _monthly(body.kind) if prov.name != "sandbox" else 0.0, "reputation": "unknown"},
        )
        ctx.session.add(row)
        await ctx.session.commit()
    except Exception:
        await ctx.session.rollback()
        try:
            await prov.release(ref)  # don't leave a paid number nobody owns
        finally:
            raise product_error(500, "save_failed", "We bought the number but couldn't save it. We've released it; please try again.")
    return _out(row, await _agents_by_workflow(ctx))


@router.post("/{number_id}/assign", response_model=NumberOut)
async def assign(number_id: str, body: AssignBody, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE))):
    row = await _row(ctx, number_id)
    if body.agent_id is None:
        row.inbound_workflow_id = None
    else:
        agent = await ctx.session.scalar(select(ProductAgentModel).where(
            ProductAgentModel.public_id == body.agent_id, ProductAgentModel.workspace_id == ctx.workspace.id))
        if agent is None:
            raise product_error(404, "agent_not_found", "We couldn't find that agent.")
        wid = agent.test_workflow_id if ctx.environment == "test" else agent.live_workflow_id
        if wid is None:
            raise product_error(400, "not_live_yet", "Put this agent live first, then connect a real number to it.")
        row.inbound_workflow_id = wid
    await ctx.session.commit()
    return _out(row, await _agents_by_workflow(ctx))


@router.patch("/{number_id}", response_model=NumberOut)
async def settings(number_id: str, body: SettingsBody, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE))):
    row = await _row(ctx, number_id)
    meta = dict(row.extra_metadata or {})
    if body.hours is not None:
        try:
            meta["hours"] = hours_mod.validate_hours(body.hours)
        except ValueError as e:
            raise product_error(400, "bad_hours", str(e))
    if body.clear_fallback:
        meta.pop("fallback", None)
    elif body.fallback is not None:
        if not _E164.match(body.fallback):
            raise product_error(400, "bad_fallback", "Enter the fallback number with its country code, like +919876543210.")
        meta["fallback"] = body.fallback
    if body.label is not None:
        row.label = body.label
    row.extra_metadata = meta  # a new dict, so the change is saved
    await ctx.session.commit()
    return _out(row, await _agents_by_workflow(ctx))


@router.delete("/{number_id}", status_code=204)
async def release(number_id: str, ctx: Ctx = Depends(require(Perm.BILLING_MANAGE))):
    row = await _row(ctx, number_id)
    ref = (row.extra_metadata or {}).get("provider_ref")
    if ref:
        try:
            await _provider(ctx).release(ref)
        except providers.NumberError as e:
            raise product_error(502, "release_failed", str(e))
    await ctx.session.delete(row)
    await ctx.session.commit()
