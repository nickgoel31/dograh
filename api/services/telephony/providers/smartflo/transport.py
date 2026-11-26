"""Smartflo transport factory."""

from fastapi import WebSocket
from pipecat.transports.websocket.fastapi import FastAPIWebsocketParams, FastAPIWebsocketTransport

from api.services.pipecat.audio_config import AudioConfig
from api.services.pipecat.audio_mixer import build_audio_out_mixer
from api.services.pipecat.transport_params import realtime_param_overrides
from api.services.telephony.factory import load_credentials_for_transport

from .serializers import SmartfloFrameSerializer
from .strategies import SmartfloHangupStrategy, SmartfloTransferStrategy


async def create_transport(
    websocket: WebSocket,
    workflow_run_id: int,
    audio_config: AudioConfig,
    organization_id: int,
    *,
    ambient_noise_config: dict | None = None,
    telephony_configuration_id: int | None = None,
    is_realtime: bool = False,
    stream_id: str,
    call_id: str,
    ref_id: str | None = None,
):
    """Create a transport for Smartflo Voice Streaming connections."""
    config = await load_credentials_for_transport(organization_id, telephony_configuration_id, expected_provider="smartflo")
    token = config.get("account_token")
    if not token:
        raise ValueError(f"Incomplete Smartflo configuration for organization {organization_id}")

    serializer = SmartfloFrameSerializer(
        stream_sid=stream_id, call_id=call_id, ref_id=ref_id, account_token=token,
        transfer_strategy=SmartfloTransferStrategy(), hangup_strategy=SmartfloHangupStrategy(),
        params=SmartfloFrameSerializer.InputParams(smartflo_sample_rate=8000, sample_rate=audio_config.pipeline_sample_rate),
    )
    mixer = await build_audio_out_mixer(audio_config.transport_out_sample_rate, ambient_noise_config)
    return FastAPIWebsocketTransport(
        websocket=websocket,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True, audio_out_enabled=True,
            audio_in_sample_rate=audio_config.transport_in_sample_rate, audio_out_sample_rate=audio_config.transport_out_sample_rate,
            audio_out_mixer=mixer, serializer=serializer, **realtime_param_overrides(is_realtime),
        ),
    )
