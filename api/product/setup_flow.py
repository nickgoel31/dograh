"""The guided setup: learn about a business, suggest what to build, and choose the voice, tools and knowledge for it.

Everything here only reads and suggests. Creating things is done by the person's own browser session through the normal endpoints (so roles, limits and
confirmations apply as if they had clicked each button).
"""

from __future__ import annotations

import json
import logging
import re

from fastapi import HTTPException

from api.product import models_config, voices
from api.product.site_reader import Page
from api.product.style import LANGUAGES, MAX_LANGUAGES
from api.product.templates import BY_KEY, INDUSTRIES, TEMPLATES

log = logging.getLogger(__name__)

# What to suggest, most useful first, when nothing better is known.
DEFAULT_ORDER = ("receptionist", "appointments", "leads", "support", "orders", "survey", "reminders")

# Which services an agent for this job usually needs. The person connects them (they need the person's own accounts).
TOOLS_FOR = {
    "calendar": ("google_calendar", "calendly"),
    "crm": ("hubspot", "zoho", "google_sheets"),
    "shop": ("shopify", "razorpay_links", "whatsapp"),
    "pay": ("razorpay_links", "whatsapp"),
    "team": ("slack", "hubspot"),
    "sheet": ("google_sheets", "whatsapp"),
}
JOB_TOOLS = {
    "appointments": "calendar", "clinic": "calendar", "dental": "calendar", "diagnostics": "calendar", "salon": "calendar", "fitness": "calendar", "restaurant": "calendar",
    "hotel": "calendar", "homeservices": "calendar", "cleaning": "calendar", "carservice": "calendar", "legal": "calendar", "accounting": "calendar", "receptionist": "calendar",
    "leads": "crm", "realestate": "crm", "rentals": "crm", "coaching": "crm", "school": "crm", "cardealer": "crm", "loans": "crm", "insurance": "crm", "travel": "crm", "catering": "crm",
    "orders": "shop", "orderstatus": "shop", "storehelp": "shop", "pharmacy": "shop",
    "reminders": "pay", "support": "team", "survey": "sheet",
}
TOOL_WHY = {
    "google_calendar": "books appointments straight into your calendar", "calendly": "books into your Calendly event", "hubspot": "adds every caller to your CRM",
    "zoho": "adds every caller as a lead", "google_sheets": "adds a row for every call", "shopify": "lets the agent look up orders", "razorpay_links": "texts a payment link during the call",
    "whatsapp": "sends each caller a WhatsApp message after the call", "slack": "posts a summary of every call to your team",
}

SYSTEM = """You read the text of a business's website and write a short profile of the business for a phone agent.

Return ONLY a JSON object with these keys:
- "business": the business name.
- "summary": two or three plain sentences on what the business does and who it serves. Only what the text says.
- "industry": exactly one of: {industries}.
- "services": up to 8 short names of what it sells or offers.
- "hours": opening hours as written, or null.
- "location": address or area, or null.
- "phone": a phone number shown, or null.
- "email": an email shown, or null.
- "languages": up to 2 of: {languages}. The languages callers probably speak, judging by the site and where the business is.
- "faqs": up to 8 objects {{"q": question a caller would ask, "a": the answer from the text}}. Only answers the text actually gives. Never invent prices, hours or policies.
- "suggested": up to 4 objects {{"key": one of {keys}, "why": one short sentence on why this agent would help this business}}.

Use only facts in the text. If something is not there, use null or leave it out."""


def _clip(v, n: int) -> str:
    return re.sub(r"\s+", " ", str(v or "")).strip()[:n]


def _opt(v, n: int) -> str | None:
    s = _clip(v, n)
    return s if s and s.lower() not in ("null", "none", "n/a", "unknown") else None


def clean_profile(data: dict, fallback: dict | None = None) -> dict:
    """Keep only valid values from the model's answer."""
    fb = fallback or {}
    langs = [x for x in (data.get("languages") or []) if isinstance(x, str) and x in LANGUAGES][:MAX_LANGUAGES] or fb.get("languages") or ["English"]
    faqs = []
    for f in (data.get("faqs") or [])[:8]:
        if isinstance(f, dict) and _clip(f.get("q"), 200) and _clip(f.get("a"), 600):
            faqs.append({"q": _clip(f["q"], 200), "a": _clip(f["a"], 600)})
    suggested = []
    for s in (data.get("suggested") or [])[:4]:
        if isinstance(s, dict) and s.get("key") in BY_KEY and all(x["key"] != s["key"] for x in suggested):
            suggested.append({"key": s["key"], "why": _clip(s.get("why"), 160) or BY_KEY[s["key"]].blurb})
    industry = data.get("industry") if data.get("industry") in INDUSTRIES else fb.get("industry", "General")
    return {
        "business": _clip(data.get("business"), 80) or fb.get("business", ""),
        "summary": _clip(data.get("summary"), 600) or fb.get("summary", ""),
        "industry": industry,
        "services": [_clip(x, 80) for x in (data.get("services") or [])[:8] if _clip(x, 80)],
        "hours": _opt(data.get("hours"), 200), "location": _opt(data.get("location"), 200), "phone": _opt(data.get("phone"), 40), "email": _opt(data.get("email"), 120),
        "languages": langs, "faqs": faqs, "suggested": suggested or fb.get("suggested", []),
    }


def default_suggestions(industry: str = "General", skip: set[str] | None = None, n: int = 4) -> list[dict]:
    """Agents to suggest from the industry, then the usual ones."""
    skip = skip or set()
    own = [t.key for t in TEMPLATES if t.industry == industry and industry != "General"]
    out = []
    for k in [*own, *DEFAULT_ORDER]:
        if k in BY_KEY and k not in skip and all(x["key"] != k for x in out):
            out.append({"key": k, "why": BY_KEY[k].blurb})
    return out[:n]


def heuristic_profile(pages: list[Page]) -> dict:
    """What can be said without the AI: the site's own title and description."""
    home = pages[0]
    name = re.split(r"\s[|\-–—:]\s", home.title)[0].strip() if home.title else ""
    text = " ".join(p.text for p in pages)
    dev = sum(1 for c in text if "ऀ" <= c <= "ॿ")
    langs = ["Hindi", "English"] if dev > len(text) * 0.15 else ["English"]
    return {"business": name[:80], "summary": _clip(home.description or home.text, 500), "industry": "General", "services": [], "hours": None, "location": None,
            "phone": None, "email": None, "languages": langs, "faqs": [], "suggested": default_suggestions()}


def _pages_text(pages: list[Page]) -> str:
    return "\n\n".join(f"## {p.title or p.url}\n{p.description}\n{p.text}".strip() for p in pages)


async def build_profile(llm, org_id: int, user_id: int, pages: list[Page], notes: str = "") -> tuple[dict, bool]:
    """(profile, written_by_ai). Falls back to the page title and description when the AI is not available."""
    fb = heuristic_profile(pages) if pages else {"business": "", "summary": _clip(notes, 500), "industry": "General", "languages": ["English"], "suggested": default_suggestions()}
    source = _pages_text(pages) if pages else f"(no website) The owner says:\n{notes}"
    system = SYSTEM.format(industries=", ".join(INDUSTRIES), languages=", ".join(LANGUAGES), keys=", ".join(BY_KEY))
    try:
        raw = await llm.complete(org_id, user_id, system, [{"role": "user", "content": source[:24000]}], platform=True)
        raw = re.sub(r"^```(?:json)?|```$", "", (raw or "").strip(), flags=re.MULTILINE).strip()
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        data = json.loads(m.group(0) if m else raw)
        if not isinstance(data, dict):
            raise ValueError("not an object")
        return clean_profile(data, fb), True
    except HTTPException:
        return clean_profile({}, fb), False
    except Exception as e:  # noqa: BLE001 - a profile is a convenience: any failure falls back to the page text
        log.warning("business profile failed: %s", e)
        return clean_profile({}, fb), False


def profile_text(p: dict, website: str | None = None) -> str:
    """The profile as a note the agent can look things up in."""
    lines = [f"Business: {p.get('business') or 'This business'}"]
    if website:
        lines.append(f"Website: {website}")
    if p.get("summary"):
        lines += ["", p["summary"]]
    if p.get("services"):
        lines += ["", "What we offer:"] + [f"- {s}" for s in p["services"]]
    for label, k in (("Opening hours", "hours"), ("Where", "location"), ("Phone", "phone"), ("Email", "email")):
        if p.get(k):
            lines.append(f"{label}: {p[k]}")
    if p.get("faqs"):
        lines += ["", "Questions callers ask:"] + [f"Q: {f['q']}\nA: {f['a']}" for f in p["faqs"]]
    return "\n".join(lines)


# Words in an agent's job that say it already does this kind of work.
COVER_WORDS = {
    "receptionist": ("answer calls", "take messages", "front desk", "receptionist"), "appointments": ("book", "appointment", "schedul", "reservation"),
    "leads": ("lead", "qualif", "sales"), "support": ("support", "solve problems", "troubleshoot"), "orders": ("take orders", "order"),
    "survey": ("survey", "feedback"), "reminders": ("remind", "pending payment", "collections"),
}


def covered(agents: list[dict]) -> set[str]:
    """Which kinds of agent the workspace already has, judged by what each agent's job says it does."""
    out = set()
    for a in agents:
        role = (a.get("role") or "").lower()
        for key, words in COVER_WORDS.items():
            if any(w in role for w in words):
                out.add(key)
        for t in TEMPLATES:
            words = {w for w in re.findall(r"[a-z]{5,}", t.role.lower())}
            if words and len(words & set(re.findall(r"[a-z]{5,}", role))) >= max(1, min(2, len(words))):
                out.add(t.key)
    return out


def recommended(agents: list[dict], industry: str = "General") -> list[dict]:
    done = covered(agents)
    return [{"key": s["key"], "title": BY_KEY[s["key"]].name, "why": s["why"]} for s in default_suggestions(industry, done)]


# ---------------- voice and tools ----------------
INDIAN = {n for n in LANGUAGES if n != "English"}


def _supports(v, language: str) -> bool:
    if v.engine == "murf":
        loc = models_config._LANG_LOCALE.get(language)
        return bool(loc and loc in v.tts.get("locales", ()))
    if v.engine == "swarvo":
        return language == "Hindi"
    if v.engine == "google":
        return True
    return v.language.lower().startswith(language.lower()) or (language == "English" and v.language.lower().startswith("english"))


def pick_voice(catalogue: list, usable, languages: list[str], limit: int = 3) -> dict | None:
    """The best available voice for the agent's main language, and a few others to choose from. ``usable(v)`` says whether this person can use it."""
    lang = (languages or ["Hindi"])[0]
    pool = [v for v in catalogue if usable(v) and _supports(v, lang)]
    if not pool:
        return None
    order = ("murf", "swarvo", "inworld", "google") if lang in INDIAN else ("inworld", "murf", "google", "swarvo")
    rank = {e: i for i, e in enumerate(order)}

    def key(v):
        main = 0 if (v.engine == "murf" and v.language.startswith(lang)) or v.engine != "murf" else 1
        return (rank.get(v.engine, 9), main, v.name)

    pool.sort(key=key)
    best = pool[0]
    why = {
        "murf": f"A Falcon voice that speaks {lang} and is built for fast phone conversations.",
        "swarvo": "A Swarvo voice, tuned for natural Hindi on calls.",
        "inworld": f"A natural {lang} voice with expressive delivery.",
        "google": "A Gemini voice that handles many languages in one call.",
    }.get(best.engine, "A voice that speaks the right language.")
    others = [v for v in pool[1:] if v.id != best.id][:limit]
    return {"id": best.id, "name": best.name, "language": best.language, "engine": best.engine, "reason": why, "alternatives": [{"id": v.id, "name": v.name, "language": v.language} for v in others]}


def tool_suggestions(usecase: str, connected: set[str]) -> list[dict]:
    group = JOB_TOOLS.get(usecase, "sheet")
    return [{"key": k, "why": TOOL_WHY.get(k, ""), "connected": k in connected} for k in TOOLS_FOR[group]]


async def usable_voices(session, email: str | None):
    """(catalogue, usable) for this person: voices whose engine is set up and that this account may use."""
    cat = voices.catalogue()
    ready = {e: await models_config.engine_ready(session, e) for e in {v.engine for v in cat}}
    return cat, lambda v: bool(ready.get(v.engine, True)) and voices.can_use(v, email)
