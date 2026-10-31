"""'Call me': ring the customer's own phone with their live agent, to hear it on a real line. Uses the usual per-minute price."""

from __future__ import annotations

import re
from types import SimpleNamespace
from typing import Protocol

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from api.db.models import TelephonyPhoneNumberModel
from api.product import agents as agent_svc
from api.product import billing
from api.product.deps import Ctx, require
from api.product.errors import product_error
from api.product.roles import Perm
from api.utils import rate_limit

router = APIRouter(prefix="/product/agents", tags=["agents"])
_E164 = re.compile(r"^\+[1-9]\d{6,14}$")


class PhoneCallGateway(Protocol):
    async def start(self, org_id: int, user_id: int, workflow_id: int, phone: str) -> str: ...


class CorePhoneCall:
    async def start(self, org_id, user_id, workflow_id, phone):
        from api.routes import telephony as core

        user = SimpleNamespace(id=user_id, provider_id=f"u{user_id}", selected_organization_id=org_id, is_superuser=False, role="admin")
        try:
            res = await core.initiate_call(core.InitiateCallRequest(workflow_id=workflow_id, phone_number=phone), user=user)
        except HTTPException as e:
            raise product_error(400 if e.status_code < 500 else 502, "call_failed",
                                "We couldn't start the call. Check that you have a phone number and enough balance, then try again.")
        return "queued" if getattr(res, "status_code", 200) == 202 else "calling"


_gw: PhoneCallGateway = CorePhoneCall()


def get_phone_call() -> PhoneCallGateway:
    return _gw


class CallMeBody(BaseModel):
    phone: str = Field(max_length=20)


@router.post("/{agent_id}/call-me")
async def call_me(agent_id: str, body: CallMeBody, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE)), gw: PhoneCallGateway = Depends(get_phone_call)):
    if not _E164.match(body.phone.strip()):
        raise product_error(400, "bad_number", "Enter your number with its country code, like +919876543210.")
    agent = await agent_svc.get_agent(ctx.session, ctx.workspace, agent_id)
    if agent.live_workflow_id is None or agent.status != "live":
        raise product_error(400, "not_live_yet", "Put this agent live first, then we can call your phone with it. Until then, use the Talk button to try it in your browser.")
    org = ctx.workspace.live_org_id
    has_number = await ctx.session.scalar(select(func.count()).select_from(TelephonyPhoneNumberModel).where(
        TelephonyPhoneNumberModel.organization_id == org, TelephonyPhoneNumberModel.is_active.is_(True)))
    if not has_number:
        raise product_error(400, "no_number", "Get a phone number first on the Phone Numbers page. The call comes from one of your numbers.")
    if await billing.limit_reached(ctx.session, org):
        raise product_error(400, "limit_reached", "You've reached your monthly spending limit, so calls are paused.")
    await rate_limit.enforce(f"callme:{ctx.workspace.id}", 5, 3600, "That's a lot of test calls for one hour. Try again a little later.")
    status = await gw.start(org, ctx.user.id, agent.live_workflow_id, body.phone.strip())
    return {"status": status, "message": "Your phone should ring in a few seconds." if status == "calling" else "Your call is queued and will ring shortly."}
