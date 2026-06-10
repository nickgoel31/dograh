import asyncio
import time
from loguru import logger
from pipecat.frames.frames import (
    Frame,
    LLMMessagesAppendFrame,
    LLMRunFrame,
    LLMContextFrame,
    LLMTextFrame,
    LLMFullResponseStartFrame,
    TextFrame
)
from pipecat.processors.frame_processor import FrameProcessor, FrameDirection

class FillerAudioProcessor(FrameProcessor):
    def __init__(self, tts_service, delay_ms: int = 500, fillers: list = None):
        super().__init__()
        self._tts_service = tts_service
        self._delay_ms = delay_ms
        self._fillers = fillers or ["Ji, ek second.", "Ji, check karta hoon.", "Ji, batata hoon."]
        self._filler_index = 0
        self._waiting_for_llm = False
        self._filler_task = None

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, (LLMMessagesAppendFrame, LLMRunFrame, LLMContextFrame)):
            # Aggregator has pushed messages to the LLM, expect response soon
            self._waiting_for_llm = True
            
            # Cancel any previous filler task just in case
            if self._filler_task and not self._filler_task.done():
                self._filler_task.cancel()
                
            self._filler_task = asyncio.create_task(self._filler_timer())
            await self.push_frame(frame, direction)
            return
            
        if isinstance(frame, (LLMTextFrame, LLMFullResponseStartFrame, TextFrame)):
            if self._waiting_for_llm:
                self._waiting_for_llm = False
                if self._filler_task and not self._filler_task.done():
                    self._filler_task.cancel()
                    
        await self.push_frame(frame, direction)

    async def _filler_timer(self):
        try:
            await asyncio.sleep(self._delay_ms / 1000.0)
            if self._waiting_for_llm:
                # LLM took too long, inject a filler!
                filler_text = self._fillers[self._filler_index % len(self._fillers)]
                self._filler_index += 1
                logger.info(f"LLM latency exceeded {self._delay_ms}ms, injecting filler: '{filler_text}'")
                
                # Push a TextFrame directly down to TTS so it speaks immediately
                # Note: We send it downstream so the TTS processor catches it.
                await self.push_frame(TextFrame(text=filler_text), FrameDirection.DOWNSTREAM)
        except asyncio.CancelledError:
            pass
