"""Call button for customers' websites: a script to embed and the socket it uses.

The script opens the hosted widget page in an iframe. That page talks to the socket below. The socket only serves
agents that are Live, only when the embedding website is in the workspace's allowed list, and calls run (and are
billed) on the Live side. The embedding site comes from the browser, so this is a guard against casual misuse,
not against someone scripting requests.
"""

import os
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, Request, Response, WebSocket
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.db.product_models import ProductAgentModel, ProductWorkspaceModel
from api.product import billing, models_config, privacy
from api.product.calls_router import STUN, IceOut, IceServer, allowed_origins, origin_allowed
from api.product.deps import get_session
from api.product.errors import product_error
from api.product.ids import decode_id, encode_id
from api.product.llm_gateway import AgentTextGateway, get_text
from api.utils import rate_limit
from api.product.gateway import PlatformGateway, get_gateway

router = APIRouter(prefix="/public", tags=["widget"])

SCRIPT = """(function(){
  var s=document.currentScript, agent=s.getAttribute('data-agent');
  var app=s.getAttribute('data-app'); if(!app||!agent) return;
  var b=document.createElement('button'); b.textContent=s.getAttribute('data-label')||'Talk to us';
  b.style.cssText='position:fixed;right:20px;bottom:20px;z-index:2147483000;padding:12px 18px;border:0;border-radius:999px;background:#4f46e5;color:#fff;font:600 14px system-ui;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25)';
  var f;
  b.onclick=function(){
    if(f){f.remove();f=null;b.textContent=s.getAttribute('data-label')||'Talk to us';return;}
    f=document.createElement('iframe'); f.allow='microphone';
    f.src=app.replace(/\\/$/,'')+'/widget/'+encodeURIComponent(agent)+'?mode='+(s.getAttribute('data-mode')||'voice')+'&embedder='+encodeURIComponent(location.origin);
    f.style.cssText='position:fixed;right:20px;bottom:76px;width:340px;height:440px;max-width:calc(100vw - 40px);border:0;border-radius:16px;z-index:2147483000;box-shadow:0 8px 30px rgba(0,0,0,.3);background:#fff';
    document.body.appendChild(f); b.textContent='Close';
  };
  document.body.appendChild(b);
})();
"""


@router.get("/widget.js")
async def widget_js():
    return Response(SCRIPT, media_type="application/javascript", headers={"Cache-Control": "public, max-age=300"})


@router.get("/widget/ice", response_model=IceOut)
async def widget_ice():
    servers = [IceServer(urls=[STUN])]
    try:
        import secrets

        from api.routes.turn_credentials import TURN_SECRET, generate_turn_credentials

        if TURN_SECRET:
            c = generate_turn_credentials("w" + secrets.token_hex(6))
            servers.append(IceServer(urls=c["uris"], username=c["username"], credential=c["password"]))
    except Exception:  # noqa: BLE001 - STUN alone still works on friendly networks
        pass
    return IceOut(ice_servers=servers)


def _norm(o: str | None) -> str:
    return (o or "").strip().rstrip("/")


@router.websocket("/widget/{agent_id}/call")
async def widget_call(
    websocket: WebSocket,
    agent_id: str,
    embedder: str | None = None,
    session: AsyncSession = Depends(get_session),
    gw: PlatformGateway = Depends(get_gateway),
):
    async def refuse(reason: str):
        await websocket.accept()
        await websocket.close(code=1008, reason=reason)

    if not origin_allowed(websocket.headers.get("origin"), websocket.headers.get("host"), allowed_origins()):
        return await refuse("origin_not_allowed")
    agent = await session.scalar(select(ProductAgentModel).where(ProductAgentModel.public_id == agent_id))
    ws = await session.get(ProductWorkspaceModel, agent.workspace_id) if agent else None
    if agent is None or ws is None or agent.status != "live" or agent.live_workflow_id is None:
        return await refuse("agent_not_available")
    allowed = [_norm(o) for o in (await privacy.get_settings(session, ws.id)).widget_origins or []]
    if not embedder or _norm(embedder) not in allowed or urlsplit(embedder).scheme not in ("http", "https"):
        return await refuse("website_not_allowed")
    if await billing.limit_reached(session, ws.live_org_id):
        return await refuse("agent_not_available")
    if not await models_config.ensure_org_profiles(session, ws.live_org_id):
        return await refuse("calls_not_set_up")
    await session.commit()
    run_id = await gw.start_test_run(ws.live_org_id, ws.owner_user_id, agent.live_workflow_id)
    await gw.serve_signaling(websocket, ws.live_org_id, ws.owner_user_id, agent.live_workflow_id, run_id)


# ---- website chat: the same agent, in text ----
class ChatStart(BaseModel):
    embedder: str = Field(max_length=200)


class ChatSay(ChatStart):
    session: str = Field(max_length=60)
    text: str = Field(min_length=1, max_length=500)


async def _chat_target(session, agent_id: str, embedder: str):
    agent = await session.scalar(select(ProductAgentModel).where(ProductAgentModel.public_id == agent_id))
    ws = await session.get(ProductWorkspaceModel, agent.workspace_id) if agent else None
    if agent is None or ws is None or agent.status != "live" or agent.live_workflow_id is None:
        raise product_error(404, "agent_not_available", "This agent is not taking messages right now.")
    allowed = [_norm(o) for o in (await privacy.get_settings(session, ws.id)).widget_origins or []]
    if _norm(embedder) not in allowed:
        raise product_error(403, "website_not_allowed", "This website isn't allowed to chat with this agent.")
    return agent, ws


@router.post("/widget/{agent_id}/chat/start")
async def chat_start(agent_id: str, body: ChatStart, request: Request, session: AsyncSession = Depends(get_session), text: AgentTextGateway = Depends(get_text)):
    await rate_limit.enforce(f"pchat:{request.client.host if request.client else 'x'}", 20, 600, "Too many chats started. Please wait a little.")
    agent, ws = await _chat_target(session, agent_id, body.embedder)
    r = await text.start(ws.live_org_id, ws.owner_user_id, agent.live_workflow_id)
    return {"session": encode_id("chat", r.run_id), "reply": r.text, "ended": r.ended}


@router.post("/widget/{agent_id}/chat/say")
async def chat_say(agent_id: str, body: ChatSay, request: Request, session: AsyncSession = Depends(get_session), text: AgentTextGateway = Depends(get_text)):
    await rate_limit.enforce(f"pchatsay:{body.session}", 40, 600, "You're sending messages very quickly. Please slow down.")
    run_id = decode_id("chat", body.session)
    if run_id is None:
        raise product_error(400, "bad_session", "This chat has expired. Please start a new one.")
    agent, ws = await _chat_target(session, agent_id, body.embedder)
    r = await text.say(ws.live_org_id, ws.owner_user_id, agent.live_workflow_id, run_id, body.text.strip())
    return {"reply": r.text, "ended": r.ended}
