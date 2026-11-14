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
PROVIDER_ALIASES = {"sarvam": "Engine A", "inworld": "Studio", "google": "Gemini", "swarvo": "Swarvo", "murf": "Falcon"}

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


# swarvo-tts 2.5 built-in voices (names are case sensitive). Hindi is the language it was tested in.
SWARVO_FEMALE = ("Ahana", "Vaidehi", "Malini", "Charvi", "Jahnavi", "Nivedita", "Ishwari", "Vrinda", "Kayal", "Tanushree")
SWARVO_MALE = ("Anirban", "Nakul", "Vasant", "Siddhant", "Satvik", "Abhay", "Ritvik", "Sreekar", "Shaunak", "Akshat")


class SwarvoAdapter:
    """Our own speech model. It only speaks (no thinking), so these voices run the normal listen > think > speak pipeline."""

    def list(self) -> list[Voice]:
        out = []
        for gender, names in (("Female", SWARVO_FEMALE), ("Male", SWARVO_MALE)):
            for n in names:
                out.append(Voice(id=voice_id("swarvo", "tts-2.5", n), name=n, language="Hindi", style="swarvo-tts 2.5", provider=PROVIDER_ALIASES["swarvo"], gender=gender,
                                 tts={"engine": "swarvo", "voice": n, "lang": "hi"}))
        return out


class MurfAdapter:
    """Murf Falcon 2.1 voices for Indian languages. Like the Swarvo voices they only speak, so they run the listen > think > speak pipeline.

    Each voice is listed once under its main language and can speak the others it supports (shown in its description). Gender comes only from
    Murf's own list (set MURF_API_KEY to fill it in); it is never guessed from the name.
    """

    def list(self) -> list[Voice]:
        from api.services.configuration.options.murf import MURF_GENDER, MURF_INDIAN_VOICES, MURF_LOCALE_LANGUAGE

        genders = murf_genders()
        out = []
        for name, locales in MURF_INDIAN_VOICES.items():
            langs = [MURF_LOCALE_LANGUAGE[l] for l in locales if l in MURF_LOCALE_LANGUAGE]
            speaks = ("Speaks " + ", ".join(langs[:-1]) + (" and " if len(langs) > 1 else "") + langs[-1] + ".") if langs else ""
            desc = f"Natural, conversational voice for phone calls. {speaks}".strip()
            out.append(Voice(id=voice_id("murf", "falcon-2.1", name), name=name, language=langs[0] if langs else "Hindi", style="Falcon 2.1", provider=PROVIDER_ALIASES["murf"],
                             gender=genders.get(name) or MURF_GENDER.get(name), tts={"engine": "murf", "voice": name, "locales": list(locales), "description": desc}))
        return out


_MURF_GENDERS: dict = {"at": 0.0, "map": {}}


def murf_genders() -> dict[str, str]:
    """{voice name: Female/Male} from Murf's own voice list. Only when MURF_API_KEY is set; cached for a day; empty on any problem."""
    import time

    key = os.getenv("MURF_API_KEY", "").strip()
    if not key:
        return {}
    if time.time() - _MURF_GENDERS["at"] < 86400:
        return _MURF_GENDERS["map"]
    _MURF_GENDERS["at"] = time.time()  # also after a failure, so a broken call is not retried on every request
    try:
        import httpx

        r = httpx.get("https://api.murf.ai/v1/speech/voices", params={"model": "falcon-2.1"}, headers={"api-key": key}, timeout=6)
        r.raise_for_status()
        _MURF_GENDERS["map"] = {v["voiceId"]: v["gender"] for v in r.json() if v.get("gender") in ("Male", "Female")}
    except Exception:  # noqa: BLE001 - this only adds a nicety to the voice cards
        _MURF_GENDERS["map"] = {}
    return _MURF_GENDERS["map"]


ENGINES = {"inworld": InworldAdapter, "google": GoogleAdapter, "swarvo": SwarvoAdapter, "murf": MurfAdapter, "sarvam": SarvamAdapter}


def _adapters() -> list[VoiceAdapter]:
    names = [n.strip() for n in os.getenv("PRODUCT_VOICE_ENGINES", "inworld,google,swarvo,murf").split(",") if n.strip() in ENGINES]
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
