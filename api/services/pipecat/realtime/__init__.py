"""Dograh-specific subclasses of pipecat realtime LLM services.

Each subclass wires Dograh engine integration quirks (user-mute gating,
TTSSpeakFrame greeting trigger, node-transition handling, function-call
deferral, etc.) onto the corresponding pipecat realtime service.

The pipecat fork's services stay close to upstream — Dograh behavior lives
here.
"""
from .azure_realtime import DograhAzureRealtimeLLMService
from .gemini_live import DograhGeminiLiveLLMService
from .gemini_live_vertex import DograhGeminiLiveVertexLLMService
from .grok_realtime import DograhGrokRealtimeLLMService
from .openai_realtime import DograhOpenAIRealtimeLLMService
from .ultravox_realtime import DograhUltravoxRealtimeLLMService
from .inworld_realtime import DograhInworldRealtimeLLMService

__all__ = [
    "DograhAzureRealtimeLLMService",
    "DograhGeminiLiveLLMService",
    "DograhGeminiLiveVertexLLMService",
    "DograhGrokRealtimeLLMService",
    "DograhOpenAIRealtimeLLMService",
    "DograhUltravoxRealtimeLLMService",
    "DograhInworldRealtimeLLMService",
]
