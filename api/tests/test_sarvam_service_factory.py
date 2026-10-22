from types import SimpleNamespace
from unittest.mock import patch

import pytest
from pipecat.services.sarvam.llm import SarvamLLMService as RealSarvamLLMService
from pipecat.transcriptions.language import Language

from api.services.configuration.registry import (
    SarvamLLMConfiguration,
    ServiceProviders,
)
from api.services.pipecat.audio_config import AudioConfig
from api.services.pipecat.service_factory import (
    create_llm_service,
    create_llm_service_from_provider,
    create_stt_service,
)


class TestSarvamLLMConfiguration:
    def test_default_values(self):
        config = SarvamLLMConfiguration(api_key="test-key")
        assert config.provider == ServiceProviders.SARVAM
        assert config.model == "sarvam-105b"
        assert config.temperature == 0.5
        assert config.reasoning_effort == "default"

    def test_custom_model(self):
        config = SarvamLLMConfiguration(api_key="test-key", model="sarvam-105b")
        assert config.model == "sarvam-105b"


class TestSarvamLLMServiceFactory:
    def test_create_sarvam_llm_service(self):
        with patch(
            "api.services.pipecat.service_factory.DograhSarvamLLMService"
        ) as mock_service:
            mock_service.Settings = RealSarvamLLMService.Settings
            create_llm_service_from_provider(
                provider=ServiceProviders.SARVAM.value,
                model="sarvam-30b",
                api_key="test-key",
            )

        assert mock_service.call_count == 1
        kwargs = mock_service.call_args.kwargs
        assert kwargs["api_key"] == "test-key"
        assert kwargs["settings"].model == "sarvam-30b"
        assert kwargs["settings"].temperature == 0.5

    def test_create_sarvam_llm_service_passes_user_temperature(self):
        with patch(
            "api.services.pipecat.service_factory.DograhSarvamLLMService"
        ) as mock_service:
            mock_service.Settings = RealSarvamLLMService.Settings
            create_llm_service_from_provider(
                provider=ServiceProviders.SARVAM.value,
                model="sarvam-30b",
                api_key="test-key",
                temperature=0.8,
            )

        kwargs = mock_service.call_args.kwargs
        assert kwargs["settings"].temperature == 0.8

    def test_create_llm_service_extracts_sarvam_temperature(self):
        user_config = SimpleNamespace(
            llm=SimpleNamespace(
                provider=ServiceProviders.SARVAM.value,
                model="sarvam-30b",
                api_key="test-key",
                temperature=0.7,
            )
        )

        with patch(
            "api.services.pipecat.service_factory.DograhSarvamLLMService"
        ) as mock_service:
            mock_service.Settings = RealSarvamLLMService.Settings
            create_llm_service(user_config)

        kwargs = mock_service.call_args.kwargs
        assert kwargs["settings"].temperature == 0.7


class TestSarvamSTTServiceFactory:
    @pytest.mark.parametrize(
        "input_language,expected_language",
        [
            ("unknown", None),
            (None, None),
            ("hi-IN", Language.HI_IN),
            ("ne-IN", "ne-IN"),
        ],
    )
    def test_stt_language_mapping(self, input_language, expected_language):
        user_config = SimpleNamespace(
            stt=SimpleNamespace(
                provider=ServiceProviders.SARVAM.value,
                model="saaras:v3",
                api_key="test-key",
                language=input_language,
            )
        )
        audio_config = AudioConfig(
            transport_in_sample_rate=16000, transport_out_sample_rate=16000
        )

        with patch(
            "api.services.pipecat.service_factory.SarvamSTTService"
        ) as mock_service:
            create_stt_service(user_config, audio_config)

        kwargs = mock_service.call_args.kwargs
        assert kwargs["settings"].language == expected_language


# ---------------------------------------------------------------------------
# bulbul:v4-flash, custom values and the newer Sarvam LLMs
# ---------------------------------------------------------------------------
from api.services.configuration.options.sarvam import (  # noqa: E402
    SARVAM_V4_FLASH_LANGUAGES,
    SARVAM_V4_FLASH_VOICES,
)
from api.services.configuration.registry import (  # noqa: E402
    SarvamSTTConfiguration,
    SarvamTTSConfiguration,
)
from api.services.pipecat import sarvam_compat  # noqa: E402
from api.services.pipecat.service_factory import create_tts_service  # noqa: E402


class TestSarvamTTSConfiguration:
    def test_defaults_to_v4_flash(self):
        c = SarvamTTSConfiguration(api_key="k")
        assert c.model == "bulbul:v4-flash"
        assert c.voice == "shubh_enhi_ads"
        assert c.voice in SARVAM_V4_FLASH_VOICES

    def test_voice_catalog_is_complete_and_unique(self):
        assert len(SARVAM_V4_FLASH_VOICES) == 222
        assert len(set(SARVAM_V4_FLASH_VOICES)) == 222
        assert all(v == v.lower() for v in SARVAM_V4_FLASH_VOICES)
        # v4-flash personas follow <name>_<language>_<style>; v2/v3 short names are not valid
        assert "shubh" not in SARVAM_V4_FLASH_VOICES

    def test_custom_value_toggle_is_enabled_for_model_voice_and_language(self):
        for cfg in (SarvamTTSConfiguration, SarvamSTTConfiguration):
            props = cfg.model_json_schema()["properties"]
            assert props["model"]["allow_custom_input"] is True
            assert props["language"]["allow_custom_input"] is True
        assert SarvamTTSConfiguration.model_json_schema()["properties"]["voice"]["allow_custom_input"] is True

    def test_per_model_voice_and_language_options(self):
        props = SarvamTTSConfiguration.model_json_schema()["properties"]
        assert props["voice"]["model_options"]["bulbul:v4-flash"][0] == "shubh_enhi_ads"
        assert "anushka" in props["voice"]["model_options"]["bulbul:v2"]
        langs = props["language"]["model_options"]["bulbul:v4-flash"]
        assert tuple(langs) == SARVAM_V4_FLASH_LANGUAGES
        assert "ml-IN" not in langs and "od-IN" not in langs  # no personas yet

    def test_llm_model_list_includes_new_models(self):
        examples = SarvamLLMConfiguration.model_json_schema()["properties"]["model"]["examples"]
        for m in ("sarvam-105b", "sarvam-105b-conversations", "gemma4", "glm5.3", "deepseekv4.1-flash"):
            assert m in examples


class TestSarvamTTSRuntime:
    def _tts_config(self, **kw):
        base = dict(provider=ServiceProviders.SARVAM.value, model="bulbul:v4-flash",
                    api_key="k", voice="simran_en_customer", language="en-IN")
        base.update(kw)
        return SimpleNamespace(tts=SimpleNamespace(**base))

    def test_v4_flash_is_registered_with_pipecat(self):
        from pipecat.services.sarvam import tts as sarvam_tts

        cfg = sarvam_tts.TTS_MODEL_CONFIGS["bulbul:v4-flash"]
        assert cfg.default_sample_rate == 24000
        assert cfg.pace_range == (0.5, 2.0)
        assert not cfg.supports_pitch and not cfg.supports_loudness
        assert "simran_en_customer" in cfg.speakers

    def test_service_builds_for_v4_flash(self):
        svc = create_tts_service(self._tts_config(), AudioConfig(transport_in_sample_rate=8000, transport_out_sample_rate=8000))
        assert "model=bulbul:v4-flash" in svc._websocket_url
        assert svc._settings.voice == "simran_en_customer"

    def test_custom_model_id_is_accepted_instead_of_crashing(self):
        svc = create_tts_service(self._tts_config(model="bulbul:v5-preview", voice="x_hi_y", language="hi-IN"),
                                 AudioConfig(transport_in_sample_rate=8000, transport_out_sample_rate=8000))
        assert "model=bulbul:v5-preview" in svc._websocket_url

    def test_missing_voice_falls_back_per_model(self):
        assert sarvam_compat.default_sarvam_voice("bulbul:v2") == "anushka"
        assert sarvam_compat.default_sarvam_voice("bulbul:v3") == "shubh"
        assert sarvam_compat.default_sarvam_voice("bulbul:v4-flash") == "shubh_enhi_ads"


class TestSarvamSTTCustomModel:
    def test_unknown_stt_model_is_accepted(self):
        user_config = SimpleNamespace(
            stt=SimpleNamespace(provider=ServiceProviders.SARVAM.value, model="saaras:v4",
                                api_key="k", language="unknown")
        )
        audio = AudioConfig(transport_in_sample_rate=16000, transport_out_sample_rate=16000)
        svc = create_stt_service(user_config, audio)
        assert svc._settings.model == "saaras:v4"


class TestSarvamLLMRouting:
    def _svc(self, model, **kw):
        return create_llm_service_from_provider(
            provider=ServiceProviders.SARVAM.value, model=model, api_key="k", **kw
        )

    def test_v1_models_use_v1_endpoint(self):
        assert str(self._svc("sarvam-105b")._client.base_url).startswith("https://api.sarvam.ai/v1")

    @pytest.mark.parametrize("model", ["gemma4", "glm5.3", "deepseekv4.1-flash"])
    def test_open_weight_models_use_v2_endpoint(self, model):
        assert str(self._svc(model)._client.base_url).startswith("https://api.sarvam.ai/v2")

    def test_custom_model_is_accepted(self):
        assert self._svc("some-new-model")._settings.model == "some-new-model"

    def test_session_affinity_header_is_sent(self):
        headers = self._svc("gemma4")._client.default_headers
        assert headers.get("x-session-affinity")

    def test_reasoning_off_sends_explicit_null(self):
        svc = self._svc("sarvam-105b", reasoning_effort="off")
        params = svc.build_chat_completion_params(
            {"messages": [{"role": "user", "content": "hi"}], "tools": None, "tool_choice": None}
        )
        assert "reasoning_effort" in params and params["reasoning_effort"] is None

    def test_reasoning_level_is_forwarded_and_default_is_omitted(self):
        high = self._svc("sarvam-105b", reasoning_effort="high").build_chat_completion_params(
            {"messages": [{"role": "user", "content": "hi"}]}
        )
        assert high["reasoning_effort"] == "high"
        default = self._svc("sarvam-105b", reasoning_effort="default").build_chat_completion_params(
            {"messages": [{"role": "user", "content": "hi"}]}
        )
        assert "reasoning_effort" not in default
