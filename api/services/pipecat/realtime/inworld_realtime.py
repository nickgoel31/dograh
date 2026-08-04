"""Dograh subclass of pipecat's Inworld Realtime LLM service.

Layers Dograh engine integration quirks onto upstream-pristine
:class:`InworldRealtimeLLMService`.

Adds:

- **User-mute audio gating** via ``UserMuteStarted/StoppedFrame``.
- **TTSSpeakFrame as initial-response trigger** so the engine's greeting
  flow kicks off the bot's first response.
- **One-off LLMMessagesAppendFrame handling** for ephemeral realtime prompts
  like user-idle checks, without mutating Dograh's local ``LLMContext``.
- **finalized=True on TranscriptionFrame** because every Inworld
  transcription via the ``completed`` event is final by construction.
- **STT language, vocabulary hints, turn-detection mode, and eagerness**
  via Inworld's ``providerData.stt`` and ``audio.input.transcription``.
"""

import json
from typing import Any, Literal

from loguru import logger

from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    Frame,
    LLMFullResponseStartFrame,
    LLMMessagesAppendFrame,
    TranscriptionFrame,
    TTSSpeakFrame,
    UserMuteStartedFrame,
    UserMuteStoppedFrame,
)
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.frame_processor import FrameDirection
from pipecat.services.llm_service import FunctionCallFromLLM
from pipecat.services.inworld.realtime import events
from pipecat.services.inworld.realtime.llm import InworldRealtimeLLMService
from pipecat.transcriptions.language import Language
from pipecat.utils.time import time_now_iso8601


class DograhInworldRealtimeLLMService(InworldRealtimeLLMService):
    """Inworld Realtime with Dograh engine integration quirks. See module docstring."""

    @staticmethod
    def _speed_to_steering_tag(speed: float) -> str | None:
        """Map a numeric speed multiplier to an inworld-tts-2 steering tag.

        inworld-tts-2 does NOT honour ``audio.output.speed`` numerically —
        speed is steered via natural-language bracket tags that the TTS model
        interprets during synthesis. This method returns the appropriate tag
        (or ``None`` for the natural-speed range) so it can be prepended to
        every system instruction.

        Speed → tag mapping:
            ≤ 0.6   → ``[very slow]``
            0.7–0.89 → ``[slow]``
            0.9–1.1  → None (default / natural speed)
            1.1–1.3  → ``[slightly fast]``
            1.3–1.6  → ``[speak fast]``
            1.6–1.85 → ``[very fast]``
            > 1.85   → ``[extremely fast]``
        """
        if speed <= 0.6:
            return "[very slow]"
        elif speed <= 0.89:
            return "[slow]"
        elif speed <= 1.1:
            return None  # natural/default speed — no tag needed
        elif speed <= 1.3:
            return "[slightly fast]"
        elif speed <= 1.6:
            return "[speak fast]"
        elif speed <= 1.85:
            return "[very fast]"
        else:
            return "[extremely fast]"

    def __init__(
        self,
        *,
        language: str | None = None,
        turn_detection: Literal["semantic_vad", "server_vad"] = "semantic_vad",
        stt_eagerness: Literal["low", "medium", "high", "auto"] = "low",
        transcription_prompt: str | None = None,
        tts_speed: float = 1.5,
        **kwargs,
    ):
        """Initialize DograhInworldRealtimeLLMService.

        Args:
            language: BCP-47 language code for STT (e.g. ``"en"``, ``"es"``).
                Auto-detects when ``None``.
            turn_detection: Turn detection mode. ``"semantic_vad"`` (default)
                uses model-based understanding; ``"server_vad"`` uses energy-based VAD.
            stt_eagerness: How aggressively to detect end-of-turn for
                ``semantic_vad``. One of ``"low"``, ``"medium"``, ``"high"``,
                ``"auto"``. Lower eagerness waits longer before committing;
                higher eagerness responds faster but may cut users off.
            transcription_prompt: Custom vocabulary hint passed to the STT
                model (e.g. brand names, technical jargon). Soft bias only —
                not a strict whitelist.
            tts_speed: TTS speaking rate multiplier. ``1.0`` is the model's
                natural speed. ``1.5`` (default) is noticeably faster and
                recommended for most voice agents. Range ``0.5``–``2.0``.
                For ``inworld-tts-2`` this maps to a steering tag injected
                into the system instructions; ``audio.output.speed`` is also
                set for non-TTS-2 model fallback.
            **kwargs: Remaining keyword arguments forwarded to
                :class:`InworldRealtimeLLMService`, including ``api_key``,
                ``llm_model``, ``voice``, ``tts_model``, ``stt_model``.
        """
        # Extract shorthand model params that the upstream service accepts
        # directly; we'll rebuild a full SessionProperties so the upstream
        # __init__ doesn't need to also set these.
        stt_model = kwargs.pop("stt_model", None) or "inworld/inworld-stt-1"
        tts_model = kwargs.pop("tts_model", None) or "inworld-tts-2"
        llm_model = kwargs.pop("llm_model", None) or "google-ai-studio/gemini-2.5-flash-lite"
        voice = kwargs.pop("voice", None) or "Riya"

        # Resolve STT language: "auto", None, or empty string disables explicit language
        # parameter so Inworld STT performs multilingual auto-detection.
        stt_lang = language if (language and language.lower() not in ("auto", "none", "null", "")) else None

        # Build InputTranscription with model, language, and vocabulary hint.
        # language and prompt are native fields on InputTranscription (added
        # to the pipecat submodule) and are serialized by model_dump(exclude_none=True).
        transcription = events.InputTranscription(
            model=stt_model,
            language=stt_lang,
            prompt=transcription_prompt or None,
        )

        # Build TurnDetection; eagerness is only meaningful for semantic_vad
        # (ignored by server_vad). TurnDetection.eagerness accepts None, so
        # passing None here is safe and results in the field being excluded via
        # model_dump(exclude_none=True).
        turn_det = events.TurnDetection(
            type=turn_detection,
            eagerness=stt_eagerness if turn_detection == "semantic_vad" else None,
            create_response=True,
            interrupt_response=True,
        )

        parsed_speed = float(tts_speed) if tts_speed is not None else 1.5

        # Build session properties.
        # NOTE: audio.output.speed is set for OpenAI-compatible/legacy model
        # support, but inworld-tts-2 ignores that field — it uses steering
        # tags instead. The _speed_to_steering_tag() result is injected into
        # the system instructions at _send_session_update() time.
        session_properties = events.SessionProperties(
            model=llm_model,
            output_modalities=["audio", "text"],
            audio=events.AudioConfiguration(
                input=events.AudioInput(
                    format=events.PCMAudioFormat(rate=24000),
                    transcription=transcription,
                    turn_detection=turn_det,
                ),
                output=events.AudioOutput(
                    format=events.PCMAudioFormat(rate=24000),
                    model=tts_model,
                    voice=voice,
                    speed=parsed_speed,
                ),
            ),
            # providerData.tts — note: 'speed' is NOT a valid providerData.tts
            # field (Inworld ignores it silently). Valid fields are:
            # segmenter_strategy, steering_handling, language, delivery_mode,
            # conversational, user_turn_mode, timestamp_type,
            # timestamp_transport_strategy.
            provider_data={
                "tts": {
                    "steering_handling": "emit_once",
                }
            },
        )

        super().__init__(
            llm_model=llm_model,
            voice=voice,
            tts_model=tts_model,
            stt_model=stt_model,
            settings=InworldRealtimeLLMService.Settings(
                model=llm_model,
                session_properties=session_properties,
            ),
            **kwargs,
        )
        self._tts_speed = parsed_speed
        self._tts_model = tts_model
        self._user_is_muted: bool = False
        self._handled_initial_context: bool = False
        self._bot_is_speaking: bool = False
        self._deferred_function_calls: list[FunctionCallFromLLM] = []


    # ------------------------------------------------------------------
    # Speed steering: inject tag into instructions before session.update
    # ------------------------------------------------------------------

    async def _send_session_update(self):
        """Override to prepend TTS-2 speed steering tag to system instructions.

        ``inworld-tts-2`` does not honour ``audio.output.speed`` \u2014 speech
        speed is controlled via natural-language steering tags embedded in the
        text. We inject the speed steering tag (e.g. ``[speak fast]``) into the
        system instructions before the ``session.update`` event is sent so that
        TTS-2 renders all responses at the configured rate.

        The tag is written into the **working copy** of session_properties that
        the parent creates inside ``_send_session_update``.  We achieve this by
        temporarily patching ``send_client_event`` for the duration of the
        parent's call so we can intercept the ``SessionUpdateEvent`` payload and
        inject the tag into ``session.instructions`` right before transmission.
        """
        tag = self._speed_to_steering_tag(self._tts_speed)

        if not (tag and self._tts_model and "tts-2" in self._tts_model.lower()):
            await super()._send_session_update()
            return

        # Monkey-patch send_client_event for this one call so we can intercept
        # the SessionUpdateEvent and inject the speed tag.
        original_send = self.send_client_event

        async def _intercept_send(event):
            from pipecat.services.inworld.realtime.events import SessionUpdateEvent
            if isinstance(event, SessionUpdateEvent):
                sp = event.session
                raw = sp.instructions or ""
                if not raw.strip().startswith(tag):
                    sp.instructions = f"{tag}\n{raw}" if raw else tag
            await original_send(event)

        self.send_client_event = _intercept_send
        try:
            await super()._send_session_update()
        finally:
            self.send_client_event = original_send


    # ------------------------------------------------------------------
    # Frame handling: mute, TTSSpeakFrame as greeting trigger
    # ------------------------------------------------------------------

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        if isinstance(frame, UserMuteStartedFrame):
            self._user_is_muted = True
            await self.push_frame(frame, direction)
            return
        if isinstance(frame, UserMuteStoppedFrame):
            self._user_is_muted = False
            await self.push_frame(frame, direction)
            return
        if isinstance(frame, TTSSpeakFrame):
            # Greeting trigger: the engine queues a TTSSpeakFrame after node
            # setup. Inworld Realtime renders its own audio, so we don't pass
            # the frame to TTS. Route through _handle_context so the initial
            # response and later tool-result turns share the same context
            # lifecycle even when Dograh has already pre-populated self._context.
            if not self._handled_initial_context:
                # Google models behind Inworld fail if there is no non-system message
                # before the first response.create.
                model_name = getattr(self._settings, "model", "") or ""
                if "google" in model_name.lower():
                    has_non_system = any(m.get("role") not in ("system", "developer") for m in self._context.messages)
                    if not has_non_system:
                        self._context.add_message({"role": "user", "content": "Hello!"})
                await self._handle_context(self._context)
            else:
                logger.warning(
                    f"{self}: TTSSpeakFrame after initial context already "
                    "handled — Inworld Realtime owns audio generation, ignoring"
                )
            # Don't forward the frame; the audio path is owned by the realtime
            # service itself.
            return
        if isinstance(frame, LLMMessagesAppendFrame):
            await self._handle_messages_append(frame)
            return
        if isinstance(frame, BotStartedSpeakingFrame):
            self._bot_is_speaking = True
        elif isinstance(frame, BotStoppedSpeakingFrame):
            self._bot_is_speaking = False
            await self._run_pending_function_calls()
        await super().process_frame(frame, direction)

    async def _handle_messages_append(self, frame: LLMMessagesAppendFrame):
        """Consume a one-off append frame without mutating the local LLMContext."""
        if self._disconnecting:
            return

        if not self._api_session_ready:
            if frame.run_llm:
                logger.debug(
                    f"{self}: LLMMessagesAppendFrame received before session ready; "
                    "deferring response until the session is initialized"
                )
                self._run_llm_when_api_session_ready = True
            return

        appended_any = False
        for message in frame.messages:
            item = self._message_to_conversation_item(message)
            if item is None:
                continue
            evt = events.ConversationItemCreateEvent(item=item)
            self._messages_added_manually[evt.item.id] = True
            await self.send_client_event(evt)
            appended_any = True

        if frame.run_llm and appended_any:
            await self._send_manual_response_create()

    async def _handle_context(self, context: LLMContext):
        if not self._handled_initial_context:
            if context is None:
                logger.warning(
                    f"{self}: received initial context trigger before context was set"
                )
                return
            self._handled_initial_context = True
            self._context = context
            await self._create_response()
        else:
            self._context = context
            await self._process_completed_function_calls(send_new_results=True)

    async def _send_user_audio(self, frame):
        if self._user_is_muted:
            return
        await super()._send_user_audio(frame)

    def _message_to_conversation_item(
        self, message: dict[str, Any]
    ) -> events.ConversationItem | None:
        if not isinstance(message, dict):
            logger.warning(
                f"{self}: skipping unsupported appended message payload {message!r}"
            )
            return None

        role = message.get("role")
        if role not in {"user", "system", "developer"}:
            logger.warning(
                f"{self}: skipping unsupported appended message role {role!r}"
            )
            return None

        text = self._extract_text_content(message.get("content"))
        if not text:
            logger.warning(
                f"{self}: skipping appended message with unsupported content {message!r}"
            )
            return None

        item_role = "system" if role in {"system", "developer"} else "user"
        return events.ConversationItem(
            type="message",
            role=item_role,
            content=[events.ItemContent(type="input_text", text=text)],
        )

    @staticmethod
    def _extract_text_content(content: Any) -> str | None:
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts: list[str] = []
            for part in content:
                if not isinstance(part, dict):
                    return None
                if part.get("type") != "text":
                    return None
                text = part.get("text")
                if not isinstance(text, str):
                    return None
                parts.append(text)
            return "\n".join(parts) if parts else None
        return None

    async def _send_manual_response_create(self):
        """Trigger inference after manually appending conversation items."""
        await self.push_frame(LLMFullResponseStartFrame())
        await self.start_processing_metrics()
        await self.start_ttfb_metrics()
        await self.send_client_event(
            events.ResponseCreateEvent(
                response=events.ResponseProperties(
                    # Output modalities handling logic might be specific,
                    # but usually audio and text are requested
                    output_modalities=["audio", "text"]
                )
            )
        )

    async def _run_pending_function_calls(self):
        if not self._deferred_function_calls:
            return
        function_calls = self._deferred_function_calls
        self._deferred_function_calls = []
        logger.debug(
            f"{self}: executing {len(function_calls)} deferred function call(s) "
            "after bot turn ended"
        )
        await self.run_function_calls(function_calls)

    async def _handle_evt_function_call_arguments_done(self, evt):
        """Process or defer tool calls until the bot finishes speaking."""
        try:
            args = json.loads(evt.arguments)

            function_call_item = self._pending_function_calls.get(evt.call_id)
            if function_call_item:
                del self._pending_function_calls[evt.call_id]

                function_calls = [
                    FunctionCallFromLLM(
                        context=self._context,
                        tool_call_id=evt.call_id,
                        function_name=function_call_item.name,
                        arguments=args,
                    )
                ]

                if self._bot_is_speaking:
                    self._deferred_function_calls.extend(function_calls)
                    logger.debug(
                        f"{self}: deferring function call {function_call_item.name} "
                        "until bot stops speaking"
                    )
                else:
                    await self.run_function_calls(function_calls)
                    logger.debug(f"Processed function call: {function_call_item.name}")
            else:
                logger.warning(
                    f"No tracked function call found for call_id: {evt.call_id}"
                )
                logger.warning(
                    f"Available pending calls: {list(self._pending_function_calls.keys())}"
                )

        except Exception as e:
            logger.error(f"Failed to process function call arguments: {e}")

    # ------------------------------------------------------------------
    # Transcription: broadcast with finalized=True for every
    # completed-transcription event from Inworld.
    # ------------------------------------------------------------------

    async def _handle_evt_input_audio_transcription_completed(self, evt):
        await self._call_event_handler(
            "on_conversation_item_updated", evt.item_id, None
        )
        transcript = evt.transcript.strip() if evt.transcript else ""
        if not transcript:
            return

        await self.broadcast_frame(
            TranscriptionFrame,
            text=transcript,
            user_id="",
            timestamp=time_now_iso8601(),
            result=evt,
            finalized=True,
        )
