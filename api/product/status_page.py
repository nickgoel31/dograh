"""The public status page: health checks written every minute, and what they add up to over the last 30 days."""

from __future__ import annotations

import os
import time
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta

import aiohttp
import sqlalchemy as sa
from sqlalchemy import delete, func, select, text

from api.db.models import ModelProfileModel
from api.db.product_models import ProductStatusCheckModel

DAYS = 30
STALE_AFTER = timedelta(minutes=10)  # a part with no recent check is "unknown", not "fine"
KEEP_DAYS = 95

COMPONENTS = {
    "app": "Web app and API",
    "models": "Voice and AI models",
    "voices": "Swarvo voices",
    "phone": "Phone calls",
}

# Notes on past incidents, newest first. Add one here when something happens; the page shows the last 90 days.
INCIDENTS: list[dict] = []

Pinger = Callable[[str], Awaitable[tuple[bool, int | None]]]


async def ping(url: str) -> tuple[bool, int | None]:
    t0 = time.monotonic()
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=8)) as s, s.get(url) as r:
            return r.status < 500, int((time.monotonic() - t0) * 1000)
    except Exception:  # noqa: BLE001 - an unreachable service is simply "down"
        return False, None


async def run_checks(session, pinger: Pinger = ping) -> dict[str, tuple[bool, int | None]]:
    """The current health of each part. Parts this deployment does not use are left out."""
    out: dict[str, tuple[bool, int | None]] = {}
    t0 = time.monotonic()
    try:
        await session.execute(text("select 1"))
        out["app"] = (True, int((time.monotonic() - t0) * 1000))
    except Exception:  # noqa: BLE001
        out["app"] = (False, None)
        return out
    out["models"] = (bool(await session.scalar(select(ModelProfileModel.id).where(ModelProfileModel.is_active.is_(True)).limit(1))), None)
    base = os.getenv("SWARVO_TTS_BASE_URL", "").strip().rstrip("/")
    if base:
        out["voices"] = await pinger(base + "/health")
    if os.getenv("PRODUCT_PLIVO_AUTH_ID") or os.getenv("PRODUCT_TWILIO_ACCOUNT_SID"):
        out["phone"] = (True, None)  # the carriers publish their own status; we only know ours is set up
    return out


async def record(session, pinger: Pinger = ping, now: datetime | None = None) -> int:
    now = now or datetime.now(UTC)
    results = await run_checks(session, pinger)
    for comp, (ok, ms) in results.items():
        session.add(ProductStatusCheckModel(at=now, component=comp, ok=ok, ms=ms))
    await session.execute(delete(ProductStatusCheckModel).where(ProductStatusCheckModel.at < now - timedelta(days=KEEP_DAYS)))
    await session.commit()
    return len(results)


def _state(last_ok: bool | None, last_at: datetime | None, now: datetime) -> str:
    if last_at is None:
        return "unknown"
    if last_at.tzinfo is None:
        last_at = last_at.replace(tzinfo=UTC)
    if now - last_at > STALE_AFTER:
        return "unknown"
    return "operational" if last_ok else "outage"


async def summary(session, now: datetime | None = None) -> dict:
    now = now or datetime.now(UTC)
    since = (now - timedelta(days=DAYS - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    day = func.date(ProductStatusCheckModel.at)
    rows = (await session.execute(
        select(ProductStatusCheckModel.component, day, func.count(), func.sum(sa.cast(ProductStatusCheckModel.ok, sa.Integer)))
        .where(ProductStatusCheckModel.at >= since).group_by(ProductStatusCheckModel.component, day))).all()
    per: dict[str, dict[str, tuple[int, int]]] = {}
    for comp, d, n, ok in rows:
        per.setdefault(comp, {})[str(d)[:10]] = (int(n), int(ok or 0))
    comps = []
    for key, name in COMPONENTS.items():
        if key not in per:
            continue
        last = (await session.execute(select(ProductStatusCheckModel.ok, ProductStatusCheckModel.at).where(ProductStatusCheckModel.component == key).order_by(ProductStatusCheckModel.at.desc()).limit(1))).first()
        history, total, good = [], 0, 0
        for i in range(DAYS):
            d = (since + timedelta(days=i)).date().isoformat()
            n, ok = per[key].get(d, (0, 0))
            total, good = total + n, good + ok
            history.append({"date": d, "uptime": round(100 * ok / n, 2) if n else None})
        comps.append({"key": key, "name": name, "state": _state(last[0] if last else None, last[1] if last else None, now), "uptime": round(100 * good / total, 2) if total else None, "history": history})
    states = {c["state"] for c in comps}
    overall = "outage" if "outage" in states else "unknown" if (not comps or "unknown" in states) else "operational"
    cutoff = (now - timedelta(days=90)).date().isoformat()
    return {"overall": overall, "components": comps, "incidents": [i for i in INCIDENTS if i["date"] >= cutoff], "checked_at": now.isoformat()}
