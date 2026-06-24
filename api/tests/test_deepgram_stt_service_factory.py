from types import SimpleNamespace
from unittest.mock import patch

from pipecat.transcriptions.language import Language

from api.services.configuration.registry import ServiceProviders
from api.services.pipecat.service_factory import create_stt_service


def test_create_deepgram_flux_en_service():
    user_config = SimpleNamespace(
        stt=SimpleNamespace(
            provider=ServiceProviders.DEEPGRAM.value,
            api_key="test-api-key",
            model="flux-general-en",
        )
    )
    audio_config = SimpleNamespace(transport_in_sample_rate=16000)

    with patch("api.services.pipecat.service_factory.DeepgramFluxSTTService") as mock_service:
        create_stt_service(user_config, audio_config)

    assert mock_service.call_count == 1
    kwargs = mock_service.call_args.kwargs
    assert kwargs["api_key"] == "test-api-key"
    assert kwargs["sample_rate"] == 16000
    assert kwargs["settings"].model == "flux-general-en"
    assert kwargs["settings"].language_hints is None


def test_create_deepgram_flux_multi_service_auto_detect():
    user_config = SimpleNamespace(
        stt=SimpleNamespace(
            provider=ServiceProviders.DEEPGRAM.value,
            api_key="test-api-key",
            model="flux-general-multi",
            language="multi",
        )
    )
    audio_config = SimpleNamespace(transport_in_sample_rate=16000)

    with patch("api.services.pipecat.service_factory.DeepgramFluxSTTService") as mock_service:
        create_stt_service(user_config, audio_config)

    assert mock_service.call_count == 1
    kwargs = mock_service.call_args.kwargs
    assert kwargs["api_key"] == "test-api-key"
    assert kwargs["sample_rate"] == 16000
    assert kwargs["settings"].model == "flux-general-multi"
    assert kwargs["settings"].language_hints is None


def test_create_deepgram_flux_multi_service_with_language():
    user_config = SimpleNamespace(
        stt=SimpleNamespace(
            provider=ServiceProviders.DEEPGRAM.value,
            api_key="test-api-key",
            model="flux-general-multi",
            language="es",
        )
    )
    audio_config = SimpleNamespace(transport_in_sample_rate=16000)

    with patch("api.services.pipecat.service_factory.DeepgramFluxSTTService") as mock_service:
        create_stt_service(user_config, audio_config)

    assert mock_service.call_count == 1
    kwargs = mock_service.call_args.kwargs
    assert kwargs["api_key"] == "test-api-key"
    assert kwargs["sample_rate"] == 16000
    assert kwargs["settings"].model == "flux-general-multi"
    assert kwargs["settings"].language_hints == [Language.ES]


def test_create_deepgram_nova_service():
    user_config = SimpleNamespace(
        stt=SimpleNamespace(
            provider=ServiceProviders.DEEPGRAM.value,
            api_key="test-api-key",
            model="nova-3-general",
            language="es",
        )
    )
    audio_config = SimpleNamespace(transport_in_sample_rate=16000)

    with patch("api.services.pipecat.service_factory.DeepgramSTTService") as mock_service:
        create_stt_service(user_config, audio_config)

    assert mock_service.call_count == 1
    kwargs = mock_service.call_args.kwargs
    assert kwargs["api_key"] == "test-api-key"
    assert kwargs["sample_rate"] == 16000
    assert kwargs["settings"].model == "nova-3-general"
    assert kwargs["settings"].language == "es"
