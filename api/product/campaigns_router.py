"""Campaigns: upload a contact list, pass the compliance gate, then the platform dials. Counters come from the calls themselves."""

from __future__ import annotations

import tempfile
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Protocol

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import load_only

from api.db.models import TelephonyPhoneNumberModel, WorkflowModel, WorkflowRunModel
from api.db.product_models import ProductAgentModel, ProductCampaignAuditModel
from api.product import agents as agent_svc
from api.product import campaigns as camp
from api.product import conversations as conv
from api.product.deps import Ctx, get_ctx, require
from api.product.errors import product_error
from api.product.ids import decode_id, encode_id
from api.product.roles import Perm

router = APIRouter(prefix="/product/campaigns", tags=["campaigns"])


class CampaignGateway(Protocol):
    async def create(self, org_id: int, user_id: int, name: str, workflow_id: int, csv_text: str, schedule: dict, retry: dict) -> dict: ...
    async def list(self, org_id: int, user_id: int) -> list[dict]: ...
    async def act(self, org_id: int, user_id: int, ref: int, action: str) -> dict: ...


class CoreCampaigns:
    @staticmethod
    def _user(org_id, user_id):
        return SimpleNamespace(id=user_id, provider_id=f"u{user_id}", selected_organization_id=org_id, is_superuser=False, role="admin")

    @staticmethod
    async def _call(coro):
        try:
            return await coro
        except HTTPException as e:
            raise product_error(400 if e.status_code < 500 else 502, "campaign_failed",
                                "We couldn't do that with this campaign. Check the contact list and that a phone number is connected.")

    async def create(self, org_id, user_id, name, workflow_id, csv_text, schedule, retry):
        from api.routes import campaign as core
        from api.services.storage import storage_fs

        key = f"campaigns/{org_id}/{uuid.uuid4()}.csv"
        with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False, encoding="utf-8", newline="") as f:
            f.write(csv_text)
        if not await storage_fs.aupload_file(f.name, key):
            raise product_error(502, "campaign_failed", "We couldn't save your contact list. Please try again.")
        req = core.CreateCampaignRequest(
            name=name, workflow_id=workflow_id, source_type="csv", source_id=key,
            schedule_config=core.ScheduleConfigRequest(enabled=True, timezone=schedule["tz"], slots=[core.TimeSlotRequest(**s) for s in schedule["slots"]]),
            retry_config=core.RetryConfigRequest(enabled=retry["max_retries"] > 0, max_retries=retry["max_retries"], retry_delay_seconds=retry["delay"]),
        )
        c = await self._call(core.create_campaign(req, user=self._user(org_id, user_id)))
        return {"ref": c.id, "state": c.state, "total": c.total_rows or 0, "workflow_id": c.workflow_id, "created_at": c.created_at}

    async def list(self, org_id, user_id):
        from api.routes import campaign as core

        r = await self._call(core.get_campaigns(user=self._user(org_id, user_id)))
        return [{"ref": c.id, "name": c.name, "state": c.state, "total": c.total_rows or 0, "workflow_id": c.workflow_id, "created_at": c.created_at} for c in r.campaigns]

    async def act(self, org_id, user_id, ref, action):
        from api.routes import campaign as core

        fn = {"start": core.start_campaign, "pause": core.pause_campaign, "resume": core.resume_campaign}[action]
        c = await self._call(fn(ref, user=self._user(org_id, user_id)))
        return {"ref": c.id, "state": c.state}


_gw: CampaignGateway = CoreCampaigns()


def get_campaigns() -> CampaignGateway:
    return _gw


STATE = {"created": "scheduled", "scheduled": "scheduled", "running": "running", "paused": "paused", "completed": "done", "failed": "paused"}


class SlotIn(BaseModel):
    day_of_week: int = Field(ge=0, le=6)
    start_time: str = Field(pattern=r"^\d{2}:\d{2}$")
    end_time: str = Field(pattern=r"^\d{2}:\d{2}$")


class ContactsBody(BaseModel):
    csv_text: str = Field(max_length=camp.MAX_BYTES)
    country: str = Field(default="IN", pattern="^[A-Za-z]{2}$")


class CreateBody(ContactsBody):
    name: str = Field(min_length=1, max_length=120)
    agent_id: str
    timezone: str = "Asia/Kolkata"
    slots: list[SlotIn] = Field(min_length=1, max_length=14)
    max_retries: int = Field(default=2, ge=0, le=5)
    retry_delay_minutes: int = Field(default=30, ge=1, le=240)
    consent_confirmed: bool = False
    dnc_checked: bool = False


class ContactsOut(BaseModel):
    total: int
    valid: int
    duplicates: int
    invalid: list[dict]
    columns: list[str]
    sample: list[dict]


class CampaignOut(BaseModel):
    id: str
    name: str
    agent_id: str | None
    status: str  # running | paused | done | scheduled
    total: int
    dialed: int = 0
    answered: int = 0
    voicemail: int = 0
    no_answer: int = 0
    converted: int = 0


@router.post("/contacts/check", response_model=ContactsOut)
async def check_contacts(body: ContactsBody, ctx: Ctx = Depends(get_ctx)):
    try:
        r = camp.check_contacts(body.csv_text, body.country.upper())
    except ValueError as e:
        raise product_error(400, "bad_contacts", str(e))
    return ContactsOut(total=r["total"], valid=len(r["valid"]), duplicates=r["duplicates"], invalid=r["invalid"][:50], columns=r["columns"], sample=r["valid"][:5])


async def _counters(ctx: Ctx, ref: int) -> dict:
    rows = (await ctx.session.scalars(select(WorkflowRunModel).where(WorkflowRunModel.campaign_id == ref).options(load_only(
        WorkflowRunModel.is_completed, WorkflowRunModel.cost_info, WorkflowRunModel.usage_info, WorkflowRunModel.gathered_context)).limit(20000))).all()
    c = {"dialed": len(rows), "answered": 0, "voicemail": 0, "no_answer": 0, "converted": 0}
    for r in rows:
        g = r.gathered_context or {}
        o = conv.product_outcome(disposition=g.get("mapped_call_disposition") or g.get("call_disposition"), completed=bool(r.is_completed), duration=conv.duration_seconds(r.cost_info, r.usage_info))
        if o == "voicemail":
            c["voicemail"] += 1
        elif o == "no-answer":
            c["no_answer"] += 1
        elif o in ("booked", "qualified", "resolved", "transferred"):
            c["answered"] += 1
            c["converted"] += o in ("booked", "qualified")
    return c


async def _out(ctx: Ctx, c: dict, agents: dict[int, ProductAgentModel]) -> CampaignOut:
    a = agents.get(c["workflow_id"]) if "workflow_id" in c else None
    return CampaignOut(id=encode_id("cmp", c["ref"]), name=c.get("name", ""), agent_id=a.public_id if a else None,
                       status=STATE.get(c["state"], "scheduled"), total=c.get("total", 0), **await _counters(ctx, c["ref"]))


async def _live_agents(ctx: Ctx) -> dict[int, ProductAgentModel]:
    rows = (await ctx.session.scalars(select(ProductAgentModel).where(ProductAgentModel.workspace_id == ctx.workspace.id))).all()
    return {a.live_workflow_id: a for a in rows if a.live_workflow_id}


@router.post("", response_model=CampaignOut, status_code=201)
async def create(body: CreateBody, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE)), gw: CampaignGateway = Depends(get_campaigns)):
    if ctx.environment != "live":
        raise product_error(400, "live_only", "Campaigns call real people, so they run in Live mode. Switch to Live to start one.")
    agent = await agent_svc.get_agent(ctx.session, ctx.workspace, body.agent_id)
    if agent.live_workflow_id is None or agent.status != "live":
        raise product_error(400, "agent_not_live", "Put this agent live first, then start a campaign with it.")
    has_number = await ctx.session.scalar(select(func.count()).select_from(TelephonyPhoneNumberModel).where(
        TelephonyPhoneNumberModel.organization_id == ctx.org_id, TelephonyPhoneNumberModel.is_active.is_(True)))
    if not has_number:
        raise product_error(400, "no_number", "Campaigns call from your own phone numbers. Get a number on the Phone Numbers page first.")
    slots = [s.model_dump() for s in body.slots]
    try:
        camp.check_compliance(consent=body.consent_confirmed, dnc_checked=body.dnc_checked, tz=body.timezone, slots=slots)
        r = camp.check_contacts(body.csv_text, body.country.upper())
    except ValueError as e:
        raise product_error(400, "compliance_blocked", str(e))
    from api.product import contacts as ct

    stop = await ct.blocked_set(ctx.session, ctx.workspace.id)
    removed = [v for v in r["valid"] if v["phone_number"] in stop]
    r["valid"] = [v for v in r["valid"] if v["phone_number"] not in stop]
    if not r["valid"]:
        raise product_error(400, "bad_contacts", "None of the phone numbers in this file could be used." if not removed else "Everyone in this file is on your do-not-call list.")
    made = await gw.create(ctx.org_id, ctx.user.id, body.name.strip(), agent.live_workflow_id, camp.to_csv(r["valid"]),
                           {"tz": body.timezone, "slots": slots}, {"max_retries": body.max_retries, "delay": body.retry_delay_minutes * 60})
    ctx.session.add(ProductCampaignAuditModel(
        workspace_id=ctx.workspace.id, user_id=ctx.user.id, campaign_ref=made["ref"], action="created", at=datetime.now(UTC),
        detail={"contacts": len(r["valid"]), "invalid": len(r["invalid"]), "duplicates": r["duplicates"], "consent_confirmed": True,
                "dnc_attested": True, "skipped_do_not_call": len(removed), "registry_checked": False, "timezone": body.timezone, "slots": slots, "country": body.country.upper()}))
    await ctx.session.commit()
    made.setdefault("name", body.name.strip())
    return await _out(ctx, {**made, "name": body.name.strip()}, {agent.live_workflow_id: agent})


@router.get("", response_model=list[CampaignOut])
async def list_campaigns(ctx: Ctx = Depends(get_ctx), gw: CampaignGateway = Depends(get_campaigns)):
    agents = await _live_agents(ctx)
    if ctx.environment != "live":
        return []
    return [await _out(ctx, c, agents) for c in await gw.list(ctx.org_id, ctx.user.id) if c["workflow_id"] in agents]


async def _action(ctx: Ctx, gw: CampaignGateway, campaign_id: str, action: str) -> CampaignOut:
    ref = decode_id("cmp", campaign_id)
    agents = await _live_agents(ctx)
    known = {c["ref"]: c for c in await gw.list(ctx.org_id, ctx.user.id)} if ref else {}
    c = known.get(ref)
    if c is None or c["workflow_id"] not in agents or ctx.environment != "live":
        raise product_error(404, "campaign_not_found", "We couldn't find that campaign.")
    if action == "start" and agents[c["workflow_id"]].status != "live":
        raise product_error(400, "agent_not_live", "This campaign's agent is paused. Resume it first.")
    res = await gw.act(ctx.org_id, ctx.user.id, ref, action)
    ctx.session.add(ProductCampaignAuditModel(workspace_id=ctx.workspace.id, user_id=ctx.user.id, campaign_ref=ref, action=action, at=datetime.now(UTC), detail={}))
    await ctx.session.commit()
    return await _out(ctx, {**c, **res}, agents)


@router.post("/{campaign_id}/start", response_model=CampaignOut)
async def start(campaign_id: str, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE)), gw: CampaignGateway = Depends(get_campaigns)):
    return await _action(ctx, gw, campaign_id, "start")


@router.post("/{campaign_id}/pause", response_model=CampaignOut)
async def pause(campaign_id: str, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE)), gw: CampaignGateway = Depends(get_campaigns)):
    return await _action(ctx, gw, campaign_id, "pause")


@router.post("/{campaign_id}/resume", response_model=CampaignOut)
async def resume(campaign_id: str, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE)), gw: CampaignGateway = Depends(get_campaigns)):
    return await _action(ctx, gw, campaign_id, "resume")
