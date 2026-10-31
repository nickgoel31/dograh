import pytest

from api.product.make_profile import profile_config_from, summary
from api.services.reseller.profiles import ProfileConfigError


def test_profile_keeps_only_provider_sections():
    raw = {
        "llm": {"provider": "openai", "api_key": "k", "model": "gpt-4.1"},
        "tts": {"provider": "sarvam", "api_key": "k", "model": "bulbul:v4-flash", "voice": "shubh_enhi_ads", "language": "hi-IN"},
        "stt": {"provider": "deepgram", "api_key": "k", "model": "nova-3", "language": "multi"},
        "last_validated_at": "2026-01-01", "something_else": 1,
    }
    cfg = profile_config_from(raw)
    assert set(cfg) == {"llm", "tts", "stt"}
    s = summary(cfg)
    assert "openai / gpt-4.1" in s and "sarvam" in s and "k," not in s  # never prints keys


def test_empty_settings_are_refused_plainly():
    with pytest.raises(ProfileConfigError):
        profile_config_from({})
