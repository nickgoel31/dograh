"""Browser test calls: ICE config and an authenticated signalling socket.

The browser never talks to the platform directly. This socket checks the
session cookie, the origin, the workspace and the role, creates the test run in
the workspace's *test* organization, then hands the socket to the platform's
signalling code.
"""

import os
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, WebSocket
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.db.models import OrganizationModel, UserModel
from api.product.payments import WalletGateway, get_wallet
from api.db.product_models import ProductAgentModel
from api.product import config, models_config
from api.product.deps import Ctx, get_ctx, get_session
from api.product.gateway import PlatformGateway, get_gateway
from api.product.roles import Perm, can
from api.product.service import default_view, list_workspaces
from api.utils.auth import decode_jwt_token

router = APIRouter(prefix="/product", tags=["calls"])

STUN = "stun:stun.l.google.com:19302"


class IceServer(BaseModel):
    urls: list[str]
    username: str | None = None
    credential: str | None = None


class IceOut(BaseModel):
    ice_servers: list[IceServer]


def allowed_origins() -> set[str]:
    return {o.strip().rstrip("/") for o in os.getenv("PRODUCT_ALLOWED_ORIGINS", "").split(",") if o.strip()}


def origin_allowed(origin: str | None, host: str | None, allowed: set[str]) -> bool:
    """Browsers always send Origin on a WebSocket; a missing one is rejected."""
    if not origin:
        return False
    if origin.rstrip("/") in allowed:
        return True
    return bool(host) and urlsplit(origin).netloc == host


@router.get("/call/ice", response_model=IceOut)
async def ice(ctx: Ctx = Depends(get_ctx)):
    servers = [IceServer(urls=[STUN])]
    try:
        from api.routes.turn_credentials import TURN_SECRET, generate_turn_credentials

        if TURN_SECRET:
            c = generate_turn_credentials(str(ctx.user.id))
            servers.append(IceServer(urls=c["uris"], username=c["username"], credential=c["password"]))
    except Exception:  # noqa: BLE001 - calls still work on STUN alone on friendly networks
        pass
    return IceOut(ice_servers=servers)


async def _authorize(
    ws: WebSocket, session: AsyncSession, agent_id: str, workspace_id: str | None, wallet: WalletGateway | None = None
) -> tuple[UserModel, object, ProductAgentModel] | str:
    """Returns (user, workspace, agent) or a short reason code for closing the socket."""
    if not origin_allowed(ws.headers.get("origin"), ws.headers.get("host"), allowed_origins()):
        return "origin_not_allowed"
    token = ws.cookies.get(config.SESSION_COOKIE_NAME)
    if not token:
        return "not_signed_in"
    try:
        user = await session.get(UserModel, int(decode_jwt_token(token)["sub"]))
    except Exception:  # noqa: BLE001
        user = None
    if user is None:
        return "session_expired"
    views = await list_workspaces(session, user.id)
    if not views:
        return "no_workspace"
    view = default_view(views) if workspace_id is None else next(
        (v for v in views if v.workspace.public_id == workspace_id), None
    )
    if view is None:
        return "workspace_not_found"
    if not can(view.role, Perm.AGENTS_WRITE):
        return "not_allowed"
    agent = await session.scalar(
        select(ProductAgentModel).where(
            ProductAgentModel.public_id == agent_id, ProductAgentModel.workspace_id == view.workspace.id
        )
    )
    if agent is None:
        return "agent_not_found"
    if not await models_config.ensure_org_profiles(session, view.workspace.test_org_id):
        return "calls_not_set_up"
    live = await session.get(OrganizationModel, view.workspace.live_org_id)
    if wallet is not None and live is not None and live.wallet_enabled and not view.workspace.adopted:  # practice calls are charged like real ones
        w = await wallet.summary(live.id)
        if float(w.get("balance", 0) or 0) <= 0 and float(w.get("minutes_available", 0) or 0) <= 0:
            return "add_money_first"
    await session.commit()
    return user, view.workspace, agent


@router.websocket("/agents/{agent_id}/call")
async def test_call(
    websocket: WebSocket,
    agent_id: str,
    workspace: str | None = None,
    session: AsyncSession = Depends(get_session),
    gw: PlatformGateway = Depends(get_gateway),
    wallet: WalletGateway = Depends(get_wallet),
):
    result = await _authorize(websocket, session, agent_id, workspace, wallet)
    if isinstance(result, str):
        # Accept, then close with the reason: a socket closed before accept reaches the
        # browser as a bare HTTP 403 with no reason. (The success path must NOT accept:
        # the platform's signalling code does that itself.)
        await websocket.accept()
        await websocket.close(code=1008, reason=result)
        return
    user, ws_row, agent = result
    # Test calls always run on the test copy: free, never reaches real callers.
    run_id = await gw.start_test_run(ws_row.test_org_id, user.id, agent.test_workflow_id)
    await gw.serve_signaling(websocket, ws_row.test_org_id, user.id, agent.test_workflow_id, run_id)
