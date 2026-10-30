from fastapi import APIRouter, Depends, Header, Response
from pydantic import BaseModel, Field

from api.db.product_models import ProductAgentModel
from api.product import agents as svc
from api.product import definition as defn
from api.product.deps import Ctx, get_ctx, require
from api.product.errors import product_error
from api.product.gateway import PlatformGateway, get_gateway
from api.product.roles import Perm
from api.product.templates import TEMPLATES

router = APIRouter(prefix="/product/agents", tags=["agents"])


class AgentOut(BaseModel):
    id: str
    name: str
    emoji: str
    color: str
    role: str
    status: str
    tone: str
    business: str
    what_you_do: str
    brain: str
    voice_id: str | None
    prompt_mode: str
    prompt: str | None = None
    version: int
    # Filled from real call data in a later phase; zero/null until then.
    calls_today: int = 0
    success_rate: int | None = None
    spark: list[int] = Field(default_factory=lambda: [0] * 8)


class AgentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    template: str | None = None
    role: str | None = Field(default=None, max_length=120)
    business: str = Field(default="", max_length=160)
    what_you_do: str = Field(default="", max_length=2000)
    tone: str | None = None


class AgentPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    emoji: str | None = Field(default=None, max_length=16)
    color: str | None = Field(default=None, max_length=16)
    role: str | None = Field(default=None, max_length=120)
    tone: str | None = None
    business: str | None = Field(default=None, max_length=160)
    what_you_do: str | None = Field(default=None, max_length=2000)
    brain: str | None = None
    voice_id: str | None = Field(default=None, max_length=64)
    prompt: str | None = Field(default=None, max_length=20000)


class CheckOut(BaseModel):
    id: str
    label: str
    level: str
    hint: str | None = None


class TemplateOut(BaseModel):
    key: str
    name: str
    emoji: str
    color: str
    role: str
    tone: str
    blurb: str


def _out(a: ProductAgentModel, prompt: str | None = None) -> AgentOut:
    return AgentOut(
        id=a.public_id, name=a.name, emoji=a.emoji, color=a.color, role=a.role, status=a.status,
        tone=a.tone, business=a.business, what_you_do=a.what_you_do, brain=a.brain,
        voice_id=a.voice_id, prompt_mode=a.prompt_mode, prompt=prompt, version=a.version,
    )


@router.get("/templates", response_model=list[TemplateOut])
async def templates(ctx: Ctx = Depends(get_ctx)):
    return [TemplateOut(**t.__dict__) for t in TEMPLATES]


@router.get("", response_model=list[AgentOut])
async def list_agents(ctx: Ctx = Depends(get_ctx)):
    return [_out(a) for a in await svc.list_agents(ctx.session, ctx.workspace)]


@router.post("", response_model=AgentOut, status_code=201)
async def create_agent(
    body: AgentCreate,
    response: Response,
    ctx: Ctx = Depends(require(Perm.AGENTS_WRITE)),
    gw: PlatformGateway = Depends(get_gateway),
):
    agent = await svc.create_agent(
        ctx.session, gw, ctx.workspace, ctx.user.id, name=body.name, template=body.template,
        role=body.role, business=body.business, what_you_do=body.what_you_do, tone=body.tone,
    )
    await ctx.session.commit()
    response.headers["ETag"] = str(agent.version)
    return _out(agent)


@router.get("/{agent_id}", response_model=AgentOut)
async def get_agent(
    agent_id: str, response: Response, ctx: Ctx = Depends(get_ctx), gw: PlatformGateway = Depends(get_gateway)
):
    agent = await svc.get_agent(ctx.session, ctx.workspace, agent_id)
    graph = await gw.working_definition(ctx.workspace.test_org_id, agent.test_workflow_id) or {}
    response.headers["ETag"] = str(agent.version)
    return _out(agent, defn.get_prompt(graph))


@router.patch("/{agent_id}", response_model=AgentOut)
async def patch_agent(
    agent_id: str,
    body: AgentPatch,
    response: Response,
    if_match: str | None = Header(default=None),
    ctx: Ctx = Depends(require(Perm.AGENTS_WRITE)),
    gw: PlatformGateway = Depends(get_gateway),
):
    agent = await svc.get_agent(ctx.session, ctx.workspace, agent_id)
    expected = None
    if if_match is not None:
        try:
            expected = int(if_match.strip('"'))
        except ValueError:
            raise product_error(400, "bad_etag", "That edit was out of date. Reload and try again.")
    await svc.update_agent(ctx.session, gw, ctx.workspace, agent, body.model_dump(exclude_unset=True), expected)
    await ctx.session.commit()
    response.headers["ETag"] = str(agent.version)
    graph = await gw.working_definition(ctx.workspace.test_org_id, agent.test_workflow_id) or {}
    return _out(agent, defn.get_prompt(graph))


@router.post("/{agent_id}/duplicate", response_model=AgentOut, status_code=201)
async def duplicate(
    agent_id: str,
    ctx: Ctx = Depends(require(Perm.AGENTS_WRITE)),
    gw: PlatformGateway = Depends(get_gateway),
):
    src = await svc.get_agent(ctx.session, ctx.workspace, agent_id)
    copy = await svc.duplicate_agent(ctx.session, gw, ctx.workspace, ctx.user.id, src)
    await ctx.session.commit()
    return _out(copy)


@router.post("/{agent_id}/pause", response_model=AgentOut)
async def pause(agent_id: str, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE))):
    agent = await svc.get_agent(ctx.session, ctx.workspace, agent_id)
    if agent.status != "live":
        raise product_error(400, "not_live", "Only a live agent can be paused.")
    agent.status = "paused"
    agent.version += 1
    await ctx.session.commit()
    return _out(agent)


@router.post("/{agent_id}/resume", response_model=AgentOut)
async def resume(agent_id: str, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE))):
    agent = await svc.get_agent(ctx.session, ctx.workspace, agent_id)
    if agent.status != "paused":
        raise product_error(400, "not_paused", "This agent isn't paused.")
    agent.status = "live"
    agent.version += 1
    await ctx.session.commit()
    return _out(agent)


@router.get("/{agent_id}/readiness", response_model=list[CheckOut])
async def readiness(agent_id: str, ctx: Ctx = Depends(get_ctx), gw: PlatformGateway = Depends(get_gateway)):
    agent = await svc.get_agent(ctx.session, ctx.workspace, agent_id)
    checks = await svc.readiness(ctx.session, gw, ctx.workspace, agent)
    await ctx.session.commit()  # readiness repairs a missing model profile
    return [CheckOut(**c.__dict__) for c in checks]


@router.post("/{agent_id}/publish", response_model=AgentOut)
async def publish(
    agent_id: str,
    ctx: Ctx = Depends(require(Perm.AGENTS_WRITE)),
    gw: PlatformGateway = Depends(get_gateway),
):
    agent = await svc.get_agent(ctx.session, ctx.workspace, agent_id)
    await svc.go_live(ctx.session, gw, ctx.workspace, ctx.user.id, agent)
    await ctx.session.commit()
    return _out(agent)
