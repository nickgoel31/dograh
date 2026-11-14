"""The Swarvo MCP server: lets Claude, ChatGPT or any MCP client run a customer's account for them.

Connect with the workspace's MCP token (Developers > MCP access). Every tool calls the same product API the app uses, in-process and as the person who
created the token, so roles, workspaces, limits, validation and the audit log all apply exactly as if they had clicked the buttons themselves.

A *read-only* token (swm_r_...) can only read. A *full* token (swm_f_...) can change anything its creator can. A few things are never available
through MCP: signing in or out, passwords, two-step sign-in, the owner's admin area and the scheduler.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal

import httpx
from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from fastmcp.server.dependencies import get_http_headers
from mcp.types import Icon, ToolAnnotations
from sqlalchemy import select

from api.db.models import UserModel
from api.db.product_models import ProductApiKeyModel, ProductWorkspaceModel
from api.product import developers as dev
from api.product.deps import session_factory

API_PREFIX = "/api/v1"  # where the product API is mounted (tests set this to "")
RATE_PER_MINUTE = 240
TOKEN_RE = re.compile(r"^swm_[rf]_[A-Za-z0-9_\-]{20,80}$")
# Never reachable through MCP, whatever the token.
BLOCKED = ("/auth", "/admin", "/ops", "/account/password", "/account/phone", "/team/2fa", "/billing/webhooks", "/hooks")
Env = Literal["live", "test"]

INSTRUCTIONS = """You are connected to a Swarvo AI workspace: a platform for building AI voice agents that answer and make phone calls. You can look at everything in the account and change it.

How things work:
- Agents have a private TEST copy (edit and try freely) and a LIVE copy that callers reach. publish_agent sends the latest changes live. Phone numbers, calls and campaigns belong to the LIVE side; pass environment="test" to see practice calls.
- To make a new agent quickly, call setup_agent with the person's website and/or a few words about the business and what the agent should do. It reads the site, writes the agent, adds knowledge, picks a voice, publishes it and connects a free number, with no further questions. Use create_agent only when you need exact control.
- Money: calls are billed per minute from the wallet. Never top up, buy a number or run a campaign unless the person clearly asked for it.
- Voices: list_voices shows what is available. Voices marked available=false are not switched on for this workspace.
- If a tool does not exist for something, use api_request (use search_api first to find the right path).
Be careful with anything that calls real people (campaigns, call-backs), releases a phone number, or deletes an agent or knowledge. Say what you are about to do and confirm when the request was not explicit."""

_SITE = os.getenv("PRODUCT_PUBLIC_URL", "https://app.swarvoai.com").rstrip("/")
mcp = FastMCP("swarvo", instructions=INSTRUCTIONS, website_url=_SITE,
              icons=[Icon(src=f"{_SITE}/logo-icon.ico", mimeType="image/x-icon", sizes=["any"])])
_READ = ToolAnnotations(readOnlyHint=True, idempotentHint=True, destructiveHint=False, openWorldHint=False)
_WRITE = ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=False)
_DESTROY = ToolAnnotations(readOnlyHint=False, destructiveHint=True, openWorldHint=False)

_app_override = None  # tests point this at their own app


def _app():
    if _app_override is not None:
        return _app_override
    from api.app import app

    return app


def _raw_token() -> str | None:
    """The token from the connection: Authorization: Bearer swm_... or X-API-Key (the URL form is turned into a header before this)."""
    h = get_http_headers(include={"authorization"})
    t = h.get("x-api-key")
    if not t and (h.get("authorization") or "").lower().startswith("bearer "):
        t = h["authorization"].split(" ", 1)[1].strip()
    return t


def _forwarded_for() -> str | None:
    return get_http_headers(include={"x-forwarded-for"}).get("x-forwarded-for")


@dataclass
class Principal:
    key_id: int
    user_id: int
    email: str
    workspace: str
    readonly: bool


def _expired(key: ProductApiKeyModel) -> bool:
    e = key.expires_at
    if e is None:
        return False
    return (e.replace(tzinfo=UTC) if e.tzinfo is None else e) < datetime.now(UTC)


async def token_state(raw: str | None) -> str:
    """ok | missing | invalid | expired. Used to answer a connection with 401 (so the app can sign in or refresh) before any tool runs."""
    if not raw:
        return "missing"
    if not TOKEN_RE.match(raw):
        return "invalid"
    async with session_factory()() as s:
        key = await s.scalar(select(ProductApiKeyModel).where(ProductApiKeyModel.key_hash == dev.hash_key(raw), ProductApiKeyModel.environment == "mcp", ProductApiKeyModel.revoked_at.is_(None)))
    if key is None:
        return "invalid"
    return "expired" if _expired(key) else "ok"


async def authenticate(raw: str | None) -> Principal:
    if not raw or not TOKEN_RE.match(raw):
        raise ToolError("Missing or invalid MCP token. Create one under Developers > MCP access and connect with it.")
    async with session_factory()() as s:
        key = await s.scalar(select(ProductApiKeyModel).where(ProductApiKeyModel.key_hash == dev.hash_key(raw), ProductApiKeyModel.environment == "mcp", ProductApiKeyModel.revoked_at.is_(None)))
        if key is None:
            raise ToolError("That MCP token isn't valid any more. It may have been revoked.")
        if _expired(key):
            raise ToolError("This sign-in has expired. Reconnect Swarvo AI.")
        ws = await s.get(ProductWorkspaceModel, key.workspace_id)
        user = await s.get(UserModel, key.created_by) if key.created_by else None
        if ws is None or user is None:
            raise ToolError("The account behind this token no longer exists.")
        key.last_used_at = datetime.now(UTC)
        await s.commit()
        p = Principal(key.id, user.id, user.email or "", ws.public_id, raw.startswith("swm_r_"))
    from api.utils import rate_limit

    try:
        await rate_limit.enforce(f"pmcp:{p.key_id}", RATE_PER_MINUTE, 60, "Too many requests. Wait a minute and try again.")
    except Exception as e:  # noqa: BLE001
        raise ToolError(getattr(e, "detail", "Too many requests. Wait a minute and try again.")) from e
    return p


def _message(r: httpx.Response) -> str:
    try:
        d = r.json().get("detail")
    except Exception:  # noqa: BLE001
        d = None
    if isinstance(d, dict):
        return d.get("message") or d.get("code") or r.text[:300]
    if isinstance(d, list) and d:
        first = d[0]
        return f"{'.'.join(str(x) for x in first.get('loc', [])[1:])}: {first.get('msg')}"
    return str(d or r.text[:300])


async def _call(method: str, path: str, *, json: Any = None, params: dict | None = None, environment: str = "live") -> Any:
    """Run one product API request as the token's creator."""
    p = await authenticate(_raw_token())
    method = method.upper()
    if method not in ("GET", "POST", "PUT", "PATCH", "DELETE"):
        raise ToolError("Use GET, POST, PUT, PATCH or DELETE.")
    if not path.startswith("/"):
        path = "/" + path
    if path.startswith("/product"):
        path = path[len("/product"):]
    if any(path == b or path.startswith(b + "/") for b in BLOCKED):
        raise ToolError("That part of the API is not available through MCP.")
    if p.readonly and method != "GET":
        raise ToolError("This MCP token is read-only. Create a full-access token under Developers > MCP access to make changes.")
    from api.utils.auth import create_jwt_token

    headers = {"Authorization": f"Bearer {create_jwt_token(p.user_id, p.email, 'admin', False)}", "X-Workspace": p.workspace, "X-Environment": environment}
    if _forwarded_for():
        headers["X-Forwarded-For"] = _forwarded_for() or ""
    clean = {k: v for k, v in (params or {}).items() if v is not None}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=_app()), base_url="http://swarvo.internal", timeout=240) as c:
        r = await c.request(method, f"{API_PREFIX}/product{path}", json=json, params=clean, headers=headers)
    if r.status_code >= 400:
        raise ToolError(f"{_message(r)} (HTTP {r.status_code})")
    if r.status_code == 204 or not r.content:
        return {"ok": True}
    ct = r.headers.get("content-type", "")
    return r.json() if "json" in ct else {"text": r.text[:20000], "content_type": ct}


def _cap(rows: Any, limit: int) -> Any:
    if isinstance(rows, list) and len(rows) > limit:
        return {"items": rows[:limit], "truncated": True, "total": len(rows), "note": f"Showing the first {limit}. Narrow the search or raise limit."}
    return rows


def _drop_none(d: dict) -> dict:
    return {k: v for k, v in d.items() if v is not None}


# ============================================================ account
@mcp.tool(annotations=_READ)
async def whoami() -> Any:
    """Who this token acts as: the user, their workspace, role and permissions."""
    return await _call("GET", "/me")


@mcp.tool(annotations=_READ)
async def workspace_overview(environment: Env = "live") -> Any:
    """Today's summary for the workspace: calls, agents, balance and what needs attention."""
    return await _call("GET", "/home/summary", environment=environment)


@mcp.tool(annotations=_READ)
async def get_wallet() -> Any:
    """Balance and minutes left."""
    return await _call("GET", "/billing/wallet")


@mcp.tool(annotations=_READ)
async def billing_summary() -> Any:
    """Balance, price per minute, this month's spend, limits and price slabs."""
    return await _call("GET", "/billing/summary")


@mcp.tool(annotations=_READ)
async def billing_usage(days: int = 30) -> Any:
    """Minutes and money used per day for the last N days (1 to 365)."""
    return await _call("GET", "/billing/usage", params={"days": days})


@mcp.tool(annotations=_READ)
async def list_invoices() -> Any:
    """Invoices and payments."""
    return {"invoices": await _call("GET", "/billing/invoices"), "payments": await _call("GET", "/billing/payments")}


@mcp.tool(annotations=_WRITE)
async def create_topup(amount: float) -> Any:
    """Start adding money to the wallet. Returns a payment link or order the person must pay; nothing is charged by this call. Only when asked."""
    return await _call("POST", "/billing/topups", json={"amount": amount})


# ============================================================ agents
@mcp.tool(annotations=_READ)
async def list_agents() -> Any:
    """All agents with id, name, role, status (draft, live, paused), voice and language settings."""
    return await _call("GET", "/agents")


@mcp.tool(annotations=_READ)
async def get_agent(agent_id: str) -> Any:
    """One agent in full, including its main instructions (prompt) and settings."""
    return await _call("GET", f"/agents/{agent_id}")


@mcp.tool(annotations=_WRITE)
async def setup_agent(text: str, publish: bool = True) -> Any:
    """Build a whole agent from one message with no further questions. Pass the business's website and/or a few words about the business and what the agent should do
    (and languages if they matter), for example "We run Sunrise Dental in Pune, sunrisedental.in. Answer calls in Hindi and English and book check-ups".
    It reads the website, writes the agent and its call script, adds knowledge, picks the best available voice, publishes it (unless publish=false) and connects a free number.
    Returns each step's result."""
    return await _call("POST", "/assistant/setup/auto", json={"text": text, "publish": publish})


@mcp.tool(annotations=_WRITE)
async def create_agent(name: str, template: str | None = None, role: str | None = None, business: str = "", what_you_do: str = "", script: str = "", tone: str | None = None, emoji: str | None = None) -> Any:
    """Create a draft agent with exact settings. template is a key from list_templates. tone is Friendly, Professional or Playful. script is numbered call steps."""
    return await _call("POST", "/agents", json=_drop_none({"name": name, "template": template, "role": role, "business": business, "what_you_do": what_you_do, "script": script, "tone": tone, "emoji": emoji}))


@mcp.tool(annotations=_READ)
async def generate_agent_draft(usecase: str, description: str, language: str = "") -> Any:
    """Have the AI write an agent (name, role, business facts, call script) from a description, without saving anything. usecase is a template key or your own words."""
    return await _call("POST", "/agents/generate", json={"usecase": usecase, "description": description, "language": language})


@mcp.tool(annotations=_WRITE)
async def update_agent(agent_id: str, name: str | None = None, role: str | None = None, tone: str | None = None, business: str | None = None, what_you_do: str | None = None,
                       script: str | None = None, brain: str | None = None, voice_id: str | None = None, prompt: str | None = None) -> Any:
    """Change an agent's settings (only what you pass). brain is fast, balanced or smartest. prompt replaces the main instructions entirely (switches it to hand-written).
    Changes are saved to the test copy; call publish_agent to send them live."""
    return await _call("PATCH", f"/agents/{agent_id}", json=_drop_none({"name": name, "role": role, "tone": tone, "business": business, "what_you_do": what_you_do, "script": script, "brain": brain, "voice_id": voice_id, "prompt": prompt}))


@mcp.tool(annotations=_WRITE)
async def set_agent_style(agent_id: str, style: dict) -> Any:
    """Set voice and call behaviour for an agent. Keys include: languages (up to 2 names like ["Hindi","English"]), pace, patience, steering, backchannel, fillers, interruptions,
    voicemail_detect, call_max_seconds, call_idle_seconds, call_concurrency, tts_mode (chat/read), stt_engine (assemblyai/deepgram). Only the keys you pass change."""
    return await _call("PATCH", f"/agents/{agent_id}", json={"style": style})


@mcp.tool(annotations=_DESTROY)
async def delete_agent(agent_id: str) -> Any:
    """Delete an agent for good. Phone numbers using it stop answering. Confirm first unless the person clearly asked."""
    return await _call("DELETE", f"/agents/{agent_id}")


@mcp.tool(annotations=_WRITE)
async def duplicate_agent(agent_id: str) -> Any:
    """Make a copy of an agent as a new draft."""
    return await _call("POST", f"/agents/{agent_id}/duplicate")


@mcp.tool(annotations=_WRITE)
async def publish_agent(agent_id: str) -> Any:
    """Send the agent's latest changes live, so callers reach the new version. Fails with a plain reason if it is not ready."""
    return await _call("POST", f"/agents/{agent_id}/publish")


@mcp.tool(annotations=_WRITE)
async def pause_agent(agent_id: str) -> Any:
    """Pause a live agent so callers get the after-hours message instead."""
    return await _call("POST", f"/agents/{agent_id}/pause")


@mcp.tool(annotations=_WRITE)
async def resume_agent(agent_id: str) -> Any:
    """Resume a paused agent."""
    return await _call("POST", f"/agents/{agent_id}/resume")


@mcp.tool(annotations=_READ)
async def agent_readiness(agent_id: str) -> Any:
    """The go-live checklist for an agent: what is ready and what blocks publishing."""
    return await _call("GET", f"/agents/{agent_id}/readiness")


@mcp.tool(annotations=_READ)
async def get_agent_flow(agent_id: str) -> Any:
    """The agent's call flow (nodes and edges) as editable JSON."""
    return await _call("GET", f"/agents/{agent_id}/flow")


@mcp.tool(annotations=_WRITE)
async def save_agent_flow(agent_id: str, definition: dict) -> Any:
    """Replace the agent's call flow. definition is {"nodes": [...], "edges": [...]} as returned by get_agent_flow. It needs exactly one startCall node and at least one endCall node."""
    return await _call("PUT", f"/agents/{agent_id}/flow", json=definition)


@mcp.tool(annotations=_READ)
async def list_agent_versions(agent_id: str) -> Any:
    """Saved versions of an agent."""
    return await _call("GET", f"/agents/{agent_id}/versions")


@mcp.tool(annotations=_WRITE)
async def restore_agent_version(agent_id: str, number: int) -> Any:
    """Restore an earlier version into the test copy (publish afterwards to send it live)."""
    return await _call("POST", f"/agents/{agent_id}/versions/{number}/restore")


@mcp.tool(annotations=_READ)
async def export_agent(agent_id: str) -> Any:
    """The whole agent as one portable JSON document (settings, personality, voice choice, call flow). Use import_agent to recreate it."""
    return await _call("GET", f"/agents/{agent_id}/export")


@mcp.tool(annotations=_WRITE)
async def import_agent(document: dict, name: str | None = None) -> Any:
    """Create a new draft agent from an exported document or a plain call flow ({"nodes": [...], "edges": [...]})."""
    return await _call("POST", "/agents/import", json=_drop_none({"document": document, "name": name}))


@mcp.tool(annotations=_READ)
async def list_templates() -> Any:
    """Starter agent templates by industry, each with a real call script."""
    return await _call("GET", "/agents/templates")


# ============================================================ voices
@mcp.tool(annotations=_READ)
async def list_voices(provider: str | None = None, language: str | None = None, q: str | None = None, gender: str | None = None, limit: int = 60) -> Any:
    """Voices you can give an agent. provider is Falcon, Studio, Gemini or Swarvo. language like Hindi or Tamil. available=false means not switched on for this workspace."""
    rows = await _call("GET", "/voices", params={"language": language, "q": q})
    rows = [v for v in rows if (not provider or v.get("provider", "").lower() == provider.lower()) and (not gender or (v.get("gender") or "").lower() == gender.lower())]
    return _cap([{k: v.get(k) for k in ("id", "name", "provider", "language", "gender", "style", "description", "available")} for v in rows], limit)


@mcp.tool(annotations=_READ)
async def listening_options() -> Any:
    """What agents with separate-speech voices (Falcon, Swarvo) can listen with, and whether each is set up."""
    return await _call("GET", "/voices/listening")


# ============================================================ conversations
@mcp.tool(annotations=_READ)
async def list_conversations(agent_id: str | None = None, outcome: str | None = None, failed: bool | None = None, text: str | None = None, caller: str | None = None, limit: int = 25, page: int = 1, environment: Env = "live") -> Any:
    """Calls, newest first. outcome: booked, resolved, qualified, transferred, voicemail, failed, no-answer. text searches what was said; caller searches names and numbers."""
    return await _call("GET", "/conversations", params={"agent": agent_id, "outcome": outcome, "failed": failed, "text": text, "q": caller, "limit": min(max(limit, 1), 100), "page": page}, environment=environment)


@mcp.tool(annotations=_READ)
async def get_conversation(call_id: str, environment: Env = "live") -> Any:
    """One call in full: transcript, summary, extracted details, mood, cost and a short-lived recording link."""
    return await _call("GET", f"/conversations/{call_id}", environment=environment)


@mcp.tool(annotations=_READ)
async def live_calls(environment: Env = "live") -> Any:
    """Calls happening right now."""
    return await _call("GET", "/live", environment=environment)


@mcp.tool(annotations=_READ)
async def get_analytics(days: int = 30, agent_id: str | None = None, environment: Env = "live") -> Any:
    """Call volume, outcomes, cost and comparison with the previous period."""
    return await _call("GET", "/analytics", params={"days": days, "agent": agent_id, "compare": True}, environment=environment)


@mcp.tool(annotations=_READ)
async def get_insights(environment: Env = "live") -> Any:
    """Written insights about recent calls: what is working and what to fix."""
    return await _call("GET", "/analytics/insights", environment=environment)


# ============================================================ phone numbers
@mcp.tool(annotations=_READ)
async def list_numbers(environment: Env = "live") -> Any:
    """Phone numbers, which agent answers each, opening hours and status."""
    return await _call("GET", "/numbers", environment=environment)


@mcp.tool(annotations=_READ)
async def available_numbers(country: str = "IN") -> Any:
    """Numbers that can be bought, with monthly rent and whether an ID check is needed."""
    return await _call("GET", "/numbers/available", params={"country": country})


@mcp.tool(annotations=_WRITE)
async def buy_number(number: str, kind: Literal["local", "toll_free"] = "local") -> Any:
    """Buy a phone number from available_numbers. This costs money (rent). Only when the person clearly asked."""
    return await _call("POST", "/numbers", json={"number": number, "kind": kind})


@mcp.tool(annotations=_WRITE)
async def assign_number(number_id: str, agent_id: str | None, environment: Env = "live") -> Any:
    """Point a phone number at an agent (it must be live). Pass agent_id=null to stop it answering."""
    return await _call("POST", f"/numbers/{number_id}/assign", json={"agent_id": agent_id}, environment=environment)


@mcp.tool(annotations=_WRITE)
async def update_number(number_id: str, settings: dict, environment: Env = "live") -> Any:
    """Change a number's opening hours and after-hours message. See list_numbers for the current shape of hours and fallback."""
    return await _call("PATCH", f"/numbers/{number_id}", json=settings, environment=environment)


@mcp.tool(annotations=_DESTROY)
async def release_number(number_id: str, environment: Env = "live") -> Any:
    """Give a phone number back. It may not be recoverable. Confirm first unless the person clearly asked."""
    return await _call("DELETE", f"/numbers/{number_id}", environment=environment)


# ============================================================ knowledge and tools
@mcp.tool(annotations=_READ)
async def list_knowledge() -> Any:
    """Knowledge sources (websites, files, notes, Q&A) and their status."""
    return await _call("GET", "/knowledge")


@mcp.tool(annotations=_WRITE)
async def add_knowledge_url(url: str, refresh_hours: int | None = 24) -> Any:
    """Add a web page for agents to learn from. refresh_hours: 1, 6, 12, 24 or 168 (weekly), or null for never."""
    return await _call("POST", "/knowledge/url", json={"url": url, "refresh_hours": refresh_hours})


@mcp.tool(annotations=_WRITE)
async def add_knowledge_text(title: str, text: str) -> Any:
    """Add a note to knowledge."""
    return await _call("POST", "/knowledge/text", json={"title": title, "text": text})


@mcp.tool(annotations=_WRITE)
async def add_knowledge_qa(title: str, pairs: list[dict]) -> Any:
    """Add fixed questions and answers. pairs is [{"q": "...", "a": "..."}]."""
    return await _call("POST", "/knowledge/qa", json={"title": title, "pairs": pairs})


@mcp.tool(annotations=_DESTROY)
async def delete_knowledge(doc_id: str) -> Any:
    """Delete a knowledge source."""
    return await _call("DELETE", f"/knowledge/{doc_id}")


@mcp.tool(annotations=_WRITE)
async def attach_knowledge(agent_id: str, document_ids: list[str]) -> Any:
    """Set exactly which knowledge sources an agent can use (replaces the current list)."""
    return await _call("PUT", f"/knowledge/agent/{agent_id}", json={"document_ids": document_ids})


@mcp.tool(annotations=_READ)
async def ask_knowledge(question: str) -> Any:
    """Search the knowledge the way an agent would and return what it finds."""
    return await _call("POST", "/knowledge/ask", json={"question": question})


@mcp.tool(annotations=_READ)
async def list_connectors() -> Any:
    """Integrations (Google Calendar, Calendly, HubSpot, Salesforce, Zoho, Shopify, Slack, WhatsApp, Google Sheets, Razorpay links) and whether each is connected."""
    return await _call("GET", "/connectors")


@mcp.tool(annotations=_WRITE)
async def connect_connector(connector_id: str, config: dict) -> Any:
    """Connect an integration. config holds its fields (see the fields list in list_connectors). Secrets pass straight through; never repeat them back."""
    return await _call("PUT", f"/connectors/{connector_id}", json={"config": {str(k): str(v) for k, v in config.items()}})


@mcp.tool(annotations=_DESTROY)
async def disconnect_connector(connector_id: str) -> Any:
    """Disconnect an integration."""
    return await _call("DELETE", f"/connectors/{connector_id}")


@mcp.tool(annotations=_READ)
async def list_tools() -> Any:
    """Custom tools agents can use during calls (web requests, transfers)."""
    return await _call("GET", "/tools")


@mcp.tool(annotations=_WRITE)
async def set_handover(agent_id: str, number: str, when: str = "The caller asks to speak to a person, or the agent cannot help.", message: str = "One moment, I'll connect you now.", timeout: int = 30) -> Any:
    """Let an agent pass calls to a person. number is in international form like +919876543210. timeout is how many seconds to ring (10 to 60)."""
    return await _call("PUT", f"/tools/handover/{agent_id}", json={"number": number, "when": when, "message": message, "timeout": timeout})


# ============================================================ campaigns and contacts
@mcp.tool(annotations=_READ)
async def list_campaigns() -> Any:
    """Outbound campaigns and their progress."""
    return await _call("GET", "/campaigns", environment="live")


@mcp.tool(annotations=_WRITE)
async def create_campaign(name: str, agent_id: str, csv_text: str, slots: list[dict], consent_confirmed: bool, dnc_checked: bool, timezone: str = "Asia/Kolkata",
                          max_retries: int = 2, retry_delay_minutes: int = 30, retry_on_busy: bool = True, retry_on_no_answer: bool = True, retry_on_voicemail: bool = False) -> Any:
    """Create an outbound calling campaign (does not start it). This calls REAL people: only when asked, and only with the person's confirmation that the people on the list agreed to be called
    (consent_confirmed) and the list was checked against Do-Not-Call (dnc_checked). csv_text needs a phone column. slots is [{"day_of_week": 0-6 (Monday is 0), "start_time": "10:00", "end_time": "18:00"}] within 09:00 to 21:00."""
    return await _call("POST", "/campaigns", json={"name": name, "agent_id": agent_id, "csv_text": csv_text, "slots": slots, "consent_confirmed": consent_confirmed, "dnc_checked": dnc_checked, "timezone": timezone,
                                                  "max_retries": max_retries, "retry_delay_minutes": retry_delay_minutes, "retry_on_busy": retry_on_busy, "retry_on_no_answer": retry_on_no_answer, "retry_on_voicemail": retry_on_voicemail}, environment="live")


@mcp.tool(annotations=_WRITE)
async def campaign_action(campaign_id: str, action: Literal["start", "pause", "resume"]) -> Any:
    """Start, pause or resume a campaign. Starting calls real people."""
    return await _call("POST", f"/campaigns/{campaign_id}/{action}", environment="live")


@mcp.tool(annotations=_WRITE)
async def schedule_callback(agent_id: str, phone: str, when: str, timezone: str = "Asia/Kolkata", name: str | None = None) -> Any:
    """Call one person back at a time they asked for. when is a local date and time like 2026-11-20T17:30. The agent must be live."""
    return await _call("POST", "/campaigns/callback", json=_drop_none({"agent_id": agent_id, "phone": phone, "when": when, "timezone": timezone, "name": name}), environment="live")


@mcp.tool(annotations=_READ)
async def list_contacts(q: str | None = None, page: int = 1, limit: int = 50) -> Any:
    """People who called or were called."""
    return await _call("GET", "/contacts", params={"q": q, "page": page, "limit": min(max(limit, 1), 100)})


@mcp.tool(annotations=_READ)
async def list_do_not_call() -> Any:
    """The do-not-call list."""
    return await _call("GET", "/contacts/blocked")


@mcp.tool(annotations=_WRITE)
async def add_do_not_call(numbers: str) -> Any:
    """Add phone numbers (separated by commas or new lines) to the do-not-call list."""
    return await _call("POST", "/contacts/blocked", json={"numbers": numbers})


# ============================================================ developer access
@mcp.tool(annotations=_READ)
async def list_api_keys(environment: Env = "live") -> Any:
    """API keys for the chosen environment (secrets are never shown again)."""
    return await _call("GET", "/developers/keys", environment=environment)


@mcp.tool(annotations=_WRITE)
async def create_api_key(name: str, environment: Env = "test") -> Any:
    """Create an API key (sk_test_... reads practice data, sk_live_... reads live data). The secret is returned ONCE: show it to the person right away."""
    return await _call("POST", "/developers/keys", json={"name": name}, environment=environment)


@mcp.tool(annotations=_DESTROY)
async def revoke_api_key(key_id: str, environment: Env = "live") -> Any:
    """Revoke an API key."""
    return await _call("DELETE", f"/developers/keys/{key_id}", environment=environment)


@mcp.tool(annotations=_READ)
async def list_webhooks() -> Any:
    """Webhooks and whether they are failing."""
    return await _call("GET", "/developers/webhooks")


@mcp.tool(annotations=_WRITE)
async def create_webhook(url: str, events: list[str] | None = None) -> Any:
    """Add a webhook. events can include call.started, call.ended, tool.failed, campaign.completed. The signing secret is returned ONCE."""
    return await _call("POST", "/developers/webhooks", json=_drop_none({"url": url, "events": events}))


@mcp.tool(annotations=_DESTROY)
async def delete_webhook(hook_id: str) -> Any:
    """Delete a webhook."""
    return await _call("DELETE", f"/developers/webhooks/{hook_id}")


@mcp.tool(annotations=_READ)
async def api_request_log(limit: int = 50, environment: Env = "live") -> Any:
    """Recent requests made with API keys."""
    return await _call("GET", "/developers/logs", params={"limit": limit}, environment=environment)


# ============================================================ team and settings
@mcp.tool(annotations=_READ)
async def list_team() -> Any:
    """Team members, roles and pending invites."""
    return await _call("GET", "/team")


@mcp.tool(annotations=_WRITE)
async def invite_member(email: str, role: Literal["admin", "developer", "viewer"] = "viewer") -> Any:
    """Invite someone to the workspace. Returns an invite link to send them."""
    return await _call("POST", "/team/invites", json={"email": email, "role": role})


@mcp.tool(annotations=_READ)
async def get_settings() -> Any:
    """Privacy, recording, retention, branding, WhatsApp follow-up and security settings."""
    return await _call("GET", "/team/settings")


@mcp.tool(annotations=_WRITE)
async def update_settings(settings: dict) -> Any:
    """Change workspace settings. This replaces the whole settings object, so start from get_settings, change what is needed and pass all of it back."""
    return await _call("PUT", "/team/settings", json=settings)


@mcp.tool(annotations=_READ)
async def audit_log(limit: int = 50) -> Any:
    """Recent important actions in the workspace."""
    return await _call("GET", "/team/audit", params={"limit": limit})


# ============================================================ everything else
def _endpoints() -> list[dict]:
    try:
        spec = _app().openapi()
    except Exception:  # noqa: BLE001
        return []
    out = []
    for path, ops in (spec.get("paths") or {}).items():
        if "/product/" not in path:
            continue
        short = path.split("/product", 1)[1]
        if any(short == b or short.startswith(b + "/") for b in BLOCKED):
            continue
        for method, op in ops.items():
            if method.upper() in ("GET", "POST", "PUT", "PATCH", "DELETE"):
                out.append({"method": method.upper(), "path": short, "summary": (op.get("summary") or "").strip(), "description": (op.get("description") or "").strip()[:200],
                            "params": [p.get("name") for p in op.get("parameters", []) if p.get("in") in ("query", "path")]})
    return out


@mcp.tool(annotations=_READ)
async def search_api(query: str, limit: int = 15) -> Any:
    """Find product API endpoints by words (for example "webhook" or "invoice pdf"), to use with api_request."""
    words = [w for w in re.findall(r"[a-z0-9]+", query.lower()) if len(w) > 1]
    scored = []
    for e in _endpoints():
        hay = f"{e['path']} {e['summary']} {e['description']}".lower()
        score = sum(hay.count(w) for w in words)
        if score:
            scored.append((score, e))
    return [e for _, e in sorted(scored, key=lambda x: -x[0])[:limit]]


@mcp.tool(annotations=_WRITE)
async def api_request(method: Literal["GET", "POST", "PUT", "PATCH", "DELETE"], path: str, body: dict | None = None, query: dict | None = None, environment: Env = "live") -> Any:
    """Call any product API endpoint not covered by the other tools, as the token's creator. path is like /agents or /billing/pricing (use search_api to find it). A read-only token can only use GET."""
    return await _call(method, path, json=body, params=query, environment=environment)


# ============================================================ mounting
class TokenInPath:
    """Lets clients that cannot send headers connect with the token in the address: <mount>/t/<token>/. It is turned into the normal Authorization header."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] in ("http", "websocket"):
            root = scope.get("root_path", "")
            path = scope.get("path", "")
            rel = path[len(root):] if root and path.startswith(root) else path
            m = re.match(r"^/t/(swm_[rf]_[A-Za-z0-9_\-]+)(/.*)?$", rel)
            if m:
                new_rel = m.group(2) or "/"
                headers = [(k, v) for k, v in scope.get("headers", []) if k != b"authorization"] + [(b"authorization", f"Bearer {m.group(1)}".encode())]
                scope = dict(scope, path=root + new_rel, raw_path=(root + new_rel).encode(), headers=headers)
        await self.app(scope, receive, send)


class RequireSignIn:
    """Answers a connection that has no valid token with 401 and a pointer to the sign-in details, which is what tells Claude and ChatGPT to start the
    "Connect" flow (or to refresh an expired token) instead of failing."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = {k.decode().lower(): v.decode() for k, v in scope.get("headers", [])}
        raw = headers.get("x-api-key")
        if not raw and headers.get("authorization", "").lower().startswith("bearer "):
            raw = headers["authorization"].split(" ", 1)[1].strip()
        state = await token_state(raw)
        if state == "ok":
            return await self.app(scope, receive, send)
        host = headers.get("x-forwarded-host") or headers.get("host") or "localhost"
        proto = "http" if host.split(":")[0] in ("localhost", "127.0.0.1", "test") else "https"
        meta = f"{proto}://{host}{API_PREFIX}/product/oauth/.well-known/oauth-protected-resource"
        error = '' if state == "missing" else ', error="invalid_token"'
        body = json.dumps({"error": "invalid_token" if state != "missing" else "unauthorized", "error_description": "Sign in to Swarvo AI to use this connection."}).encode()
        await send({"type": "http.response.start", "status": 401, "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode()),
                                                                              (b"www-authenticate", f'Bearer resource_metadata="{meta}"{error}'.encode())]})
        await send({"type": "http.response.body", "body": body})


def http_app():
    """The ASGI app to mount (at /api/v1/swarvo-mcp), and the underlying app whose lifespan must run with the main one."""
    inner = mcp.http_app(path="/", stateless_http=True)
    return TokenInPath(RequireSignIn(inner)), inner
