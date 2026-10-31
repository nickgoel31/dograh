"""Privacy settings and what they do at run time.

- redact_pii: masks emails, phone numbers and card-like numbers wherever call text is shown or sent out.
- record_calls off: recordings are not offered for playback (capture itself is a platform setting, see PRODUCT_ASSUMPTIONS).
- consent_announcement: spoken first on every Live call (added when an agent goes live).
- retention_days: older recordings and transcripts are cleared by `purge_expired`.
"""

import re
from copy import deepcopy
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from api.db.models import WorkflowModel, WorkflowRunModel
from api.db.product_models import ProductSettingsModel, ProductWorkspaceModel

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_CARD = re.compile(r"\b(?:\d[ -]?){13,16}\b")
_PHONE = re.compile(r"(?<![\w])\+?\d[\d ()-]{7,}\d(?!\w)")


def redact_text(text: str | None) -> str | None:
    if not text:
        return text
    text = _EMAIL.sub("[email]", text)
    text = _CARD.sub("[card]", text)
    return _PHONE.sub("[phone]", text)


def mask_phone(phone: str | None) -> str | None:
    return None if not phone else "•••" + phone[-3:]


async def get_settings(session, workspace_id: int) -> ProductSettingsModel:
    row = await session.get(ProductSettingsModel, workspace_id)
    if row is None:
        row = ProductSettingsModel(workspace_id=workspace_id, record_calls=True, redact_pii=False)
        session.add(row)
        await session.flush()
    return row


async def apply_consent(session, ws: ProductWorkspaceModel, graph: dict) -> dict:
    """Prefix the announcement to the greeting of a Live graph."""
    text = (await get_settings(session, ws.id)).consent_announcement
    if not text:
        return graph
    out = deepcopy(graph)
    for n in out.get("nodes", []):
        if n.get("type") == "startCall":
            d = n.setdefault("data", {})
            g = d.get("greeting") or ""
            if not g.startswith(text):
                d["greeting"] = f"{text} {g}".strip()
                d["greeting_type"] = "text"
    return out


async def purge_expired(session, ws: ProductWorkspaceModel, now: datetime | None = None) -> int:
    """Clear recordings and transcripts older than the retention period. Returns how many calls were cleared."""
    days = (await get_settings(session, ws.id)).retention_days
    if not days:
        return 0
    cutoff = (now or datetime.now(UTC)) - timedelta(days=days)
    runs = (await session.scalars(
        select(WorkflowRunModel).join(WorkflowModel, WorkflowRunModel.workflow_id == WorkflowModel.id)
        .where(WorkflowModel.organization_id.in_([ws.live_org_id, ws.test_org_id]), WorkflowRunModel.created_at < cutoff)
    )).all()
    n = 0
    for r in runs:
        had = bool(r.recording_url) or bool((r.logs or {}).get("realtime_feedback_events"))
        if not had:
            continue
        r.recording_url = None
        r.logs = {k: v for k, v in (r.logs or {}).items() if k != "realtime_feedback_events"}
        n += 1
    await session.flush()
    return n
