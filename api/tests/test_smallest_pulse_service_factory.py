from types import SimpleNamespace
from unittest.mock import patch

from api.services.configuration.registry import ServiceProviders
from api.services.pipecat.service_factory import create_stt_service


def test_create_smallest_pulse_stt_service_telephony():
    user_config = SimpleNamespace(
        stt=SimpleNamespace(
            provider=ServiceProviders.SMALLEST_PULSE.value,
            api_key="config_api_key",
            model="pulse",
            language="hi",
            eou_timeout_ms=500,
        )
    )
    # 8000Hz (telephony)
    audio_config = SimpleNamespace(transport_in_sample_rate=8000)

    with patch(
        "api.services.pipecat.service_factory.SmallestPulseTranscriber"
    ) as mock_service:
        create_stt_service(user_config, audio_config)

    assert mock_service.call_count == 1
    kwargs = mock_service.call_args.kwargs
    assert kwargs["api_key"] == "config_api_key"
    assert kwargs["language"] == "hi"
    assert kwargs["sample_rate"] == 8000
    assert kwargs["encoding"] == "mulaw"
    assert kwargs["eou_timeout_ms"] == 500


def test_create_smallest_pulse_stt_service_webrtc():
    user_config = SimpleNamespace(
        stt=SimpleNamespace(
            provider=ServiceProviders.SMALLEST_PULSE.value,
            api_key="config_api_key",
            model="pulse",
            language="en",
            eou_timeout_ms=800,
        )
    )
    # 16000Hz (webrtc/default)
    audio_config = SimpleNamespace(transport_in_sample_rate=16000)

    with patch(
        "api.services.pipecat.service_factory.SmallestPulseTranscriber"
    ) as mock_service:
        create_stt_service(user_config, audio_config)

    assert mock_service.call_count == 1
    kwargs = mock_service.call_args.kwargs
    assert kwargs["api_key"] == "config_api_key"
    assert kwargs["language"] == "en"
    assert kwargs["sample_rate"] == 16000
    assert kwargs["encoding"] == "linear16"
    assert kwargs["eou_timeout_ms"] == 800


def test_create_smallest_pulse_stt_service_api_key_fallback():
    user_config = SimpleNamespace(
        stt=SimpleNamespace(
            provider=ServiceProviders.SMALLEST_PULSE.value,
            api_key=None,
            model="pulse",
            language="es",
            eou_timeout_ms=900,
        )
    )
    audio_config = SimpleNamespace(transport_in_sample_rate=16000)

    with patch("api.services.pipecat.service_factory.SMALLEST_AI_API_KEY", "fallback_api_key"):
        with patch(
            "api.services.pipecat.service_factory.SmallestPulseTranscriber"
        ) as mock_service:
            create_stt_service(user_config, audio_config)

    assert mock_service.call_count == 1
    kwargs = mock_service.call_args.kwargs
    assert kwargs["api_key"] == "fallback_api_key"
    assert kwargs["language"] == "es"
    assert kwargs["sample_rate"] == 16000
    assert kwargs["encoding"] == "linear16"
    assert kwargs["eou_timeout_ms"] == 900
