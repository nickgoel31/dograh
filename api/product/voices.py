"""Voice catalogue: normalised voices from the configured TTS providers.

Adapters turn a provider's raw voice list into ``Voice`` records. Only facts the
provider data actually contains are filled in (name, language, style); gender,
age and accent stay ``None`` until curated metadata exists. Never guess them.

To plug in another provider (including your own TTS) add a class with a
``list()`` method to ``ADAPTERS``.
"""

import hashlib
from dataclasses import dataclass, field
from typing import Protocol

# Provider names are aliased so customers never see the real vendor.
PROVIDER_ALIASES = {"sarvam": "Engine A"}

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


class VoiceAdapter(Protocol):
    def list(self) -> list[Voice]: ...


def voice_id(provider: str, model: str, raw: str) -> str:
    return "vc_" + hashlib.sha256(f"{provider}:{model}:{raw}".encode()).hexdigest()[:12]


class SarvamAdapter:
    """bulbul:v4-flash personas. Ids look like ``name_lang_style`` (e.g. ``aayan_hi_conversational``)."""

    provider = "sarvam"
    model = "bulbul:v4-flash"

    def list(self) -> list[Voice]:
        from api.services.configuration.options.sarvam import SARVAM_V4_FLASH_VOICES

        out = []
        for raw in SARVAM_V4_FLASH_VOICES:
            name, _, rest = raw.partition("_")
            code, _, style = rest.partition("_")
            out.append(
                Voice(
                    id=voice_id(self.provider, self.model, raw),
                    name=name.capitalize(),
                    language=LANGUAGE_NAMES.get(code, code or "Unknown"),
                    style=style.replace("_", " ").capitalize() or None,
                    provider=PROVIDER_ALIASES[self.provider],
                    tts={"provider": self.provider, "model": self.model, "voice": raw},
                )
            )
        return out


ADAPTERS: list[VoiceAdapter] = [SarvamAdapter()]


def catalogue() -> list[Voice]:
    seen: dict[str, Voice] = {}
    for a in ADAPTERS:
        for v in a.list():
            seen[v.id] = v
    return sorted(seen.values(), key=lambda v: (v.language, v.name))


def find(voice_id_: str) -> Voice | None:
    return next((v for v in catalogue() if v.id == voice_id_), None)
