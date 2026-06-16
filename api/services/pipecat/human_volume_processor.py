import numpy as np
from loguru import logger
from pipecat.frames.frames import Frame, InputAudioRawFrame
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor


class HumanVolumeProcessor(FrameProcessor):
    def __init__(self, volume_multiplier: float = 1.45):
        super().__init__()
        self._volume_multiplier = volume_multiplier
        logger.info(f"Initialized HumanVolumeProcessor with multiplier: {self._volume_multiplier}")

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, InputAudioRawFrame) and self._volume_multiplier != 1.0:
            try:
                # Convert raw PCM bytes (16-bit signed integer) to numpy array
                audio_np = np.frombuffer(frame.audio, dtype=np.int16)
                # Multiply by volume multiplier and clip to 16-bit signed int range to avoid distortion/overflow
                boosted = np.clip(audio_np * self._volume_multiplier, -32768, 32767).astype(np.int16)
                # Create a new InputAudioRawFrame with boosted audio bytes
                boosted_frame = InputAudioRawFrame(
                    audio=boosted.tobytes(),
                    sample_rate=frame.sample_rate,
                    num_channels=frame.num_channels,
                )
                await self.push_frame(boosted_frame, direction)
                return
            except Exception as e:
                logger.error(f"Error boosting volume in HumanVolumeProcessor: {e}")
                # Fallback to forwarding the original frame if something goes wrong
                await self.push_frame(frame, direction)
                return

        await self.push_frame(frame, direction)
