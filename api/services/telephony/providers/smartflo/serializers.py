"""Smartflo Voice Streaming frame serializer.

Smartflo's bi-directional stream is Twilio-shaped: JSON events with a ``streamSid``, base64 μ-law at 8 kHz, ``clear`` to cut buffered audio.
What differs from Twilio: the server sends ``connected`` before ``start``, media carries a ``chunk`` counter, audio we send should be whole
multiples of 160 bytes (20 ms) or gaps are heard, and the call is ended over Smartflo's REST API (see strategies.py), not Twilio's.
"""

import base64
import json
from typing import TYPE_CHECKING

from loguru import logger
from pipecat.audio.dtmf.types import KeypadEntry
from pipecat.audio.utils import create_stream_resampler, pcm_to_ulaw, ulaw_to_pcm
from pipecat.frames.frames import (
    AudioRawFrame,
    CancelFrame,
    EndFrame,
    Frame,
    InputAudioRawFrame,
    InputDTMFFrame,
    InterruptionFrame,
    OutputTransportMessageFrame,
    OutputTransportMessageUrgentFrame,
    StartFrame,
)
from pipecat.serializers.base_serializer import FrameSerializer
from pipecat.utils.enums import EndTaskReason

if TYPE_CHECKING:
    from pipecat.serializers.call_strategies import HangupStrategy, TransferStrategy

WIRE_RATE = 8000
FRAME_BYTES = 160  # 20 ms of 8 kHz μ-law


class SmartfloFrameSerializer(FrameSerializer):
    """Converts between Pipecat frames and Smartflo's WebSocket media stream messages."""

    class InputParams(FrameSerializer.InputParams):
        smartflo_sample_rate: int = WIRE_RATE
        sample_rate: int | None = None  # pipeline input rate
        auto_hang_up: bool = True

    def __init__(
        self,
        stream_sid: str,
        call_id: str | None = None,
        ref_id: str | None = None,
        account_token: str | None = None,
        transfer_strategy: "TransferStrategy | None" = None,
        hangup_strategy: "HangupStrategy | None" = None,
        params: InputParams | None = None,
    ):
        params = params or SmartfloFrameSerializer.InputParams()
        super().__init__(params)
        self._params: SmartfloFrameSerializer.InputParams = params
        self._stream_sid = stream_sid
        self._call_id = call_id
        self._ref_id = ref_id
        self._account_token = account_token
        self._transfer_strategy = transfer_strategy
        self._hangup_strategy = hangup_strategy
        self._sample_rate = 0
        self._input_resampler = create_stream_resampler()
        self._output_resampler = create_stream_resampler()
        self._pending = bytearray()  # μ-law not yet sent: only whole 160-byte frames go out
        self._chunk = 0
        self._hangup_attempted = False
        self._transfer_attempted = False

    async def setup(self, frame: StartFrame):
        self._sample_rate = self._params.sample_rate or frame.audio_in_sample_rate

    def _call_context(self) -> dict:
        return {"call_id": self._call_id, "ref_id": self._ref_id, "account_token": self._account_token}

    async def serialize(self, frame: Frame) -> str | bytes | None:
        if isinstance(frame, (EndFrame, CancelFrame)):
            reason = getattr(frame, "reason", None)
            if reason == EndTaskReason.TRANSFER_CALL.value and not self._transfer_attempted:
                self._transfer_attempted = True
                if self._transfer_strategy:
                    if not await self._transfer_strategy.execute_transfer(self._call_context()):
                        logger.error(f"[Smartflo] transfer strategy failed for call {self._call_id}")
                else:
                    logger.warning(f"[Smartflo] no transfer strategy for call {self._call_id}")
            elif self._params.auto_hang_up and not self._hangup_attempted:
                self._hangup_attempted = True
                if self._hangup_strategy:
                    if not await self._hangup_strategy.execute_hangup(self._call_context()):
                        logger.error(f"[Smartflo] hangup failed for call {self._call_id}")
                else:
                    logger.warning(f"[Smartflo] no hangup strategy for call {self._call_id}")
            return None
        if isinstance(frame, InterruptionFrame):
            self._pending.clear()  # what we had not yet sent is stale too
            return json.dumps({"event": "clear", "streamSid": self._stream_sid})
        if isinstance(frame, AudioRawFrame):
            ulaw = await pcm_to_ulaw(frame.audio, frame.sample_rate, self._params.smartflo_sample_rate, self._output_resampler)
            if not ulaw:
                return None
            self._pending.extend(ulaw)
            whole = len(self._pending) // FRAME_BYTES * FRAME_BYTES
            if not whole:
                return None
            data, self._pending = bytes(self._pending[:whole]), self._pending[whole:]
            self._chunk += 1
            return json.dumps({"event": "media", "streamSid": self._stream_sid, "media": {"payload": base64.b64encode(data).decode("ascii"), "chunk": self._chunk}})
        if isinstance(frame, (OutputTransportMessageFrame, OutputTransportMessageUrgentFrame)):
            if self.should_ignore_frame(frame):
                return None
            return json.dumps(frame.message)
        return None

    async def deserialize(self, data: str | bytes) -> Frame | None:
        try:
            message = json.loads(data)
        except (TypeError, ValueError):
            return None
        event = message.get("event")
        if event == "media":
            payload = base64.b64decode(message.get("media", {}).get("payload", ""))
            pcm = await ulaw_to_pcm(payload, self._params.smartflo_sample_rate, self._sample_rate, self._input_resampler)
            if not pcm:
                return None
            return InputAudioRawFrame(audio=pcm, num_channels=1, sample_rate=self._sample_rate)
        if event == "dtmf":
            try:
                return InputDTMFFrame(KeypadEntry(message.get("dtmf", {}).get("digit")))
            except ValueError:
                return None
        return None  # connected, start, mark, stop: nothing for the pipeline
