"""WhatsApp follow-ups: "after a call to this agent or menu, send this message".

A rule picks its calls (all, one AI agent, or one IVR menu), when it fires (any call, or only for an outcome such as a booking or a
voicemail), how long to wait, and what to say. The scheduled job turns finished calls into messages, once per call, never to anyone on the
do-not-call list, and at most once per person per cooldown. Business-started WhatsApp messages go through the approved templates in
whatsapp.py, so the text is the same kind of follow-up as the workspace-wide one.
"""

from __future__ import annotations

import logging
import os
import re
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select

from api.db.models import WorkflowModel, WorkflowRunModel
from api.db.product_models import (
    ProductAgentModel,
    ProductCallInsightModel,
    ProductFollowupModel,
    ProductFollowupSendModel,
    ProductIvrCallModel,
    ProductIvrModel,
    ProductWorkspaceModel,
)
from api.product import contacts as ct
from api.product import conversations as conv
from api.product import whatsapp

log = logging.getLogger(__name__)

TRIGGERS = ("any", "answered", "booked", "qualified", "resolved", "transferred", "voicemail", "no-answer", "agent")
SOURCES = ("all", "agent", "ivr")
LOOKBACK = timedelta(hours=48)  # a call is only messaged while it is this recent
IVR_QUIET = timedelta(seconds=90)  # a menu call with no step for this long is over
MESSAGE_MAX = 600
VARIABLES = ("name", "business", "agent", "caller", "payment_link", "summary")


def daily_cap() -> int:
    return int(os.getenv("PRODUCT_FOLLOWUP_DAILY_CAP", "300"))


def render(text: str, values: dict[str, str]) -> str:
    """Fill {name}, {business}, {agent}, {caller}, {payment_link}, {summary} and any {answer} a menu collected. Unknown {words} are left out."""
    def one(m: re.Match) -> str:
        return values.get(m.group(1).lower(), "")

    return whatsapp.clean(re.sub(r"\{([A-Za-z0-9_]{1,24})\}", one, text or ""))


def matches(trigger: str, outcome: str) -> bool:
    if trigger == "any":
        return True
    if trigger == "answered":
        return outcome not in ("no-answer", "failed")
    return trigger == outcome


async def _candidates(session, ws: ProductWorkspaceModel, f: ProductFollowupModel, now: datetime) -> list[dict]:
    """Finished calls this rule applies to: [{key, phone, name, outcome, ended, values}]."""
    out: list[dict] = []
    since = now - LOOKBACK
    if f.source in ("all", "agent"):
        agent_names: dict[int, str] = {}
        agents = (await session.scalars(select(ProductAgentModel).where(ProductAgentModel.workspace_id == ws.id))).all()
        for a in agents:
            if a.live_workflow_id and (f.source == "all" or a.public_id == f.source_id):
                agent_names[a.live_workflow_id] = a.name
        wf_ids = list(agent_names)
        if wf_ids:
            runs = (await session.scalars(
                select(WorkflowRunModel).join(WorkflowModel, WorkflowRunModel.workflow_id == WorkflowModel.id)
                .where(WorkflowModel.organization_id == ws.live_org_id, WorkflowRunModel.workflow_id.in_(wf_ids), WorkflowRunModel.is_completed.is_(True),
                       WorkflowRunModel.created_at > since).order_by(WorkflowRunModel.id.desc()).limit(300))).all()
            insights = {i.run_id: i.summary for i in (await session.scalars(select(ProductCallInsightModel).where(ProductCallInsightModel.run_id.in_([r.id for r in runs])))).all()} if runs else {}
            for r in runs:
                name, phone = conv.caller_of(r.initial_context, r.gathered_context)
                g = r.gathered_context or {}
                dur = conv.duration_seconds(r.cost_info, r.usage_info)
                outcome = conv.product_outcome(disposition=g.get("mapped_call_disposition") or g.get("call_disposition"), completed=True, duration=dur) or "resolved"
                created = r.created_at if r.created_at.tzinfo else r.created_at.replace(tzinfo=UTC)
                out.append({"key": f"run:{r.id}", "phone": phone, "name": None if name == phone else name, "outcome": outcome, "ended": created + timedelta(seconds=dur or 0),
                            "values": {"agent": agent_names.get(r.workflow_id, ""), "summary": insights.get(r.id, ""), "caller": phone or ""}})
    if f.source in ("all", "ivr"):
        q = select(ProductIvrCallModel, ProductIvrModel.public_id).join(ProductIvrModel, ProductIvrModel.id == ProductIvrCallModel.ivr_id).where(
            ProductIvrCallModel.workspace_id == ws.id, ProductIvrCallModel.last_at > since, ProductIvrCallModel.last_at < now - IVR_QUIET)
        if f.source == "ivr":
            q = q.where(ProductIvrModel.public_id == f.source_id)
        for c, _pid in (await session.execute(q.order_by(ProductIvrCallModel.id.desc()).limit(300))).all():
            if f.source == "all" and c.outcome == "agent":
                continue  # the AI agent's own call carries that follow-up
            last = c.last_at if c.last_at.tzinfo else c.last_at.replace(tzinfo=UTC)
            vals = {str(k): str(v) for k, v in (c.vars or {}).items() if k != "caller"}
            out.append({"key": f"ivr:{c.id}", "phone": c.from_number, "name": None, "outcome": c.outcome if c.outcome != "menu" else "no-answer", "ended": last,
                        "values": {**vals, "agent": "", "summary": "", "caller": c.from_number}})
    return out


async def run_followups(session, wa_send=whatsapp.send, now: datetime | None = None, limit: int = 60) -> dict:
    """The scheduled step: send every follow-up that is due. Returns counts."""
    now = now or datetime.now(UTC)
    if not whatsapp.configured() and wa_send is whatsapp.send:
        return {"sent": 0, "failed": 0, "skipped": 0}
    sent = failed = skipped = 0
    cap = daily_cap()
    for f in (await session.scalars(select(ProductFollowupModel).where(ProductFollowupModel.enabled.is_(True), ProductFollowupModel.consent.is_(True)))).all():
        if sent + failed >= limit:
            break
        ws = await session.get(ProductWorkspaceModel, f.workspace_id)
        if ws is None or not (f.message or "").strip():
            continue
        blocked = await ct.blocked_set(session, ws.id)
        done = {k for (k,) in (await session.execute(select(ProductFollowupSendModel.call_key).where(ProductFollowupSendModel.followup_id == f.id, ProductFollowupSendModel.at > now - LOOKBACK * 2))).all()}
        today = await session.scalar(select(func.count(ProductFollowupSendModel.id)).where(ProductFollowupSendModel.workspace_id == ws.id, ProductFollowupSendModel.status == "sent", ProductFollowupSendModel.at > now - timedelta(days=1))) or 0
        from api.product.privacy import get_settings

        link = f.link or (await get_settings(session, ws.id)).payment_link
        for c in sorted(await _candidates(session, ws, f, now), key=lambda x: x["ended"]):
            if c["key"] in done or c["ended"] > now - timedelta(minutes=f.delay_minutes) or sent + failed >= limit:
                continue
            if not matches(f.trigger, c["outcome"]):
                continue
            phone = ct.normalize(c["phone"])

            async def record(status: str, reason: str = "") -> None:
                session.add(ProductFollowupSendModel(followup_id=f.id, workspace_id=ws.id, call_key=c["key"], phone=phone or "-", status=status, reason=reason))
                await session.flush()
                done.add(c["key"])

            if not phone:
                await record("skipped", "no phone number")
                skipped += 1
                continue
            if phone in blocked:
                await record("skipped", "on the do-not-call list")
                skipped += 1
                continue
            recent = await session.scalar(select(ProductFollowupSendModel.id).where(ProductFollowupSendModel.followup_id == f.id, ProductFollowupSendModel.phone == phone, ProductFollowupSendModel.status == "sent", ProductFollowupSendModel.at > now - timedelta(hours=f.cooldown_hours)))
            if recent:
                await record("skipped", "already messaged recently")
                skipped += 1
                continue
            if today + sent >= cap:
                break  # tomorrow; nothing is recorded, so these calls are picked up again
            values = {"name": (c["name"] or "there").split(" ")[0], "business": ws.name, "payment_link": link or "", **c["values"]}
            text = render(f.message, values)
            ok = await wa_send(phone, text, f.link)
            await record("sent" if ok else "failed", "" if ok else "WhatsApp did not accept the message")
            sent += bool(ok)
            failed += not ok
    await session.commit()
    return {"sent": sent, "failed": failed, "skipped": skipped}
