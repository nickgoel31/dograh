"""Chat agents: the same agents you already built, answering in text on your website and on WhatsApp.

A chat is a session with a list of messages. The agent answers from the same knowledge, tools and prompt as on the phone. A person on your
team can take a chat over from the inbox, and hand it back. Everything here is the logic; the endpoints are in chat_router.py.
"""

import hmac
import logging
import re
import secrets
from datetime import UTC, datetime
from hashlib import sha256

from sqlalchemy import select

from api.db.product_models import ProductAgentModel, ProductChatMessageModel, ProductChatSessionModel, ProductChatSettingsModel, ProductWorkspaceModel
from api.product import billing, emailer, models_config
from api.product.ids import decode_id, encode_id
from api.product.llm_gateway import AgentTextGateway
from api.product.notifications import notify

log = logging.getLogger(__name__)

DEFAULT_CONFIG = {
    "title": "Chat with us", "greeting": "Hi! How can I help you today?", "color": "#6366f1", "position": "right",
    "prompts": [], "collect_lead": False, "powered_by": True, "offline_message": "",
}
HUMAN_WORDS = re.compile(r"\b(human|real person|live agent|live person|talk to (a|an|someone|somebody)|speak (to|with) (a|an|someone|somebody)|customer (care|support|service) (agent|executive|team)|representative)\b", re.I)
HANDOFF_TOOLS = re.compile(r"transfer|handoff|hand_off|human|escalat", re.I)
HANDOFF_REPLY = "I've asked a teammate to join this chat. They'll reply here as soon as they can."
FALLBACK_REPLY = "Sorry, I couldn't answer just now. Please try again in a moment."
BUSY_REPLY = "We can't take new messages right now. Please try again later."
MAX_TEXT = 2000


def now() -> datetime:
    return datetime.now(UTC)


def clean_config(raw: dict | None) -> dict:
    """Merge saved appearance settings over the defaults, keeping only what is safe to show on someone else's website."""
    c = {**DEFAULT_CONFIG, **{k: v for k, v in (raw or {}).items() if k in DEFAULT_CONFIG}}
    c["title"] = str(c["title"])[:60] or DEFAULT_CONFIG["title"]
    c["greeting"] = str(c["greeting"])[:300]
    c["offline_message"] = str(c["offline_message"])[:300]
    c["color"] = c["color"] if re.fullmatch(r"#[0-9a-fA-F]{6}", str(c["color"])) else DEFAULT_CONFIG["color"]
    c["position"] = "left" if c["position"] == "left" else "right"
    c["prompts"] = [str(p).strip()[:80] for p in (c["prompts"] or []) if str(p).strip()][:4]
    c["collect_lead"] = bool(c["collect_lead"])
    c["powered_by"] = bool(c["powered_by"])
    return c


async def get_settings(session, ws: ProductWorkspaceModel) -> ProductChatSettingsModel:
    s = await session.get(ProductChatSettingsModel, ws.id)
    if s is None:
        s = ProductChatSettingsModel(workspace_id=ws.id, key="chat_" + secrets.token_hex(8), enabled=True, config={}, origins=[], whatsapp={})
        session.add(s)
        await session.flush()
    return s


async def by_key(session, key: str) -> ProductChatSettingsModel | None:
    return await session.scalar(select(ProductChatSettingsModel).where(ProductChatSettingsModel.key == key))


async def chat_agent(session, ws: ProductWorkspaceModel, s: ProductChatSettingsModel) -> ProductAgentModel | None:
    """The agent that answers: the one chosen, else the newest live agent. Only live agents answer the public."""
    q = select(ProductAgentModel).where(ProductAgentModel.workspace_id == ws.id, ProductAgentModel.status == "live", ProductAgentModel.live_workflow_id.is_not(None))
    if s.agent_id:
        chosen = await session.scalar(q.where(ProductAgentModel.id == s.agent_id))
        if chosen:
            return chosen
    return await session.scalar(q.order_by(ProductAgentModel.id.desc()))


def token_for(sess: ProductChatSessionModel) -> str:
    return encode_id("cs", sess.id)


async def session_by_token(session, token: str, ws_id: int | None = None) -> ProductChatSessionModel | None:
    n = decode_id("cs", token or "")
    row = await session.get(ProductChatSessionModel, n) if n else None
    return row if row and (ws_id is None or row.workspace_id == ws_id) else None


async def add_message(session, sess: ProductChatSessionModel, role: str, text: str, ext_id: str | None = None) -> ProductChatMessageModel:
    m = ProductChatMessageModel(session_id=sess.id, role=role, text=text[:MAX_TEXT * 2], ext_id=ext_id, created_at=now())
    session.add(m)
    sess.last_text, sess.last_at = text[:200], m.created_at
    await session.flush()
    return m


async def open_session(session, ws, s, agent, channel: str, contact: str, name: str | None = None, email: str | None = None) -> ProductChatSessionModel:
    sess = ProductChatSessionModel(workspace_id=ws.id, agent_id=agent.id if agent else None, channel=channel, contact=contact[:80], name=(name or "")[:120] or None,
                                   email=(email or "")[:160] or None, status="bot", unread=0, created_at=now(), last_at=now())
    session.add(sess)
    await session.flush()
    return sess


async def request_human(session, ws, s, sess, mailer: emailer.Mailer | None, why: str) -> None:
    sess.status, sess.handoff_at = "human", now()
    who = sess.name or sess.contact
    await notify(session, ws.id, "chat", "A customer needs a person", f"{who}: {why[:200]}", "/chat/inbox", f"chat-h:{sess.id}:{int(sess.handoff_at.timestamp())}")
    if s.notify_email and mailer is not None:
        base = emailer.app_url()
        try:
            await mailer.send(s.notify_email, "A customer needs a person", f"{who} asked for a person in your chat.\n\nThey wrote: {why[:300]}\n\nReply in the inbox: {base}/chat/inbox")
        except Exception:  # noqa: BLE001 - the in-app alert is already saved
            log.warning("could not email the chat hand-over alert", exc_info=True)


async def converse(session, ws, s, agent, sess, text: str, gateway: AgentTextGateway, mailer: emailer.Mailer | None = None, ext_id: str | None = None) -> list[ProductChatMessageModel]:
    """Take a visitor's message and return the new messages it caused (their own first)."""
    text = text.strip()[:MAX_TEXT]
    out = [await add_message(session, sess, "visitor", text, ext_id)]
    if sess.status == "closed":
        sess.status = "bot"
    if sess.status == "human":  # a person has the chat: tell them, the agent stays quiet
        sess.unread = (sess.unread or 0) + 1
        return out
    if await billing.limit_reached(session, ws.live_org_id) or agent is None or not await models_config.ensure_org_profiles(session, ws.live_org_id):
        out.append(await add_message(session, sess, "agent", BUSY_REPLY))
        return out
    wants_person = bool(HUMAN_WORDS.search(text))
    reply_text, tools = "", []
    try:
        if not sess.run_id:
            sess.run_id = (await gateway.start(ws.live_org_id, ws.owner_user_id, agent.live_workflow_id)).run_id
        r = await gateway.say(ws.live_org_id, ws.owner_user_id, agent.live_workflow_id, sess.run_id, text)
        reply_text, tools = (r.text or "").strip(), r.tools or []
    except Exception:  # noqa: BLE001 - never leave the visitor with silence
        log.warning("chat agent failed for session %s", sess.id, exc_info=True)
        reply_text = FALLBACK_REPLY
    if reply_text:
        out.append(await add_message(session, sess, "agent", reply_text))
    if wants_person or any(HANDOFF_TOOLS.search(t or "") for t in tools):
        await request_human(session, ws, s, sess, mailer, text)
        out.append(await add_message(session, sess, "agent", HANDOFF_REPLY))
    return out


def present(m: ProductChatMessageModel) -> dict:
    return {"id": m.id, "role": m.role, "text": m.text, "at": m.created_at.isoformat() if m.created_at else None}


# ---- WhatsApp (Meta Cloud API) ----

def wa_signature_ok(app_secret: str, body: bytes, header: str | None) -> bool:
    if not app_secret or not header or not header.startswith("sha256="):
        return False
    want = hmac.new(app_secret.encode(), body, sha256).hexdigest()
    return hmac.compare_digest(want, header[7:])


class WhatsAppSender:
    """Sends a text through the customer's own WhatsApp Business number."""

    def __init__(self, transport=None):
        self._transport = transport

    async def send(self, phone_number_id: str, token: str, to: str, text: str) -> None:
        import httpx

        async with httpx.AsyncClient(timeout=20, transport=self._transport) as c:
            r = await c.post(f"https://graph.facebook.com/v20.0/{phone_number_id}/messages", headers={"Authorization": f"Bearer {token}"},
                             json={"messaging_product": "whatsapp", "to": to, "type": "text", "text": {"body": text[:4000], "preview_url": True}})
        if r.status_code >= 400:
            raise RuntimeError(f"whatsapp send failed {r.status_code}: {r.text[:200]}")


_sender = WhatsAppSender()


def get_wa_sender() -> WhatsAppSender:
    """The seam tests replace."""
    return _sender
