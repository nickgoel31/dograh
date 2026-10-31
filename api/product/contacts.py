"""Contacts (everyone the agents talked to), the do-not-call list, and spotting "stop calling me"."""

import re
from datetime import UTC, datetime

from sqlalchemy import func, select

from api.db.models import WorkflowModel, WorkflowRunModel
from api.db.product_models import ProductBlockModel, ProductContactModel, ProductWorkspaceModel
from api.product import conversations as conv
from api.product.notifications import notify

# Plain phrases (English and common Hindi/Hinglish) that mean "never call me again".
OPT_OUT = re.compile(
    r"(stop calling|don'?t call( me)?( again)?|do not call|dont call|never call|remove (my|me|this) (number|name)|take me off|unsubscribe|no more calls|"
    r"call (mat|na) kar|mat call kar|phone mat kar|dobara call mat|mujhe call mat)", re.I)
_PHONE = re.compile(r"[^\d+]")


def normalize(raw: str | None) -> str | None:
    """'+91 98765-43210' -> '+919876543210'. None when it can't be a phone number."""
    if not raw:
        return None
    digits = _PHONE.sub("", str(raw))
    plus = digits.startswith("+")
    digits = digits.lstrip("+")
    if not digits.isdigit() or not 7 <= len(digits) <= 15:
        return None
    return "+" + digits


async def blocked_set(session, workspace_id: int) -> set[str]:
    return set((await session.scalars(select(ProductBlockModel.phone).where(ProductBlockModel.workspace_id == workspace_id))).all())


async def block(session, workspace_id: int, phone: str, reason: str) -> bool:
    """True when newly added."""
    p = normalize(phone)
    if not p or await session.scalar(select(ProductBlockModel.id).where(ProductBlockModel.workspace_id == workspace_id, ProductBlockModel.phone == p)):
        return False
    session.add(ProductBlockModel(workspace_id=workspace_id, phone=p, reason=reason))
    await session.flush()
    return True


def asked_to_stop(turns: list[dict]) -> bool:
    return any(t.get("who") == "caller" and OPT_OUT.search(t.get("text") or "") for t in turns)


async def sync(session, ws: ProductWorkspaceModel, limit: int = 500) -> list[tuple[int, str]]:
    """Fold new finished live calls into contacts, and add anyone who asked not to be called to the block list.
    Returns (run id, phone) for every call seen for the first time."""
    since = await session.scalar(select(func.max(ProductContactModel.last_run_id)).where(ProductContactModel.workspace_id == ws.id)) or 0
    runs = (await session.scalars(
        select(WorkflowRunModel).join(WorkflowModel, WorkflowRunModel.workflow_id == WorkflowModel.id)
        .where(WorkflowModel.organization_id == ws.live_org_id, WorkflowRunModel.id > since, WorkflowRunModel.is_completed.is_(True))
        .order_by(WorkflowRunModel.id).limit(limit))).all()
    seen: list[tuple[int, str]] = []
    for r in runs:
        name, phone = conv.caller_of(r.initial_context, r.gathered_context)
        p = normalize(phone)
        if not p:
            continue
        c = await session.scalar(select(ProductContactModel).where(ProductContactModel.workspace_id == ws.id, ProductContactModel.phone == p))
        if c is None:
            c = ProductContactModel(workspace_id=ws.id, phone=p, name=None if name == phone else name, calls=0, last_run_id=0)
            session.add(c)
        elif not c.name and name != phone:
            c.name = name
        c.calls, c.last_run_id = (c.calls or 0) + 1, max(c.last_run_id or 0, r.id)
        c.last_call_at = max(filter(None, [c.last_call_at, r.created_at]), default=r.created_at)
        seen.append((r.id, p))
        if asked_to_stop(conv.build_transcript((r.logs or {}).get("realtime_feedback_events"))) and await block(session, ws.id, p, "asked"):
            await notify(session, ws.id, "dnc", "Someone asked not to be called", f"{p} was added to your do-not-call list.", "/contacts", f"dnc:{p}")
    await session.flush()
    return seen
