"""Two seams to the platform for the Testing Lab: talk to an agent as text, and make a one-shot LLM call."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Protocol

from fastapi import HTTPException

from api.product.errors import product_error


@dataclass
class AgentReply:
    run_id: int
    text: str
    ended: bool = False
    tools: list[str] = field(default_factory=list)


class AgentTextGateway(Protocol):
    async def start(self, org_id: int, user_id: int, workflow_id: int) -> AgentReply: ...
    async def say(self, org_id: int, user_id: int, workflow_id: int, run_id: int, text: str) -> AgentReply: ...


class LLMGateway(Protocol):
    async def complete(self, org_id: int, user_id: int, system: str, messages: list[dict], platform: bool = False) -> str: ...


def _user(org_id: int, user_id: int):
    return SimpleNamespace(id=user_id, provider_id=f"u{user_id}", selected_organization_id=org_id, is_superuser=False, role="admin")


def _reply(resp) -> AgentReply:
    turns = (resp.session_data or {}).get("turns") or []
    last = turns[-1] if turns else {}
    text = ((last.get("assistant_message") or {}).get("text")) or ""
    tools = [e.get("payload", {}).get("function_name") or e.get("function_name") for e in last.get("events") or []
             if "function-call-start" in str(e.get("type", ""))]
    return AgentReply(resp.workflow_run_id, text, bool(resp.is_completed), [t for t in tools if t])


class CoreText:
    @staticmethod
    async def _call(coro):
        try:
            return await coro
        except HTTPException:
            raise product_error(502, "agent_unreachable", "We couldn't talk to the agent just now. Check that calls are set up, then try again.")

    async def start(self, org_id, user_id, workflow_id):
        from api.routes import workflow_text_chat as core

        return _reply(await self._call(core.create_text_chat_session(workflow_id, core.CreateTextChatSessionRequest(), user=_user(org_id, user_id))))

    async def say(self, org_id, user_id, workflow_id, run_id, text):
        from api.routes import workflow_text_chat as core

        return _reply(await self._call(core.append_text_chat_message(workflow_id, run_id, core.AppendTextChatMessageRequest(text=text), user=_user(org_id, user_id))))


class CoreLLM:
    async def complete(self, org_id, user_id, system, messages, platform=False):
        from api.db import db_client
        from api.services.pipecat.service_factory import create_llm_service_from_provider
        from api.services.workflow.qa.analysis import _run_llm_inference

        key = os.getenv("PRODUCT_ASSISTANT_OPENAI_KEY", "").strip()
        if platform and key:  # the app's own helper runs on the platform's key, so it works for every workspace
            cfg = {"provider": "openai", "api_key": key, "model": os.getenv("PRODUCT_ASSISTANT_MODEL", "").strip() or "gpt-4.1-mini"}
        else:
            cfg = (await db_client.get_user_configurations(user_id, organization_id=org_id)).model_dump(exclude_none=True).get("llm") or {}
        if not cfg.get("provider") or not cfg.get("api_key"):
            raise product_error(503, "ai_unavailable", "This feature isn't switched on for your workspace yet. Please contact support.")
        extra = {k: cfg[k] for k in ("base_url", "endpoint") if cfg.get(k)}
        try:
            llm = create_llm_service_from_provider(cfg["provider"], cfg.get("model"), cfg["api_key"], **extra)
            return (await _run_llm_inference(llm, messages, system)) or ""
        except Exception:  # noqa: BLE001 - provider errors are not for customers
            raise product_error(502, "ai_failed", "The AI helper didn't answer. Please try again in a moment.")


_text: AgentTextGateway = CoreText()
_llm: LLMGateway = CoreLLM()


def get_text() -> AgentTextGateway:
    return _text


def get_llm() -> LLMGateway:
    return _llm
