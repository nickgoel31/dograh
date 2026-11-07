"""'Human feel': how an agent paces, listens and speaks. Plain-word choices that map onto the voice engine's own settings.

Pace, patience, turn detection, steadiness, fillers and vocabulary tune the Studio (Inworld) realtime voices. Interruptions,
call length and silence timeout apply to every voice. Anything left unset keeps the voice profile's own default.
"""

from copy import deepcopy

DEFAULT_MAX_MINUTES = 15  # the platform's own default is 5, which cuts real conversations short
DEFAULT_SILENCE_SECONDS = 10

PATIENCE = {"quick": "high", "balanced": "medium", "patient": "low"}  # how long to wait before assuming the caller is done
TURNS = {"smart": "semantic_vad", "fast": "server_vad"}  # smart = understands when a sentence is finished; fast = reacts to silence
STEADINESS = {"steady": "STABLE", "balanced": "BALANCED", "expressive": "CREATIVE"}
STT_ENGINES = ("assemblyai", "deepgram")  # what a swarvo-tts voice listens with
# Deepgram Nova-3 languages for India (plus English and automatic). Malayalam is not offered by Deepgram's streaming models.
DEEPGRAM_LANGUAGES = {"hi": "Hindi", "ta": "Tamil", "te": "Telugu", "kn": "Kannada", "mr": "Marathi", "bn": "Bengali", "gu": "Gujarati", "pa": "Punjabi", "ur": "Urdu", "en": "English", "multi": "Automatic"}
# The languages an agent can speak (up to two per agent) and the script each one is written in. The AI is told to write every language in its own script,
# so Hindi is always Devanagari and English is always Latin letters, which is also what the voice reads best.
LANGUAGES = {
    "English": "Latin letters (the English alphabet)",
    "Hindi": "Devanagari (\u0926\u0947\u0935\u0928\u093e\u0917\u0930\u0940)",
    "Marathi": "Devanagari (\u0926\u0947\u0935\u0928\u093e\u0917\u0930\u0940)",
    "Gujarati": "Gujarati script (\u0a97\u0ac1\u0a9c\u0ab0\u0abe\u0aa4\u0ac0)",
    "Tamil": "Tamil script (\u0ba4\u0bae\u0bbf\u0bb4\u0bcd)",
    "Telugu": "Telugu script (\u0c24\u0c46\u0c32\u0c41\u0c17\u0c41)",
    "Kannada": "Kannada script (\u0c95\u0ca8\u0ccd\u0ca8\u0ca1)",
    "Malayalam": "Malayalam script (\u0d2e\u0d32\u0d2f\u0d3e\u0d33\u0d02)",
    "Bengali": "Bengali script (\u09ac\u09be\u0982\u09b2\u09be)",
    "Punjabi": "Gurmukhi (\u0a17\u0a41\u0a30\u0a2e\u0a41\u0a16\u0a40)",
    "Odia": "Odia script (\u0b13\u0b21\u0b3c\u0b3f\u0b06)",
    "Urdu": "Urdu script (\u0627\u0631\u062f\u0648)",
}
MAX_LANGUAGES = 2
TTS_MODES = ("chat", "read")  # swarvo-tts: chat adds natural pauses and short fillers, read says exactly the words
TTS_CHAT_LEVELS = ("light", "normal", "heavy")  # only matters in chat mode
STEERING = ("off", "low", "medium", "high")  # how often the voice is directed for the moment (Studio voices)


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
                raise ValueError("Delivery must be steady, balanced or expressive.")
            out[k] = v
        elif k == "steering":
            if v not in STEERING:
                raise ValueError("Steering must be off, low, medium or high.")
            out[k] = v
        elif k in ("fillers", "interruptions", "backchannel", "slow_filler"):
            out[k] = bool(v)
        elif k == "vocabulary":
            out[k] = str(v).strip()[:300]
        elif k == "model":
            if v and v not in allowed_models():
                raise ValueError("That AI model isn't available.")
            out[k] = v or ""
        elif k == "languages":
            if not isinstance(v, list):
                raise ValueError("Pick up to 2 languages.")
            names: list[str] = []
            for x in v:
                x = str(x).strip()
                for n in (["Hindi", "English"] if x == "Hinglish" else [x]):  # an older choice: Hindi and English together
                    if n in LANGUAGES and n not in names:
                        names.append(n)
            out[k] = names[:MAX_LANGUAGES]
        elif k == "tts_mode":
            if v not in TTS_MODES:
                raise ValueError("Voice mode must be chat or read.")
            out[k] = v
        elif k == "tts_chat_level":
            if v not in TTS_CHAT_LEVELS:
                raise ValueError("Chat level must be light, normal or heavy.")
            out[k] = v
        elif k == "qa":
            if not isinstance(v, list) or len(v) > 60:
                raise ValueError("Add up to 60 questions and answers.")
            pairs = []
            for x in v:
                q, a = str((x or {}).get("q", "")).strip(), str((x or {}).get("a", "")).strip()
                if q and a:
                    pairs.append({"q": q[:300], "a": a[:1200]})
            out[k] = pairs
        elif k == "stt_engine":
            if v not in STT_ENGINES:
                raise ValueError("Listening must be AssemblyAI or Deepgram.")
            out[k] = v
        elif k == "stt_language":
            if v not in DEEPGRAM_LANGUAGES:
                raise ValueError("Pick one of the listed languages.")
            out[k] = v
        elif k == "call_ambient":
            if not isinstance(v, dict):
                raise ValueError("Ambient noise settings are not valid.")
            vol = v.get("volume", 0.3)
            if not isinstance(vol, (int, float)) or not 0 <= vol <= 1:
                raise ValueError("Ambient noise volume must be between 0 and 1.")
            out[k] = {"enabled": bool(v.get("enabled")), "volume": round(float(vol), 2)}
        elif k == "call_turn_strategy":
            if v not in ("transcription", "turn_analyzer"):
                raise ValueError("Detection strategy must be transcription or turn_analyzer.")
            out[k] = v
        elif k == "call_turn_secs":
            if not isinstance(v, (int, float)) or not 0.5 <= v <= 10:
                raise ValueError("Incomplete turn timeout must be between 0.5 and 10 seconds.")
            out[k] = round(float(v), 1)
        elif k == "call_compaction":
            out[k] = bool(v)
        elif k == "call_max_seconds":
            if not isinstance(v, int) or not 1 <= v <= 14400:
                raise ValueError("Max call duration must be between 1 and 14400 seconds.")
            out[k] = v
        elif k == "call_idle_seconds":
            if not isinstance(v, int) or not 1 <= v <= 3600:
                raise ValueError("Max user idle timeout must be between 1 and 3600 seconds.")
            out[k] = v
        elif k == "call_concurrency":
            if not isinstance(v, int) or not 0 <= v <= 100000:
                raise ValueError("Concurrency limit must be a whole number, or empty for no limit.")
            out[k] = v
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


def language_rule(langs: list[str] | None) -> str:
    """Instructions that make the AI write each language in its own script. Empty when no language is chosen."""
    names = [n for n in (langs or []) if n in LANGUAGES][:MAX_LANGUAGES]
    if not names:
        return ""
    per = "; ".join(f"{n} in {LANGUAGES[n]}" for n in names)
    first = (
        f"You speak {names[0]}." if len(names) == 1 else f"You speak {names[0]} and {names[1]}. Answer in the language the caller uses, and start in {names[0]} if you cannot tell."
    )
    return (
        f"Languages: {first} ALWAYS write every language in its own native script, never in another script: {per}. "
        "For example, never write Hindi in English letters. If you mix two languages in one sentence, write each word in its own language's script "
        "(English words in Latin letters, inside a sentence written in the other language's script). Do not use emoji."
    )


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
    if s.get("steering") in STEERING:
        rt["steering"] = s["steering"]
    if "backchannel" in s:
        rt["backchannel"] = s["backchannel"]
    if "slow_filler" in s:
        rt["slow_filler"] = s["slow_filler"]
    if s.get("vocabulary"):
        rt["transcription_prompt"] = s["vocabulary"]
    return rt


def workflow_settings(style: dict | None) -> dict:
    """Call-level settings every voice honours."""
    s = style or {}
    out = {"max_call_duration": int(s.get("max_minutes", DEFAULT_MAX_MINUTES)) * 60, "max_user_idle_timeout": float(s.get("silence_seconds", DEFAULT_SILENCE_SECONDS))}
    # The platform's own call settings, set exactly as in the classic UI; anything left unset keeps the platform's default.
    if "call_max_seconds" in s:
        out["max_call_duration"] = s["call_max_seconds"]
    if "call_idle_seconds" in s:
        out["max_user_idle_timeout"] = float(s["call_idle_seconds"])
    if "call_turn_strategy" in s:
        out["turn_stop_strategy"] = s["call_turn_strategy"]
    if "call_turn_secs" in s:
        out["smart_turn_stop_secs"] = s["call_turn_secs"]
    if "call_compaction" in s:
        out["context_compaction_enabled"] = s["call_compaction"]
    if "call_ambient" in s:
        out["ambient_noise_configuration"] = s["call_ambient"]
    return out
