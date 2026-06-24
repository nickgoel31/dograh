import pytest
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


@pytest.mark.asyncio
async def test_deepgram_flux_on_update_pushes_interim_transcription_frame():
    user_config = SimpleNamespace(
        stt=SimpleNamespace(
            provider=ServiceProviders.DEEPGRAM.value,
            api_key="test-api-key",
            model="flux-general-multi",
            language="multi",
        )
    )
    audio_config = SimpleNamespace(transport_in_sample_rate=16000)

    from unittest.mock import AsyncMock, MagicMock
    
    mock_instance = MagicMock()
    mock_instance._user_id = "test-user"
    mock_instance.push_frame = AsyncMock()
    
    registered_handlers = {}
    
    def mock_event_handler(event_name):
        def decorator(func):
            registered_handlers[event_name] = func
            return func
        return decorator
        
    mock_instance.event_handler = mock_event_handler

    with patch("api.services.pipecat.service_factory.DeepgramFluxSTTService", return_value=mock_instance):
        create_stt_service(user_config, audio_config)

    assert "on_update" in registered_handlers
    
    handler = registered_handlers["on_update"]
    await handler(mock_instance, "hello world")
    
    assert mock_instance.push_frame.call_count == 1
    frame = mock_instance.push_frame.call_args[0][0]
    from pipecat.frames.frames import InterimTranscriptionFrame
    assert isinstance(frame, InterimTranscriptionFrame)
    assert frame.text == "hello world"
    assert frame.user_id == "test-user"
