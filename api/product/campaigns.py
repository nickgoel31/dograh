"""Campaign contact checking and the compliance gate. Pure functions."""

import csv
import io
import os
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

MAX_ROWS = int(os.getenv("PRODUCT_MAX_CAMPAIGN_ROWS", "10000"))
MAX_BYTES = 5_000_000
PHONE_HINTS = ("phone", "mobile", "number", "contact", "cell", "whatsapp")


def allowed_window() -> tuple[str, str]:
    """Earliest and latest local time calls may be placed (default 09:00 to 21:00)."""
    raw = os.getenv("PRODUCT_CALL_WINDOW", "09:00-21:00")
    start, _, end = raw.partition("-")
    return start.strip(), end.strip()


def _normalize(raw: str, country: str) -> str | None:
    from api.utils.telephony_address import normalize_telephony_address

    try:
        n = normalize_telephony_address(raw.strip(), country_hint=country)
    except Exception:  # noqa: BLE001
        return None
    c = n.canonical
    return c if c.startswith("+") and n.address_type == "pstn" and 8 <= len(c) <= 16 else None


def check_contacts(csv_text: str, country: str = "IN") -> dict:
    """Authoritative parse: find the phone column, normalise to E.164, drop duplicates, report bad rows.

    Returns {columns, total, valid: [row dicts incl. phone_number], invalid: [{row, reason}], duplicates}.
    Raises ValueError with a plain message when the file can't be used at all.
    """
    if len(csv_text.encode()) > MAX_BYTES:
        raise ValueError("That file is too big. Keep it under 5 MB.")
    rows = list(csv.reader(io.StringIO(csv_text.lstrip("﻿"))))
    rows = [r for r in rows if any(c.strip() for c in r)]
    if len(rows) < 2:
        raise ValueError("The file needs a header row and at least one contact.")
    header = [h.strip() for h in rows[0]]
    col = next((i for i, h in enumerate(header) if h.lower().replace(" ", "_") == "phone_number"), None)
    if col is None:
        col = next((i for i, h in enumerate(header) if any(k in h.lower() for k in PHONE_HINTS)), None)
    if col is None:
        raise ValueError("We couldn't find a phone number column. Name it 'phone' or 'mobile'.")
    body = rows[1:]
    if len(body) > MAX_ROWS:
        raise ValueError(f"A campaign can have up to {MAX_ROWS:,} contacts. This file has {len(body):,}.")
    others = [(i, h) for i, h in enumerate(header) if i != col and h]
    valid, invalid, seen, dups = [], [], set(), 0
    for n, r in enumerate(body, start=2):
        raw = r[col] if col < len(r) else ""
        phone = _normalize(raw, country) if raw.strip() else None
        if phone is None:
            invalid.append({"row": n, "reason": "Empty phone number" if not raw.strip() else f"'{raw.strip()[:30]}' isn't a valid phone number"})
        elif phone in seen:
            dups += 1
        else:
            seen.add(phone)
            valid.append({"phone_number": phone, **{h: (r[i].strip() if i < len(r) else "") for i, h in others}})
    return {"columns": [h for _, h in others], "total": len(body), "valid": valid, "invalid": invalid, "duplicates": dups}


def to_csv(valid: list[dict]) -> str:
    cols = ["phone_number"] + [k for k in (valid[0] if valid else {}) if k != "phone_number"]
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore")
    w.writeheader()
    w.writerows(valid)
    return buf.getvalue()


def check_compliance(*, consent: bool, dnc_checked: bool, tz: str, slots: list[dict], now: datetime | None = None) -> None:
    """Raise ValueError (plain words) unless the campaign may start. There is no do-not-call registry
    integration yet, so the customer must attest that the list was checked; that attestation is logged."""
    if not consent:
        raise ValueError("Please confirm that the people on this list agreed to be called.")
    if not dnc_checked:
        raise ValueError("Please confirm that you've checked this list against the Do-Not-Call register.")
    try:
        ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError("We don't recognise that time zone.")
    if not slots:
        raise ValueError("Pick at least one day and time window for calls.")
    lo, hi = allowed_window()
    for s in slots:
        if not (0 <= int(s["day_of_week"]) <= 6) or not (s["start_time"] < s["end_time"]):
            raise ValueError("Each calling window needs a day and a start before its end.")
        if s["start_time"] < lo or s["end_time"] > hi:
            raise ValueError(f"Calls can only be made between {lo} and {hi} in your contacts' local time.")
