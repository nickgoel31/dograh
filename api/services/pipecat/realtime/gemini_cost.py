"""Keeping Gemini Live calls cheap, and measuring them correctly.

Gemini Live bills the WHOLE conversation context (system instruction, tools and everything said so far) again on every turn, so the cost of a
call grows with how much history is kept and with how long the instructions are. Two things are handled here:

* the history kept in the live session is capped (sliding-window compression), relative to the size of the instructions, and
* the usage Google reports is split by type (audio, text) so the cost shown is the real one. Audio costs four times what text does.

Tunable without code changes, in the environment:
    GEMINI_LIVE_HISTORY_TRIGGER_TOKENS  history kept before older turns are dropped   (default 3000)
    GEMINI_LIVE_HISTORY_TARGET_TOKENS   history kept after dropping them              (default 1200)
"""

from __future__ import annotations

import os

DEFAULT_TRIGGER = 3000  # about 1 minute of two-way conversation
DEFAULT_TARGET = 1200  # about 25 seconds, kept after trimming
MIN_TARGET = 800  # below this the agent forgets what was said a few seconds ago


def _env_int(name: str, default: int) -> int:
    try:
        return max(0, int(os.getenv(name, "") or default))
    except ValueError:
        return default


def history_budget() -> tuple[int, int]:
    """(trigger, target) for the conversation history, not counting the instructions."""
    trigger = _env_int("GEMINI_LIVE_HISTORY_TRIGGER_TOKENS", DEFAULT_TRIGGER)
    target = max(MIN_TARGET, _env_int("GEMINI_LIVE_HISTORY_TARGET_TOKENS", DEFAULT_TARGET))
    return max(trigger, target + 500), target


def estimate_tokens(text: str) -> int:
    """A rough token count for text we are about to send. Indian scripts take more tokens per character than English."""
    if not text:
        return 0
    non_ascii = sum(1 for c in text if ord(c) > 127)
    per_token = 2.0 if non_ascii > len(text) * 0.3 else 3.6
    return int(len(text) / per_token) + 1


def compression_limits(instruction_tokens: int) -> tuple[int, int]:
    """(trigger_tokens, target_tokens) for the whole context: the instructions stay, only the history is trimmed."""
    trigger, target = history_budget()
    return instruction_tokens + trigger, instruction_tokens + target


def by_modality(details) -> dict[str, int]:
    """Google's per-type token list -> {"AUDIO": n, "TEXT": n, ...}."""
    out: dict[str, int] = {}
    for d in details or []:
        m = getattr(d, "modality", None)
        name = getattr(m, "value", m) or "UNSPECIFIED"
        out[str(name)] = out.get(str(name), 0) + int(getattr(d, "token_count", 0) or 0)
    return out


def split_usage(usage) -> dict:
    """What one turn cost, split into audio and text so the price is exact. Empty when Google gave no breakdown (the blended rate is used then).

    Pictures and video are priced close to text, so they are counted with it. Thinking tokens are text output.
    """
    p = by_modality(getattr(usage, "prompt_tokens_details", None))
    tool = by_modality(getattr(usage, "tool_use_prompt_tokens_details", None))
    r = by_modality(getattr(usage, "response_tokens_details", None))
    if not p and not r:
        return {}
    audio_in = p.get("AUDIO", 0) + tool.get("AUDIO", 0)
    text_in = sum(p.values()) + sum(tool.values()) - audio_in
    audio_out = r.get("AUDIO", 0)
    text_out = sum(r.values()) - audio_out + int(getattr(usage, "thoughts_token_count", 0) or 0)
    return {"audio_input_tokens": audio_in, "text_input_tokens": text_in, "audio_output_tokens": audio_out, "text_output_tokens": text_out}
