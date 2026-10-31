"""Turn a platform call record into what customers see. Pure functions, no database.

Everything here is derived from fields the platform really records:
* ``logs.realtime_feedback_events``: transcript pieces, tool calls and speed metrics
* ``cost_info``: duration and a vendor cost breakdown
* ``gathered_context``: the call's disposition and any extracted answers
"""

from datetime import datetime

OUTCOMES = ("booked", "resolved", "qualified", "transferred", "voicemail", "failed", "no-answer")

# First matching rule wins. Matched against the lower-cased disposition text
# (the platform records either an extracted label or the reason the call ended).
# "not_*" / "un*" qualifiers are checked first so "not_interested" is never "qualified".
_NEGATIVE = ("not_interested", "not interested", "not_qualified", "unqualified", "disqualified", "declined", "no_interest")
_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("voicemail", ("voicemail", "answering_machine", "answering machine", "machine_detected")),
    ("transferred", ("transfer", "xfer", "handed_off", "escalat")),
    ("failed", ("error", "fail", "exception", "crash", "pipeline", "quota", "insufficient")),
    ("no-answer", ("no_answer", "no answer", "unanswered", "busy", "not_answered", "idle", "silence", "timeout")),
    ("booked", ("book", "appointment", "scheduled", "reserved")),
    ("qualified", ("qualif", "interested", "hot_lead", "lead")),
)
_SHORT_CALL_SECONDS = 5


def product_outcome(*, disposition: str | None, completed: bool, duration: float | None) -> str | None:
    """None means the call is still in progress."""
    text = (disposition or "").strip().lower().replace("-", "_")
    if text:
        if not any(n in text for n in _NEGATIVE):
            for outcome, needles in _RULES:
                if any(n in text for n in needles):
                    return outcome
        else:
            return "resolved"
    if not completed:
        return None
    if duration is not None and duration < _SHORT_CALL_SECONDS:
        return "no-answer"
    return "resolved"


FAIL_REASONS = {
    "failed": "Something went wrong during this call. Try again, and contact support if it keeps happening.",
    "no-answer": "Nobody spoke on the call, so there was nothing to respond to.",
}


def failure_reason(outcome: str | None) -> str | None:
    return FAIL_REASONS.get(outcome or "")


# Platform-internal keys that are not answers the agent collected.
_INTERNAL = {
    "call_disposition", "mapped_call_disposition", "extracted_call_disposition", "call_tags", "call_id",
    "provider", "caller_number", "called_number", "direction", "transfer_state", "recording_id",
}


def extracted_answers(gathered: dict | None) -> dict[str, str]:
    out: dict[str, str] = {}
    for k, v in (gathered or {}).items():
        if k in _INTERNAL or k.startswith("_") or isinstance(v, (dict, list)) or v in (None, ""):
            continue
        out[str(k).replace("_", " ").capitalize()] = str(v)
    return out


def _ts(e: dict) -> float | None:
    raw = (e.get("payload") or {}).get("timestamp") or e.get("timestamp")
    if not raw:
        return None
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def build_transcript(events: list[dict] | None) -> list[dict]:
    """Caller/agent turns with seconds from the start of the call.

    ``reply`` on an agent turn is the platform's measured response delay for the
    turn that triggered it (sum of its speed metrics), when recorded.
    """
    evs = [e for e in (events or []) if isinstance(e, dict)]
    stamped = [(e, _ts(e)) for e in evs]
    known = [t for _, t in stamped if t is not None]
    t0 = min(known) if known else 0.0
    ordered = sorted(range(len(stamped)), key=lambda i: (stamped[i][1] if stamped[i][1] is not None else t0, i))

    turns: list[dict] = []
    pending_latency = 0.0
    last_t = 0.0
    for i in ordered:
        e, t = stamped[i]
        t = (t if t is not None else t0 + last_t) - t0
        last_t = t
        kind = e.get("type")
        p = e.get("payload") or {}
        if kind == "rtf-user-transcription":
            text = (p.get("text") or "").strip()
            if p.get("final") and text:
                turns.append({"who": "caller", "t": round(t, 2), "end": round(t, 2), "text": text})
                pending_latency = 0.0
        elif kind == "rtf-bot-text":
            text = (p.get("text") or "").strip()
            if not text:
                continue
            if turns and turns[-1]["who"] == "agent":
                turns[-1]["text"] = f"{turns[-1]['text']} {text}".strip()
                turns[-1]["end"] = round(t, 2)
            else:
                turn = {"who": "agent", "t": round(t, 2), "end": round(t, 2), "text": text}
                if pending_latency > 0:
                    turn["reply"] = round(pending_latency, 2)
                turns.append(turn)
        elif kind == "rtf-function-call-start":
            name = p.get("function_name")
            if turns and turns[-1]["who"] == "agent":
                turns[-1].setdefault("tool", name)
            else:
                turn = {"who": "agent", "t": round(t, 2), "end": round(t, 2), "text": "", "tool": name}
                if pending_latency > 0:
                    turn["reply"] = round(pending_latency, 2)
                turns.append(turn)
        elif kind == "ttfb-metric":
            try:
                pending_latency += float(p.get("ttfb_seconds") or 0)
            except (TypeError, ValueError):
                pass
    return _timed(turns)


def _timed(turns: list[dict]) -> list[dict]:
    """Give every turn a real start and end, and a reply time where the platform recorded none.

    A caller's turn is stamped when their words were finalised (the moment they stopped), so their speech is
    placed just before that, sized by how many words they said. An agent's turn starts at its first words and
    runs a little past its last. The reply time is the gap between the caller stopping and the agent starting.
    """
    for i, t in enumerate(turns):
        prev_end = turns[i - 1]["end"] if i else 0.0
        if t["who"] == "caller":
            words = max(1, len((t["text"] or "").split()))
            stop = t["t"]
            t["t"], t["end"] = round(min(stop, max(prev_end, stop - min(0.45 * words, 12.0))), 2), round(stop, 2)
        else:
            t["end"] = round(max(t["end"], t["t"]) + 0.8, 2)
            if i and turns[i - 1]["who"] == "caller" and "reply" not in t:
                gap = t["t"] - turns[i - 1]["end"]
                if 0 < gap <= 30:
                    t["reply"] = round(gap, 2)
    for i in range(len(turns) - 1):  # nobody talks over a turn that has not started yet
        if turns[i]["who"] == "agent" and turns[i]["end"] > turns[i + 1]["t"] and turns[i + 1]["t"] > turns[i]["t"]:
            turns[i]["end"] = turns[i + 1]["t"]
    return turns


COMPONENTS = (("stt_cost", "Speech to text"), ("llm_cost", "AI brain"), ("tts_cost", "Voice"))


def cost_split(cost_info: dict | None, total: float) -> list[dict]:
    """The customer's price split by where the platform's own cost went.

    Uses the vendor cost breakdown only as *weights*: the values add up to
    ``total`` (what the customer pays), never to the vendor cost.
    """
    breakdown = (cost_info or {}).get("cost_breakdown") or {}
    weights = [(label, float(breakdown.get(key) or 0.0)) for key, label in COMPONENTS]
    weight_sum = sum(w for _, w in weights)
    if total <= 0 or weight_sum <= 0:
        return [{"name": label, "value": 0.0} for label, _ in weights] + [{"name": "Phone", "value": 0.0}]
    out = [{"name": label, "value": round(total * w / weight_sum, 4)} for label, w in weights]
    return out + [{"name": "Phone", "value": 0.0}]  # telephony cost is added with phone numbers


def duration_seconds(cost_info: dict | None, usage_info: dict | None) -> float | None:
    for src in (cost_info, usage_info):
        v = (src or {}).get("call_duration_seconds")
        if isinstance(v, (int, float)):
            return float(v)
    return None


def caller_of(initial: dict | None, gathered: dict | None) -> tuple[str, str | None]:
    """(display name, phone)."""
    initial, gathered = initial or {}, gathered or {}
    phone = initial.get("caller_number") or gathered.get("caller_number") or initial.get("phone_number")
    name = initial.get("caller_name") or initial.get("customer_name") or initial.get("name")
    if name:
        return str(name), str(phone) if phone else None
    if phone:
        return str(phone), str(phone)
    return "Browser call", None
