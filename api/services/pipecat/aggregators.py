import re

from pipecat.frames.frames import (
    EndFrame,
    Frame,
    InterimTranscriptionFrame,
    TextFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor


class FastSentenceAggregator(FrameProcessor):
    """Aggregates text frames and flushes on any natural pause punctuation.

    Unlike the default SentenceAggregator which waits for terminal punctuation
    (.?!), this aggregator flushes on commas, semicolons, colons, and the Hindi
    Poorn Viram (| and ।). This acts as a middle-ground between SENTENCE mode
    and TOKEN mode for TTS latency, typically saving 50-100ms.
    """

    def __init__(self):
        super().__init__()
        self._aggregation = ""
        # Match terminal punctuation OR pause punctuation (comma, semicolon, colon, poorn viram)
        self._pause_pattern = re.compile(r"[,;:\.\?\!\|।]")

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, InterimTranscriptionFrame):
            return

        if isinstance(frame, TextFrame):
            self._aggregation += frame.text
            # Flush on any matching pause punctuation
            if self._pause_pattern.search(self._aggregation):
                await self.push_frame(TextFrame(self._aggregation))
                self._aggregation = ""
        elif isinstance(frame, EndFrame):
            if self._aggregation:
                await self.push_frame(TextFrame(self._aggregation))
                self._aggregation = ""
            await self.push_frame(frame, direction)
        else:
            await self.push_frame(frame, direction)
