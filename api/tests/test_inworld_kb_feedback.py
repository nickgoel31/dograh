"""Knowledge-base search feedback + response queueing in the Inworld realtime wrapper."""

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api.services.pipecat.realtime.inworld_realtime import (
    DograhInworldRealtimeLLMService,
)
from pipecat.services.inworld.realtime.llm import InworldRealtimeLLMService

pytestmark = pytest.mark.anyio


@pytest.fixture
def svc():
    s = DograhInworldRealtimeLLMService(api_key="test-key")
    s._api_session_ready = True
    s._ws_send = AsyncMock()
    s._context = MagicMock()
    return s


def _function_call(svc, name="retrieve_from_knowledge_base"):
    svc._pending_function_calls["c1"] = SimpleNamespace(name=name)
    svc.run_function_calls = AsyncMock()
    return SimpleNamespace(call_id="c1", arguments=json.dumps({"query": "refund policy"}))


async def _finish_response(svc):
    with patch.object(InworldRealtimeLLMService, "_handle_evt_response_done", AsyncMock()), patch.object(
        svc, "_extract_response_usage", AsyncMock()
    ):
        await svc._handle_evt_response_done(SimpleNamespace())


async def test_create_response_is_queued_while_another_is_in_flight(svc):
    parent_create = AsyncMock()
    with patch.object(InworldRealtimeLLMService, "_create_response", parent_create):
        svc._mark_response_active()
        await svc._create_response()  # e.g. the KB tool result arriving early
        parent_create.assert_not_called()

        await _finish_response(svc)  # the in-flight response ends

        parent_create.assert_called_once()  # answer is generated automatically


async def test_stale_response_does_not_block_forever(svc):
    parent_create = AsyncMock()
    with patch.object(InworldRealtimeLLMService, "_create_response", parent_create):
        svc._mark_response_active()
        svc._response_active_since -= 60
        await svc._create_response()
        parent_create.assert_called_once()


async def test_silent_kb_call_triggers_holding_phrase_after_response_done(svc):
    evt = _function_call(svc)

    await svc._handle_evt_function_call_arguments_done(evt)
    svc.run_function_calls.assert_awaited_once()  # search starts immediately
    assert svc._pending_kb_filler

    await _finish_response(svc)

    sent = [c.args[0] for c in svc._ws_send.await_args_list]
    assert any(
        m["type"] == "response.create" and "holding phrase" in m["response"]["instructions"]
        for m in sent
    )


async def test_no_holding_phrase_when_model_already_spoke(svc):
    svc._audio_in_response = True  # model said "let me check" itself
    await svc._handle_evt_function_call_arguments_done(_function_call(svc))
    assert not svc._pending_kb_filler


async def test_no_holding_phrase_for_other_tools(svc):
    await svc._handle_evt_function_call_arguments_done(_function_call(svc, "end_call"))
    assert not svc._pending_kb_filler


async def test_fast_result_skips_holding_phrase_and_answers_immediately(svc):
    parent_create = AsyncMock()
    with patch.object(InworldRealtimeLLMService, "_create_response", parent_create):
        await svc._handle_evt_function_call_arguments_done(_function_call(svc))
        svc._mark_response_active()
        await svc._create_response()  # KB result arrived before response.done

        await _finish_response(svc)

    parent_create.assert_called_once()
    assert not [c for c in svc._ws_send.await_args_list if "instructions" in json.dumps(c.args[0])]


async def test_slow_result_gets_holding_phrase_then_answer(svc):
    parent_create = AsyncMock()
    with patch.object(InworldRealtimeLLMService, "_create_response", parent_create):
        await svc._handle_evt_function_call_arguments_done(_function_call(svc))
        await _finish_response(svc)  # first response ends -> holding phrase starts
        assert svc._response_active

        await svc._create_response()  # search finishes while the phrase is playing
        parent_create.assert_not_called()

        await _finish_response(svc)  # phrase ends -> answer
        parent_create.assert_called_once()


async def test_filler_can_be_disabled():
    s = DograhInworldRealtimeLLMService(api_key="k", kb_search_filler=False)
    s._api_session_ready = True
    s._pending_function_calls["c1"] = SimpleNamespace(name="retrieve_from_knowledge_base")
    s._context = MagicMock()
    s.run_function_calls = AsyncMock()
    await s._handle_evt_function_call_arguments_done(
        SimpleNamespace(call_id="c1", arguments="{}")
    )
    assert not s._pending_kb_filler
