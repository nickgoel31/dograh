import numpy as np
from loguru import logger
from pipecat.frames.frames import AudioRawFrame, Frame
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

class AudioVolumeProcessor(FrameProcessor):
    """
    A processor that multiplies the amplitude of raw audio frames by a volume factor.
    Useful for TTS services that do not natively support a volume parameter.
    """

    def __init__(self, volume: float = 1.0):
        super().__init__()
        self._volume = volume
        if self._volume != 1.0:
            logger.debug(f"AudioVolumeProcessor initialized with volume multiplier: {self._volume}")

    def set_volume(self, volume: float):
        """Update the volume multiplier dynamically."""
        self._volume = volume

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, AudioRawFrame):
            if self._volume == 1.0:
                await self.push_frame(frame, direction)
                return
            
            # Convert audio bytes to a 16-bit integer NumPy array
            audio_np = np.frombuffer(frame.audio, dtype=np.int16)
            
            # Multiply by volume and clip to prevent integer overflow/distortion
            scaled_np = np.clip(audio_np * self._volume, -32768, 32767).astype(np.int16)
            
            import dataclasses
            scaled_frame = dataclasses.replace(frame, audio=scaled_np.tobytes())
            
            await self.push_frame(scaled_frame, direction)
        else:
            await self.push_frame(frame, direction)
