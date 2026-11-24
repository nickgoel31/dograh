"""Swarvo IVR on the phone network (Plivo): answering a call with the menu, carrying it step by step, handing it to an AI agent, and billing it.

State lives in the database (one row per call), and every callback address is signed, so Plivo can call any worker and nobody else can forge a step.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

from sqlalchemy import select

from api.constants import OSS_JWT_SECRET
from api.db.product_models import ProductAgentModel, ProductBillingSettingsModel, ProductIvrCallModel, ProductIvrModel, ProductWorkspaceModel
from api.product import hours as hours_mod
from api.product import ivr_engine as eng

log = logging.getLogger(__name__)

# Voices Plivo can speak with. Polly voices cover Indian English and Hindi, and the common English voices.
VOICES = [
    {"id": "Polly.Aditi", "label": "Aditi (woman, Indian English / Hindi)", "languages": ["en-IN", "hi-IN"]},
    {"id": "Polly.Kajal", "label": "Kajal (woman, Indian English / Hindi)", "languages": ["en-IN", "hi-IN"]},
    {"id": "Polly.Joanna", "label": "Joanna (woman, US English)", "languages": ["en-US"]},
    {"id": "Polly.Matthew", "label": "Matthew (man, US English)", "languages": ["en-US"]},
    {"id": "Polly.Amy", "label": "Amy (woman, UK English)", "languages": ["en-GB"]},
]
LANGUAGES = {"en-IN": "English (India)", "hi-IN": "Hindi", "en-US": "English (US)", "en-GB": "English (UK)"}
DEFAULT_SETTINGS = {"voice": "Polly.Aditi", "language": "en-IN", "pulse": 60, "hours": None, "paused_message": "Sorry, this line isn't taking calls right now. Please try again later."}
LIVE_FOR = timedelta(seconds=90)  # a call with no step for this long is over; it is billed then


def rate_per_minute(pulse: int) -> float:
    """Price of one IVR minute: ₹1 a minute when billed every 60 seconds, ₹0.50 for each 30 seconds (also ₹1 a minute)."""
    if pulse == 30:
        return float(os.getenv("PRODUCT_IVR_RATE_30", "1.0"))
    return float(os.getenv("PRODUCT_IVR_RATE_60", "1.0"))


def settings_of(ivr: ProductIvrModel) -> dict:
    s = {**DEFAULT_SETTINGS, **(ivr.settings or {})}
    s["pulse"] = 30 if int(s.get("pulse") or 60) == 30 else 60
    return s


def clean_settings(raw: dict, current: dict) -> dict:
    s = {**current}
    if "voice" in raw:
        if raw["voice"] not in {v["id"] for v in VOICES}:
            raise eng.FlowError("Choose one of the listed voices.")
        s["voice"] = raw["voice"]
    if "language" in raw:
        if raw["language"] not in LANGUAGES:
            raise eng.FlowError("Choose one of the listed languages.")
        s["language"] = raw["language"]
    if "pulse" in raw:
        if int(raw["pulse"]) not in (30, 60):
            raise eng.FlowError("Billing is either every 30 seconds or every 60 seconds.")
        s["pulse"] = int(raw["pulse"])
    if "hours" in raw:
        s["hours"] = hours_mod.validate_hours(raw["hours"]) if raw["hours"] else None
    if "paused_message" in raw:
        s["paused_message"] = str(raw["paused_message"] or "")[:200] or DEFAULT_SETTINGS["paused_message"]
    return s


def seconds_billed(seconds: float, pulse: int) -> float:
    """Minutes charged: every started 30 (or 60) second block counts in full. A call that never got a step is free."""
    if seconds <= 0:
        return 0.0
    blocks = -(-int(seconds) // pulse)
    return blocks * pulse / 60


# ---------------- signed callbacks ----------------
def _sig(pid: str, kind: str, node: str, tries: int) -> str:
    return hmac.new(OSS_JWT_SECRET.encode(), f"ivr|{pid}|{kind}|{node}|{tries}".encode(), hashlib.sha256).hexdigest()[:24]


def sig_ok(pid: str, kind: str, node: str, tries: int, sig: str) -> bool:
    return hmac.compare_digest(_sig(pid, kind, node, tries), sig or "")


def make_url(base: str, pid: str):
    def url(kind: str, node: str, tries: int) -> str:
        q = urlencode({"k": kind, "node": node, "tries": tries, "sig": _sig(pid, kind, node, tries)})
        return f"{base}/api/v1/ivr/plivo/{pid}/step?{q}"

    return url


def open_checker(settings: dict, now: datetime | None = None):
    now = now or datetime.now(UTC)
    return lambda hrs: hours_mod.is_open(hrs, now)


def xml(step: eng.Step, settings: dict, base: str, pid: str, caller_id: str = "") -> str:
    return '<?xml version="1.0" encoding="UTF-8"?>' + eng.to_xml(step, voice=settings["voice"], language=settings["language"], url=make_url(base, pid), caller_id=caller_id)


def say_and_hangup(text: str, settings: dict | None = None) -> str:
    s = {**DEFAULT_SETTINGS, **(settings or {})}
    return '<?xml version="1.0" encoding="UTF-8"?>' + eng.to_xml(eng.Step(say=[text], then={"kind": "hangup"}), voice=s["voice"], language=s["language"], url=lambda *_: "")


# ---------------- a call's life ----------------
async def begin(session, ivr: ProductIvrModel, *, org_id: int, number_id: int | None, config_id: int | None, call_uuid: str, from_number: str, to_number: str, base: str) -> str:
    """A call arrived on a number that points at this IVR. Returns the XML for the first step."""
    s = settings_of(ivr)
    if ivr.status != "live":
        return say_and_hangup(s["paused_message"], s)
    flow = ivr.flow
    call = await session.scalar(select(ProductIvrCallModel).where(ProductIvrCallModel.call_uuid == call_uuid))
    if call is None:
        call = ProductIvrCallModel(ivr_id=ivr.id, workspace_id=ivr.workspace_id, org_id=org_id, number_id=number_id, config_id=config_id, call_uuid=call_uuid,
                                   from_number=from_number, to_number=to_number, trail=[], vars={"caller": "".join(c for c in from_number if c.isdigit())[-10:]})
        session.add(call)
    st = eng.step(flow, flow["start"], vars=call.vars, is_open=open_checker(s), hours=s.get("hours"))
    _log(call, st, "start")
    await session.commit()
    return xml(st, s, base, ivr.public_id, caller_id=to_number)


def _log(call: ProductIvrCallModel, st: eng.Step, event: str, **extra) -> None:
    call.trail = [*(call.trail or []), *({"at": datetime.now(UTC).isoformat(timespec="seconds"), "node": n, "event": event if i == 0 else "next", **(extra if i == 0 else {})} for i, n in enumerate(st.trail))][-80:]
    call.last_at = datetime.now(UTC)
    kind = st.then.get("kind")
    call.outcome = {"dial": "transferred", "agent": "agent", "record": "voicemail", "hangup": "hangup"}.get(kind, "menu")


async def carry_on(session, ivr: ProductIvrModel, call: ProductIvrCallModel, kind: str, node: str, tries: int, form: dict, base: str) -> tuple[eng.Step, str]:
    """The caller answered (or the phone network reported back). Returns the next Step and its XML."""
    s = settings_of(ivr)
    flow, nodes = ivr.flow, ivr.flow["nodes"]
    common = dict(is_open=open_checker(s), hours=s.get("hours"))
    vars_ = dict(call.vars or {})
    n = nodes.get(node)
    if n is None:
        st = eng.Step(say=[eng.DEFAULT_GOODBYE])
    elif kind == "input":
        digits, speech = str(form.get("Digits") or ""), str(form.get("Speech") or "")
        st = eng.answer(flow, node, digits=digits, speech=speech, tries=tries, vars=vars_, **common)
        if n["type"] == "collect" and digits:
            vars_[n["var"]] = "".join(c for c in digits if c.isdigit())[:20]
            call.vars = vars_
        _log(call, st, "input", digits=("*" * len(digits)) if n["type"] == "collect" else digits, speech=speech[:80])
    elif kind == "noinput":
        st = eng.answer(flow, node, tries=tries, vars=vars_, **common)
        _log(call, st, "no_input")
    elif kind == "dial":
        status = str(form.get("DialStatus") or form.get("DialBLegStatus") or "").lower()
        st = eng.after_dial(flow, node, status, vars=vars_, **common)
        _log(call, st, "dial_" + (status or "ended"))
    elif kind == "record":
        call.voicemail_url = str(form.get("RecordUrl") or form.get("RecordingUrl") or "")[:500] or None
        st = eng.after_record(flow, node, vars=vars_, **common)
        _log(call, st, "voicemail")
        call.outcome = "voicemail"
    else:
        st = eng.Step(say=[eng.DEFAULT_GOODBYE])
    await session.commit()
    return st, xml(st, s, base, ivr.public_id, caller_id=call.to_number)


def duration_seconds(call: ProductIvrCallModel) -> int:
    """How long the IVR carried this call: from the first step to the last one we heard of (plus the few seconds before the caller hung up)."""
    if call.seconds:
        return call.seconds
    end = call.last_at or call.started_at
    start = call.started_at
    if end is None or start is None:
        return 0
    return max(1, int((end - start).total_seconds()) + 3)


async def charge_calls(session, wallet, now: datetime | None = None, limit: int = 200) -> int:
    """Bill finished IVR calls (no step for 90 seconds, or handed to an AI agent) to the Live wallet, once each."""
    now = now or datetime.now(UTC)
    rows = (await session.scalars(select(ProductIvrCallModel).where(ProductIvrCallModel.billed.is_(False), ProductIvrCallModel.last_at < now - LIVE_FOR).order_by(ProductIvrCallModel.id).limit(limit))).all()
    done = 0
    for c in rows:
        if c.outcome == "transferred" and c.last_at > now - timedelta(hours=3):
            continue  # still talking to the transfer number; the call's end is reported when it finishes
        ivr = await session.get(ProductIvrModel, c.ivr_id)
        ws = await session.get(ProductWorkspaceModel, c.workspace_id)
        if ivr is None or ws is None:
            c.billed = True
            continue
        owner = await session.get(ProductBillingSettingsModel, c.workspace_id)
        pulse = owner.ivr_pulse if owner is not None and owner.ivr_pulse in (30, 60) else settings_of(ivr)["pulse"]
        c.seconds = duration_seconds(c)
        minutes = seconds_billed(c.seconds, pulse)
        rate = rate_per_minute(pulse)
        try:
            amount = await wallet.charge(ws.live_org_id, minutes, rate, f"Swarvo IVR call {c.id} ({pulse}s billing)", f"ivr:{c.id}") if minutes else 0.0
        except Exception as e:  # noqa: BLE001 - one call that can't be charged must not stop the rest; it is tried again next time
            log.warning("IVR call %s could not be charged: %s", c.id, e)
            continue
        c.minutes, c.amount, c.billed = minutes, amount, True
        done += 1
    await session.commit()
    return done


async def agent_workflow(session, ivr: ProductIvrModel, agent_public_id: str) -> int | None:
    a = await session.scalar(select(ProductAgentModel).where(ProductAgentModel.public_id == agent_public_id, ProductAgentModel.workspace_id == ivr.workspace_id))
    return a.live_workflow_id if a else None
