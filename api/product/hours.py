"""Opening hours and the gate an inbound call passes before the agent answers. Pure except `inbound_gate`."""

import re
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DEFAULT_CLOSED = "We're closed right now. Please call back during our opening hours."
DEFAULT_PAUSED = "Sorry, we can't take your call right now. Please try again later."
_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def validate_hours(h: dict) -> dict:
    """Normalise user input or raise ValueError with a plain message.

    Shape: {"enabled": bool, "tz": "Asia/Kolkata",
            "windows": [{"days": [0..6, Monday=0], "start": "09:00", "end": "18:00"}],
            "closed_message": str}
    """
    tz = str(h.get("tz") or "UTC")
    try:
        ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError("We don't recognise that time zone.")
    windows = []
    for w in h.get("windows") or []:
        days = sorted({int(d) for d in w.get("days", [])})
        if not days or any(d < 0 or d > 6 for d in days):
            raise ValueError("Pick at least one day for each opening time.")
        start, end = str(w.get("start", "")), str(w.get("end", ""))
        if not (_HHMM.match(start) and _HHMM.match(end)) or start >= end:
            raise ValueError("Opening times must look like 09:00 and finish after they start.")
        windows.append({"days": days, "start": start, "end": end})
    if h.get("enabled") and not windows:
        raise ValueError("Add at least one opening time, or turn business hours off.")
    return {
        "enabled": bool(h.get("enabled")), "tz": tz, "windows": windows,
        "closed_message": str(h.get("closed_message") or "")[:300],
    }


def is_open(hours: dict | None, now_utc: datetime) -> bool:
    if not hours or not hours.get("enabled"):
        return True
    local = now_utc.astimezone(ZoneInfo(hours.get("tz") or "UTC"))
    hhmm = local.strftime("%H:%M")
    return any(local.weekday() in w["days"] and w["start"] <= hhmm < w["end"] for w in hours.get("windows", []))


def gate_message(meta: dict | None, agent_status: str | None, now_utc: datetime) -> str | None:
    """What to say instead of answering, or None to let the agent take the call."""
    if agent_status == "paused":
        return DEFAULT_PAUSED
    hours = (meta or {}).get("hours")
    if not is_open(hours, now_utc):
        return (hours or {}).get("closed_message") or DEFAULT_CLOSED
    return None


async def inbound_gate(phone_row) -> str | None:
    """Called by the platform's inbound webhook for every call to a number. Fails open."""
    try:
        from sqlalchemy import or_, select

        from api.db import db_client
        from api.db.product_models import ProductAgentModel

        status = None
        if phone_row.inbound_workflow_id:
            async with db_client.async_session() as s:
                status = await s.scalar(
                    select(ProductAgentModel.status).where(
                        or_(
                            ProductAgentModel.live_workflow_id == phone_row.inbound_workflow_id,
                            ProductAgentModel.test_workflow_id == phone_row.inbound_workflow_id,
                        )
                    )
                )
        return gate_message(phone_row.extra_metadata, status, datetime.now().astimezone())
    except Exception:  # noqa: BLE001 - a broken gate must never stop calls from being answered
        return None
