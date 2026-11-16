"""Chat agents, team side: create and edit agents (by hand or in plain words), their flow and model, test them, see usage and pricing, and help a person who has taken a chat over."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from api.db.product_models import ProductChatAgentModel, ProductChatMessageModel, ProductChatSessionModel
from api.product import billing, chat, chat_catalog, chat_engine, chat_flow, chat_presets
from api.product.deps import Ctx, get_ctx, require
from api.product.errors import product_error
from api.product.knowledge_router import KnowledgeGateway, get_knowledge
from api.product.llm_gateway import LLMGateway, get_llm
from api.product.payments import WalletGateway, get_wallet
from api.product.roles import Perm
from api.utils import rate_limit

router = APIRouter(prefix="/product/chat", tags=["chat-agents"])
MAX_AGENTS = 20


def _out(a: ProductChatAgentModel, counts: dict | None = None) -> dict:
    s = chat_engine.setup_of(a)
    c = (counts or {}).get(a.id, {})
    return {"id": a.public_id, "key": a.key, "use_case": a.use_case, "status": a.status, **s, "origins": a.origins or [], "version": a.version, "updated": a.updated_at.isoformat() if a.updated_at else None,
            "price": chat_catalog.catalogue_price(a.model), "chats": c.get("chats", 0), "replies": c.get("replies", 0)}


async def _mine(ctx: Ctx, agent_id: str) -> ProductChatAgentModel:
    a = await ctx.session.scalar(select(ProductChatAgentModel).where(ProductChatAgentModel.public_id == agent_id, ProductChatAgentModel.workspace_id == ctx.workspace.id))
    if a is None:
        raise product_error(404, "chat_agent_not_found", "We couldn't find that chat agent.")
    return a


@router.get("/meta")
async def meta(ctx: Ctx = Depends(get_ctx)):
    """Everything the editor offers: models with prices, ready-made use cases, tones, lengths and languages."""
    return {"models": chat_catalog.catalogue(), "ai_ready": chat_catalog.available(), "use_cases": [{"key": k, "name": p["name"], "emoji": p["emoji"], "blurb": p["blurb"], "widget": p["widget"]} for k, p in chat_presets.PRESETS.items()],
            "tones": list(chat_presets.TONES), "lengths": list(chat_presets.LENGTHS), "languages": list(chat_presets.LANGUAGES), "step_types": list(chat_flow.STEP_TYPES)}


@router.get("/agents")
async def list_agents(ctx: Ctx = Depends(get_ctx)):
    rows = (await ctx.session.scalars(select(ProductChatAgentModel).where(ProductChatAgentModel.workspace_id == ctx.workspace.id).order_by(ProductChatAgentModel.id))).all()
    counts: dict = {}
    for aid, n in (await ctx.session.execute(select(ProductChatSessionModel.chat_agent_id, func.count()).where(ProductChatSessionModel.workspace_id == ctx.workspace.id, ProductChatSessionModel.chat_agent_id.is_not(None),
                                                                                                             ProductChatSessionModel.channel != "test", ProductChatSessionModel.last_text.is_not(None)).group_by(ProductChatSessionModel.chat_agent_id))).all():
        counts.setdefault(aid, {})["chats"] = n
    return [_out(a, counts) for a in rows]


class CreateIn(BaseModel):
    use_case: str = "support"
    name: str | None = Field(default=None, max_length=60)
    business: str = Field(default="", max_length=80)
    description: str = Field(default="", max_length=3000)


@router.post("/agents", status_code=201)
async def create_agent(body: CreateIn, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE)), llm: LLMGateway = Depends(get_llm)):
    if (await ctx.session.scalar(select(func.count()).select_from(ProductChatAgentModel).where(ProductChatAgentModel.workspace_id == ctx.workspace.id)) or 0) >= MAX_AGENTS:
        raise product_error(400, "too_many_chat_agents", f"You can have up to {MAX_AGENTS} chat agents. Delete one you don't use first.")
    uc = body.use_case if body.use_case in chat_presets.PRESETS else "custom"
    biz = body.business.strip() or ctx.workspace.name
    a = chat_engine.new_agent(ctx.workspace.id, uc, body.name, biz)
    written = False
    if body.description.strip():
        await rate_limit.enforce(f"pchatgen:{ctx.user.id}", 20, 600, "You're creating agents quickly. Give it a minute.")
        changes, written = await chat_engine.write_setup(llm, ctx.workspace.test_org_id, ctx.user.id, uc, biz, body.description)
        if body.name:
            changes.pop("name", None)
        chat_engine.apply_setup(a, changes)
        a.version = 1
    ctx.session.add(a)
    await ctx.session.commit()
    return {**_out(a), "written_by_ai": written}


@router.get("/agents/{agent_id}")
async def get_agent(agent_id: str, ctx: Ctx = Depends(get_ctx)):
    return _out(await _mine(ctx, agent_id))


class PatchIn(BaseModel):
    name: str | None = None
    emoji: str | None = None
    prompt: str | None = Field(default=None, max_length=6000)
    model: str | None = None
    temperature: float | None = None
    reply_length: str | None = None
    tone: str | None = None
    language: str | None = None
    use_knowledge: bool | None = None
    memory: int | None = None
    flow: dict | None = None
    handover: dict | None = None
    widget: dict | None = None
    origins: list[str] | None = Field(default=None, max_length=20)


def _origins(raw: list[str]) -> list[str]:
    out = []
    for o in raw:
        u = urlsplit(o.strip())
        if u.scheme not in ("http", "https") or not u.netloc:
            raise product_error(400, "bad_website", f"“{o}” isn't a website address. Use the full address, like https://www.example.com.")
        out.append(f"{u.scheme}://{u.netloc}")
    return sorted(set(out))


@router.patch("/agents/{agent_id}")
async def edit_agent(agent_id: str, body: PatchIn, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE))):
    a = await _mine(ctx, agent_id)
    changes = body.model_dump(exclude_none=True)
    origins = changes.pop("origins", None)
    if origins is not None:
        a.origins = _origins(origins)
    if changes:
        chat_engine.remember(a, "Edited by hand")
        if not chat_engine.apply_setup(a, changes):
            a.history = (a.history or [])[1:]  # nothing really changed: do not keep a useless version
    a.updated_at = datetime.now(UTC)
    await ctx.session.commit()
    return _out(a)


@router.post("/agents/{agent_id}/status")
async def set_agent_status(agent_id: str, body: dict, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE))):
    a = await _mine(ctx, agent_id)
    status = str(body.get("status", ""))
    if status not in ("draft", "live", "paused"):
        raise product_error(400, "bad_status", "Status must be draft, live or paused.")
    if status == "live" and not a.prompt.strip():
        raise product_error(400, "not_ready", "Write the agent's instructions first.")
    a.status = status
    await ctx.session.commit()
    return _out(a)


@router.post("/agents/{agent_id}/duplicate", status_code=201)
async def duplicate_agent(agent_id: str, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE))):
    a = await _mine(ctx, agent_id)
    if (await ctx.session.scalar(select(func.count()).select_from(ProductChatAgentModel).where(ProductChatAgentModel.workspace_id == ctx.workspace.id)) or 0) >= MAX_AGENTS:
        raise product_error(400, "too_many_chat_agents", f"You can have up to {MAX_AGENTS} chat agents.")
    b = chat_engine.new_agent(ctx.workspace.id, a.use_case, f"{a.name} copy", ctx.workspace.name)
    chat_engine.apply_setup(b, {k: v for k, v in chat_engine.setup_of(a).items() if k != "name"})
    b.name, b.version, b.origins = f"{a.name} copy"[:60], 1, list(a.origins or [])
    ctx.session.add(b)
    await ctx.session.commit()
    return _out(b)


@router.delete("/agents/{agent_id}")
async def delete_agent(agent_id: str, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE))):
    a = await _mine(ctx, agent_id)
    from api.db.product_models import ProductChatSettingsModel

    s = await ctx.session.get(ProductChatSettingsModel, ctx.workspace.id)
    if s is not None and s.whatsapp_agent_id == a.id:
        s.whatsapp_agent_id = None
    await ctx.session.delete(a)
    await ctx.session.commit()
    return {"ok": True}


class AiEditIn(BaseModel):
    instruction: str = Field(min_length=3, max_length=1500)
    apply: bool = True


@router.post("/agents/{agent_id}/ai-edit")
async def ai_edit(agent_id: str, body: AiEditIn, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE)), llm: LLMGateway = Depends(get_llm)):
    """Change the agent by describing the change in plain words. Every change can be undone."""
    await rate_limit.enforce(f"pchatedit:{ctx.user.id}", 40, 600, "You're editing quickly. Give it a minute.")
    a = await _mine(ctx, agent_id)
    try:
        changes, summary = await chat_engine.ai_edit(llm, ctx.workspace.test_org_id, ctx.user.id, a, body.instruction)
    except Exception as e:  # noqa: BLE001
        if getattr(e, "status_code", 0) == 503:
            raise
        raise product_error(502, "ai_failed", "The AI helper couldn't understand that change. Try saying it a different way.") from e
    if not body.apply:
        return {"summary": summary, "changes": sorted(changes), "agent": _out(a)}
    chat_engine.remember(a, body.instruction.strip())
    changed = chat_engine.apply_setup(a, changes)
    if not changed:
        a.history = (a.history or [])[1:]
    await ctx.session.commit()
    return {"summary": summary, "changed": changed, "agent": _out(a)}


@router.get("/agents/{agent_id}/history")
async def history(agent_id: str, ctx: Ctx = Depends(get_ctx)):
    a = await _mine(ctx, agent_id)
    return [{"index": i, "at": h.get("at"), "label": h.get("label"), "version": h.get("version")} for i, h in enumerate(a.history or [])]


class UndoIn(BaseModel):
    index: int = Field(default=0, ge=0, le=chat_engine.HISTORY_KEEP)


@router.post("/agents/{agent_id}/undo")
async def undo(agent_id: str, body: UndoIn, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE))):
    a = await _mine(ctx, agent_id)
    hist = list(a.history or [])
    if body.index >= len(hist):
        raise product_error(400, "nothing_to_undo", "There is nothing to go back to.")
    snap = hist[body.index]
    a.history = hist[body.index + 1:]
    chat_engine.apply_setup(a, snap["setup"])
    await ctx.session.commit()
    return _out(a)


class TestIn(BaseModel):
    token: str | None = Field(default=None, max_length=80)
    text: str | None = Field(default=None, max_length=2000)


@router.post("/agents/{agent_id}/test")
async def test_agent(agent_id: str, body: TestIn, ctx: Ctx = Depends(get_ctx), llm: LLMGateway = Depends(get_llm), kb: KnowledgeGateway = Depends(get_knowledge)):
    """Talk to the agent exactly as a visitor would. Tests cost nothing and never show in the inbox."""
    await rate_limit.enforce(f"pchattest:{ctx.user.id}", 80, 600, "You're testing quickly. Give it a minute.")
    a = await _mine(ctx, agent_id)
    s = await chat.get_settings(ctx.session, ctx.workspace)
    sess = await chat.session_by_token(ctx.session, body.token or "", ctx.workspace.id)
    if sess is None or sess.channel != "test" or sess.chat_agent_id != a.id:
        sess = await chat.open_session(ctx.session, ctx.workspace, s, None, "test", "test-" + str(ctx.user.id), None, None)
        new = await chat_engine.begin(ctx.session, sess, a, "web")
    else:
        new = []
    if body.text and body.text.strip():
        new += await chat_engine.handle(ctx.session, ctx.workspace, s, a, sess, body.text, llm=llm, kb=kb, wallet=None, free=True)
    await ctx.session.commit()
    return {"token": chat.token_for(sess), "status": sess.status, "state": sess.flow_state, "messages": [chat.present(m) for m in new]}


# ---------------------------------------------------------------- usage and pricing
@router.get("/pricing")
async def pricing(ctx: Ctx = Depends(get_ctx)):
    return chat_catalog.pricing()


@router.get("/usage")
async def usage(days: int = Query(default=30, ge=1, le=365), ctx: Ctx = Depends(get_ctx), wallet: WalletGateway = Depends(get_wallet)):
    start, _ = billing.month_bounds(billing.current_period())
    since = datetime.now(UTC) - timedelta(days=days)
    base = select(ProductChatMessageModel).join(ProductChatSessionModel, ProductChatSessionModel.id == ProductChatMessageModel.session_id).where(
        ProductChatSessionModel.workspace_id == ctx.workspace.id, ProductChatMessageModel.charge > 0)
    month = (await ctx.session.scalars(base.where(ProductChatMessageModel.created_at >= start))).all()
    recent = (await ctx.session.scalars(base.where(ProductChatMessageModel.created_at >= since))).all()
    by_day: dict[str, dict] = {}
    for m in recent:
        d = by_day.setdefault((m.created_at or since).date().isoformat(), {"replies": 0, "spend": 0.0})
        d["replies"] += 1
        d["spend"] = round(d["spend"] + (m.charge or 0), 4)
    by_model: dict[str, dict] = {}
    for m in month:
        d = by_model.setdefault(m.model or "?", {"replies": 0, "spend": 0.0})
        d["replies"] += 1
        d["spend"] = round(d["spend"] + (m.charge or 0), 4)
    n = len(month)
    try:
        balance = float((await wallet.summary(ctx.workspace.live_org_id)).get("balance", 0) or 0)
    except Exception:  # noqa: BLE001
        balance = None
    off = chat_catalog.discount_for(n)
    nxt = next(((f, d) for f, d, _ in chat_catalog.SLABS if f > n), None)
    return {"month_replies": n, "month_spend": round(sum(m.charge or 0 for m in month), 2), "discount": off, "next_slab": {"at": nxt[0], "discount": nxt[1], "to_go": nxt[0] - n} if nxt else None,
            "prices": {m["id"]: chat_catalog.price_for(m["id"], n) for m in chat_catalog.catalogue()}, "by_model": by_model, "by_day": [{"day": k, **v} for k, v in sorted(by_day.items())], "balance": balance,
            "currency": chat_catalog.pricing()["currency"]}


# ---------------------------------------------------------------- helping a person who has taken a chat over
class CannedIn(BaseModel):
    replies: list[dict] = Field(max_length=30)


def _canned(raw) -> list[dict]:
    out = []
    for r in raw or []:
        if isinstance(r, dict) and str(r.get("text", "")).strip():
            out.append({"title": (str(r.get("title") or "").strip() or str(r["text"]).strip())[:40], "text": str(r["text"]).strip()[:1000]})
    return out[:30]


@router.get("/canned")
async def get_canned(ctx: Ctx = Depends(get_ctx)):
    s = await chat.get_settings(ctx.session, ctx.workspace)
    return _canned(s.canned)


@router.put("/canned")
async def put_canned(body: CannedIn, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE))):
    s = await chat.get_settings(ctx.session, ctx.workspace)
    s.canned = _canned(body.replies)
    await ctx.session.commit()
    return s.canned


async def _session(ctx: Ctx, sid: str) -> ProductChatSessionModel:
    row = await chat.session_by_token(ctx.session, sid, ctx.workspace.id)
    if row is None:
        raise product_error(404, "chat_not_found", "We couldn't find that chat.")
    return row


@router.post("/sessions/{sid}/suggest")
async def suggest(sid: str, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE)), llm: LLMGateway = Depends(get_llm), kb: KnowledgeGateway = Depends(get_knowledge)):
    """A draft reply for the person replying. It is shown, not sent."""
    await rate_limit.enforce(f"pchatsuggest:{ctx.user.id}", 60, 600, "You're asking quickly. Give it a minute.")
    sess = await _session(ctx, sid)
    a = await ctx.session.get(ProductChatAgentModel, sess.chat_agent_id) if sess.chat_agent_id else None
    try:
        return {"text": await chat_engine.suggest_reply(ctx.session, ctx.workspace, a, sess, llm=llm, kb=kb)}
    except Exception as e:  # noqa: BLE001
        raise product_error(502, "ai_failed", "The AI helper didn't answer. Please try again in a moment.") from e


class NoteIn(BaseModel):
    text: str = Field(min_length=1, max_length=1000)


@router.post("/sessions/{sid}/note")
async def add_note(sid: str, body: NoteIn, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE))):
    """A note only the team sees, kept in the conversation."""
    sess = await _session(ctx, sid)
    before = (sess.last_text, sess.last_at)
    m = await chat.add_message(ctx.session, sess, "note", body.text.strip())
    sess.last_text, sess.last_at = before  # a note is not news for the list
    await ctx.session.commit()
    return chat.present(m)


@router.post("/sessions/{sid}/take")
async def take_over(sid: str, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE))):
    """Take the chat over: the agent stops answering and this person is shown as handling it."""
    sess = await _session(ctx, sid)
    sess.status, sess.assigned_to, sess.unread = "human", ctx.user.id, 0
    await ctx.session.commit()
    return {"status": sess.status, "assigned_to": ctx.user.id}
