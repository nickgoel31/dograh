"""Chat agents: the team's side (inbox and settings), the public side (the website chat) and the WhatsApp webhook."""

import json
import logging
import secrets
from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select

from api.db.product_models import ProductAgentModel, ProductChatMessageModel, ProductChatSessionModel, ProductChatSettingsModel
from api.product import chat, emailer
from api.product.deps import Ctx, get_ctx, get_session, require
from api.product.errors import product_error
from api.product.llm_gateway import AgentTextGateway, get_text
from api.product.roles import Perm
from api.utils import rate_limit

log = logging.getLogger(__name__)
router = APIRouter(prefix="/product/chat", tags=["chat"])
public = APIRouter(prefix="/public/chat", tags=["chat-public"])
hooks = APIRouter(prefix="/product/hooks", tags=["chat-public"])
CORS = {"Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=60"}


# ============================== the team's side ==============================

class WhatsAppIn(BaseModel):
    phone_number_id: str = Field(default="", max_length=40, pattern=r"^[0-9]*$")
    token: str | None = Field(default=None, max_length=600)  # blank keeps the saved one
    app_secret: str | None = Field(default=None, max_length=200)


class SettingsIn(BaseModel):
    agent_id: str | None = None
    enabled: bool = True
    config: dict = Field(default_factory=dict)
    origins: list[str] = Field(default_factory=list, max_length=20)
    notify_email: str | None = Field(default=None, max_length=160)
    whatsapp: WhatsAppIn | None = None


def _wa_view(s: ProductChatSettingsModel) -> dict:
    w = s.whatsapp or {}
    return {"phone_number_id": w.get("phone_number_id", ""), "has_token": bool(w.get("token")), "has_secret": bool(w.get("app_secret")), "verify_token": w.get("verify_token", ""),
            "connected": bool(w.get("phone_number_id") and w.get("token") and w.get("app_secret"))}


async def _agent_public_id(session, s) -> str | None:
    return await session.scalar(select(ProductAgentModel.public_id).where(ProductAgentModel.id == s.agent_id)) if s.agent_id else None


async def _settings_out(ctx: Ctx, s: ProductChatSettingsModel) -> dict:
    live = await chat.chat_agent(ctx.session, ctx.workspace, s)
    return {"key": s.key, "agent_id": await _agent_public_id(ctx.session, s), "enabled": s.enabled, "config": chat.clean_config(s.config), "origins": s.origins or [],
            "notify_email": s.notify_email, "whatsapp": _wa_view(s), "answering_agent": live.name if live else None, "ready": live is not None}


@router.get("/settings")
async def get_settings(ctx: Ctx = Depends(get_ctx)):
    s = await chat.get_settings(ctx.session, ctx.workspace)
    await ctx.session.commit()
    return await _settings_out(ctx, s)


@router.put("/settings")
async def save_settings(body: SettingsIn, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE))):
    s = await chat.get_settings(ctx.session, ctx.workspace)
    if body.agent_id:
        a = await ctx.session.scalar(select(ProductAgentModel).where(ProductAgentModel.public_id == body.agent_id, ProductAgentModel.workspace_id == ctx.workspace.id))
        if a is None:
            raise product_error(404, "agent_not_found", "We couldn't find that agent.")
        s.agent_id = a.id
    else:
        s.agent_id = None
    origins = []
    for o in body.origins:
        u = urlsplit(o.strip())
        if u.scheme not in ("http", "https") or not u.netloc:
            raise product_error(400, "bad_website", f"“{o}” isn't a website address. Use the full address, like https://www.example.com.")
        origins.append(f"{u.scheme}://{u.netloc}")
    s.enabled, s.config, s.origins, s.notify_email = body.enabled, chat.clean_config(body.config), sorted(set(origins)), (body.notify_email or "").strip() or None
    if body.whatsapp is not None:
        w = dict(s.whatsapp or {})
        w["phone_number_id"] = body.whatsapp.phone_number_id.strip()
        if body.whatsapp.token:
            w["token"] = body.whatsapp.token.strip()
        if body.whatsapp.app_secret:
            w["app_secret"] = body.whatsapp.app_secret.strip()
        w.setdefault("verify_token", "vt_" + secrets.token_hex(10))
        s.whatsapp, s.wa_phone_id = w, w["phone_number_id"] or None
        if s.wa_phone_id:
            clash = await ctx.session.scalar(select(ProductChatSettingsModel.workspace_id).where(ProductChatSettingsModel.wa_phone_id == s.wa_phone_id, ProductChatSettingsModel.workspace_id != ctx.workspace.id))
            if clash:
                raise product_error(409, "number_in_use", "That WhatsApp number is already connected to another workspace.")
    await ctx.session.commit()
    return await _settings_out(ctx, s)


def _view(sess: ProductChatSessionModel) -> dict:
    return {"id": chat.token_for(sess), "name": sess.name, "contact": sess.contact, "email": sess.email, "channel": sess.channel, "status": sess.status, "unread": sess.unread or 0,
            "last_text": sess.last_text, "last_at": sess.last_at.isoformat() if sess.last_at else None, "rating": sess.rating, "handoff": bool(sess.handoff_at)}


async def _mine(ctx: Ctx, sid: str) -> ProductChatSessionModel:
    row = await chat.session_by_token(ctx.session, sid, ctx.workspace.id)
    if row is None:
        raise product_error(404, "chat_not_found", "We couldn't find that chat.")
    return row


@router.get("/sessions")
async def sessions(status: str | None = Query(default=None, pattern="^(bot|human|closed|open)$"), q: str | None = Query(default=None, max_length=60), page: int = Query(default=1, ge=1), limit: int = Query(default=30, ge=1, le=100), ctx: Ctx = Depends(get_ctx)):
    stmt = select(ProductChatSessionModel).where(ProductChatSessionModel.workspace_id == ctx.workspace.id, ProductChatSessionModel.last_text.is_not(None))  # chats nobody wrote in are not shown
    if status == "open":
        stmt = stmt.where(ProductChatSessionModel.status != "closed")
    elif status:
        stmt = stmt.where(ProductChatSessionModel.status == status)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(ProductChatSessionModel.name.ilike(like), ProductChatSessionModel.contact.ilike(like), ProductChatSessionModel.email.ilike(like), ProductChatSessionModel.last_text.ilike(like)))
    total = await ctx.session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (await ctx.session.scalars(stmt.order_by(ProductChatSessionModel.last_at.desc(), ProductChatSessionModel.id.desc()).offset((page - 1) * limit).limit(limit))).all()
    needs = await ctx.session.scalar(select(func.count()).select_from(ProductChatSessionModel).where(ProductChatSessionModel.workspace_id == ctx.workspace.id, ProductChatSessionModel.status == "human")) or 0
    return {"sessions": [_view(r) for r in rows], "total": total, "needs_you": needs}


@router.get("/sessions/{sid}")
async def one(sid: str, ctx: Ctx = Depends(get_ctx)):
    sess = await _mine(ctx, sid)
    msgs = (await ctx.session.scalars(select(ProductChatMessageModel).where(ProductChatMessageModel.session_id == sess.id).order_by(ProductChatMessageModel.id))).all()
    if sess.unread:
        sess.unread = 0
        await ctx.session.commit()
    return {**_view(sess), "messages": [chat.present(m) for m in msgs]}


class ReplyIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


@router.post("/sessions/{sid}/reply")
async def reply(sid: str, body: ReplyIn, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE)), sender: chat.WhatsAppSender = Depends(chat.get_wa_sender)):
    sess = await _mine(ctx, sid)
    sess.status, sess.unread = "human", 0  # answering as a person means the agent steps back
    m = await chat.add_message(ctx.session, sess, "human", body.text.strip())
    sent = True
    if sess.channel == "whatsapp":
        s = await chat.get_settings(ctx.session, ctx.workspace)
        w = s.whatsapp or {}
        try:
            await sender.send(w.get("phone_number_id", ""), w.get("token", ""), sess.contact, body.text.strip())
        except Exception:  # noqa: BLE001
            log.warning("whatsapp reply failed", exc_info=True)
            sent = False
    await ctx.session.commit()
    return {"message": chat.present(m), "delivered": sent}


class StatusIn(BaseModel):
    status: str = Field(pattern="^(bot|human|closed)$")


@router.post("/sessions/{sid}/status")
async def set_status(sid: str, body: StatusIn, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE))):
    sess = await _mine(ctx, sid)
    sess.status = body.status
    if body.status != "human":
        sess.unread = 0
    await ctx.session.commit()
    return _view(sess)


@router.get("/stats")
async def stats(days: int = Query(default=30, ge=1, le=365), ctx: Ctx = Depends(get_ctx)):
    since = datetime.now(UTC) - timedelta(days=days)
    rows = (await ctx.session.scalars(select(ProductChatSessionModel).where(ProductChatSessionModel.workspace_id == ctx.workspace.id, ProductChatSessionModel.created_at >= since, ProductChatSessionModel.last_text.is_not(None)).limit(20000))).all()
    messages = await ctx.session.scalar(select(func.count()).select_from(ProductChatMessageModel).join(ProductChatSessionModel, ProductChatSessionModel.id == ProductChatMessageModel.session_id).where(
        ProductChatSessionModel.workspace_id == ctx.workspace.id, ProductChatMessageModel.created_at >= since)) or 0
    rated = [r.rating for r in rows if r.rating]
    by_day: dict[str, int] = {}
    for r in rows:
        d = (r.created_at or since).date().isoformat()
        by_day[d] = by_day.get(d, 0) + 1
    handed = sum(1 for r in rows if r.handoff_at)
    return {"sessions": len(rows), "messages": messages, "handed_over": handed, "handled_by_agent": len(rows) - handed, "open": sum(1 for r in rows if r.status != "closed"),
            "needs_you": sum(1 for r in rows if r.status == "human"), "avg_rating": round(sum(rated) / len(rated), 1) if rated else None, "rated": len(rated),
            "by_day": [{"day": d, "sessions": n} for d, n in sorted(by_day.items())]}


# ============================== the website chat ==============================

SCRIPT = r"""(function(){
  var s=document.currentScript; if(!s) return;
  var key=s.getAttribute('data-key'); if(!key) return;
  var u=new URL(s.src), app=(s.getAttribute('data-app')||u.origin).replace(/\/$/,''), api=u.origin+u.pathname.replace(/\/public\/chat\.js$/,'');
  fetch(api+'/public/chat/config?key='+encodeURIComponent(key)).then(function(r){return r.ok?r.json():null}).then(function(c){
    if(!c||!c.enabled||document.getElementById('swarvo-chat-btn')) return;
    var side=c.position==='left'?'left':'right', open=false, frame=null;
    var b=document.createElement('button'); b.id='swarvo-chat-btn'; b.setAttribute('aria-label',c.title||'Chat with us');
    b.style.cssText='position:fixed;'+side+':20px;bottom:20px;z-index:2147483000;width:58px;height:58px;border:0;border-radius:50%;background:'+c.color+';color:#fff;cursor:pointer;box-shadow:0 6px 24px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;transition:transform .15s';
    var chat='<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z"/></svg>';
    var x='<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    b.innerHTML=chat; b.onmouseenter=function(){b.style.transform='scale(1.06)'}; b.onmouseleave=function(){b.style.transform=''};
    function show(){
      if(!frame){
        frame=document.createElement('iframe'); frame.title=c.title||'Chat';
        var q='?embedder='+encodeURIComponent(location.origin), n=s.getAttribute('data-user-name'), e=s.getAttribute('data-user-email');
        if(n) q+='&name='+encodeURIComponent(n); if(e) q+='&email='+encodeURIComponent(e);
        frame.src=app+'/chat-widget/'+encodeURIComponent(key)+q;
        var small=window.innerWidth<480;
        frame.style.cssText='position:fixed;'+(small?'inset:0;width:100%;height:100%;border-radius:0;':side+':20px;bottom:92px;width:380px;height:min(640px,calc(100vh - 112px));border-radius:16px;')+'border:0;z-index:2147483001;box-shadow:0 12px 48px rgba(0,0,0,.3);background:#fff;color-scheme:normal';
        document.body.appendChild(frame);
      }
      frame.style.display='block'; open=true; b.innerHTML=x;
    }
    function hide(){ if(frame) frame.style.display='none'; open=false; b.innerHTML=chat; }
    b.onclick=function(){ open?hide():show(); };
    window.addEventListener('message',function(ev){ if(ev.origin===app&&ev.data==='swarvo-chat-close') hide(); });
    window.SwarvoChat={open:show,close:hide,toggle:function(){open?hide():show()}};
    document.body.appendChild(b);
    if(s.getAttribute('data-open')==='true') show();
  }).catch(function(){});
})();
"""


chat_js = APIRouter(prefix="/public", tags=["chat-public"])


@chat_js.get("/chat.js")
async def script():
    return Response(SCRIPT, media_type="application/javascript", headers={"Cache-Control": "public, max-age=300"})


def _norm(o: str | None) -> str:
    return (o or "").strip().rstrip("/")


def _origin_ok(s: ProductChatSettingsModel, embedder: str | None, request: Request) -> bool:
    if not embedder:
        return False
    host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    if urlsplit(embedder).netloc == host:  # our own pages, like the preview in the dashboard
        return True
    allowed = [_norm(o) for o in s.origins or []]
    return not allowed or _norm(embedder) in allowed


def _public_config(s) -> dict:
    return {"enabled": bool(s.enabled), **chat.clean_config(s.config)}


@public.get("/config")
async def public_config(key: str = Query(max_length=40), session=Depends(get_session)):
    s = await chat.by_key(session, key)
    body = {"enabled": False} if s is None else _public_config(s)
    return Response(json.dumps(body), media_type="application/json", headers=CORS)


class OpenIn(BaseModel):
    key: str = Field(max_length=40)
    embedder: str = Field(max_length=200)
    token: str | None = Field(default=None, max_length=80)
    visitor: str | None = Field(default=None, max_length=60)
    name: str | None = Field(default=None, max_length=120)
    email: str | None = Field(default=None, max_length=160, pattern=r"^[^@\s]*@?[^@\s]*$")


async def _target(session, key: str, embedder: str, request: Request):
    s = await chat.by_key(session, key)
    if s is None or not s.enabled:
        raise product_error(404, "chat_unavailable", "This chat isn't available right now.")
    if not _origin_ok(s, embedder, request):
        raise product_error(403, "website_not_allowed", "This website isn't allowed to show this chat.")
    from api.db.product_models import ProductWorkspaceModel

    return s, await session.get(ProductWorkspaceModel, s.workspace_id)


@public.post("/session")
async def open_chat(body: OpenIn, request: Request, session=Depends(get_session)):
    await rate_limit.enforce(f"pchatopen:{request.client.host if request.client else 'x'}", 30, 600, "Too many chats started. Please wait a little.")
    s, ws = await _target(session, body.key, body.embedder, request)
    sess = await chat.session_by_token(session, body.token or "", ws.id)
    if sess is None or sess.channel != "web":
        agent = await chat.chat_agent(session, ws, s)
        sess = await chat.open_session(session, ws, s, agent, "web", body.visitor or secrets.token_hex(6), body.name, body.email)
    elif (body.name or body.email) and not (sess.name or sess.email):
        sess.name, sess.email = (body.name or sess.name), (body.email or sess.email)
    msgs = (await session.scalars(select(ProductChatMessageModel).where(ProductChatMessageModel.session_id == sess.id).order_by(ProductChatMessageModel.id))).all()
    await session.commit()
    return {"token": chat.token_for(sess), "status": sess.status, "config": _public_config(s), "messages": [chat.present(m) for m in msgs]}


class SayIn(BaseModel):
    token: str = Field(max_length=80)
    text: str = Field(min_length=1, max_length=2000)


async def _open_session(session, token: str):
    sess = await chat.session_by_token(session, token)
    if sess is None:
        raise product_error(400, "bad_session", "This chat has expired. Please start a new one.")
    return sess


@public.post("/message")
async def say(body: SayIn, session=Depends(get_session), text: AgentTextGateway = Depends(get_text), mailer: emailer.Mailer = Depends(emailer.get_mailer)):
    await rate_limit.enforce(f"pchatsay:{body.token}", 40, 600, "You're sending messages very quickly. Please slow down.")
    sess = await _open_session(session, body.token)
    s = await session.get(ProductChatSettingsModel, sess.workspace_id)
    if s is None or not s.enabled:
        raise product_error(404, "chat_unavailable", "This chat isn't available right now.")
    from api.db.product_models import ProductWorkspaceModel

    ws = await session.get(ProductWorkspaceModel, sess.workspace_id)
    agent = await chat.chat_agent(session, ws, s)
    new = await chat.converse(session, ws, s, agent, sess, body.text, text, mailer)
    await session.commit()
    return {"status": sess.status, "messages": [chat.present(m) for m in new]}


@public.get("/poll")
async def poll(token: str = Query(max_length=80), after: int = Query(default=0, ge=0), session=Depends(get_session)):
    sess = await _open_session(session, token)
    msgs = (await session.scalars(select(ProductChatMessageModel).where(ProductChatMessageModel.session_id == sess.id, ProductChatMessageModel.id > after, ProductChatMessageModel.role != "visitor").order_by(ProductChatMessageModel.id))).all()
    return {"status": sess.status, "messages": [chat.present(m) for m in msgs]}


class RateIn(BaseModel):
    token: str = Field(max_length=80)
    rating: int = Field(ge=1, le=5)


@public.post("/rate")
async def rate(body: RateIn, session=Depends(get_session)):
    sess = await _open_session(session, body.token)
    sess.rating = body.rating
    await session.commit()
    return {"ok": True}


# ============================== WhatsApp ==============================

@hooks.get("/whatsapp")
async def whatsapp_verify(request: Request, session=Depends(get_session)):
    """Meta calls this once when you save the webhook. We answer only if the verify token is one of ours."""
    q = request.query_params
    if q.get("hub.mode") == "subscribe" and q.get("hub.verify_token"):
        for s in (await session.scalars(select(ProductChatSettingsModel).where(ProductChatSettingsModel.whatsapp.is_not(None)))).all():
            if secrets.compare_digest(str((s.whatsapp or {}).get("verify_token", "")), q["hub.verify_token"]):
                return Response(q.get("hub.challenge", ""), media_type="text/plain")
    return Response("forbidden", status_code=403)


@hooks.post("/whatsapp")
async def whatsapp_inbound(request: Request, session=Depends(get_session), text: AgentTextGateway = Depends(get_text), mailer: emailer.Mailer = Depends(emailer.get_mailer), sender: chat.WhatsAppSender = Depends(chat.get_wa_sender)):
    raw = await request.body()
    try:
        data = json.loads(raw or b"{}")
    except ValueError:
        return Response("bad request", status_code=400)
    from api.db.product_models import ProductWorkspaceModel

    for entry in data.get("entry", []) if isinstance(data, dict) else []:
        for change in entry.get("changes", []):
            v = change.get("value") or {}
            pid = str((v.get("metadata") or {}).get("phone_number_id") or "")
            s = await session.scalar(select(ProductChatSettingsModel).where(ProductChatSettingsModel.wa_phone_id == pid)) if pid else None
            w = (s.whatsapp or {}) if s else {}
            if s is None or not chat.wa_signature_ok(w.get("app_secret", ""), raw, request.headers.get("x-hub-signature-256")):
                continue  # not ours, or not signed by Meta: ignore it
            ws = await session.get(ProductWorkspaceModel, s.workspace_id)
            names = {c.get("wa_id"): (c.get("profile") or {}).get("name") for c in v.get("contacts", [])}
            for msg in v.get("messages", []):
                wamid, who = str(msg.get("id") or ""), str(msg.get("from") or "")
                if not who or (wamid and await session.scalar(select(ProductChatMessageModel.id).where(ProductChatMessageModel.ext_id == wamid))):
                    continue  # a retried delivery
                sess = await session.scalar(select(ProductChatSessionModel).where(ProductChatSessionModel.workspace_id == ws.id, ProductChatSessionModel.channel == "whatsapp", ProductChatSessionModel.contact == who).order_by(ProductChatSessionModel.id.desc()))
                agent = await chat.chat_agent(session, ws, s)
                if sess is None:
                    sess = await chat.open_session(session, ws, s, agent, "whatsapp", who, names.get(who))
                body = ((msg.get("text") or {}).get("body") or "").strip() if msg.get("type") == "text" else ""
                reply_texts: list[str] = []
                if not body:
                    await chat.add_message(session, sess, "visitor", f"[{msg.get('type', 'message')}]", wamid or None)
                    reply_texts.append("I can only read text messages for now. Please type your question.")
                else:
                    new = await chat.converse(session, ws, s, agent, sess, body, text, mailer, wamid or None)
                    reply_texts = [m.text for m in new if m.role == "agent"]
                await session.commit()
                for t in reply_texts:
                    try:
                        await sender.send(pid, w.get("token", ""), who, t)
                    except Exception:  # noqa: BLE001 - the answer is saved; the team can resend from the inbox
                        log.warning("whatsapp send failed for workspace %s", ws.id, exc_info=True)
    return {"ok": True}
