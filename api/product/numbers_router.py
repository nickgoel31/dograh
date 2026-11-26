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
    ivr_id: str | None = None
    carrier: str | None = None  # set for numbers brought from another carrier
    setup: dict | None = None  # how to point the carrier at us (Tata Smartflo), shown after the number is brought over


class OfferOut(BaseModel):
    number: str
    region: str | None
    monthly: float = 0.0  # rent per month, in the account currency (set with PRODUCT_NUMBER_MONTHLY_LOCAL / _TOLL_FREE)
    currency: str = "INR"
    per_minute: float = 0.0  # what each minute of calls costs now (billed per minute, rounded up)
    kyc_required: bool = False


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
        hours=m.get("hours"), fallback=m.get("fallback"), sandbox=bool(m.get("sandbox")), ivr_id=m.get("ivr_id"), carrier=m.get("carrier"),
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
    if ctx.environment == "live":
        provider, creds = providers.live_config() or ("twilio", {})
    else:
        provider, creds = "twilio", {"account_sid": f"SANDBOX{ctx.workspace.id}", "auth_token": "sandbox", "from_numbers": []}
    cfg = TelephonyConfigurationModel(
        organization_id=ctx.org_id, name="Phone numbers", provider=provider, credentials=creds, is_default_outbound=True,
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
    from api.product import config, kyc_router, rates

    per_min = await rates.workspace_rate(ctx.session, ctx.workspace)
    return [OfferOut(number=o.number, region=o.region, monthly=_monthly(kind), currency=config.CURRENCY, per_minute=per_min, kyc_required=ctx.environment == "live" and kyc_router.needed_for(o.number)) for o in found]


@router.post("", response_model=NumberOut, status_code=201)
async def buy(body: BuyBody, ctx: Ctx = Depends(require(Perm.BILLING_MANAGE))):
    from api.constants import BACKEND_API_ENDPOINT
    from api.utils.telephony_address import normalize_telephony_address

    if body.kind not in KINDS or not _E164.match(body.number):
        raise product_error(400, "bad_number", "That doesn't look like a phone number we can buy.")
    from api.product import kyc_router

    if ctx.environment == "live" and kyc_router.needed_for(body.number) and not await kyc_router.is_approved(ctx.session, ctx.workspace.id):
        raise product_error(403, "kyc_required", "Numbers in this country need identity verification first. Open “Verify identity” on this page, send your details, and we'll tell you when you're approved.")
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
    if prov.name == "plivo" and kyc_router.needed_for(body.number):
        from api.product import plivo_kyc

        krow = await kyc_router.get_row(ctx.session, ctx.workspace.id)
        pid = (krow.data or {}).get("plivo_id") if krow else None
        comp = plivo_kyc.get_compliance()
        if comp is not None and pid:
            try:
                await comp.link(body.number, pid)
            except Exception as e:  # noqa: BLE001 - the number is bought; an operator can link it by hand
                import logging

                logging.getLogger(__name__).warning("could not link %s to its verification: %s", body.number, e)
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


CARRIERS: dict[str, dict] = {
    "twilio": {"name": "Twilio", "auto": True, "fields": [("account_sid", "Account SID", False, False), ("auth_token", "Auth token", True, False)]},
    "plivo": {"name": "Plivo", "auto": True, "fields": [("auth_id", "Auth ID", False, False), ("auth_token", "Auth token", True, False)]},
    "vobiz": {"name": "Vobiz", "auto": False, "fields": [("auth_id", "Account ID", False, False), ("auth_token", "Auth token", True, False), ("application_id", "Application ID", False, True)]},
    "telnyx": {"name": "Telnyx", "auto": False, "fields": [("api_key", "API key", True, False), ("connection_id", "Connection ID", False, True)]},
    "vonage": {"name": "Vonage", "auto": False, "fields": [("api_key", "API key", False, False), ("api_secret", "API secret", True, False), ("application_id", "Application ID", False, False), ("private_key", "Private key", True, False)]},
    "cloudonix": {"name": "Cloudonix", "auto": False, "fields": [("bearer_token", "Bearer token", True, False), ("domain_id", "Domain ID", False, False)]},
    "smartflo": {"name": "Tata Smartflo", "auto": False, "fields": [("account_token", "Account API Token", True, False), ("click_to_call_key", "Click to Call API Key (for outgoing calls)", True, True)]},
    "ari": {"name": "Asterisk (SIP)", "auto": False, "fields": [("ari_endpoint", "Asterisk address (ARI)", False, False), ("app_name", "ARI application name", False, False), ("app_password", "ARI password", True, False), ("ws_client_name", "WebSocket client name", False, True)]},
}


def _inbound_url() -> str:
    from api.constants import BACKEND_API_ENDPOINT

    return f"{BACKEND_API_ENDPOINT}/api/v1/telephony/inbound/run"


@router.get("/carriers")
async def carriers(ctx: Ctx = Depends(get_ctx)):
    return [{"id": k, "name": v["name"], "auto": v["auto"], "inbound_url": _inbound_url(),
             "fields": [{"key": f, "label": lab, "secret": sec, "optional": opt} for f, lab, sec, opt in v["fields"]]} for k, v in CARRIERS.items()]


class BringBody(BaseModel):
    carrier: str = Field(max_length=20)
    number: str = Field(max_length=20)
    details: dict[str, str] = Field(default_factory=dict)


def make_carrier(carrier: str, details: dict):
    """Seam for tests: the customer's own carrier account."""
    if carrier == "twilio":
        return providers.TwilioNumbers(details["account_sid"], details["auth_token"])
    return providers.PlivoNumbers(details["auth_id"], details["auth_token"])


async def smartflo_check(token: str) -> tuple[bool, str]:
    """Seam for tests: does Smartflo accept this account token?"""
    from api.services.telephony.providers.smartflo import api_client

    return await api_client.token_works(token)


def smartflo_setup(key: str) -> dict:
    """What the customer sets up in the Smartflo portal: the two addresses (they carry the account's secret key) and the steps."""
    from api.constants import BACKEND_API_ENDPOINT

    base = f"{BACKEND_API_ENDPOINT}/api/v1/telephony/smartflo"
    return {
        "endpoint_url": f"{base}/dynamic/{key}", "webhook_url": f"{base}/webhook/{key}",
        "steps": [
            "In Smartflo, open Settings > Channels > Voice Bot (Voice Streaming) and choose Add an Endpoint.",
            "Pick the Dynamic option, method POST, and paste the Endpoint address below as the URL.",
            "For incoming calls: open My Numbers, choose your number, click Configure Destination, pick that Voice Bot endpoint and save.",
            "For outgoing calls: open API Connect > Click to Call Support API, create or edit a key, choose this number, set its destination to that Voice Bot endpoint, and paste the key here.",
            "Optional, for call details and recordings: open API Connect > Webhook, add a webhook with the Webhook address below, a Call hangup trigger, and your number. Tata's support must switch webhooks on for your account first.",
        ],
    }


async def _verify_other(carrier: str, details: dict, number: str) -> None:
    """A quick real check where the carrier makes one easy. The rest are saved as given and work once the carrier is pointed at us."""
    import httpx

    try:
        async with httpx.AsyncClient(timeout=15) as c:
            if carrier == "telnyx":
                r = await c.get("https://api.telnyx.com/v2/phone_numbers", params={"filter[phone_number]": number}, headers={"Authorization": f"Bearer {details['api_key']}"})
                if r.status_code in (401, 403):
                    raise providers.NumberError("Telnyx did not accept that API key.")
                if r.status_code == 200 and not r.json().get("data"):
                    raise providers.NumberError("That number isn't on this Telnyx account.")
            elif carrier == "smartflo":
                from api.services.telephony.providers.smartflo import api_client

                good, why = await smartflo_check(details["account_token"])
                if not good:
                    raise providers.NumberError(why)
            elif carrier == "ari":
                r = await c.get(f"{details['ari_endpoint'].rstrip('/')}/ari/asterisk/info", auth=(details["app_name"], details["app_password"]))
                if r.status_code >= 400:
                    raise providers.NumberError("Asterisk did not accept those details. Check the address, application name and password.")
    except providers.NumberError:
        raise
    except Exception:  # noqa: BLE001
        if carrier == "ari":
            raise providers.NumberError("We couldn't reach your Asterisk server. Check the address, and that it can be reached from the internet.")


@router.post("/bring", response_model=NumberOut, status_code=201)
async def bring(body: BringBody, ctx: Ctx = Depends(require(Perm.BILLING_MANAGE))):
    """Use a number the customer already owns with their own carrier account. It stays theirs; removing it here never touches the carrier."""
    from api.utils.telephony_address import normalize_telephony_address

    spec = CARRIERS.get(body.carrier)
    if spec is None:
        raise product_error(400, "bad_carrier", "We don't support that carrier yet.")
    if ctx.environment != "live":
        raise product_error(400, "live_only", "Bring your own number in Live. Practice numbers are free.")
    if not _E164.match(body.number):
        raise product_error(400, "bad_number", "Enter the number with its country code, like +14155550123.")
    details = {k: (body.details.get(k) or "").strip() for k, *_ in spec["fields"]}
    gaps = [label for k, label, _, opt in spec["fields"] if not opt and not details[k]]
    if gaps:
        raise product_error(400, "missing_fields", "Please fill in: " + ", ".join(gaps) + ".")
    n = normalize_telephony_address(body.number)
    if await ctx.session.scalar(select(TelephonyPhoneNumberModel.id).where(TelephonyPhoneNumberModel.organization_id == ctx.org_id, TelephonyPhoneNumberModel.address_normalized == n.canonical)):
        raise product_error(409, "already_yours", "You already have that number.")
    try:
        if spec["auto"]:
            await make_carrier(body.carrier, details).link_existing(body.number, _inbound_url())
        else:
            await _verify_other(body.carrier, details, body.number)
    except providers.NumberError as e:
        raise product_error(400, "bring_failed", str(e))
    setup = None
    if body.carrier == "smartflo":
        cfg = await _smartflo_config(ctx, details, body.number)
        setup = smartflo_setup(cfg.credentials["endpoint_key"])
    else:
        creds = {**{k: v for k, v in details.items() if v}, "from_numbers": [body.number]}
        cfg = TelephonyConfigurationModel(organization_id=ctx.org_id, name=f"Your {spec['name']} account", provider=body.carrier, credentials=creds, is_default_outbound=False)
        ctx.session.add(cfg)
        await ctx.session.flush()
    row = TelephonyPhoneNumberModel(organization_id=ctx.org_id, telephony_configuration_id=cfg.id, address=body.number, address_normalized=n.canonical, address_type=n.address_type, country_code=n.country_code,
                                    is_active=True, extra_metadata={"kind": "local", "byo": True, "carrier": body.carrier, "sandbox": False, "monthly": 0.0, "reputation": "unknown"})
    ctx.session.add(row)
    await ctx.session.commit()
    out = _out(row, await _agents_by_workflow(ctx))
    out.setup = setup
    return out


async def _smartflo_config(ctx: Ctx, details: dict, number: str) -> TelephonyConfigurationModel:
    """One Smartflo connection per account token: a second number joins the first one's, so the customer sets up one endpoint, not one per number."""
    import secrets

    token, key = details["account_token"], details.get("click_to_call_key") or None
    existing = (await ctx.session.scalars(select(TelephonyConfigurationModel).where(TelephonyConfigurationModel.organization_id == ctx.org_id, TelephonyConfigurationModel.provider == "smartflo"))).all()
    for cfg in existing:
        creds = dict(cfg.credentials or {})
        if creds.get("account_token") == token:
            creds["from_numbers"] = [*dict.fromkeys([*(creds.get("from_numbers") or []), number])]
            if key:
                creds["click_to_call_keys"] = {**(creds.get("click_to_call_keys") or {}), number: key}
                creds["click_to_call_key"] = creds.get("click_to_call_key") or key
            cfg.credentials = creds  # a new dict, so the change is saved
            return cfg
    creds = {"account_token": token, "click_to_call_key": key, "click_to_call_keys": {number: key} if key else {}, "endpoint_key": secrets.token_urlsafe(24), "from_numbers": [number]}
    cfg = TelephonyConfigurationModel(organization_id=ctx.org_id, name="Your Tata Smartflo account" if not existing else f"Your Tata Smartflo account {len(existing) + 1}", provider="smartflo", credentials=creds, is_default_outbound=False)
    ctx.session.add(cfg)
    await ctx.session.flush()
    return cfg


@router.get("/{number_id}/smartflo-setup")
async def smartflo_setup_for(number_id: str, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE))):
    """The addresses and steps for a Tata Smartflo number, so they can be looked at again later."""
    row = await _row(ctx, number_id)
    if (row.extra_metadata or {}).get("carrier") != "smartflo":
        raise product_error(404, "not_smartflo", "This isn't a Tata Smartflo number.")
    cfg = await ctx.session.get(TelephonyConfigurationModel, row.telephony_configuration_id)
    return smartflo_setup((cfg.credentials or {}).get("endpoint_key", ""))


@router.post("/{number_id}/assign", response_model=NumberOut)
async def assign(number_id: str, body: AssignBody, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE))):
    row = await _row(ctx, number_id)
    if (row.extra_metadata or {}).get("ivr_id"):  # a number answers with an agent or with a menu, never both
        row.extra_metadata = {k: v for k, v in row.extra_metadata.items() if k != "ivr_id"}
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


class IvrBody(BaseModel):
    ivr_id: str | None = None


@router.post("/{number_id}/ivr", response_model=NumberOut)
async def assign_ivr(number_id: str, body: IvrBody, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE))):
    """Answer this number with a Swarvo IVR menu (or stop doing so)."""
    from api.db.product_models import ProductIvrModel

    row = await _row(ctx, number_id)
    meta = dict(row.extra_metadata or {})
    if body.ivr_id is None:
        meta.pop("ivr_id", None)
    else:
        ivr = await ctx.session.scalar(select(ProductIvrModel).where(ProductIvrModel.public_id == body.ivr_id, ProductIvrModel.workspace_id == ctx.workspace.id))
        if ivr is None:
            raise product_error(404, "ivr_not_found", "We couldn't find that menu.")
        if meta.get("sandbox"):
            raise product_error(400, "live_number", "Menus answer real phone numbers. Connect a real number first.")
        if meta.get("carrier") == "smartflo":
            raise product_error(400, "no_menu_on_smartflo", "Phone menus run on Plivo numbers. A Tata Smartflo number can be answered by an AI agent, or you can build the menu inside Smartflo.")
        meta["ivr_id"] = ivr.public_id
        row.inbound_workflow_id = None
    row.extra_metadata = meta
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
    if (row.extra_metadata or {}).get("carrier") == "smartflo":
        cfg = await ctx.session.get(TelephonyConfigurationModel, row.telephony_configuration_id)
        if cfg is not None:
            creds = dict(cfg.credentials or {})
            creds["from_numbers"] = [n for n in creds.get("from_numbers", []) if n != row.address]
            creds["click_to_call_keys"] = {n: k for n, k in (creds.get("click_to_call_keys") or {}).items() if n != row.address}
            cfg.credentials = creds
    await ctx.session.delete(row)
    await ctx.session.commit()
