"""Work done after calls, from the scheduled tick: update contacts, text callers, and send the weekly report."""

import os
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from api.db.models import TelephonyPhoneNumberModel, UserModel, WorkflowModel, WorkflowRunModel
from api.db.product_models import ProductCallInsightModel, ProductWorkspaceModel
from api.product import config, emailer, sms, whatsapp
from api.product import contacts as ct
from api.product import conversations as conv
from api.product.notifications import notify
from api.product.privacy import get_settings


async def contacts_and_texts(session, send=sms.send, limit: int = 30, wa_send=whatsapp.send) -> dict:
    """Fold new calls into contacts; text each new caller if the workspace has an after-call message set up."""
    texts = seen_total = wa_total = 0
    auth_id, token = os.getenv("PRODUCT_PLIVO_AUTH_ID"), os.getenv("PRODUCT_PLIVO_AUTH_TOKEN")
    for ws in (await session.scalars(select(ProductWorkspaceModel))).all():
        seen = await ct.sync(session, ws)
        seen_total += len(seen)
        settings = await get_settings(session, ws.id)
        text = settings.sms_after_call
        wa_text = settings.whatsapp_after_call if whatsapp.configured() or wa_send is not whatsapp.send else None
        if not seen or not (text or wa_text):
            continue
        stop = await ct.blocked_set(session, ws.id)
        if text and auth_id and token:
            src = await session.scalar(select(TelephonyPhoneNumberModel.address).where(TelephonyPhoneNumberModel.organization_id == ws.live_org_id, TelephonyPhoneNumberModel.is_active.is_(True)).limit(1))
            done: set[str] = set()
            for _, phone in seen:
                if src and phone not in stop and phone not in done and texts < limit:
                    done.add(phone)
                    texts += bool(await send(auth_id, token, src, phone, text))
        if wa_text:
            sent_to: set[str] = set()
            for _, phone in seen:
                if phone not in stop and phone not in sent_to and wa_total < limit:
                    sent_to.add(phone)
                    wa_total += bool(await wa_send(phone, whatsapp.render(wa_text, name=None, business=ws.name, link=settings.payment_link), settings.payment_link))
    await session.commit()
    return {"contacts": seen_total, "texts": texts, "whatsapp": wa_total}


def _stats(runs: list, moods: dict[int, int | None]) -> dict:
    out = {"calls": len(runs), "minutes": 0.0, "booked": 0, "resolved": 0, "failed": 0}
    for r in runs:
        g = r.gathered_context or {}
        dur = conv.duration_seconds(r.cost_info, r.usage_info)
        out["minutes"] += (dur or 0) / 60
        o = conv.product_outcome(disposition=g.get("mapped_call_disposition") or g.get("call_disposition"), completed=True, duration=dur)
        if o in ("booked", "qualified"):
            out["booked"] += 1
        elif o in ("resolved", "transferred"):
            out["resolved"] += 1
        elif o == "failed":
            out["failed"] += 1
    scores = [m for m in (moods.get(r.id) for r in runs) if m]
    out["mood"] = round(sum(scores) / len(scores), 1) if scores else None
    out["spend"] = round(out["minutes"] * config.PRICE_PER_MIN, 2)
    out["minutes"] = round(out["minutes"], 1)
    return out


async def weekly_reports(session, mailer: emailer.Mailer, now: datetime | None = None) -> int:
    """Once per week per workspace: a short 'what your agents did' email to the owner and a bell note."""
    now = now or datetime.now(UTC)
    iso = now.isocalendar()
    sent = 0
    for ws in (await session.scalars(select(ProductWorkspaceModel))).all():
        runs = (await session.scalars(
            select(WorkflowRunModel).join(WorkflowModel, WorkflowRunModel.workflow_id == WorkflowModel.id)
            .where(WorkflowModel.organization_id == ws.live_org_id, WorkflowRunModel.is_completed.is_(True), WorkflowRunModel.created_at > now - timedelta(days=7)).limit(20000))).all()
        if not runs:
            continue
        if not await notify(session, ws.id, "report", "Your weekly report is ready", "See how your agents did this week.", "/analytics", f"weekly:{iso.year}-{iso.week}"):
            continue
        moods = {r: s for r, s in (await session.execute(select(ProductCallInsightModel.run_id, ProductCallInsightModel.sentiment).where(ProductCallInsightModel.workspace_id == ws.id))).all()}
        st = _stats(runs, moods)
        owner = await session.get(UserModel, ws.owner_user_id)
        if owner and owner.email:
            mood = f"Average caller mood: {st['mood']} out of 5." if st["mood"] else ""
            body = (f"<p>Last 7 days for <b>{ws.name}</b>:</p><ul><li><b>{st['calls']}</b> calls, {st['minutes']} minutes</li>"
                    f"<li><b>{st['booked']}</b> booked or qualified, <b>{st['resolved']}</b> answered or handed over, <b>{st['failed']}</b> failed</li>"
                    f"<li>About {config.CURRENCY} {st['spend']:,.0f} of usage</li></ul><p>{mood}</p>")
            text = f"{ws.name}, last 7 days: {st['calls']} calls, {st['minutes']} minutes, {st['booked']} booked or qualified, {st['failed']} failed. {mood}"
            if await mailer.send(owner.email, f"Your week with {config.PRODUCT_NAME}", text, emailer.wrap("Your weekly report", body, ("See the details", f"{emailer.app_url()}/analytics"))):
                sent += 1
    await session.commit()
    return sent
