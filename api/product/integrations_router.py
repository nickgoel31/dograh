"""Calendar booking for agents. The customer connects Cal.com once; we give their agents two tools (check free times, book).

The tools call small public endpoints here (`/product/hooks/calendar/{token}/...`) so the agent can pass plain words
and the Cal.com key never goes into the conversation or the tool list.
"""

import hashlib
import json
import secrets
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select

from api.db.product_models import ProductIntegrationModel
from api.product import audit, calcom
from api.product.deps import Ctx, get_ctx, get_session, require
from api.product.errors import product_error
from api.product.roles import Perm
from api.product.tools_router import ToolsGateway, get_tools
from api.utils import rate_limit

router = APIRouter(prefix="/product/integrations", tags=["integrations"])
hooks = APIRouter(prefix="/product/hooks/calendar", tags=["integrations"])
SLOTS_TOOL, BOOK_TOOL = "Check free appointment times", "Book an appointment"


def get_calcom():
    """Seam for tests: builds the Cal.com client from a key."""
    return calcom.CalCom


class CalBody(BaseModel):
    api_key: str = Field(min_length=10, max_length=200)
    event_type_id: int = Field(ge=1)
    timezone: str = Field(default="Asia/Kolkata", max_length=60)


def _h(t: str) -> str:
    return hashlib.sha256(t.encode()).hexdigest()


def _public_base() -> str:
    from api.constants import BACKEND_API_ENDPOINT

    return BACKEND_API_ENDPOINT.rstrip("/")


async def _row(ctx: Ctx) -> ProductIntegrationModel | None:
    return await ctx.session.scalar(select(ProductIntegrationModel).where(ProductIntegrationModel.workspace_id == ctx.workspace.id, ProductIntegrationModel.kind == "calcom"))


async def _drop_tools(ctx: Ctx, gw: ToolsGateway) -> None:
    for org in (ctx.workspace.test_org_id, ctx.workspace.live_org_id):
        try:
            for t in await gw.list(org, ctx.user.id):
                if t["name"] in (SLOTS_TOOL, BOOK_TOOL):
                    await gw.archive(org, ctx.user.id, t["uuid"])
        except Exception:  # noqa: BLE001
            pass


@router.get("/calendar")
async def status(ctx: Ctx = Depends(get_ctx)):
    r = await _row(ctx)
    return {"connected": r is not None, "event_type_id": (r.config or {}).get("event_type_id") if r else None, "timezone": (r.config or {}).get("timezone") if r else None}


@router.put("/calendar")
async def connect(body: CalBody, ctx: Ctx = Depends(require(Perm.TOOLS_WRITE)), gw: ToolsGateway = Depends(get_tools), cal=Depends(get_calcom)):
    try:
        ZoneInfo(body.timezone)
    except (ZoneInfoNotFoundError, ValueError):
        raise product_error(400, "bad_timezone", "We don't know that time zone. Try something like Asia/Kolkata.")
    try:  # a real check that the key and event type work
        await cal(body.api_key.strip()).free_times(body.event_type_id, date.today() + timedelta(days=1), body.timezone)
    except calcom.CalError:
        raise product_error(400, "calcom_failed", "We couldn't connect to Cal.com with those details. Check the API key and the event type number.")
    row = await _row(ctx)
    token = secrets.token_urlsafe(24)
    cfg = {"api_key": body.api_key.strip(), "event_type_id": body.event_type_id, "timezone": body.timezone}
    if row is None:
        row = ProductIntegrationModel(workspace_id=ctx.workspace.id, kind="calcom", token_hash=_h(token), config=cfg)
        ctx.session.add(row)
    else:
        row.token_hash, row.config = _h(token), cfg
    await _drop_tools(ctx, gw)
    base = f"{_public_base()}/api/v1/product/hooks/calendar/{token}"
    specs = [
        {"name": SLOTS_TOOL, "description": "Check which appointment times are free on a given day. Use before offering times to the caller.", "url": f"{base}/slots", "method": "GET", "headers": {},
         "parameters": [{"name": "date", "type": "string", "description": "The day to check, as YYYY-MM-DD", "required": True}]},
        {"name": BOOK_TOOL, "description": "Book an appointment once the caller has agreed a time. Only use a time that was offered as free.", "url": f"{base}/book", "method": "POST", "headers": {},
         "parameters": [{"name": "start", "type": "string", "description": "The agreed time, as YYYY-MM-DD HH:MM (24 hour, local time)", "required": True},
                        {"name": "name", "type": "string", "description": "The caller's name", "required": True},
                        {"name": "phone", "type": "string", "description": "The caller's phone number with country code", "required": False},
                        {"name": "email", "type": "string", "description": "The caller's email address, if they give one", "required": False}]},
    ]
    for org in (ctx.workspace.test_org_id, ctx.workspace.live_org_id):
        try:
            for s in specs:
                await gw.create_http(org, ctx.user.id, s)
        except Exception:  # noqa: BLE001 - the Live copy is repaired when an agent using it goes live
            pass
    await audit.record(ctx.session, ctx.workspace.id, ctx.user.id, "integration.connected", "calcom")
    await ctx.session.commit()
    return {"connected": True, "tools": [SLOTS_TOOL, BOOK_TOOL]}


@router.delete("/calendar", status_code=204)
async def disconnect(ctx: Ctx = Depends(require(Perm.TOOLS_WRITE)), gw: ToolsGateway = Depends(get_tools)):
    row = await _row(ctx)
    if row is not None:
        await ctx.session.delete(row)
    await _drop_tools(ctx, gw)
    await audit.record(ctx.session, ctx.workspace.id, ctx.user.id, "integration.removed", "calcom")
    await ctx.session.commit()


# ---- public endpoints the agent's tools call (the token in the address is the secret) ----

async def _by_token(session, token: str) -> ProductIntegrationModel:
    await rate_limit.enforce(f"phook:{token[:12]}", 120, 60, "Too many requests.")
    row = await session.scalar(select(ProductIntegrationModel).where(ProductIntegrationModel.token_hash == _h(token), ProductIntegrationModel.kind == "calcom"))
    if row is None:
        raise product_error(404, "not_found", "Not found.")
    return row


@hooks.get("/{token}/slots")
async def slots(token: str, date_: str = Query(default="", alias="date"), session=Depends(get_session), cal=Depends(get_calcom)):
    row = await _by_token(session, token)
    tz = row.config["timezone"]
    try:
        day = date.fromisoformat(date_.strip())
    except ValueError:
        return {"times": [], "message": "I need the day as YYYY-MM-DD."}
    try:
        times = await cal(row.config["api_key"]).free_times(row.config["event_type_id"], day, tz)
    except calcom.CalError as e:
        return {"times": [], "message": str(e)}
    now = datetime.now(ZoneInfo(tz))
    free = [t for t in times if t > now][:12]
    return {"date": day.isoformat(), "timezone": tz, "times": [t.strftime("%Y-%m-%d %H:%M") for t in free], "message": "" if free else "Nothing is free that day."}


class BookBody(BaseModel):
    start: str = Field(max_length=40)
    name: str = Field(min_length=1, max_length=120)
    phone: str | None = Field(default=None, max_length=30)
    email: str | None = Field(default=None, max_length=200)


@hooks.post("/{token}/book")
async def book(token: str, body: BookBody, session=Depends(get_session), cal=Depends(get_calcom)):
    row = await _by_token(session, token)
    tz = row.config["timezone"]
    try:
        when = calcom.parse_when(body.start, tz)
        made = await cal(row.config["api_key"]).book(row.config["event_type_id"], when, body.name.strip(), tz, (body.email or "").strip() or None, (body.phone or "").strip() or None)
    except calcom.CalError as e:
        return {"booked": False, "message": str(e)}
    return {"booked": True, "when": when.strftime("%A %d %B, %I:%M %p"), "booking": str(made.get("uid", ""))}
