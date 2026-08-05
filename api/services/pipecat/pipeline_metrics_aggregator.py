import time
from collections import defaultdict
from typing import Dict, Optional

from loguru import logger

from pipecat.frames.frames import (
    CancelFrame,
    EndFrame,
    Frame,
    MetricsFrame,
    StartFrame,
)
from pipecat.metrics.metrics import (
    LLMTokenUsage,
    LLMUsageMetricsData,
    MetricsData,
    TTSUsageMetricsData,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor


class STTUsageMetricsData(MetricsData):
    """Speech-to-Text usage metrics data.

    Parameters:
        value: Audio seconds processed by STT.
    """

    value: float


class PipelineMetricsAggregator(FrameProcessor):
    def __init__(self):
        super().__init__()
        # Structure: {f"{processor}|||{model}": aggregated_metrics}
        # For LLM: aggregated_metrics is LLMTokenUsage
        # For TTS: aggregated_metrics is int (total characters)
        # For STT: aggregated_metrics is float (total seconds)

        self._start_time: Optional[float] = None
        self._stop_time: Optional[float] = None
        self._llm_usage_metrics: Dict[str, LLMTokenUsage] = {}
        self._llm_modality_metrics: Dict[str, Dict[str, int]] = defaultdict(
            lambda: defaultdict(int)
        )
        self._tts_usage_metrics: Dict[str, int] = defaultdict(int)
        self._tts_audio_seconds: Dict[str, float] = defaultdict(float)
        self._stt_usage_metrics: Dict[str, float] = defaultdict(float)

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, StartFrame):
            await self._start(frame)
        elif isinstance(frame, EndFrame):
            await self._stop(frame)
        elif isinstance(frame, CancelFrame):
            await self._cancel(frame)
        elif isinstance(frame, MetricsFrame):
            for data in frame.data:
                if isinstance(data, LLMUsageMetricsData):
                    await self._handle_llm_usage_metrics(data)
                elif isinstance(data, TTSUsageMetricsData):
                    await self._handle_tts_usage_metrics(data)
                elif isinstance(data, STTUsageMetricsData):
                    await self._handle_stt_usage_metrics(data)

        await self.push_frame(frame, direction)

    async def _start(self, _: StartFrame):
        """Start tracking call duration."""
        self._start_time = time.time()
        self._stop_time = None

    async def _stop(self, _: EndFrame):
        """Stop tracking call duration."""
        if self._start_time is not None and self._stop_time is None:
            self._stop_time = time.time()

    async def _cancel(self, _: CancelFrame):
        """Handle call cancellation - also stop tracking duration."""
        if self._start_time is not None and self._stop_time is None:
            self._stop_time = time.time()

    async def _handle_llm_usage_metrics(self, data: LLMUsageMetricsData):
        key = f"{data.processor}|||{data.model}"
        new_usage = data.value

        if key in self._llm_usage_metrics:
            # Aggregate with existing metrics
            existing = self._llm_usage_metrics[key]
            aggregated = LLMTokenUsage(
                prompt_tokens=existing.prompt_tokens + new_usage.prompt_tokens,
                completion_tokens=existing.completion_tokens
                + new_usage.completion_tokens,
                total_tokens=existing.total_tokens + new_usage.total_tokens,
                cache_read_input_tokens=(existing.cache_read_input_tokens or 0)
                + (new_usage.cache_read_input_tokens or 0),
                cache_creation_input_tokens=(existing.cache_creation_input_tokens or 0)
                + (new_usage.cache_creation_input_tokens or 0),
            )
            self._llm_usage_metrics[key] = aggregated
        else:
            # First occurrence for this processor+model combination
            self._llm_usage_metrics[key] = LLMTokenUsage(
                prompt_tokens=new_usage.prompt_tokens,
                completion_tokens=new_usage.completion_tokens,
                total_tokens=new_usage.total_tokens,
                cache_read_input_tokens=new_usage.cache_read_input_tokens,
                cache_creation_input_tokens=new_usage.cache_creation_input_tokens,
            )

        # Track per-modality metrics safely in dictionary
        text_in = getattr(new_usage, "text_input_tokens", None) or 0
        audio_in = getattr(new_usage, "audio_input_tokens", None) or 0
        text_out = getattr(new_usage, "text_output_tokens", None) or 0
        audio_out = getattr(new_usage, "audio_output_tokens", None) or 0

        self._llm_modality_metrics[key]["text_input_tokens"] += text_in
        self._llm_modality_metrics[key]["audio_input_tokens"] += audio_in
        self._llm_modality_metrics[key]["text_output_tokens"] += text_out
        self._llm_modality_metrics[key]["audio_output_tokens"] += audio_out

        logger.debug(f"LLM usage metrics: {self._llm_usage_metrics}")

    async def _handle_tts_usage_metrics(self, data: TTSUsageMetricsData):
        key = f"{data.processor}|||{data.model}"
        self._tts_usage_metrics[key] += data.value
        sec = getattr(data, "audio_seconds", 0.0) or 0.0
        if sec > 0:
            self._tts_audio_seconds[key] += sec

    async def _handle_stt_usage_metrics(self, data: STTUsageMetricsData):
        key = f"{data.processor}|||{data.model}"
        self._stt_usage_metrics[key] += data.value

    def get_llm_usage_metrics(self) -> Dict[str, LLMTokenUsage]:
        """Get the aggregated LLM usage metrics grouped by processor|||model."""
        return self._llm_usage_metrics

    def get_tts_usage_metrics(self) -> Dict[str, int]:
        """Get the aggregated TTS usage metrics grouped by processor|||model."""
        return self._tts_usage_metrics

    def get_stt_usage_metrics(self) -> Dict[str, float]:
        """Get the aggregated STT usage metrics grouped by processor|||model."""
        return self._stt_usage_metrics

    def get_call_duration(self) -> float:
        """Get call duration"""
        if self._start_time is None:
            return 0.0

        if self._stop_time is None:
            call_duration = time.time() - self._start_time
        else:
            call_duration = self._stop_time - self._start_time

        # Lets return a rounded integer
        return int(round(call_duration))

    def get_all_usage_metrics_serialized(self) -> Dict[str, Dict[str, any]]:
        """Get all aggregated usage metrics in JSON-serializable format."""
        serialized_llm = {}
        for key, usage in self._llm_usage_metrics.items():
            modality = self._llm_modality_metrics.get(key, {})
            serialized_llm[key] = {
                "prompt_tokens": usage.prompt_tokens,
                "completion_tokens": usage.completion_tokens,
                "total_tokens": usage.total_tokens,
                "cache_read_input_tokens": usage.cache_read_input_tokens,
                "cache_creation_input_tokens": usage.cache_creation_input_tokens,
                "text_input_tokens": modality.get("text_input_tokens", 0),
                "audio_input_tokens": modality.get("audio_input_tokens", 0),
                "text_output_tokens": modality.get("text_output_tokens", 0),
                "audio_output_tokens": modality.get("audio_output_tokens", 0),
            }

        serialized_tts = {}
        for key, chars in self._tts_usage_metrics.items():
            sec = self._tts_audio_seconds.get(key, 0.0)
            if sec > 0:
                serialized_tts[key] = {
                    "characters": chars,
                    "audio_seconds": round(sec, 2),
                }
            else:
                serialized_tts[key] = chars

        serialized_stt = {}
        for key, seconds in self._stt_usage_metrics.items():
            serialized_stt[key] = {
                "audio_seconds": round(seconds, 2),
            }

        return {
            "llm": serialized_llm,
            "tts": serialized_tts,
            "stt": serialized_stt,
            "call_duration_seconds": self.get_call_duration(),
        }

    def reset_metrics(self):
        """Reset all aggregated metrics."""
        self._llm_usage_metrics.clear()
        self._llm_modality_metrics.clear()
        self._tts_usage_metrics.clear()
        self._tts_audio_seconds.clear()
        self._stt_usage_metrics.clear()
        self._start_time = None
        self._stop_time = None
