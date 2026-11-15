"""Writes a first draft of an agent (name, role, business facts and a call script) from a plain description, on the platform's own AI key."""

from __future__ import annotations

import json
import logging
import re

from fastapi import HTTPException

from api.product import prompt as prompts
from api.product.templates import BY_KEY

log = logging.getLogger(__name__)

SYSTEM = """You design phone agents for small businesses. From the owner's notes, write the agent's setup as JSON.

Return ONLY a JSON object with these keys:
- "name": a short, friendly first name for the agent that suits the business and the language callers speak (for example Asha, Kabir, Meera, Rohan, Anaya, Arjun for India; Sam, Maya, Alex elsewhere). One word. Never "Assistant" or "Bot".
- "emoji": exactly one of these, whichever fits the work best: 📞 📅 🎯 🛟 🛍️ 📋 💬 🎙️ 🤖 💡 ⚖️ 🧠.
- "role": what the agent does on calls, as a short phrase starting with a verb, under 110 characters.
- "tone": exactly one of "Friendly", "Professional", "Playful".
- "business": the business name if the owner gave one, otherwise a short generic label like "your clinic". Under 60 characters.
- "what_you_do": the real facts the agent can rely on, taken ONLY from the owner's notes: what the business does, its services or products by name, hours, location, phone, policies, prices and any common questions with their answers. Plain sentences, most useful first. Never invent prices, hours, addresses or names; leave a fact out rather than guess. Under 1500 characters.
- "script": the call flow as 6 to 10 numbered steps, each one or two short lines the agent can follow. Make it specific to THIS business: use its real name, its real services and the questions its customers actually ask, not generic filler. Give an example of what to say in quotes for the key moments (the opening line, asking what the caller needs, and the close) so the agent sounds like a person who works there. Cover: greeting and finding out what the caller needs, the main task of this agent, collecting and repeating back the key details (name, number, and the one or two things this job needs), what to do when it does not know something (never guess, offer a callback or a person), when to hand over to a human, and a warm close. Add one line for safety where it matters (emergencies, no medical or legal advice, no threats when collecting payments). Under 2800 characters.

Write for spoken phone calls, the way a friendly, competent person at this business would talk: short sentences, contractions, one question at a time, no corporate phrases. Write in English unless the owner's notes are in another language, in which case write in that language. No markdown other than the numbering."""


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
    }


def fallback_draft(usecase: str, description: str) -> dict:
    """What the agent looks like when the AI is not available: the closest template, with the owner's own words."""
    t = BY_KEY.get(usecase) or BY_KEY["receptionist"]
    desc = description.strip()
    return {
        "name": t.name.split(" ")[0],
        "emoji": t.emoji,
        "role": t.role,
        "tone": t.tone,
        "business": (desc.split(".")[0][:60].strip() if desc else t.business) or t.business,
        "what_you_do": desc or t.what_you_do,
        "script": t.script,
    }


async def write_agent(llm, org_id: int, user_id: int, *, usecase: str, description: str, industry: str = "", language: str = "") -> tuple[dict, bool]:
    """Returns (draft, generated). ``generated`` is False when the AI could not be reached and the template was used instead."""
    t = BY_KEY.get(usecase)
    fb = fallback_draft(usecase, description)
    brief = [f"What the agent should do: {usecase if not t else t.role}"]
    if industry:
        brief.append(f"Industry: {industry}")
    if language:
        brief.append(f"The agent mainly speaks: {language}")
    brief.append(f"Owner's notes about the business and what they want:\n{description.strip() or '(none given)'}")
    if t:
        brief.append(f"A starting point you may improve on, keep what is good:\n{t.script}")
    try:
        raw = await llm.complete(org_id, user_id, SYSTEM, [{"role": "user", "content": "\n\n".join(brief)}], platform=True)
        return _draft(_parse(raw), fb), True
    except HTTPException:
        return fb, False
    except Exception as e:  # noqa: BLE001 - a draft is a convenience: any failure falls back to the template
        log.warning("agent draft failed: %s", e)
        return fb, False
