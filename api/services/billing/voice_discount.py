"""A cheaper minute for calls spoken with a swarvo-tts voice.

The discount follows what the call actually used (the speech service that spoke), so it applies the same to calls made from the new app, the classic
app or the API. Set SWARVO_TTS_DISCOUNT_PERCENT to change it (default 20; 0 turns it off).
"""

import os

DEFAULT_PERCENT = 20.0
KOYAL_DEFAULT_PERCENT = 15.0


def koyal_percent() -> float:
    """How much cheaper each minute is when the agent speaks with a Koyal voice. Open to everyone. KOYAL_DISCOUNT_PERCENT changes it (0 turns it off)."""
    try:
        return min(90.0, max(0.0, float(os.getenv("KOYAL_DISCOUNT_PERCENT", "") or KOYAL_DEFAULT_PERCENT)))
    except ValueError:
        return KOYAL_DEFAULT_PERCENT


def percent() -> float:
    try:
        return min(90.0, max(0.0, float(os.getenv("SWARVO_TTS_DISCOUNT_PERCENT", "") or DEFAULT_PERCENT)))
    except ValueError:
        return DEFAULT_PERCENT


def multiplier_for_usage(usage_info: dict | None) -> float:
    """1.0 for a normal call, 0.8 (by default) when swarvo-tts did the speaking."""
    tts = (usage_info or {}).get("tts") or {}
    if any("SwarvoTTSService" in str(k) for k in tts):
        return round(1.0 - percent() / 100.0, 4)
    if any("PlivoKoyalTTSService" in str(k) for k in tts):
        return round(1.0 - koyal_percent() / 100.0, 4)
    return 1.0
