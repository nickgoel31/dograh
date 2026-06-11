import re
import time
from loguru import logger
from pipecat.frames.frames import Frame, TextFrame, LLMFullResponseEndFrame, TTSTextFrame
from pipecat.processors.frame_processor import FrameProcessor, FrameDirection

class SentenceAggregator(FrameProcessor):
    def __init__(self, max_tokens: int = 20):
        super().__init__()
        self._max_tokens = max_tokens
        self._buffer = ""
        self._token_count = 0
        # Priority boundaries: devanagari danda, or standard sentence-enders with a trailing space
        self._boundary_pattern = re.compile(r'(।|\? |! |\.\s)')

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, TextFrame):
            # Treat incoming words loosely as tokens for the safety limit
            self._buffer += frame.text
            self._token_count += len(frame.text.split())

            match = self._boundary_pattern.search(self._buffer)
            if match or self._token_count >= self._max_tokens:
                text_to_push = self._buffer.strip()
                if text_to_push:
                    logger.info(f"[LATENCY] First sentence to TTS: '{text_to_push[:40]}' after {self._token_count} tokens")
                    await self.push_frame(TTSTextFrame(text=text_to_push))
                self._buffer = ""
                self._token_count = 0
        
        elif isinstance(frame, LLMFullResponseEndFrame):
            if self._buffer.strip():
                logger.info(f"[LATENCY] First sentence to TTS (flush): '{self._buffer[:40]}' after {self._token_count} tokens")
                await self.push_frame(TTSTextFrame(text=self._buffer.strip()))
            self._buffer = ""
            self._token_count = 0
            await self.push_frame(frame, direction)
            
        else:
            await self.push_frame(frame, direction)
