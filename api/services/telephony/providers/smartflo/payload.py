"""Pure helpers for Smartflo's HTTP calls to us: reading their payloads, matching numbers and calls, and signing the stream address."""

from __future__ import annotations

import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

from api.constants import OSS_JWT_SECRET

OUTBOUND_WINDOW = timedelta(minutes=5)  # a click-to-call run is waiting for Smartflo to connect it for at most this long


def ws_token(workflow_run_id: int) -> str:
    """Goes on the wss address we hand Smartflo; the stream handler refuses a connection without it."""
    return hmac.new(OSS_JWT_SECRET.encode(), f"smartflo-ws|{workflow_run_id}".encode(), hashlib.sha256).hexdigest()[:32]


def ws_token_ok(workflow_run_id: int, token: str | None) -> bool:
    return bool(token) and hmac.compare_digest(ws_token(workflow_run_id), token or "")


def tail(number: Any, n: int = 10) -> str:
    return "".join(c for c in str(number or "") if c.isdigit())[-n:]


def number_candidates(raw: Any) -> list[str]:
    """The ways a Smartflo number may be stored on our side: as sent, with a +, and as plain digits."""
    s = str(raw or "").strip()
    digits = "".join(c for c in s if c.isdigit())
    out = [s, f"+{digits}" if digits else "", digits]
    if len(digits) == 10:  # a national Indian number, no country code
        out += [f"+91{digits}", f"91{digits}"]
    return [x for i, x in enumerate(out) if x and x not in out[:i]]


def flatten(data: Any) -> dict[str, Any]:
    """A webhook or endpoint payload as one flat dict: lower-case keys without a leading "$", nested objects lifted, JSON strings opened."""
    out: dict[str, Any] = {}

    def put(k: str, v: Any) -> None:
        key = str(k).lstrip("$").strip()
        if isinstance(v, str) and v[:1] in "{[":
            try:
                v = json.loads(v)
            except ValueError:
                pass
        if isinstance(v, dict) and key.lower() not in ("custom_identifier", "answered_agent", "billing_circle"):
            for k2, v2 in v.items():
                put(k2, v2)
            return
        out.setdefault(key, v)
        out.setdefault(key.lower(), v)

    if isinstance(data, dict):
        for k, v in data.items():
            put(k, v)
    return out


def get(d: dict, *names: str, default: Any = None) -> Any:
    for n in names:
        for k in (n, n.lower(), n.replace("_", "")):
            if d.get(k) not in (None, ""):
                return d[k]
    return default


def custom_run_id(d: dict) -> int | None:
    """The run id we put in `custom_identifier` when we started a click-to-call."""
    ci = d.get("custom_identifier")
    if isinstance(ci, str):
        try:
            ci = json.loads(ci)
        except ValueError:
            ci = None
    if isinstance(ci, dict):
        try:
            return int(ci.get("run"))
        except (TypeError, ValueError):
            return None
    return None


def call_status(d: dict) -> str:
    """Our status words for a finished Smartflo call."""
    raw = " ".join(str(get(d, "call_status", "status", "disposition", default="")).lower().split())
    connected = str(get(d, "call_connected", default="")).lower() in ("1", "true", "yes")
    if "missed" in raw or "no answer" in raw or "no-answer" in raw or "not answered" in raw:
        return "no-answer"
    if "busy" in raw:
        return "busy"
    if "fail" in raw or "invalid" in raw:
        return "failed"
    if "answer" in raw or connected or "complete" in raw:
        return "completed"
    return "completed" if raw == "" and get(d, "billsec", "answered_seconds", "duration", default=0) not in (0, "0") else (raw or "completed")


def is_final(d: dict) -> bool:
    """Whether this payload says the call is over (the hangup triggers), as opposed to answered or dialled."""
    return any(k in d for k in ("end_stamp", "hangup_cause_code", "hangup_cause_description", "hangup_cause_key", "end_time", "end_date"))


def pick_pending_outbound(runs: Iterable[dict], config_id: int, numbers: Iterable[Any], now: datetime | None = None) -> int | None:
    """The click-to-call run waiting for this connection: same Smartflo account, same customer number, recent, not yet taken.
    `runs` are dicts with id, created_at, initial_context and gathered_context. The newest match wins."""
    now = now or datetime.now(timezone.utc)
    wanted = {tail(n) for n in numbers if tail(n)}
    best: tuple[datetime, int] | None = None
    for r in runs:
        ic, gc = r.get("initial_context") or {}, r.get("gathered_context") or {}
        created = r["created_at"] if r["created_at"].tzinfo else r["created_at"].replace(tzinfo=timezone.utc)
        if ic.get("provider") != "smartflo" or ic.get("telephony_configuration_id") != config_id or gc.get("smartflo_connected"):
            continue
        if ic.get("direction") == "inbound" or now - created > OUTBOUND_WINDOW:
            continue
        if tail(ic.get("called_number") or ic.get("phone_number")) in wanted and (best is None or created > best[0]):
            best = (created, r["id"])
    return best[1] if best else None
