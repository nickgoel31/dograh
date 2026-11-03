"""The helper in the corner of the app: answers questions about running the platform, with the person's own account in mind."""

import re

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from api.db.models import TelephonyPhoneNumberModel
from api.db.product_models import ProductAgentModel
from api.product import config, help_content
from api.product.deps import Ctx, get_ctx
from api.product.llm_gateway import LLMGateway, get_llm
from api.utils import rate_limit

router = APIRouter(prefix="/product/assistant", tags=["assistant"])

PAGES = [
    ("/", "Home: today's numbers and a to-do list"), ("/agents", "Agents: create, edit, publish. Each agent has Flow and Configuration views"),
    ("/conversations", "Conversations: every call with transcript, summary, mood, cost and recording"), ("/contacts", "Contacts and the do-not-call list"),
    ("/numbers", "Phone Numbers: buy one, bring your own, assign it to an agent, set opening hours"), ("/campaigns", "Campaigns: call a list of numbers"),
    ("/knowledge", "Knowledge: websites, PDFs, text and Q&A the agents use, plus questions callers asked that nobody could answer"),
    ("/tools", "Tools & Integrations: Google Calendar, Calendly, HubSpot, Salesforce, Zoho, Shopify, Slack, WhatsApp, Google Sheets, Razorpay links"),
    ("/voices", "Voices"), ("/analytics", "Analytics"), ("/billing", "Billing & Usage: balance, add money, price slabs, invoices"),
    ("/settings", "Team & Settings: team, roles, security, privacy, branding"), ("/developers", "Developers: API keys, webhooks (Advanced view)"), ("/help", "Help articles"),
]
FACTS = """- Calls are billed per minute, rounded up (61 seconds = 2 minutes). A call that never connects is free. Practice calls from the browser are charged at the same price.
- The price per minute depends on the money in the wallet: more balance, lower price, and a slab once reached is kept. Phone number rent is billed separately.
- An agent has two copies: a private Test copy (edit and try freely) and a Live copy callers reach. Press Publish to send the latest changes live.
- Agent tabs under Configuration: Personality (who it is, what you do, script), Voice, Brain, Knowledge, Q&A, Tools, Behavior, Phone, Test, Versions, Publish.
- The Flow view is a top-to-bottom canvas: Start call, Ask a question, Do something, Yes/No check, Hand to a human, Close, Global rules, Send call data, API trigger, Call quality check. "Try a call" chats with the agent.
- The Q&A tab holds questions with fixed answers; they go into the agent's global prompt.
- Numbers in India may need KYC before they can be bought.
- Roles: owner, admin, developer, viewer."""


class Msg(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(max_length=2000)


class ChatBody(BaseModel):
    messages: list[Msg] = Field(min_length=1, max_length=20)
    page: str = Field(default="/", max_length=120)


class ChatOut(BaseModel):
    reply: str


def _system(page: str, state: str) -> str:
    pages = "\n".join(f"- {p}: {d}" for p, d in PAGES)
    help_ = "\n".join(f"- {t}: {b}" for _, t, _, b in help_content.ARTICLES)
    return (
        f"You are the built-in helper for {config.PRODUCT_NAME}, a voice-agent platform. You help the person run it: setting up agents, numbers, billing, integrations and fixing problems.\n"
        "Rules: be brief and concrete (under 120 words unless they ask for detail). Use short numbered steps for how-to answers. Use plain words, no jargon. "
        "Only say things supported by the facts below; if you don't know, say so and suggest the Help page or support. Never invent prices, features or settings. "
        "Never ask for passwords, API keys or card details; if the person pastes a secret, tell them not to share it. "
        "When pointing to a page, write a markdown link using exactly one of the paths listed, like [Billing & Usage](/billing).\n\n"
        f"Pages:\n{pages}\n\nFacts:\n{FACTS}\n\nHelp articles:\n{help_}\n\n"
        f"The person is on the page: {page}.\nTheir account right now: {state}"
    )


def _fallback(question: str) -> str:
    words = {w for w in re.findall(r"[a-z]{4,}", question.lower())}
    best = max(help_content.ARTICLES, key=lambda a: len(words & set(re.findall(r"[a-z]{4,}", (a[1] + " " + a[3]).lower()))), default=None)
    if best and words & set(re.findall(r"[a-z]{4,}", (best[1] + " " + best[3]).lower())):
        return f"**{best[1]}**\n{best[3]}\n\nMore in [Help](/help)."
    return "I couldn't reach the assistant just now. Try the [Help](/help) page, or ask again in a moment."


async def _state(ctx: Ctx) -> str:
    agents = (await ctx.session.execute(select(ProductAgentModel.name, ProductAgentModel.status).where(ProductAgentModel.workspace_id == ctx.workspace.id).limit(8))).all()
    numbers = await ctx.session.scalar(select(func.count()).select_from(TelephonyPhoneNumberModel).where(TelephonyPhoneNumberModel.organization_id == ctx.workspace.live_org_id)) or 0
    listing = ", ".join(f"{n} ({s})" for n, s in agents) or "none yet"
    return f"role {ctx.role}; agents: {listing}; phone numbers: {numbers}."


@router.post("/chat", response_model=ChatOut)
async def chat(body: ChatBody, ctx: Ctx = Depends(get_ctx), llm: LLMGateway = Depends(get_llm)):
    await rate_limit.enforce(f"passist:{ctx.user.id}", 40, 600, "You're asking quickly. Give it a minute and try again.")
    messages = [{"role": m.role, "content": m.content} for m in body.messages[-10:]]
    last = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
    try:
        text = (await llm.complete(ctx.workspace.test_org_id, ctx.user.id, _system(body.page, await _state(ctx)), messages, platform=True)).strip()
    except Exception:  # noqa: BLE001 - no model available: answer from the help articles instead
        text = ""
    return ChatOut(reply=text[:2500] or _fallback(last))


# ---- the AI home page: the model plans, the person's own browser session carries the plan out -------------------------------------
# Reads run on their own; anything that changes something is shown to the person to confirm first. The browser calls the normal product
# endpoints, so roles, workspaces and limits apply exactly as if the person had clicked the buttons.
TOOLS: dict[str, tuple[str, str]] = {
    "list_agents": ("read", "{}  -> all agents with id, name, status"),
    "list_templates": ("read", "{}  -> agent templates (key, name, role, blurb)"),
    "list_numbers": ("read", "{}  -> phone numbers with id, number, assigned agent"),
    "list_contacts": ("read", "{q?: string}  -> people who called or were called"),
    "list_conversations": ("read", "{}  -> recent calls with summary, mood, duration"),
    "list_campaigns": ("read", "{}  -> outbound campaigns and progress"),
    "list_knowledge": ("read", "{}  -> knowledge documents the agents use"),
    "list_integrations": ("read", "{}  -> connected services (calendar, CRM, WhatsApp...)"),
    "get_wallet": ("read", "{}  -> balance and minutes left"),
    "go_to": ("ui", "{path: string}  -> open a page. Use only paths from the page list"),
    "create_agent": ("write", "{name: string, template?: string, business?: string, what_you_do?: string, script?: string, tone?: string}  -> new agent (private test copy)"),
    "update_agent": ("write", "{agent_id: string, name?, business?, what_you_do?, script?, tone?}  -> change an agent"),
    "publish_agent": ("write", "{agent_id: string}  -> send the latest changes live"),
    "assign_number": ("write", "{number_id: string, agent_id: string | null}  -> point a number at an agent (null removes it)"),
    "block_numbers": ("write", "{numbers: string}  -> add to the do-not-call list"),
    "add_knowledge_text": ("write", "{title: string, text: string}  -> add a note to knowledge"),
    "add_knowledge_qa": ("write", "{title: string, pairs: [{q: string, a: string}]}  -> add fixed question/answers"),
}


class PlanBody(BaseModel):
    messages: list[Msg] = Field(min_length=1, max_length=40)
    page: str = Field(default="/", max_length=120)


class Call(BaseModel):
    id: str
    tool: str
    kind: str
    args: dict


class PlanOut(BaseModel):
    reply: str
    calls: list[Call] = Field(default_factory=list)


def _plan_system(state: str) -> str:
    pages = "\n".join(f"- {p}: {d}" for p, d in PAGES)
    tools = "\n".join(f"- {n} ({k}): {d}" for n, (k, d) in TOOLS.items())
    return (
        f"You are the assistant on the home page of {config.PRODUCT_NAME}, a voice-agent platform. You run the platform for the person: you can look things up and, when asked, create and change things.\n"
        'Reply with ONLY a JSON object: {"reply": "short message to the person", "calls": [{"tool": "name", "args": {...}}]}. No text outside the JSON.\n'
        "Rules:\n- Use tools instead of guessing. To find ids, call a list_ tool first, then use the ids it returns.\n"
        "- Results of tools you called come back as a message starting with TOOL RESULTS. Use them to finish the job, then answer with an empty calls list.\n"
        "- Only call write tools when the person asked for that change. Ask a short question first if something important is missing (for example what a new agent should do). Never invent ids, phone numbers or prices.\n"
        "- The person confirms every write before it happens, so describe plainly what it will do. Do not ask for passwords, API keys or card details; money, buying numbers and billing are done by the person on the Billing and Phone Numbers pages, so point there with go_to.\n"
        "- When creating an agent, write a useful script (numbered steps of what the agent should do on a call) from what the person told you.\n"
        "- Be brief and plain. Short sentences. Use **bold** sparingly and markdown links like [Billing & Usage](/billing) with paths from the page list.\n\n"
        f"Pages:\n{pages}\n\nTools:\n{tools}\n\nFacts:\n{FACTS}\n\nTheir account right now: {state}"
    )


def _parse_plan(text: str) -> tuple[str, list[dict]]:
    import json

    raw = text.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```[a-z]*\n?|```$", "", raw).strip()
    start, end = raw.find("{"), raw.rfind("}")
    try:
        data = json.loads(raw[start:end + 1]) if start >= 0 and end > start else None
    except ValueError:
        data = None
    if not isinstance(data, dict):
        return raw[:2500], []
    calls = [c for c in (data.get("calls") or []) if isinstance(c, dict) and c.get("tool") in TOOLS][:5]
    return str(data.get("reply") or "")[:2500], [{"tool": c["tool"], "args": c.get("args") if isinstance(c.get("args"), dict) else {}} for c in calls]


@router.post("/plan", response_model=PlanOut)
async def plan(body: PlanBody, ctx: Ctx = Depends(get_ctx), llm: LLMGateway = Depends(get_llm)):
    await rate_limit.enforce(f"pplan:{ctx.user.id}", 60, 600, "You're asking quickly. Give it a minute and try again.")
    messages = [{"role": m.role, "content": m.content} for m in body.messages[-24:]]
    try:
        text = await llm.complete(ctx.workspace.test_org_id, ctx.user.id, _plan_system(await _state(ctx)), messages, platform=True)
        reply, raw_calls = _parse_plan(text)
    except Exception:  # noqa: BLE001 - no model available
        reply, raw_calls = "I couldn't reach the assistant just now. Please try again in a moment.", []
    import secrets

    calls = [Call(id=secrets.token_hex(4), tool=c["tool"], kind=TOOLS[c["tool"]][0], args=c["args"]) for c in raw_calls]
    return PlanOut(reply=reply or ("Working on it." if calls else "Done."), calls=calls)
