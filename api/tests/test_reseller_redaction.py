import pytest
from fastapi import HTTPException

from api.services.configuration.masking import mask_workflow_configurations
from api.services.reseller import profiles as profile_service
from api.services.reseller.context import models_hidden_var
from api.services.reseller.redaction import (
    cost_info_for_caller,
    forbid_if_hidden,
    public_cost_info,
    public_usage_info,
    usage_info_for_caller,
)

COST = {
    "call_duration_seconds": 61,
    "total_cost_usd": 0.42,
    "dograh_token_usage": 42,
    "cost_breakdown": {"llm": {"openai/gpt-4o": 0.3}, "tts": {"elevenlabs": 0.1}},
}
USAGE = {"llm": {"gpt-4o": {"prompt_tokens": 10}}, "call_duration_seconds": 61}
OVERRIDES = {"model_overrides": {"llm": {"provider": "openai", "model": "gpt-4o", "api_key": "sk-secret"}}, "other": 1}


@pytest.fixture
def hidden():
    token = models_hidden_var.set(True)
    yield
    models_hidden_var.reset(token)


def test_public_views_keep_only_duration():
    assert public_cost_info(COST) == {"call_duration_seconds": 61}
    assert public_usage_info(USAGE) == {"call_duration_seconds": 61}


def test_owner_sees_everything_tenants_do_not(hidden):
    assert cost_info_for_caller(COST) == {"call_duration_seconds": 61}
    assert usage_info_for_caller(USAGE) == {"call_duration_seconds": 61}
    with pytest.raises(HTTPException) as exc:
        forbid_if_hidden()
    assert exc.value.status_code == 403


def test_visible_by_default():
    assert cost_info_for_caller(COST) is COST
    assert usage_info_for_caller(USAGE) is USAGE
    forbid_if_hidden()  # no raise


def test_workflow_configuration_models_never_leak_to_tenants(hidden):
    out = mask_workflow_configurations(OVERRIDES)
    assert out["model_overrides"] == {"managed": True}
    assert out["other"] == 1
    dumped = repr(out)
    assert "openai" not in dumped and "gpt-4o" not in dumped and "sk-secret" not in dumped


def test_workflow_configuration_masked_not_removed_for_owner():
    out = mask_workflow_configurations(OVERRIDES)
    assert out["model_overrides"]["llm"]["model"] == "gpt-4o"
    assert out["model_overrides"]["llm"]["api_key"] != "sk-secret"


def test_profile_needs_a_service():
    with pytest.raises(profile_service.ProfileConfigError):
        profile_service.normalize_config({})
    with pytest.raises(profile_service.ProfileConfigError):
        profile_service.normalize_config({"test_phone_number": "123"})


def test_profile_rejects_unknown_provider():
    with pytest.raises(profile_service.ProfileConfigError):
        profile_service.normalize_config({"llm": {"provider": "nope", "api_key": "k", "model": "m"}})


def test_profile_public_view_hides_config():
    class P:  # minimal stand-in for ModelProfileModel
        id = 1
        slug = "std"
        display_name = "Standard"
        description = "Everyday calls"
        tier = "standard"
        capabilities = ["Low latency"]
        config = {"llm": {"provider": "openai", "api_key": "sk-secret", "model": "gpt-4o"}}
        allowed_org_ids = []
        is_active = True

    view = profile_service.public_view(P())
    assert set(view) == {"id", "display_name", "description", "tier", "capabilities"}
    assert "openai" not in repr(view) and "sk-secret" not in repr(view)
