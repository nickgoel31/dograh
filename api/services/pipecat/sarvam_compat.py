"""Sarvam support that is newer than the bundled pipecat release.

pipecat's Sarvam services keep hard-coded model tables and reject anything they
do not know ("Unsupported model ..."). Sarvam ships models faster than that, and
the model settings UI lets users type a custom model id, so this module:

* registers ``bulbul:v4-flash`` (Sarvam's latest TTS) with its 222 persona voices,
* lets any other ``bulbul:*`` / ``saaras:*`` / ``saarika:*`` id through with the
  closest known behaviour instead of failing the call at start-up,
* provides a chat service that routes the open-weight models (gemma4, glm5.3,
  deepseekv4.1-flash) to Sarvam's ``/v2`` endpoint, keeps a conversation on one
  backend replica (``x-session-affinity``) and can switch thinking off.
"""

import uuid
from collections.abc import Mapping

from loguru import logger

from api.services.configuration.options.sarvam import (
    SARVAM_LLM_MODELS,
    SARVAM_LLM_V2_MODELS,
    SARVAM_V4_FLASH_DEFAULT_VOICE,
    SARVAM_V4_FLASH_VOICES,
)
from pipecat.services.sarvam import stt as _sarvam_stt
from pipecat.services.sarvam import tts as _sarvam_tts
from pipecat.services.sarvam.llm import SarvamLLMService

SARVAM_V1_BASE_URL = "https://api.sarvam.ai/v1"
SARVAM_V2_BASE_URL = "https://api.sarvam.ai/v2"

_DEFAULT_VOICES = {
    "bulbul:v2": "anushka",
    "bulbul:v3": "shubh",
    "bulbul:v3-beta": "shubh",
}

# bulbul:v4-flash: same request format as v3. Streaming is capped at 24 kHz, pace is
# 0.5-2.0, and pitch / loudness / temperature are not applicable.
_V4_FLASH_CONFIG = _sarvam_tts.TTSModelConfig(
    supports_pitch=False,
    supports_loudness=False,
    supports_temperature=False,
    default_sample_rate=24000,
    default_speaker=SARVAM_V4_FLASH_DEFAULT_VOICE,
    pace_range=(0.5, 2.0),
    preprocessing_always_enabled=True,
    speakers=tuple(SARVAM_V4_FLASH_VOICES),
)

_sarvam_tts.TTS_MODEL_CONFIGS.setdefault("bulbul:v4-flash", _V4_FLASH_CONFIG)


def default_sarvam_voice(model: str | None) -> str:
    """Voice to use when none is configured for ``model``."""
    return _DEFAULT_VOICES.get(model or "", SARVAM_V4_FLASH_DEFAULT_VOICE)


def ensure_sarvam_tts_model(model: str) -> None:
    """Make pipecat accept a custom TTS model id (modern models behave like v4-flash)."""
    if model not in _sarvam_tts.TTS_MODEL_CONFIGS:
        logger.warning(
            f"Unknown Sarvam TTS model '{model}': using bulbul:v4-flash behaviour"
        )
        _sarvam_tts.TTS_MODEL_CONFIGS[model] = _V4_FLASH_CONFIG


def ensure_sarvam_stt_model(model: str) -> None:
    """Make pipecat accept a custom STT model id."""
    configs = _sarvam_stt.MODEL_CONFIGS
    if model in configs:
        return
    base = "saaras:v3" if model.startswith("saaras:") else "saarika:v2.5"
    logger.warning(f"Unknown Sarvam STT model '{model}': using {base} behaviour")
    configs[model] = configs[base]


class DograhSarvamLLMService(SarvamLLMService):
    """Sarvam chat service that accepts any model id and routes it to the right API."""

    def __init__(
        self,
        *,
        api_key: str,
        settings: SarvamLLMService.Settings | None = None,
        thinking_off: bool = False,
        default_headers: Mapping[str, str] | None = None,
        **kwargs,
    ):
        model = getattr(settings, "model", None) if settings is not None else None
        base_url = kwargs.pop("base_url", None) or (
            SARVAM_V2_BASE_URL if model in SARVAM_LLM_V2_MODELS else SARVAM_V1_BASE_URL
        )
        headers = {"x-session-affinity": str(uuid.uuid4()), **(default_headers or {})}
        self._thinking_off = thinking_off
        super().__init__(
            api_key=api_key,
            base_url=base_url,
            settings=settings,
            default_headers=headers,
            **kwargs,
        )

    def _validate_model(self, model: str):
        if not model.strip():
            raise ValueError("Sarvam LLM requires a non-empty model string.")
        if model not in SARVAM_LLM_MODELS:
            logger.warning(f"Using custom Sarvam LLM model '{model}'")

    def build_chat_completion_params(self, params_from_context):
        params = super().build_chat_completion_params(params_from_context)
        if self._thinking_off:
            params["reasoning_effort"] = None  # explicit null disables thinking
        return params
