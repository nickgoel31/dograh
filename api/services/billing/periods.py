"""Pure billing-period and rounding helpers (no I/O, easy to unit test)."""

import math
from datetime import datetime, timezone

from dateutil.relativedelta import relativedelta

MAX_RESET_DAY = 28  # keeps every reset day valid in every month


def clamp_reset_day(reset_day: int | None) -> int:
    return min(max(int(reset_day or 1), 1), MAX_RESET_DAY)


def _utc(ts: datetime) -> datetime:
    return ts.replace(tzinfo=timezone.utc) if ts.tzinfo is None else ts.astimezone(timezone.utc)


def period_for(reset_day: int | None, ts: datetime) -> tuple[datetime, datetime]:
    """Return ``(start, end)`` of the billing period containing ``ts``.

    ``end`` is exclusive and equals the next period's ``start`` so periods tile
    the timeline with no gaps and no overlaps.
    """
    ts = _utc(ts)
    day = clamp_reset_day(reset_day)
    start = ts.replace(day=day, hour=0, minute=0, second=0, microsecond=0)
    if ts.day < day:
        start = (start - relativedelta(months=1)).replace(day=day)
    return start, start + relativedelta(months=1)


def period_starts_between(
    last_granted: datetime | None, reset_day: int | None, current_start: datetime, max_periods: int = 24
) -> list[datetime]:
    """Period starts that still need an allowance grant, oldest first.

    ``last_granted`` is the start of the newest period that already received
    one. A change of ``reset_day`` can never grant twice in one calendar month.
    """
    if last_granted is None:
        return [current_start]
    last_granted = _utc(last_granted)
    day = clamp_reset_day(reset_day)
    out: list[datetime] = []
    y, m = last_granted.year, last_granted.month
    while len(out) < max_periods:
        m += 1
        if m > 12:
            y, m = y + 1, 1
        candidate = datetime(y, m, day, tzinfo=timezone.utc)
        if candidate > current_start:
            break
        out.append(candidate)
    return out


def billed_seconds_for(duration_seconds: float, pulse_seconds: int | None) -> int:
    """Round a call up to whole billing pulses (0 for a zero-length call)."""
    if not duration_seconds or duration_seconds <= 0:
        return 0
    pulse = max(int(pulse_seconds or 60), 1)
    return int(math.ceil(duration_seconds / pulse) * pulse)


def within_contract(
    period_start: datetime,
    start: tuple[int | None, int | None],
    end: tuple[int | None, int | None],
) -> bool:
    """Is ``period_start`` inside the optional (year, month) contract window?"""
    ym = (period_start.year, period_start.month)
    if None not in start and ym < (start[0], start[1]):
        return False
    if None not in end and ym > (end[0], end[1]):
        return False
    return True
