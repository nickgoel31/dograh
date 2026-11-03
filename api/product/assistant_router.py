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
        text = (await llm.complete(ctx.workspace.test_org_id, ctx.user.id, _system(body.page, await _state(ctx)), messages)).strip()
    except Exception:  # noqa: BLE001 - no model available: answer from the help articles instead
        text = ""
    return ChatOut(reply=text[:2500] or _fallback(last))
