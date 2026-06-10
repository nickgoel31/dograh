from typing import List, Optional
import re
from loguru import logger
from pipecat.frames.frames import (
    Frame,
    InterimTranscriptionFrame,
    TranscriptionFrame,
    UserStoppedSpeakingFrame,
    UserStartedSpeakingFrame,
    InterruptionFrame,
)
from pipecat.processors.frame_processor import FrameProcessor, FrameDirection

class InterimTranscriptionHandler(FrameProcessor):
    def __init__(self, min_confidence: float = 0.85, min_words: int = 3):
        super().__init__()
        self._min_confidence = min_confidence
        self._min_words = min_words
        self._early_triggered = False
        self._interruption_triggered = False
        self._last_final_text = ""
        
        # Fast intent keywords that usually indicate a full intent
        self._intent_patterns = [
            r"\b(yes|no|hello|hi|yeah|nope)\b",
            r"\b(check|karta|batata|haan|ji)\b"
        ]

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, TranscriptionFrame):
            self._early_triggered = False
            self._interruption_triggered = False
            self._last_final_text = frame.text
            await self.push_frame(frame, direction)
            return

        if isinstance(frame, InterimTranscriptionFrame):
            if self._early_triggered:
                return # We already early-triggered for this turn

            text = frame.text.strip()
            if not text:
                await self.push_frame(frame, direction)
                return

            word_count = len(text.split())
            confidence = getattr(frame, "confidence", 1.0) # Deepgram provides this or it defaults
            
            # Phase 5: Barge-in support. Trigger bot interruption immediately when user speaks.
            if not self._interruption_triggered:
                self._interruption_triggered = True
                await self.push_frame(InterruptionFrame(), direction)

            # Check fast keywords
            matched_intent = any(re.search(p, text.lower()) for p in self._intent_patterns)
            
            # Early trigger logic
            if (confidence >= self._min_confidence and word_count >= self._min_words) or matched_intent:
                logger.info(f"Early trigger on interim transcript: '{text}' (conf={confidence}, words={word_count})")
                self._early_triggered = True
                
                # Convert interim to final transcription to force downstream processing
                await self.push_frame(TranscriptionFrame(text=text, user_id=frame.user_id, timestamp=frame.timestamp), direction)
                # Emit user stopped speaking to terminate the turn aggregator collection
                await self.push_frame(UserStoppedSpeakingFrame(), direction)
                return
            
            # Forward the interim frame normally if not triggered
            await self.push_frame(frame, direction)
            return

        await self.push_frame(frame, direction)
