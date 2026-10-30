"""Deterministic prompt compiler for "simple" agents.

Pure and versioned: the same inputs always give the same text. Bump
PROMPT_VERSION when the wording changes so stored agents can be re-compiled
on purpose rather than by accident.
"""

PROMPT_VERSION = 1

TONES = {
    "Friendly": "Be warm, upbeat and conversational. Use the caller's name once you know it.",
    "Professional": "Be polite, calm and precise. Keep a courteous, businesslike tone.",
    "Playful": "Be light-hearted and cheerful, with the occasional gentle joke, but never at the caller's expense.",
}
DEFAULT_TONE = "Friendly"


def compile_prompt(*, business: str, what_you_do: str, role: str, tone: str) -> str:
    business = business.strip() or "the business"
    tone_line = TONES.get(tone, TONES[DEFAULT_TONE])
    about = what_you_do.strip()
    lines = [
        f"You are a phone assistant for {business}. Your job: {role.strip() or 'help callers'}.",
    ]
    if about:
        lines += ["", f"About the business: {about}"]
    lines += [
        "",
        f"Style: {tone_line}",
        "",
        "Rules:",
        "- You are on a phone call: keep every reply to one or two short sentences.",
        "- Ask one question at a time and wait for the answer.",
        "- Never invent prices, availability or policies. If you are not sure, say so and offer to connect a person.",
        "- Confirm important details (names, numbers, dates) by repeating them back.",
    ]
    return "\n".join(lines)


def compile_greeting(*, business: str) -> str:
    return f"Hello, thanks for calling {business.strip() or 'us'}! How can I help you today?"
