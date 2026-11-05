"""Voice catalogue: normalised voices from the configured TTS providers.

Adapters turn a provider's raw voice list into ``Voice`` records. Only facts the
provider data actually contains are filled in (name, language, style); gender,
age and accent stay ``None`` until curated metadata exists. Never guess them.

To plug in another provider (including your own TTS) add a class with a
``list()`` method to ``ADAPTERS``.
"""

import hashlib
import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

# Provider names are aliased so customers never see the real vendor.
PROVIDER_ALIASES = {"sarvam": "Engine A", "inworld": "Studio", "google": "Gemini"}

LANGUAGE_NAMES = {
    "hi": "Hindi", "en": "English", "bn": "Bengali", "gu": "Gujarati", "kn": "Kannada",
    "ml": "Malayalam", "mr": "Marathi", "od": "Odia", "pa": "Punjabi", "ta": "Tamil",
    "te": "Telugu", "enhi": "English + Hindi",
}


@dataclass(frozen=True)
class Voice:
    id: str
    name: str
    language: str
    style: str | None
    provider: str  # customer-facing alias
    gender: str | None = None
    age: str | None = None
    accent: str | None = None
    # Platform-side routing data: never serialised to customers.
    tts: dict = field(default_factory=dict, compare=False, repr=False)


    @property
    def engine(self) -> str:
        """Which kind of voice this is: 'inworld', 'google' or (older) 'sarvam'."""
        return self.tts.get("engine") or self.tts.get("provider") or ""


class VoiceAdapter(Protocol):
    def list(self) -> list[Voice]: ...


def voice_id(provider: str, model: str, raw: str) -> str:
    return "vc_" + hashlib.sha256(f"{provider}:{model}:{raw}".encode()).hexdigest()[:12]


class SarvamAdapter:
    """bulbul:v4-flash personas. Ids look like ``name_lang_style`` (e.g. ``aayan_hi_conversational``)."""

    provider = "sarvam"
    model = "bulbul:v4-flash"

    def list(self) -> list[Voice]:
        from api.services.configuration.options.sarvam import (
            SARVAM_V4_FLASH_LANGUAGES,
            SARVAM_V4_FLASH_VOICES,
        )

        out = []
        for raw in SARVAM_V4_FLASH_VOICES:
            name, _, rest = raw.partition("_")
            code, _, style = rest.partition("_")
            tts = {"provider": self.provider, "model": self.model, "voice": raw}
            # Only single-language personas get a language code; mixed ones keep the profile's.
            if f"{code}-IN" in SARVAM_V4_FLASH_LANGUAGES:
                tts["language"] = f"{code}-IN"
            out.append(
                Voice(
                    id=voice_id(self.provider, self.model, raw),
                    name=name.capitalize(),
                    language=LANGUAGE_NAMES.get(code, code or "Unknown"),
                    style=style.replace("_", " ").capitalize() or None,
                    provider=PROVIDER_ALIASES[self.provider],
                    tts=tts,
                )
            )
        return out


REGIONS = {
    "US": "US", "GB": "UK", "AU": "Australia", "IN": "India", "SG": "Singapore", "PH": "Philippines", "NG": "Nigeria",
    "MX": "Mexico", "ES": "Spain", "AR": "Argentina", "BR": "Brazil", "PT": "Portugal", "DE": "Germany", "FR": "France",
}
BASE_LANGUAGES = {
    "en": "English", "hi": "Hindi", "es": "Spanish", "pt": "Portuguese", "de": "German", "fr": "French", "ru": "Russian",
    "sv": "Swedish", "zh": "Chinese", "ja": "Japanese", "nl": "Dutch", "it": "Italian", "ko": "Korean", "ar": "Arabic",
    "he": "Hebrew", "pl": "Polish",
}
AGES = {"young": "Young", "middle_aged": "Middle-aged", "elderly": "Older"}


def language_name(code: str) -> str:
    """'en-IN' -> 'English (India)'. Only wording from the provider's own language code."""
    base, _, region = (code or "").partition("-")
    name = BASE_LANGUAGES.get(base.lower(), base.upper() or "Unknown")
    return f"{name} ({REGIONS.get(region.upper(), region)})" if region and region.upper() in REGIONS else name


class InworldAdapter:
    """Real voices from the voice provider's own catalogue (data/inworld_voices.json, fetched once). Used with the 'inworld' profile."""

    def list(self) -> list[Voice]:
        rows = json.loads((Path(__file__).parent / "data" / "inworld_voices.json").read_text(encoding="utf-8"))
        if os.getenv("PRODUCT_VOICES_INDIAN_ONLY", "1") != "0":  # Indian-language voices only (set to 0 to list every language)
            rows = [r for r in rows if str(r["lang"]).upper().endswith("-IN")]
        return [
            Voice(
                id=voice_id("inworld", "tts-2", r["id"]), name=r["name"], language=language_name(r["lang"]),
                style=", ".join(t.capitalize() for t in r["tags"][:3]) or None, provider=PROVIDER_ALIASES["inworld"],
                gender=(r["gender"] or "").capitalize() or None, age=AGES.get(r["age"] or ""), accent=None,
                tts={"engine": "inworld", "voice": r["id"], "description": r["desc"], "lang": r["lang"]},
            )
            for r in rows
        ]


# Google's own one-word style notes for the 30 Gemini voices. Gender is not published, so it stays empty.
GOOGLE_VOICES = {
    "Zephyr": "Bright", "Puck": "Upbeat", "Charon": "Informative", "Kore": "Firm", "Fenrir": "Excitable", "Leda": "Youthful",
    "Orus": "Firm", "Aoede": "Breezy", "Callirrhoe": "Easy-going", "Autonoe": "Bright", "Enceladus": "Breathy", "Iapetus": "Clear",
    "Umbriel": "Easy-going", "Algieba": "Smooth", "Despina": "Smooth", "Erinome": "Clear", "Algenib": "Gravelly",
    "Rasalgethi": "Informative", "Laomedeia": "Upbeat", "Achernar": "Soft", "Alnilam": "Firm", "Schedar": "Even",
    "Gacrux": "Mature", "Pulcherrima": "Forward", "Achird": "Friendly", "Zubenelgenubi": "Casual", "Vindemiatrix": "Gentle",
    "Sadachbia": "Lively", "Sadaltager": "Knowledgeable", "Sulafat": "Warm",
}


class GoogleAdapter:
    """Gemini voices, used with the 'google' profile. They speak many languages, so language is 'Multilingual'."""

    def list(self) -> list[Voice]:
        return [
            Voice(id=voice_id("google", "live", n), name=n, language="Multilingual", style=style, provider=PROVIDER_ALIASES["google"],
                  tts={"engine": "google", "voice": n})
            for n, style in GOOGLE_VOICES.items()
        ]


ENGINES = {"inworld": InworldAdapter, "google": GoogleAdapter, "sarvam": SarvamAdapter}


def _adapters() -> list[VoiceAdapter]:
    names = [n.strip() for n in os.getenv("PRODUCT_VOICE_ENGINES", "inworld,google").split(",") if n.strip() in ENGINES]
    return [ENGINES[n]() for n in names]


def catalogue() -> list[Voice]:
    seen: dict[str, Voice] = {}
    for a in _adapters():
        for v in a.list():
            seen[v.id] = v
    first = {"Hindi": 0, "English (India)": 1, "English (US)": 2}  # the languages most customers want, ahead of the alphabet
    return sorted(seen.values(), key=lambda v: (first.get(v.language, 9), v.language, v.name))


def google_access() -> list[str]:
    """Who may use the Google voices: full email addresses, or '@domain.com' for everyone at a company. Set PRODUCT_GOOGLE_VOICE_ACCESS (comma separated)."""
    raw = os.getenv("PRODUCT_GOOGLE_VOICE_ACCESS")
    raw = "thewalkingjumbo@gmail.com,@twjlabs.com" if raw is None else raw
    return [p.strip().lower() for p in raw.split(",") if p.strip()]


def can_use(v: Voice, email: str | None) -> bool:
    """Google voices are limited to a few accounts for now; every other voice is open to everyone."""
    if v.engine != "google":
        return True
    e = (email or "").strip().lower()
    return bool(e) and any(e == p or (p.startswith("@") and e.endswith(p)) for p in google_access())


def find(voice_id_: str) -> Voice | None:
    return next((v for v in catalogue() if v.id == voice_id_), None)
