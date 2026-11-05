"""Which AI models and voices a workspace's calls use.

The platform already has *model profiles*: named bundles of LLM / TTS / STT
settings (with provider keys) owned by the platform operator and applied to an
organization at call time, so tenants never see or hold provider details.

Product rules built on that:
* Every workspace organization (test and live) points at the *default* profile.
* An agent's "Brain" preset (Fast / Balanced / Smartest) picks another profile's
  LLM; a chosen voice swaps the TTS voice. Both become per-agent
  ``model_overrides`` copied from the profile, so nothing is typed by users.

Operators map presets to profile slugs with ``PRODUCT_PROFILES`` (JSON), e.g.
``{"default": "std", "fast": "std-fast", "balanced": "std", "smartest": "std-pro"}``.
Profiles are created with the existing superuser API; see docs/MODEL_SETUP.md.
"""

import json
import os
from copy import deepcopy

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.db.models import ModelProfileModel, OrganizationModel
from api.product import style as style_mod
from api.product import voices as voice_catalogue

PRESETS = ("fast", "balanced", "smartest")

# The AI model behind each Brain level on the 'inworld' realtime profile. Override with PRODUCT_INWORLD_MODELS (JSON).
INWORLD_BRAINS = {
    "fast": "google-ai-studio/gemini-2.5-flash-lite",
    "balanced": "google-ai-studio/gemini-3.1-flash-lite",
    "smartest": "google-ai-studio/gemini-3.8-flash",
}


def inworld_model(brain: str) -> str:
    try:
        custom = json.loads(os.getenv("PRODUCT_INWORLD_MODELS", "") or "{}")
    except ValueError:
        custom = {}
    return (custom.get(brain) if isinstance(custom, dict) else None) or INWORLD_BRAINS.get(brain) or INWORLD_BRAINS["balanced"]


async def engine_profile(session: AsyncSession, engine: str) -> ModelProfileModel | None:
    """The profile that serves a voice engine ('inworld' / 'google'), mapped in PRODUCT_PROFILES."""
    return await _by_slug(session, profile_slugs().get(engine) or engine)


async def engine_ready(session: AsyncSession, engine: str) -> bool:
    """True when that engine's profile exists and has an API key."""
    prof = await engine_profile(session, engine)
    if engine == "swarvo":  # a normal listen > think > speak profile: needs the speech key, a thinking model and a listening model
        c = (prof.config or {}) if prof else {}
        return bool((c.get("tts") or {}).get("api_key") and c.get("llm") and c.get("stt"))
    rt = (prof.config or {}).get("realtime") if prof else None
    return bool(rt and rt.get("api_key"))


def brain_applies(engine: str | None) -> bool:
    """Brain levels pick the AI model on the 'inworld' engine only; the Google realtime model is a single model."""
    return engine not in ("google", "swarvo")


def profile_slugs() -> dict[str, str]:
    try:
        raw = json.loads(os.getenv("PRODUCT_PROFILES", "") or "{}")
    except ValueError:
        return {}
    return {k: v for k, v in raw.items() if isinstance(v, str)} if isinstance(raw, dict) else {}


async def _by_slug(session: AsyncSession, slug: str | None) -> ModelProfileModel | None:
    if not slug:
        return None
    return await session.scalar(
        select(ModelProfileModel).where(ModelProfileModel.slug == slug, ModelProfileModel.is_active.is_(True))
    )


async def default_profile(session: AsyncSession) -> ModelProfileModel | None:
    slugs = profile_slugs()
    return await _by_slug(session, slugs.get("default") or slugs.get("balanced"))


async def ensure_org_profiles(session: AsyncSession, *org_ids: int) -> bool:
    """Point any org without a profile at the default one. True when every org ends up with one.

    Caller commits. Also repairs workspaces created before profiles were configured.
    """
    profile = await default_profile(session)
    ok = True
    for org_id in org_ids:
        org = await session.get(OrganizationModel, org_id)
        if org is None:
            ok = False
        elif org.model_profile_id is None:
            if profile is None:
                ok = False
            else:
                org.model_profile_id = profile.id
    return ok


async def build_overrides(session: AsyncSession, *, brain: str, voice_id: str | None, style: dict | None = None) -> dict | None:
    """Self-contained per-agent overrides, or None when the default profile already fits."""
    base = await default_profile(session)
    if base is None:
        return None
    overrides: dict = {}

    voice = voice_catalogue.find(voice_id) if voice_id else None
    if voice is not None and voice.engine == "swarvo":
        prof = await engine_profile(session, "swarvo")
        c = (prof.config or {}) if prof else {}
        if not (c.get("tts") and c.get("llm") and c.get("stt")):
            return None
        tts = deepcopy(c["tts"])
        tts["voice"] = voice.tts["voice"]
        tts["language"] = voice.tts.get("lang", tts.get("language", "hi"))
        out = {"is_realtime": False, "llm": deepcopy(c["llm"]), "stt": deepcopy(c["stt"]), "tts": tts}
        if c.get("embeddings"):
            out["embeddings"] = deepcopy(c["embeddings"])
        return out
    if voice is not None and voice.engine in ("inworld", "google"):
        prof = await engine_profile(session, voice.engine)
        rt = (prof.config or {}).get("realtime") if prof else None
        if not rt:
            return None
        rt = deepcopy(rt)
        rt["voice"] = voice.tts["voice"]
        if voice.engine == "inworld":
            rt["model"] = inworld_model(brain)
            rt = style_mod.overlay(rt, style)
        return {"is_realtime": True, "realtime": rt}
    rt = (base.config or {}).get("realtime")
    if voice is None and rt and rt.get("provider") == "inworld_realtime":  # no voice picked: the profile's own voice, at the chosen Brain level
        return {"is_realtime": True, "realtime": style_mod.overlay({**deepcopy(rt), "model": inworld_model(brain)}, style)}

    chosen = await _by_slug(session, profile_slugs().get(brain))
    llm = (chosen.config or {}).get("llm") if chosen else None
    if chosen is not None and chosen.id != base.id and llm:
        overrides["llm"] = deepcopy(llm)

    tts = (base.config or {}).get("tts")
    if voice is not None and tts and tts.get("provider") == voice.tts.get("provider"):
        merged = deepcopy(tts)
        merged["model"] = voice.tts["model"]
        merged["voice"] = voice.tts["voice"]
        if voice.tts.get("language"):
            merged["language"] = voice.tts["language"]
        overrides["tts"] = merged
    return overrides or None


async def presets_available(session: AsyncSession) -> dict[str, bool]:
    return {p: (await _by_slug(session, profile_slugs().get(p))) is not None for p in PRESETS}
