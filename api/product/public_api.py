"""The public API (`/api/v1/public/*`) for customers' own software. Authenticated with a secret key, never a login.

``sk_test_`` keys read the Test side, ``sk_live_`` keys the Live side. Every request is rate-limited and logged.
"""

import time
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Header, Request
from fastapi.exceptions import HTTPException
from fastapi.routing import APIRoute
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.db.models import WorkflowRunModel
from api.db.product_models import ProductAgentModel, ProductApiKeyModel, ProductApiLogModel, ProductWorkspaceModel
from api.product import conversations_router as cr
from api.product import developers as dev
from api.product.deps import Ctx, get_session
from api.product.errors import product_error
from api.product.ids import decode_call_id
from api.product.llm_gateway import LLMGateway, get_llm
from api.utils import rate_limit

RATE_PER_MINUTE = 120


class LoggedRoute(APIRoute):
    """Writes one request-log row per authenticated request, whatever the outcome."""

    def get_route_handler(self):
        inner = super().get_route_handler()

        async def handler(request: Request):
            t0, status = time.monotonic(), 500
            try:
                resp = await inner(request)
                status = resp.status_code
                return resp
            except HTTPException as e:
                status = e.status_code
                raise
            finally:
                key, session = getattr(request.state, "api_key", None), getattr(request.state, "api_session", None)
                if key is not None and session is not None:
                    try:
                        session.add(ProductApiLogModel(workspace_id=key.workspace_id, key_id=key.id, method=request.method, path=request.url.path[:200], status=status,
                                                       ms=int((time.monotonic() - t0) * 1000), created_at=datetime.now(UTC)))
                        await session.commit()
                    except Exception:  # noqa: BLE001 - logging must never break a request
                        await session.rollback()

        return handler


router = APIRouter(prefix="/public", tags=["public"], route_class=LoggedRoute)


async def key_ctx(request: Request, authorization: str | None = Header(default=None), session: AsyncSession = Depends(get_session)) -> Ctx:
    raw = authorization[7:].strip() if authorization and authorization.lower().startswith("bearer ") else None
    key = await dev.authenticate(session, raw)
    if key is None:
        raise product_error(401, "bad_api_key", "That API key isn't valid. Create one under Developers.")
    request.state.api_key, request.state.api_session = key, session
    await rate_limit.enforce(f"papi:{key.id}", RATE_PER_MINUTE, 60, "Too many requests. Slow down and try again in a minute.")
    key.last_used_at = datetime.now(UTC)
    ws = await session.get(ProductWorkspaceModel, key.workspace_id)
    return Ctx(session, None, ws, "viewer", key.environment)  # a key only ever reads


class AgentOut(BaseModel):
    id: str
    name: str
    status: str


class WhoOut(BaseModel):
    workspace: str
    environment: str


@router.get("/me", response_model=WhoOut)
async def whoami(ctx: Ctx = Depends(key_ctx)):
    return WhoOut(workspace=ctx.workspace.public_id, environment=ctx.environment)


@router.get("/agents", response_model=list[AgentOut])
async def agents(ctx: Ctx = Depends(key_ctx)):
    rows = (await ctx.session.scalars(select(ProductAgentModel).where(ProductAgentModel.workspace_id == ctx.workspace.id).order_by(ProductAgentModel.id))).all()
    return [AgentOut(id=a.public_id, name=a.name, status=a.status) for a in rows if (a.test_workflow_id if ctx.environment == "test" else a.live_workflow_id)]


@router.get("/calls", response_model=cr.CallPage)
async def calls(page: int = 1, limit: int = 25, agent: str | None = None, ctx: Ctx = Depends(key_ctx)):
    page, limit = max(1, page), max(1, min(limit, 100))
    ags = await cr._agents(ctx)
    stmt = cr._scope(ctx)
    if agent:
        wid = next((w for w, a in ags.items() if a.public_id == agent), None)
        if wid is None:
            return cr.CallPage(calls=[], total=0, page=page, limit=limit)
        stmt = stmt.where(WorkflowRunModel.workflow_id == wid)
    total = await ctx.session.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
    rows = (await ctx.session.scalars(stmt.order_by(WorkflowRunModel.created_at.desc(), WorkflowRunModel.id.desc()).offset((page - 1) * limit).limit(limit))).all()
    return cr.CallPage(calls=await cr.present(ctx, [cr._out(ctx, r, ags) for r in rows]), total=total, page=page, limit=limit)


@router.get("/calls/{call_id}", response_model=cr.CallDetail)
async def call(call_id: str, ctx: Ctx = Depends(key_ctx), sign: cr.AudioSigner = Depends(cr.get_audio_signer), llm: LLMGateway = Depends(get_llm)):
    if decode_call_id(call_id) is None:
        raise product_error(404, "call_not_found", "We couldn't find that call.")
    return await cr.get_call(call_id, ctx, sign, llm)
