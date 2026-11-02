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


def allowed_models() -> list[str]:
    """AI models an agent on a Studio voice may use: the three Brain levels plus the engine's other supported models."""
    from api.product.models_config import INWORLD_BRAINS
    from api.services.configuration.options.inworld import INWORLD_REALTIME_MODELS

    return list(dict.fromkeys([*INWORLD_BRAINS.values(), *INWORLD_REALTIME_MODELS]))


def model_label(model: str) -> str:
    name = model.split("/")[-1].replace("-", " ")
    return " ".join(("GPT" if w.lower() == "gpt" else w.capitalize()) for w in name.split())


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
        elif k == "model":
            if v and v not in allowed_models():
                raise ValueError("That AI model isn't available.")
            out[k] = v or ""
        elif k == "languages":
            if not isinstance(v, list) or len(v) > 6 or not all(isinstance(x, str) and 1 <= len(x.strip()) <= 30 for x in v):
                raise ValueError("Pick up to 6 languages.")
            out[k] = [x.strip() for x in v]
        elif k == "qa":
            if not isinstance(v, list) or len(v) > 60:
                raise ValueError("Add up to 60 questions and answers.")
            pairs = []
            for x in v:
                q, a = str((x or {}).get("q", "")).strip(), str((x or {}).get("a", "")).strip()
                if q and a:
                    pairs.append({"q": q[:300], "a": a[:1200]})
            out[k] = pairs
        elif k in ("daily_call_cap", "monthly_spend_cap"):
            if not isinstance(v, int) or not 0 <= v <= 1_000_000:
                raise ValueError("Limits must be whole numbers, or 0 for no limit.")
            out[k] = v
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
    if s.get("model"):
        rt["model"] = s["model"]  # an exact model chosen on the Brain tab wins over the Fast/Balanced/Smartest level
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
