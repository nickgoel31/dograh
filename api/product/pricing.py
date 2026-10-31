"""The price per minute and where it goes.

The rate falls as a workspace holds more minutes in its wallet (volume slabs): the more you load, the cheaper every minute is.
The slab is found from the wallet balance - the cheapest slab whose minutes the balance can still buy at that slab's own rate
(so ₹6,000 buys 1,000 minutes at ₹6.00, which is why ₹6,000 is where the ₹6.00 slab starts). Above the last slab, customers
talk to sales; the last rate keeps applying meanwhile.

Where a minute's price goes: phone first (PHONE_PER_MIN), then the rest is split voice 60%, speech to text 30%, AI brain 10%.
Override the slabs with PRODUCT_PRICE_SLABS, a JSON list like [[1000, 6.75], [5000, 6]] (up to this many minutes a month, rate).
"""

import json
import math
import os

DEFAULT_SLABS: list[tuple[int, float]] = [
    (1_000, 6.75), (5_000, 6.0), (15_000, 5.5), (25_000, 5.0), (37_500, 4.6), (50_000, 4.2), (75_000, 3.8), (100_000, 3.4),
]
PHONE_PER_MIN = 0.4
SHARES = (("Voice", 0.60), ("Speech to text", 0.30), ("AI brain", 0.10))
ORDER = ("Speech to text", "AI brain", "Voice", "Phone")


def billed_minutes(seconds: float | None) -> float:
    """Calls are billed per minute, rounded up: 61 seconds is 2 minutes, and a call that never connected is free."""
    return float(math.ceil(seconds / 60)) if seconds and seconds > 0 else 0.0


def slabs() -> list[tuple[int, float]]:
    try:
        raw = json.loads(os.getenv("PRODUCT_PRICE_SLABS", "") or "null")
        if isinstance(raw, list) and raw:
            return sorted((int(a), float(b)) for a, b in raw)
    except (ValueError, TypeError):
        pass
    return DEFAULT_SLABS


def _bounds(table: list[tuple[int, float]]) -> list[tuple[int, float]]:
    """(minutes the slab starts at, rate) for each slab, cheapest last."""
    out, lower = [], 0
    for limit, rate in table:
        out.append((lower, rate))
        lower = limit
    return out


def rate_for_balance(balance: float) -> float:
    """Price per minute for a wallet holding this much money: the cheapest slab the balance can actually fill."""
    table = slabs()
    for lower, rate in reversed(_bounds(table)):
        if balance >= lower * rate - 1e-9:
            return rate
    return table[0][1]


def next_balance_step(balance: float) -> tuple[float, float, int] | None:
    """(balance needed for the next cheaper slab, its rate, minutes it starts at), or None on the last slab."""
    table = slabs()
    bounds = _bounds(table)
    here = rate_for_balance(balance)
    for i, (_, rate) in enumerate(bounds):
        if rate == here and i + 1 < len(bounds):
            lower, nrate = bounds[i + 1]
            return (round(lower * nrate, 2), nrate, lower)
    return None


def rate_for(minutes_used: float) -> float:
    """Price per minute while this many minutes have been used this month."""
    table = slabs()
    for limit, rate in table:
        if minutes_used < limit:
            return rate
    return table[-1][1]


def next_step(minutes_used: float) -> tuple[int, float] | None:
    """(minutes at which the price drops, the new price), or None on the last slab."""
    table = slabs()
    for i, (limit, _) in enumerate(table):
        if minutes_used < limit:
            return (limit, table[i + 1][1]) if i + 1 < len(table) else None
    return None


def contact_sales_above() -> int:
    return slabs()[-1][0]


def split(minutes: float, rate: float) -> list[dict]:
    """The price of `minutes` at `rate`, split into phone, voice, speech to text and AI brain (in display order)."""
    total = max(0.0, minutes * rate)
    phone = min(total, minutes * PHONE_PER_MIN)
    rest = total - phone
    parts = {label: rest * share for label, share in SHARES}
    parts["Phone"] = phone
    return [{"name": n, "value": round(parts[n], 4)} for n in ORDER]
