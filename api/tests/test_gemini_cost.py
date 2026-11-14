"""Gemini Live cost: exact audio/text split of each turn, and the history cap."""

from decimal import Decimal
from types import SimpleNamespace as NS

from api.services.pipecat.realtime import gemini_cost as gc
from api.services.pricing.models import MultimodalTokenPricingModel


def det(**kw):
    return [NS(modality=NS(value=k), token_count=v) for k, v in kw.items()]


def test_usage_is_split_into_audio_and_text():
    u = NS(prompt_tokens_details=det(AUDIO=3000, TEXT=2000), tool_use_prompt_tokens_details=det(TEXT=100), response_tokens_details=det(AUDIO=400, TEXT=60), thoughts_token_count=25)
    assert gc.split_usage(u) == {"audio_input_tokens": 3000, "text_input_tokens": 2100, "audio_output_tokens": 400, "text_output_tokens": 85}


def test_no_breakdown_from_google_means_no_split():
    assert gc.split_usage(NS(prompt_tokens_details=None, response_tokens_details=None, tool_use_prompt_tokens_details=None, thoughts_token_count=0)) == {}


def test_exact_split_costs_less_than_pricing_everything_as_audio():
    price = MultimodalTokenPricingModel(Decimal("3") / 10**6, Decimal("0.75") / 10**6, Decimal("12") / 10**6, Decimal("4.5") / 10**6)
    split = {"audio_input_tokens": 1000, "text_input_tokens": 4000, "audio_output_tokens": 300, "text_output_tokens": 50}
    blended = {"prompt_tokens": 5000, "completion_tokens": 350}
    assert price.calculate_cost(split) < price.calculate_cost(blended)


def test_history_cap_is_relative_to_the_instructions_and_can_be_tuned(monkeypatch):
    monkeypatch.delenv("GEMINI_LIVE_HISTORY_TRIGGER_TOKENS", raising=False)
    monkeypatch.delenv("GEMINI_LIVE_HISTORY_TARGET_TOKENS", raising=False)
    assert gc.compression_limits(3000) == (6000, 4200)
    monkeypatch.setenv("GEMINI_LIVE_HISTORY_TRIGGER_TOKENS", "3000")
    monkeypatch.setenv("GEMINI_LIVE_HISTORY_TARGET_TOKENS", "100")  # too little memory: raised to the floor
    assert gc.compression_limits(1000) == (4000, 1800)
    monkeypatch.setenv("GEMINI_LIVE_HISTORY_TRIGGER_TOKENS", "junk")
    assert gc.history_budget()[0] >= gc.MIN_TARGET


def test_token_estimate_counts_indian_scripts_heavier():
    assert gc.estimate_tokens("hello world " * 100) < gc.estimate_tokens("नमस्ते दुनिया " * 100)
    assert gc.estimate_tokens("") == 0


# ---------- the real service class ----------
import pytest  # noqa: E402
from unittest.mock import AsyncMock  # noqa: E402

from api.tests.test_gemini_live_reconnect_tool_results import _make_service  # noqa: E402


@pytest.mark.asyncio
async def test_service_reports_the_split_usage_of_each_turn():
    service = _make_service()
    sent = []
    service.start_llm_usage_metrics = AsyncMock(side_effect=lambda t: sent.append(t))
    usage = NS(prompt_token_count=5000, response_token_count=400, total_token_count=5400, cached_content_token_count=None, thoughts_token_count=0,
               prompt_tokens_details=det(AUDIO=3000, TEXT=2000), tool_use_prompt_tokens_details=None, response_tokens_details=det(AUDIO=400))
    await service._handle_msg_usage_metadata(NS(usage_metadata=usage))
    t = sent[0]
    assert (t.prompt_tokens, t.completion_tokens) == (5000, 400)
    assert (getattr(t, "audio_input_tokens", None), getattr(t, "text_input_tokens", None), getattr(t, "audio_output_tokens", None)) == (3000, 2000, 400)


@pytest.mark.asyncio
async def test_service_caps_the_history_before_connecting(monkeypatch):
    from google.genai.types import ContextWindowCompressionConfig, LiveConnectConfig, SlidingWindow

    service = _make_service()
    seen = {}

    async def fake_super(self, config):
        seen["cfg"] = config

    from pipecat.services.google.gemini_live.llm import GeminiLiveLLMService

    monkeypatch.setattr(GeminiLiveLLMService, "_connection_task_handler", fake_super)
    cfg = LiveConnectConfig(system_instruction="a" * 3600, context_window_compression=ContextWindowCompressionConfig(trigger_tokens=8000, sliding_window=SlidingWindow()))
    await service._connection_task_handler(cfg)
    c = seen["cfg"].context_window_compression
    base = gc.estimate_tokens("a" * 3600)
    assert c.trigger_tokens == base + 3000 and c.sliding_window.target_tokens == base + 1200
