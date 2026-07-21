"""
Base pricing models for different service types.
"""

from decimal import Decimal
from enum import Enum
from typing import Any, Dict


class CostType(Enum):
    LLM_TOKENS = "llm_tokens"
    TTS_CHARACTERS = "tts_characters"
    STT_SECONDS = "stt_seconds"


class PricingModel:
    """Base class for pricing models"""

    def calculate_cost(self, usage: Any) -> Decimal:
        """Calculate cost based on usage"""
        raise NotImplementedError


class TokenPricingModel(PricingModel):
    """Pricing model for token-based services (LLM)"""

    def __init__(
        self,
        prompt_token_price: Decimal,
        completion_token_price: Decimal,
        cache_read_discount: Decimal = Decimal("0.5"),  # 50% discount for cache reads
        cache_creation_multiplier: Decimal = Decimal(
            "1.25"
        ),  # 25% premium for cache creation
    ):
        self.prompt_token_price = prompt_token_price
        self.completion_token_price = completion_token_price
        self.cache_read_discount = cache_read_discount
        self.cache_creation_multiplier = cache_creation_multiplier

    def calculate_cost(self, usage: Dict[str, int]) -> Decimal:
        """Calculate cost for LLM token usage"""
        prompt_tokens = usage.get("prompt_tokens", 0)
        completion_tokens = usage.get("completion_tokens", 0)
        cache_read_tokens = usage.get("cache_read_input_tokens") or 0
        cache_creation_tokens = usage.get("cache_creation_input_tokens") or 0

        # Base cost
        prompt_cost = Decimal(prompt_tokens) * self.prompt_token_price
        completion_cost = Decimal(completion_tokens) * self.completion_token_price

        # Cache adjustments
        cache_read_savings = (
            Decimal(cache_read_tokens)
            * self.prompt_token_price
            * self.cache_read_discount
        )
        cache_creation_premium = (
            Decimal(cache_creation_tokens)
            * self.prompt_token_price
            * (self.cache_creation_multiplier - 1)
        )

        total_cost = (
            prompt_cost + completion_cost - cache_read_savings + cache_creation_premium
        )
        return max(total_cost, Decimal("0"))  # Ensure non-negative


class MultimodalTokenPricingModel(PricingModel):
    """Pricing model for multimodal LLM services where audio and text tokens
    have different rates (e.g. Gemini Live).

    Google Gemini Live bills audio and text tokens separately:
      - Audio input:  $3.00 / 1M tokens
      - Text input:   $0.75 / 1M tokens
      - Audio output: $12.00 / 1M tokens
      - Text output:  $4.50 / 1M tokens

    The usage dict may carry explicit modality breakdowns under the keys
    ``audio_input_tokens``, ``text_input_tokens``, ``audio_output_tokens``,
    and ``text_output_tokens``.  When those are absent the model falls back
    to the blended ``prompt_tokens`` / ``completion_tokens`` counts, applying
    the audio rate as a conservative upper-bound estimate.
    """

    def __init__(
        self,
        audio_input_token_price: Decimal,
        text_input_token_price: Decimal,
        audio_output_token_price: Decimal,
        text_output_token_price: Decimal,
    ):
        self.audio_input_token_price = audio_input_token_price
        self.text_input_token_price = text_input_token_price
        self.audio_output_token_price = audio_output_token_price
        self.text_output_token_price = text_output_token_price

    def calculate_cost(self, usage: Dict[str, int]) -> Decimal:
        """Calculate cost using per-modality breakdown when available."""
        audio_input = usage.get("audio_input_tokens", 0) or 0
        text_input = usage.get("text_input_tokens", 0) or 0
        audio_output = usage.get("audio_output_tokens", 0) or 0
        text_output = usage.get("text_output_tokens", 0) or 0

        if audio_input or text_input or audio_output or text_output:
            # Explicit modality breakdown — use exact rates
            cost = (
                Decimal(audio_input) * self.audio_input_token_price
                + Decimal(text_input) * self.text_input_token_price
                + Decimal(audio_output) * self.audio_output_token_price
                + Decimal(text_output) * self.text_output_token_price
            )
        else:
            # Fallback: no breakdown available — use audio rate as upper bound
            prompt_tokens = usage.get("prompt_tokens", 0) or 0
            completion_tokens = usage.get("completion_tokens", 0) or 0
            cost = (
                Decimal(prompt_tokens) * self.audio_input_token_price
                + Decimal(completion_tokens) * self.audio_output_token_price
            )

        return max(cost, Decimal("0"))


class CharacterPricingModel(PricingModel):
    """Pricing model for character-based services (TTS)"""

    def __init__(self, character_price: Decimal):
        self.character_price = character_price

    def calculate_cost(self, character_count: int) -> Decimal:
        """Calculate cost for TTS character usage"""
        return Decimal(character_count) * self.character_price


class TimePricingModel(PricingModel):
    """Pricing model for time-based services (STT)"""

    def __init__(self, second_price: Decimal):
        self.second_price = second_price

    def calculate_cost(self, seconds: float) -> Decimal:
        """Calculate cost for STT time usage"""
        return Decimal(str(seconds)) * self.second_price
