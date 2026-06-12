import re
from loguru import logger
from pipecat.frames.frames import (
    Frame,
    LLMTextFrame,
    LLMFullResponseEndFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

class SentenceStreamerProcessor(FrameProcessor):
    """
    Buffer LLM tokens and flush complete sentences downstream immediately.
    This avoids waiting for the full LLM response to complete before TTS starts.
    """
    FLUSH_CHARS = {'.', '?', '!', '\n'}
    MIN_FLUSH_CHARS = 12

    def __init__(self):
        super().__init__()
        self._buf = ""

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, LLMTextFrame):
            self._buf += frame.text
            if any(c in frame.text for c in self.FLUSH_CHARS) and len(self._buf) >= self.MIN_FLUSH_CHARS:
                # Flush the completed sentence downstream
                await self.push_frame(LLMTextFrame(self._buf), direction)
                logger.debug(f"SentenceStreamerProcessor: flushed sentence: {self._buf.strip()}")
                self._buf = ""
            # Do NOT forward the original token LLMTextFrame downstream, since we are aggregating it
            return

        if isinstance(frame, LLMFullResponseEndFrame):
            if self._buf.strip():
                await self.push_frame(LLMTextFrame(self._buf), direction)
                logger.debug(f"SentenceStreamerProcessor: flushed remaining: {self._buf.strip()}")
                self._buf = ""
            
            await self.push_frame(frame, direction)
            return

        # Forward all other frames downstream unchanged
        await self.push_frame(frame, direction)
