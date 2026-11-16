"""The brain of a chat agent: runs the flow, calls the model for free-form replies, hands over to a person and bills each AI reply.

``chat.py`` still serves chats answered by a voice agent. A chat with ``chat_agent_id`` set comes here instead.
"""

from __future__ import annotations

import json
import logging
import re
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select

from api.db.models import OrganizationModel
from api.db.product_models import ProductChatAgentModel, ProductChatMessageModel, ProductChatSessionModel, ProductWorkspaceModel
from api.product import billing, chat, chat_catalog, chat_flow, chat_presets
from api.product.ids import new_public_id

log = logging.getLogger(__name__)

HUMAN_MARK, UNSURE_MARK = "[[HUMAN]]", "[[UNSURE]]"
MARKS = re.compile(r"\[\[(?:HUMAN|UNSURE)\]\]", re.I)
LOW_FUNDS_REPLY = "We can't take new messages right now. Please try again later."
MAX_HISTORY = 40
HISTORY_KEEP = 8  # versions kept for undo

# What makes up the agent's setup, so it can be saved, compared and put back.
SETUP_KEYS = ("name", "emoji", "prompt", "model", "temperature", "reply_length", "tone", "language", "use_knowledge", "memory", "flow", "handover", "widget")


def _now() -> datetime:
    return datetime.now(UTC)


# ---------------------------------------------------------------- cleaning
def clean_handover(raw: dict | None) -> dict:
    h = raw if isinstance(raw, dict) else {}
    kws = [re.sub(r"\s+", " ", str(k)).strip().lower()[:40] for k in (h.get("keywords") or []) if str(k).strip()]
    try:
        n = int(h.get("after_failures", 2))
    except (TypeError, ValueError):
        n = 2
    return {"keywords": list(dict.fromkeys(kws))[:20], "after_failures": min(max(n, 0), 10), "message": str(h.get("message") or chat.HANDOFF_REPLY)[:300]}


def clean_widget(raw: dict | None, fallback: dict | None = None) -> dict:
    return chat.clean_config({**(fallback or {}), **(raw or {})})


def setup_of(a: ProductChatAgentModel) -> dict:
    return {"name": a.name, "emoji": a.emoji, "prompt": a.prompt, "model": a.model, "temperature": a.temperature, "reply_length": a.reply_length, "tone": a.tone, "language": a.language,
            "use_knowledge": a.use_knowledge, "memory": a.memory, "flow": chat_flow.clean_flow(a.flow), "handover": clean_handover(a.handover), "widget": clean_widget(a.widget)}


def apply_setup(a: ProductChatAgentModel, changes: dict) -> list[str]:
    """Apply validated changes; return the names of what actually changed."""
    done: list[str] = []

    def put(k, v):
        if getattr(a, k) != v:
            setattr(a, k, v)
            done.append(k)

    c = changes
    if "name" in c and str(c["name"]).strip():
        put("name", str(c["name"]).strip()[:60])
    if "emoji" in c:
        put("emoji", str(c["emoji"])[:8] or None)
    if "prompt" in c:
        put("prompt", str(c["prompt"]).strip()[:6000])
    if "model" in c:
        put("model", chat_catalog.model_or_default(c["model"]))
    if "temperature" in c:
        try:
            put("temperature", round(min(max(float(c["temperature"]), 0.0), 1.0), 2))
        except (TypeError, ValueError):
            pass
    if c.get("reply_length") in chat_presets.LENGTHS:
        put("reply_length", c["reply_length"])
    if c.get("tone") in chat_presets.TONES:
        put("tone", c["tone"])
    if c.get("language") in chat_presets.LANGUAGES:
        put("language", c["language"])
    if "use_knowledge" in c:
        put("use_knowledge", bool(c["use_knowledge"]))
    if "memory" in c:
        try:
            put("memory", min(max(int(c["memory"]), 2), MAX_HISTORY))
        except (TypeError, ValueError):
            pass
    if "flow" in c:
        put("flow", chat_flow.clean_flow(c["flow"]))
    if "handover" in c:
        put("handover", clean_handover(c["handover"]))
    if "widget" in c:
        put("widget", clean_widget(c["widget"], a.widget))
    if done:
        a.version = (a.version or 1) + 1
        a.updated_at = _now()
    return done


def remember(a: ProductChatAgentModel, label: str) -> None:
    """Keep what the agent looked like before this change, so the change can be undone."""
    snap = {"at": _now().isoformat(), "label": label[:120], "version": a.version, "setup": setup_of(a)}
    a.history = [snap, *(a.history or [])][:HISTORY_KEEP]


# ---------------------------------------------------------------- creating
def new_agent(ws_id: int, use_case: str, name: str | None = None, business: str = "") -> ProductChatAgentModel:
    p = chat_presets.PRESETS.get(use_case) or chat_presets.PRESETS["custom"]
    biz = business.strip() or "the business"
    return ProductChatAgentModel(
        workspace_id=ws_id, public_id=new_public_id("cha"), key="cw_" + secrets.token_hex(8), name=(name or p["name"])[:60], emoji=p["emoji"], use_case=use_case if use_case in chat_presets.PRESETS else "custom",
        status="draft", prompt=p["prompt"].format(business=biz), model=chat_catalog.DEFAULT_MODEL, temperature=0.4, reply_length="short", tone="Friendly", language="auto", use_knowledge=True, memory=16,
        flow=chat_flow.clean_flow(json.loads(json.dumps(p["flow"]).replace("{business}", biz))), handover=clean_handover(p["handover"]), widget=clean_widget(p["widget"]), origins=[], history=[], version=1,
        created_at=_now(), updated_at=_now())


WRITER = """You set up website chat agents for small businesses. From the owner's description, write the agent's setup.
Return ONLY a JSON object with: "name" (a short friendly first name, one word), "prompt" (the instructions for the agent, 120 to 320 words, second person "You are ...": who it is, what it does for visitors, what the business offers using ONLY facts in the description, how it should behave, what to do when it does not know), "greeting" (the first line visitors see, under 120 characters), "quick_prompts" (up to 4 short questions visitors tend to ask, each under 40 characters), "tone" (Friendly, Professional or Playful).
Never invent prices, hours, addresses or policies. Write the greeting and quick prompts in the language visitors speak if the description says so, otherwise English."""


def _json(raw: str) -> dict:
    raw = re.sub(r"^```(?:json)?|```$", "", (raw or "").strip(), flags=re.M).strip()
    m = re.search(r"\{.*\}", raw, re.S)
    data = json.loads(m.group(0) if m else raw)
    if not isinstance(data, dict):
        raise ValueError("not an object")
    return data


async def write_setup(llm, org_id: int, user_id: int, use_case: str, business: str, description: str) -> tuple[dict, bool]:
    """(changes to apply to a fresh agent, written_by_ai). Falls back to the preset when no model is reachable."""
    if not description.strip():
        return {}, False
    p = chat_presets.PRESETS.get(use_case) or chat_presets.PRESETS["custom"]
    brief = f"Use: {use_case} ({p['blurb']})\nBusiness: {business or '(not given)'}\nOwner's description:\n{description.strip()[:3000]}\nA starting point you may improve on:\n{p['prompt'].format(business=business or 'the business')}"
    try:
        d = _json(await llm.complete(org_id, user_id, WRITER, [{"role": "user", "content": brief}], platform=True))
        out: dict = {}
        if str(d.get("prompt") or "").strip():
            out["prompt"] = str(d["prompt"]).strip()
        if str(d.get("name") or "").strip():
            out["name"] = str(d["name"]).strip().split()[0]
        if d.get("tone") in chat_presets.TONES:
            out["tone"] = d["tone"]
        w = {}
        if str(d.get("greeting") or "").strip():
            w["greeting"] = str(d["greeting"]).strip()
        if isinstance(d.get("quick_prompts"), list):
            w["prompts"] = d["quick_prompts"]
        if w:
            out["widget"] = w
        return out, bool(out)
    except Exception as e:  # noqa: BLE001 - a draft is a convenience; the preset is still a working agent
        log.warning("chat agent draft failed: %s", e)
        return {}, False


EDITOR = """You change the setup of a website chat agent for a business owner who describes the change in plain words. You get the agent's current setup as JSON and their instruction.
Return ONLY a JSON object. It must have "summary": one short, plain sentence saying what you changed (or why you could not). Add ONLY the keys you changed, each with its complete new value:
- "prompt": the agent's instructions (rewrite the whole text, keeping what was good)
- "tone": Friendly, Professional or Playful
- "reply_length": short, medium or long
- "language": auto, English, Hindi, Hinglish, Bengali, Tamil, Telugu, Marathi, Gujarati, Kannada, Malayalam or Punjabi
- "greeting": the first line visitors see
- "quick_prompts": up to 4 short questions shown as buttons
- "handover": {"keywords": [words that bring a person in], "after_failures": 0 to 10, "message": what the visitor is told}
- "flow": {"steps": [...]} the whole flow. Step types: message {text}, ask {text, save_as, kind: text|email|phone}, choice {text, options: [{label, goto}]}, ai {text}, human {text}, end {text}. Each step has a short unique "id". goto and next are a step id or one of ai, human, end. Put an "ai" step where free conversation should start. Use {name} or {first_name} in text to use what the visitor shared.
- "name": the agent's first name
Change only what the instruction asks for. Do not invent business facts. If the instruction cannot be done with these settings, return only the summary saying so."""


async def ai_edit(llm, org_id: int, user_id: int, a: ProductChatAgentModel, instruction: str) -> tuple[dict, str]:
    """(changes, summary) from a plain-words instruction. Nothing is applied here."""
    current = json.dumps(setup_of(a), ensure_ascii=False)[:12000]
    raw = await llm.complete(org_id, user_id, EDITOR, [{"role": "user", "content": f"Current setup:\n{current}\n\nInstruction:\n{instruction.strip()[:1500]}"}], platform=True)
    d = _json(raw)
    summary = str(d.pop("summary", "") or "").strip()[:300] or "Updated the agent."
    changes: dict = {}
    for k in ("prompt", "tone", "reply_length", "language", "handover", "flow", "name"):
        if k in d:
            changes[k] = d[k]
    w = {}
    if "greeting" in d:
        w["greeting"] = d["greeting"]
    if "quick_prompts" in d:
        w["prompts"] = d["quick_prompts"]
    if w:
        changes["widget"] = w
    return changes, summary


# ---------------------------------------------------------------- talking
def system_prompt(a: ProductChatAgentModel, business: str, vars_: dict, knowledge: str, channel: str) -> str:
    lang = a.language
    lang_line = "Reply in the language the visitor writes in." if lang == "auto" else f"Reply in {lang}." + (" Write it the way people type it in English letters." if lang == "Hinglish" else "")
    parts = [chat_presets.COMMON.format(business=business or "the business"), "", a.prompt.strip(), "", f"Style: {chat_presets.TONES.get(a.tone, chat_presets.TONES['Friendly'])} {chat_presets.LENGTHS.get(a.reply_length, chat_presets.LENGTHS['short'])} {lang_line}"]
    known = {k: v for k, v in (vars_ or {}).items() if not k.startswith("_") and v}
    if known:
        parts += ["", "What the visitor has already told you: " + "; ".join(f"{k.replace('_', ' ')}: {v}" for k, v in known.items()) + ". Do not ask for these again."]
    if knowledge:
        parts += ["", "Knowledge you may use (from the business's own documents; trust it over guesses):", knowledge]
    if channel == "whatsapp":
        parts += ["", "This chat is on WhatsApp: no markdown, plain text only."]
    parts += ["", f"If you could not answer from the details above, end your reply with {UNSURE_MARK}."]
    return "\n".join(parts)


async def knowledge_for(kb, ws, text: str) -> str:
    if kb is None:
        return ""
    try:
        hits = await kb.search(ws.live_org_id, ws.owner_user_id, text[:500], None, 3)
    except Exception:  # noqa: BLE001 - answering without knowledge is better than not answering
        return ""
    out, size = [], 0
    for h in sorted(hits or [], key=lambda h: -float(h.get("similarity", 0))):
        chunk = (h.get("chunk_text") or "").strip()
        if not chunk or float(h.get("similarity", 0)) < 0.2:
            continue
        chunk = chunk[:700]
        if size + len(chunk) > 1800:
            break
        out.append(f"[{str(h.get('filename') or 'note').removesuffix('.txt')}] {chunk}")
        size += len(chunk)
    return "\n\n".join(out)


async def month_replies(session, ws_id: int, now: datetime | None = None) -> int:
    start, _ = billing.month_bounds(billing.current_period(now))
    return await session.scalar(select(func.count()).select_from(ProductChatMessageModel).join(ProductChatSessionModel, ProductChatSessionModel.id == ProductChatMessageModel.session_id).where(
        ProductChatSessionModel.workspace_id == ws_id, ProductChatMessageModel.charge.is_not(None), ProductChatMessageModel.charge > 0, ProductChatMessageModel.created_at >= start)) or 0


async def billed(session, ws) -> bool:
    org = await session.get(OrganizationModel, ws.live_org_id)
    return bool(org is not None and org.wallet_enabled and not ws.adopted)


async def can_afford(session, wallet, ws, price: float) -> bool:
    if not await billed(session, ws):
        return True
    try:
        return float((await wallet.summary(ws.live_org_id)).get("balance", 0) or 0) >= price
    except Exception:  # noqa: BLE001 - if the wallet cannot be read, do not cut visitors off
        return True


async def take_payment(session, wallet, ws, m: ProductChatMessageModel, amount: float) -> None:
    m.charge, m.settled = amount, False
    try:
        await wallet.credit(ws.live_org_id, -amount, f"Chat reply #{m.id}", f"chatmsg:{m.id}")
        m.settled = True
    except Exception:  # noqa: BLE001 - kept as unpaid and taken on the next scheduled run
        log.warning("chat reply %s could not be charged yet", m.id, exc_info=True)


async def settle_pending(session, wallet, limit: int = 200) -> int:
    """Take the money for replies whose charge failed earlier (run from the scheduled tick)."""
    rows = (await session.scalars(select(ProductChatMessageModel).where(ProductChatMessageModel.settled.is_(False), ProductChatMessageModel.charge > 0).order_by(ProductChatMessageModel.id).limit(limit))).all()
    n = 0
    for m in rows:
        sess = await session.get(ProductChatSessionModel, m.session_id)
        ws = await session.get(ProductWorkspaceModel, sess.workspace_id) if sess else None
        if ws is None:
            continue
        try:
            await wallet.credit(ws.live_org_id, -float(m.charge), f"Chat reply #{m.id}", f"chatmsg:{m.id}")
            m.settled = True
            n += 1
        except Exception:  # noqa: BLE001
            log.warning("chat reply %s still could not be charged", m.id)
    await session.commit()
    return n


def wants_person(a: ProductChatAgentModel, text: str) -> bool:
    low = text.lower()
    return bool(chat.HUMAN_WORDS.search(text)) or any(k and k in low for k in clean_handover(a.handover)["keywords"])


async def say_all(session, sess, turn: chat_flow.Turn) -> list[ProductChatMessageModel]:
    out = []
    for s in turn.say:
        m = await chat.add_message(session, sess, "agent", s["text"])
        if s.get("options"):
            m.meta = {"options": s["options"]}
        out.append(m)
    return out


async def begin(session, sess, a: ProductChatAgentModel, channel: str = "web") -> list[ProductChatMessageModel]:
    """A new chat: start the flow (its first messages are the greeting). The session is saved in the flow's state."""
    flow = chat_flow.clean_flow(a.flow)
    vars_ = {}
    if sess.name:
        vars_["name"], vars_["first_name"] = sess.name, sess.name.split()[0]
    if sess.email:
        vars_["email"] = sess.email
    turn = chat_flow.start(flow, vars_)
    if not turn.say and not turn.human:  # a flow that goes straight to the AI still greets the visitor
        greeting = clean_widget(a.widget)["greeting"]
        if greeting:
            turn.say.append({"text": greeting})
    sess.flow_state = turn.state
    sess.chat_agent_id = a.id
    return await say_all(session, sess, turn)


async def handle(session, ws, s, a: ProductChatAgentModel, sess, text: str, *, llm, kb=None, wallet=None, mailer=None, ext_id: str | None = None, free: bool = False) -> list[ProductChatMessageModel]:
    """A visitor wrote something: return the new messages it caused (their own first). ``free`` is for tests in the editor, which cost nothing and are not saved with a charge."""
    text = text.strip()[:chat.MAX_TEXT]
    out = [await chat.add_message(session, sess, "visitor", text, ext_id)]
    if sess.status == "closed":
        sess.status = "bot"
    if sess.status == "human":
        sess.unread = (sess.unread or 0) + 1
        return out
    flow = chat_flow.clean_flow(a.flow)
    state = dict(sess.flow_state or {})
    turn = chat_flow.answer(flow, state, text)
    sess.flow_state = turn.state
    if turn.state["vars"].get("name") and not sess.name:
        sess.name = turn.state["vars"]["name"][:120]
    if turn.state["vars"].get("email") and not sess.email:
        sess.email = turn.state["vars"]["email"][:160]
    out += await say_all(session, sess, turn)
    if turn.human or (turn.ai and wants_person(a, text)):
        out.append(await chat.add_message(session, sess, "agent", clean_handover(a.handover)["message"]))
        await chat.request_human(session, ws, s, sess, mailer, text)
        return out
    if not turn.ai:
        return out
    # --- the AI answers in its own words
    month = await month_replies(session, ws.id)
    price = chat_catalog.price_for(a.model, month)
    if await billing.limit_reached(session, ws.live_org_id) or (not free and wallet is not None and not await can_afford(session, wallet, ws, price)):
        out.append(await chat.add_message(session, sess, "agent", LOW_FUNDS_REPLY))
        if not free:
            from api.product.notifications import notify

            await notify(session, ws.id, "billing", "Chat replies are paused", "Your wallet can't cover chat replies. Add money so visitors keep getting answers.", "/billing", f"chat-low:{ws.id}:{_now().date()}")
        return out
    history = (await session.scalars(select(ProductChatMessageModel).where(ProductChatMessageModel.session_id == sess.id, ProductChatMessageModel.role.in_(("visitor", "agent", "human"))).order_by(ProductChatMessageModel.id.desc()).limit(a.memory or 16))).all()
    messages = []
    for m in reversed(history):
        role = "user" if m.role == "visitor" else "assistant"
        if messages and messages[-1]["role"] == role:
            messages[-1]["content"] += "\n" + m.text
        else:
            messages.append({"role": role, "content": m.text})
    if not messages or messages[0]["role"] != "user":
        messages.insert(0, {"role": "user", "content": text})
    knowledge = await knowledge_for(kb, ws, text) if a.use_knowledge else ""
    reply, failed = "", False
    try:
        reply = (await llm.complete(ws.live_org_id, ws.owner_user_id, system_prompt(a, ws.name, turn.state["vars"], knowledge, sess.channel), messages, platform=True, model=chat_catalog.model_or_default(a.model), temperature=a.temperature) or "").strip()
    except Exception:  # noqa: BLE001 - never leave the visitor with silence
        log.warning("chat agent %s failed for session %s", a.id, sess.id, exc_info=True)
        failed = True
    if failed or not reply:
        out.append(await chat.add_message(session, sess, "agent", chat.FALLBACK_REPLY))
        return out
    handoff, unsure = bool(re.search(r"\[\[HUMAN\]\]", reply, re.I)), bool(re.search(r"\[\[UNSURE\]\]", reply, re.I))
    clean = MARKS.sub("", reply).strip() or clean_handover(a.handover)["message"]
    m = await chat.add_message(session, sess, "agent", clean)
    m.model = a.model
    if not free and wallet is not None and await billed(session, ws):
        await take_payment(session, wallet, ws, m, price)
    out.append(m)
    v = dict(turn.state["vars"])  # a copy: a JSON value changed in place after a flush would not be saved
    v["_unsure"] = (int(v.get("_unsure", 0)) + 1) if unsure else 0
    sess.flow_state = {**turn.state, "vars": v}
    limit = clean_handover(a.handover)["after_failures"]
    if handoff or (limit and v["_unsure"] >= limit):
        out.append(await chat.add_message(session, sess, "agent", clean_handover(a.handover)["message"]))
        await chat.request_human(session, ws, s, sess, mailer, text)
    return out


async def suggest_reply(session, ws, a: ProductChatAgentModel, sess, *, llm, kb=None) -> str:
    """A draft reply for the person who has taken the chat over. Costs nothing and is never sent on its own."""
    history = (await session.scalars(select(ProductChatMessageModel).where(ProductChatMessageModel.session_id == sess.id, ProductChatMessageModel.role.in_(("visitor", "agent", "human"))).order_by(ProductChatMessageModel.id.desc()).limit(16))).all()
    messages = []
    for m in reversed(history):
        role = "user" if m.role == "visitor" else "assistant"
        if messages and messages[-1]["role"] == role:
            messages[-1]["content"] += "\n" + m.text
        else:
            messages.append({"role": role, "content": m.text})
    if not messages or messages[-1]["role"] != "user":
        messages.append({"role": "user", "content": "(the person is waiting for your reply)"})
    last = next((m.text for m in history if m.role == "visitor"), "")
    knowledge = await knowledge_for(kb, ws, last) if a and a.use_knowledge else ""
    system = system_prompt(a, ws.name, (sess.flow_state or {}).get("vars", {}), knowledge, sess.channel) if a else chat_presets.COMMON.format(business=ws.name)
    return MARKS.sub("", (await llm.complete(ws.live_org_id, ws.owner_user_id, system + "\n\nWrite the next reply for a teammate to send. Reply with only the message.", messages, platform=True, model=chat_catalog.model_or_default(a.model if a else None)) or "")).strip()
