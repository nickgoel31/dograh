"""Model profiles: named, owner-controlled bundles of provider settings."""

from typing import Any

from pydantic import ValidationError

from api.db.models import ModelProfileModel
from api.schemas.user_configuration import UserConfiguration
from api.services.configuration.masking import mask_user_config

PROFILE_CONFIG_KEYS = ("llm", "tts", "stt", "embeddings", "realtime", "is_realtime")
_SERVICE_KEYS = ("llm", "tts", "stt", "realtime")


class ProfileConfigError(ValueError):
    pass


def normalize_config(config: dict) -> dict:
    """Keep only known keys and check they form a valid configuration."""
    cleaned = {k: v for k, v in (config or {}).items() if k in PROFILE_CONFIG_KEYS and v is not None}
    if not any(cleaned.get(k) for k in _SERVICE_KEYS):
        raise ProfileConfigError("A profile needs at least one of llm, tts, stt or realtime")
    try:
        UserConfiguration.model_validate(cleaned)
    except ValidationError as exc:
        raise ProfileConfigError(str(exc)) from exc
    return cleaned


def public_view(profile: ModelProfileModel) -> dict[str, Any]:
    """What resellers / clients may see: a label and marketing copy, nothing else."""
    return {
        "id": profile.id,
        "display_name": profile.display_name,
        "description": profile.description,
        "tier": profile.tier,
        "capabilities": list(profile.capabilities or []),
    }


def owner_view(profile: ModelProfileModel) -> dict[str, Any]:
    """Full view for the platform owner. API keys stay masked."""
    try:
        masked = mask_user_config(UserConfiguration.model_validate(profile.config or {}))
    except ValidationError:
        masked = {}
    return {
        **public_view(profile),
        "slug": profile.slug,
        "allowed_org_ids": list(profile.allowed_org_ids or []),
        "is_active": profile.is_active,
        "config": {k: v for k, v in masked.items() if v is not None},
    }
