"""'Human feel': how an agent paces, listens and speaks. Plain-word choices that map onto the voice engine's own settings.

Pace, patience, turn detection, steadiness, fillers and vocabulary tune the Studio (Inworld) realtime voices. Interruptions,
call length and silence timeout apply to every voice. Anything left unset keeps the voice profile's own default.
"""

from copy import deepcopy

DEFAULT_MAX_MINUTES = 15  # the platform's own default is 5, which cuts real conversations short
DEFAULT_SILENCE_SECONDS = 10

PATIENCE = {"quick": "high", "balanced": "medium", "patient": "low"}  # how long to wait before assuming the caller is done
TURNS = {"smart": "semantic_vad", "fast": "server_vad"}  # smart = understands when a sentence is finished; fast = reacts to silence
STEADINESS = {"steady": "STABLE", "expressive": "CREATIVE"}


def clean(raw: dict | None) -> dict:
    """Keep only valid choices; raise ValueError with a plain message for a bad one."""
    out: dict = {}
    for k, v in (raw or {}).items():
        if v is None:
            continue
        if k == "pace":
            if not isinstance(v, (int, float)) or not 0.75 <= v <= 1.75:
                raise ValueError("Speaking pace must be between 0.75 and 1.75.")
            out[k] = round(float(v), 2)
        elif k == "patience":
            if v not in PATIENCE:
                raise ValueError("Patience must be quick, balanced or patient.")
            out[k] = v
        elif k == "turns":
            if v not in TURNS:
                raise ValueError("Turn-taking must be smart or fast.")
            out[k] = v
        elif k == "steadiness":
            if v not in STEADINESS:
                raise ValueError("Delivery must be steady or expressive.")
            out[k] = v
        elif k in ("fillers", "interruptions"):
            out[k] = bool(v)
        elif k == "vocabulary":
            out[k] = str(v).strip()[:300]
        elif k == "max_minutes":
            if not isinstance(v, int) or not 1 <= v <= 60:
                raise ValueError("Maximum call length must be between 1 and 60 minutes.")
            out[k] = v
        elif k == "silence_seconds":
            if not isinstance(v, int) or not 5 <= v <= 60:
                raise ValueError("Silence timeout must be between 5 and 60 seconds.")
            out[k] = v
    return out


def overlay(realtime: dict, style: dict | None) -> dict:
    """The voice settings with this agent's choices applied (Studio voices)."""
    rt, s = deepcopy(realtime), style or {}
    if "pace" in s:
        rt["tts_speed"] = s["pace"]
    if "patience" in s:
        rt["stt_eagerness"] = PATIENCE[s["patience"]]
    if "turns" in s:
        rt["turn_detection"] = TURNS[s["turns"]]
    if "steadiness" in s:
        rt["delivery_mode"] = STEADINESS[s["steadiness"]]
    if "fillers" in s:
        rt["conversational"] = s["fillers"]
    if s.get("vocabulary"):
        rt["transcription_prompt"] = s["vocabulary"]
    return rt


def workflow_settings(style: dict | None) -> dict:
    """Call-level settings every voice honours."""
    s = style or {}
    return {"max_call_duration": int(s.get("max_minutes", DEFAULT_MAX_MINUTES)) * 60, "max_user_idle_timeout": float(s.get("silence_seconds", DEFAULT_SILENCE_SECONDS))}
