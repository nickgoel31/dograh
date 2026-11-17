"""Writes a complete, human-sounding phone agent from a plain description: who it is, what it knows, its opening line, a detailed call script,
the answers to the questions callers really ask, the words the speech engine must hear correctly, and the voice settings that suit the job.

It runs on the platform's own AI key. The model is told everything an agent can be configured with (see ``SETTINGS_GUIDE``) so it chooses them on purpose instead of
leaving defaults, and every value it returns is checked here before it is used.
"""

from __future__ import annotations

import json
import logging
import re

from fastapi import HTTPException

from api.product import prompt as prompts
from api.product import style as style_mod
from api.product.templates import BY_KEY

log = logging.getLogger(__name__)

HINGLISH = ["Hindi", "English"]  # the default: Hindi and English mixed, the way people actually talk
BRAINS = ("fast", "balanced", "smartest")
STYLE_KEYS = ("pace", "patience", "turns", "steadiness", "steering", "fillers", "backchannel", "interruptions", "voicemail_detect", "max_minutes", "silence_seconds")

# Everything the writer may set, in plain words, so its choices fit the job.
SETTINGS_GUIDE = """Settings you choose (put them in "style"; leave out any you do not need):
- pace: speaking speed, 0.9 to 1.2. Calm service jobs about 1.0. Fast sales or reminder calls 1.1. Older or worried callers 0.95.
- patience: "quick" (answers fast, good for sales and bookings), "balanced", or "patient" (waits longer, good for older callers, health and support).
- turns: "smart" understands when a sentence is finished (best for most jobs), "fast" reacts to silence (short transactional calls).
- steadiness: "steady" (consistent, serious jobs), "balanced", "expressive" (warm, lively jobs like salons, restaurants, sales).
- steering: "off", "low", "medium", "high": how much the voice acts out the moment. Use "medium" for friendly jobs, "low" for serious ones.
- fillers: true lets it say natural "hmm" and "achha" sounds. True for almost every job.
- backchannel: true lets it say "haan", "ji", "okay" while the caller talks. True for service and sales, false for formal collections.
- interruptions: true lets the caller cut in (almost always true).
- voicemail_detect: true hangs up on answering machines. True for outbound jobs (reminders, sales, surveys), false for inbound.
- max_minutes: longest call, 3 to 30. Bookings 6, support 12, sales and qualification 10.
- silence_seconds: how long to wait in silence before checking the caller is there, 6 to 20. Patient callers 14, quick jobs 8.
Also choose "brain": "fast" (simple, quick jobs), "balanced" (most jobs), or "smartest" (hard conversations: complaints, negotiation, many rules)."""

SYSTEM = """You design phone agents for businesses in India. From the owner's notes and what is known about the business, write the agent's complete setup as JSON. Your agents must sound like a real, warm, competent person who works at THIS business, never like a generic assistant.

Return ONLY a JSON object with these keys:
- "name": a short first name that fits the voice's gender and the business (for example Priya, Ananya, Meera, Kavya, Neha for a female voice; Rohan, Arjun, Karan, Aman, Vikram for a male voice). One word. Never "Assistant", "Bot" or "AI".
- "emoji": exactly one of 📞 📅 🎯 🛟 🛍️ 📋 💬 🎙️ 🤖 💡 ⚖️ 🧠 🦷 💇 🍽️ 🏠 🎓 🏨 that fits best.
- "role": what the agent does on calls, a short phrase starting with a verb, under 110 characters.
- "tone": "Friendly", "Professional" or "Playful".
- "business": the real business name, under 60 characters.
- "what_you_do": the facts the agent can rely on, taken ONLY from the notes: what the business offers (services or products by name), hours, address and area, phone, prices ONLY if given, policies, offers, how to reach the owner, anything a caller might ask. Plain sentences, most useful first. Never invent anything; leave a fact out rather than guess. Under 1800 characters.
- "greeting": the very first thing the agent says when the call connects. One or two short sentences in the call language style described below, warm and natural, with the business name, ending with a simple open question. No corporate phrases like "How may I assist you today". Under 170 characters.
- "script": the agent's playbook. Write it as numbered sections, 3500 to 6500 characters in total, and make every part specific to this business and job:
  1. WHO YOU ARE: two lines. Your name, your role, and your manner (for example "warm and patient, like a trusted front-desk person who knows every regular").
  2. HOW YOU SOUND: concrete habits with real example words in the call language: short sentences, a quick acknowledgement before every answer (vary them: "जी बिल्कुल", "ठीक है", "अच्छा", "Got it", "Sure"), a soft filler now and then ("हम्म", "एक सेकंड"), never reading lists, one question at a time, using the caller's name once you know it.
  3. THE CALL, STEP BY STEP: 10 to 14 steps for this exact job. For the key moments (the opening, finding out the need, collecting details, confirming, closing) give an example line in quotes, in the call language style.
  4. WHAT YOU COLLECT: each detail (name, phone, the one or two things this job needs), how to ask for it naturally, and how to read it back (phone numbers in groups of two or three digits, dates and times the way people say them aloud).
  5. HANDLING SITUATIONS: one or two lines each, with an example reply, for: asking the price, "I will think about it" or "call later", not interested, angry or worried caller, asks for a person, wrong number, cannot hear you, asks "are you a robot or a real person", asks something you do not know, wants to change or cancel, speaks a different language.
  6. BOUNDARIES: what you never do or promise (no invented prices or availability, no medical, legal or financial advice, no pressure), and exactly when to pass the call to a person.
  7. CLOSING: how to end warmly, repeating the one thing that will happen next.
- "qa": 6 to 12 objects {"q": ..., "a": ...}: the questions callers really ask this kind of business, with short spoken answers taken ONLY from the notes. Skip a question rather than invent an answer. Write q and a in the call language style.
- "vocabulary": a comma-separated list (under 280 characters) of the business-specific words the speech recogniser must hear correctly: business name, brand names, service and product names, area and landmark names, staff names. No generic words.
- "brain": "fast", "balanced" or "smartest".
- "style": an object of voice settings.

""" + SETTINGS_GUIDE + """

LANGUAGE: write the greeting, the example lines in the script and the qa in the language style given in the brief. Write the section titles and instructions to the agent in English so they are clear. Never invent facts. Never use emoji inside spoken lines."""


def _clip(v, n: int) -> str:
    return str(v or "").strip()[:n]


def _parse(raw: str) -> dict:
    raw = (raw or "").strip()
    raw = re.sub(r"^```(?:json)?|```$", "", raw, flags=re.MULTILINE).strip()
    try:
        data = json.loads(raw)
    except ValueError:
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if not m:
            raise
        data = json.loads(m.group(0))
    if not isinstance(data, dict):
        raise ValueError("not an object")
    return data


def is_hinglish(langs: list[str] | None) -> bool:
    return [n for n in (langs or []) if n in style_mod.LANGUAGES][:2] == HINGLISH


def language_brief(langs: list[str] | None) -> str:
    """How the agent talks, in words the writer can follow."""
    names = [n for n in (langs or []) if n in style_mod.LANGUAGES] or HINGLISH
    if is_hinglish(names):
        return (
            "Hinglish: the natural way educated urban Indians talk on the phone. Hindi sentence structure with everyday English words mixed in "
            "(appointment, booking, time, price, confirm, details, offer, call back, slot, delivery). Write Hindi words in Devanagari and English words in Latin letters, "
            "for example: \"आपका appointment कल शाम 5 बजे का है. मैं confirm कर दूँ?\" Never write Hindi in English letters. Keep it simple and warm, not formal textbook Hindi."
        )
    if names == ["English"]:
        return "Indian English: clear, friendly, short sentences, the way a polite Indian professional speaks. Light, natural phrases like \"sure\", \"no problem\", \"one second\"."
    first = names[0]
    rest = f" and {names[1]}" if len(names) > 1 else ""
    return (f"{first}{rest}: natural, spoken, everyday {first} the way people really talk on the phone, with English words only where Indians normally use them (appointment, booking, price). "
            f"Write {first} in its own script and English words in Latin letters.")


def default_greeting(business: str, langs: list[str] | None, gender: str | None = None) -> str:
    """A friendly opening line in the agent's language, for when the AI is not available."""
    b = (business or "").strip() or "us"
    names = [n for n in (langs or []) if n in style_mod.LANGUAGES] or HINGLISH
    if is_hinglish(names) or names[0] == "Hindi":
        g = (gender or "").lower()
        ask = "बताइए, मैं आपकी क्या help कर सकती हूँ?" if g == "female" else "बताइए, मैं आपकी क्या help कर सकता हूँ?" if g == "male" else "बताइए, आपकी क्या help की जा सकती है?"
        return f"नमस्ते! {b} में आपका स्वागत है। {ask}"
    return prompts.compile_greeting(business=b)


def _style(raw) -> dict:
    """Keep each valid voice setting the model chose; drop the rest one by one, so a single bad value never loses the others."""
    out: dict = {}
    if not isinstance(raw, dict):
        return out
    for k in STYLE_KEYS:
        if k not in raw:
            continue
        try:
            out.update(style_mod.clean({k: raw[k]}))
        except ValueError:
            continue
    return out


def _qa(raw) -> list[dict]:
    pairs = []
    for x in raw if isinstance(raw, list) else []:
        if not isinstance(x, dict):
            continue
        q, a = _clip(x.get("q"), 300), _clip(x.get("a"), 1200)
        if q and a:
            pairs.append({"q": q, "a": a})
    return pairs[:12]


def _draft(data: dict, fallback: dict) -> dict:
    tone = data.get("tone") if data.get("tone") in prompts.TONES else fallback["tone"]
    name = _clip(data.get("name"), 40).split(" ")[0] or fallback["name"]
    return {
        "name": name,
        "emoji": _clip(data.get("emoji"), 8) or fallback["emoji"],
        "role": _clip(data.get("role"), 120) or fallback["role"],
        "tone": tone,
        "business": _clip(data.get("business"), 60) or fallback["business"],
        "what_you_do": _clip(data.get("what_you_do"), 1900) or fallback["what_you_do"],
        "script": _clip(data.get("script"), 7500) or fallback["script"],
        "greeting": _clip(data.get("greeting"), 300) or fallback["greeting"],
        "qa": _qa(data.get("qa")) or fallback["qa"],
        "vocabulary": _clip(data.get("vocabulary"), 300) or fallback["vocabulary"],
        "brain": data.get("brain") if data.get("brain") in BRAINS else fallback["brain"],
        "style": {**fallback["style"], **_style(data.get("style"))},
    }


def fallback_draft(usecase: str, description: str, langs: list[str] | None = None, gender: str | None = None) -> dict:
    """What the agent looks like when the AI is not available: the closest template, with the owner's own words and a greeting in the right language."""
    t = BY_KEY.get(usecase) or BY_KEY["receptionist"]
    desc = description.strip()
    business = (desc.split(".")[0][:60].strip() if desc else t.business) or t.business
    return {
        "name": t.name.split(" ")[0],
        "emoji": t.emoji,
        "role": t.role,
        "tone": t.tone,
        "business": business,
        "what_you_do": desc or t.what_you_do,
        "script": t.script,
        "greeting": default_greeting(business, langs, gender),
        "qa": [],
        "vocabulary": "",
        "brain": "balanced",
        "style": {"fillers": True, "backchannel": True, "interruptions": True, "patience": "balanced"},
    }


async def write_agent(llm, org_id: int, user_id: int, *, usecase: str, description: str, industry: str = "", language: str = "", languages: list[str] | None = None,
                      voice_gender: str | None = None, voice_name: str | None = None) -> tuple[dict, bool]:
    """Returns (draft, generated). ``generated`` is False when the AI could not be reached and the template was used instead.
    ``languages`` (up to two names; Hindi plus English means Hinglish) and the chosen voice's gender shape the whole agent."""
    langs = [n for n in (languages or ([language] if language else [])) if n in style_mod.LANGUAGES] or HINGLISH
    t = BY_KEY.get(usecase)
    fb = fallback_draft(usecase, description, langs, voice_gender)
    brief = [f"What the agent should do: {usecase if not t else t.role}"]
    if industry:
        brief.append(f"Industry: {industry}")
    brief.append(f"Call language style: {language_brief(langs)}")
    if voice_gender or voice_name:
        g = (voice_gender or "").lower()
        verbs = {"female": "Use feminine forms for yourself in Hindi (for example \"कर सकती हूँ\").", "male": "Use masculine forms for yourself in Hindi (for example \"कर सकता हूँ\")."}.get(g, "Avoid gendered verb forms about yourself.")
        brief.append(f"The agent's voice: {voice_name or 'a voice'}{f' ({g})' if g else ''}. Pick a first name that matches. {verbs}")
    brief.append(f"Owner's notes about the business and what they want:\n{description.strip() or '(none given)'}")
    if t:
        brief.append(f"A bare starting point. Go far deeper and make it specific to this business; keep only what is good:\n{t.script}")
    try:
        raw = await llm.complete(org_id, user_id, SYSTEM, [{"role": "user", "content": "\n\n".join(brief)}], platform=True, reasoning="medium")
        return _draft(_parse(raw), fb), True
    except HTTPException:
        return fb, False
    except Exception as e:  # noqa: BLE001 - a draft is a convenience: any failure falls back to the template
        log.warning("agent draft failed: %s", e)
        return fb, False
