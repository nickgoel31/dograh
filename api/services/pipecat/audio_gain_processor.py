import os
import numpy as np
from loguru import logger
from pipecat.frames.frames import Frame, InputAudioRawFrame, UserAudioRawFrame
from pipecat.processors.frame_processor import FrameProcessor, FrameDirection

class AudioGainProcessor(FrameProcessor):
    def __init__(self, gain_factor: float | None = None):
        super().__init__()
        if gain_factor is None:
            # Default to a 45% boost (1.45 factor)
            gain_factor_str = os.getenv("USER_AUDIO_GAIN_FACTOR", "1.45")
            try:
                gain_factor = float(gain_factor_str)
            except ValueError:
                logger.warning(f"Invalid USER_AUDIO_GAIN_FACTOR value: {gain_factor_str}. Using default 1.45.")
                gain_factor = 1.45
        
        self._gain_factor = gain_factor
        logger.info(f"Initialized AudioGainProcessor with gain factor: {self._gain_factor}")

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        if isinstance(frame, (InputAudioRawFrame, UserAudioRawFrame)):
            # Convert raw bytes back to a numpy int16 array
            audio_data = np.frombuffer(frame.audio, dtype=np.int16)
            
            # Boost the volume, avoiding overflow by clipping
            boosted_data = audio_data.astype(np.float32) * self._gain_factor
            np.clip(boosted_data, -32768, 32767, out=boosted_data)
            boosted_bytes = boosted_data.astype(np.int16).tobytes()
            
            # Return new frame with boosted audio data
            new_frame = frame.__class__(
                audio=boosted_bytes,
                sample_rate=frame.sample_rate,
                num_channels=frame.num_channels
            )
            await self.push_frame(new_frame, direction)
        else:
            await self.push_frame(frame, direction)
