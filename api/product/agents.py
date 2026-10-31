"""Agent logic. Tenant scoping is enforced here: every lookup filters by workspace."""

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.db.product_models import ProductAgentModel, ProductWorkspaceModel
from api.product import definition as defn
from api.product import flows
from api.product import models_config
from api.product import prompt as prompts
from api.product import voices as voice_catalogue
from api.product.errors import product_error
from api.product.gateway import PlatformGateway
from api.product.ids import new_public_id
from api.product.templates import BY_KEY

BRAINS = ("fast", "balanced", "smartest")
STATUSES = ("draft", "live", "paused")


@dataclass
class Check:
    id: str
    label: str
    level: str  # ok | warn | blocker
    hint: str | None = None


async def get_agent(session: AsyncSession, ws: ProductWorkspaceModel, public_id: str) -> ProductAgentModel:
    agent = await session.scalar(
        select(ProductAgentModel).where(
            ProductAgentModel.public_id == public_id, ProductAgentModel.workspace_id == ws.id
        )
    )
    if agent is None:
        raise product_error(404, "agent_not_found", "We couldn't find that agent.")
    return agent


async def list_agents(session: AsyncSession, ws: ProductWorkspaceModel) -> list[ProductAgentModel]:
    rows = await session.scalars(
        select(ProductAgentModel)
        .where(ProductAgentModel.workspace_id == ws.id)
        .order_by(ProductAgentModel.id.desc())
    )
    return list(rows)


def _compile(a: ProductAgentModel) -> str:
    return prompts.compile_prompt(
        business=a.business, what_you_do=a.what_you_do, role=a.role, tone=a.tone
    )


async def create_agent(
    session: AsyncSession,
    gw: PlatformGateway,
    ws: ProductWorkspaceModel,
    user_id: int,
    *,
    name: str,
    template: str | None,
    role: str | None,
    business: str,
    what_you_do: str,
    tone: str | None,
) -> ProductAgentModel:
    tpl = BY_KEY.get(template) if template else None
    if template and tpl is None:
        raise product_error(400, "unknown_template", "That template doesn't exist.")
    agent = ProductAgentModel(
        public_id=new_public_id("agt"),
        workspace_id=ws.id,
        name=name.strip(),
        emoji=tpl.emoji if tpl else "🤖",
        color=tpl.color if tpl else "#6356f1",
        role=(role or (tpl.role if tpl else "help callers")).strip(),
        tone=tone or (tpl.tone if tpl else prompts.DEFAULT_TONE),
        business=business.strip(),
        what_you_do=what_you_do.strip(),
        status="draft",
        test_workflow_id=0,
    )
    graph = defn.build_definition(
        name=agent.name,
        prompt=_compile(agent),
        greeting=prompts.compile_greeting(business=agent.business),
    )
    agent.test_workflow_id = await gw.create_agent(ws.test_org_id, user_id, agent.name, graph)
    session.add(agent)
    await session.flush()
    return agent


async def update_agent(
    session: AsyncSession,
    gw: PlatformGateway,
    ws: ProductWorkspaceModel,
    agent: ProductAgentModel,
    changes: dict,
    expected_version: int | None,
) -> ProductAgentModel:
    if expected_version is not None and expected_version != agent.version:
        raise product_error(
            409,
            "edited_elsewhere",
            "Someone else changed this agent while you were editing. Reload to see their changes.",
        )
    custom_prompt = changes.pop("prompt", None)
    touches_models = bool({"voice_id", "brain"} & changes.keys())
    if changes.get("voice_id") and voice_catalogue.find(changes["voice_id"]) is None:
        raise product_error(400, "unknown_voice", "That voice isn't available. Pick one from the voice list.")
    for field in ("name", "emoji", "color", "role", "tone", "business", "what_you_do", "voice_id"):
        if field in changes and changes[field] is not None:
            setattr(agent, field, changes[field].strip() if isinstance(changes[field], str) else changes[field])
    if changes.get("brain") is not None:
        if changes["brain"] not in BRAINS:
            raise product_error(400, "bad_brain", "Choose Fast, Balanced or Smartest.")
        agent.brain = changes["brain"]

    graph = await gw.working_definition(ws.test_org_id, agent.test_workflow_id) or {}
    if custom_prompt is not None:
        agent.prompt_mode = "custom"
        graph = defn.with_prompt(graph, name=agent.name, prompt=custom_prompt)
    elif agent.prompt_mode == "simple":
        graph = defn.with_prompt(
            graph,
            name=agent.name,
            prompt=_compile(agent),
            greeting=prompts.compile_greeting(business=agent.business),
        )
    else:
        graph = defn.with_prompt(graph, name=agent.name)
    await gw.save_draft(ws.test_org_id, agent.test_workflow_id, agent.name, graph)
    if touches_models:
        await gw.set_model_overrides(
            ws.test_org_id, agent.test_workflow_id,
            await models_config.build_overrides(session, brain=agent.brain, voice_id=agent.voice_id),
        )
    agent.version += 1
    await session.flush()
    return agent


async def duplicate_agent(
    session: AsyncSession, gw: PlatformGateway, ws: ProductWorkspaceModel, user_id: int, src: ProductAgentModel
) -> ProductAgentModel:
    graph = await gw.working_definition(ws.test_org_id, src.test_workflow_id) or defn.build_definition(
        name=src.name, prompt=_compile(src), greeting=prompts.compile_greeting(business=src.business)
    )
    copy = ProductAgentModel(
        public_id=new_public_id("agt"),
        workspace_id=ws.id,
        name=f"{src.name} (copy)"[:120],
        emoji=src.emoji, color=src.color, role=src.role, tone=src.tone, business=src.business,
        what_you_do=src.what_you_do, brain=src.brain, voice_id=src.voice_id,
        prompt_mode=src.prompt_mode, status="draft", test_workflow_id=0,
    )
    copy.test_workflow_id = await gw.create_agent(ws.test_org_id, user_id, copy.name, graph)
    session.add(copy)
    await session.flush()
    return copy


async def readiness(
    session: AsyncSession, gw: PlatformGateway, ws: ProductWorkspaceModel, agent: ProductAgentModel
) -> list[Check]:
    orgs = (ws.test_org_id,) if ws.adopted else (ws.test_org_id, ws.live_org_id)  # an adopted Live org keeps its own models
    models_ok = await models_config.ensure_org_profiles(session, *orgs)
    graph = await gw.working_definition(ws.test_org_id, agent.test_workflow_id) or {}
    checks = [
        Check(
            "models", "Calls are set up for your workspace",
            "ok" if models_ok else "blocker",
            None if models_ok else "Calling isn't enabled for your workspace yet. Please contact support.",
        ),
        Check(
            "prompt", "Your agent knows what to say",
            "ok" if defn.get_prompt(graph).strip() else "blocker",
            None if defn.get_prompt(graph).strip() else "Add instructions on the Personality tab.",
        ),
        Check(
            "business", "Business name is set",
            "ok" if agent.business.strip() else "warn",
            None if agent.business.strip() else "Callers will hear a generic greeting.",
        ),
        Check(
            "voice", "A voice is chosen",
            "ok" if agent.voice_id else "warn",
            None if agent.voice_id else "Pick a voice on the Voice tab, or we'll use the default.",
        ),
    ]
    return checks


async def go_live(
    session: AsyncSession, gw: PlatformGateway, ws: ProductWorkspaceModel, user_id: int, agent: ProductAgentModel, kb=None, tools=None
) -> ProductAgentModel:
    blockers = [c for c in await readiness(session, gw, ws, agent) if c.level == "blocker"]
    if blockers:
        raise product_error(400, "not_ready", f"Not ready to go live yet: {blockers[0].hint or blockers[0].label}")
    await gw.publish(ws.test_org_id, agent.test_workflow_id)
    graph = await gw.published_definition(ws.test_org_id, agent.test_workflow_id)
    if graph is None:
        raise product_error(500, "publish_failed", "We couldn't publish this agent. Please try again.")
    if kb is not None:  # live calls search the Live organization's copy of each document
        from api.product.knowledge_router import remap_for_live

        graph = await remap_for_live(graph, kb, ws, user_id)
        from api.product.tools_router import get_tools, remap_tools_for_live

        graph = await remap_tools_for_live(graph, tools or get_tools(), ws, user_id)
    from api.product import audit, privacy

    graph = await privacy.apply_consent(session, ws, graph)
    await audit.record(session, ws.id, user_id, "agent.went_live", agent.public_id)
    if agent.live_workflow_id is None:
        agent.live_workflow_id = await gw.create_agent(ws.live_org_id, user_id, agent.name, graph)
    else:
        await gw.save_draft(ws.live_org_id, agent.live_workflow_id, agent.name, graph)
    await gw.set_model_overrides(
        ws.live_org_id, agent.live_workflow_id,
        await models_config.build_overrides(session, brain=agent.brain, voice_id=agent.voice_id),
    )
    await gw.publish(ws.live_org_id, agent.live_workflow_id)
    agent.status = "live"
    agent.version += 1
    await session.flush()
    return agent


async def versions_of(gw: PlatformGateway, ws: ProductWorkspaceModel, agent: ProductAgentModel) -> list[dict]:
    return await gw.list_versions(ws.test_org_id, agent.test_workflow_id)


def find_version(versions: list[dict], number: int) -> dict:
    v = next((v for v in versions if v["number"] == number), None)
    if v is None:
        raise product_error(404, "version_not_found", "We couldn't find that version.")
    return v


async def restore_version(
    session: AsyncSession, gw: PlatformGateway, ws: ProductWorkspaceModel, agent: ProductAgentModel, number: int
) -> ProductAgentModel:
    """Make the chosen version the new working draft. Nothing goes live until Go live."""
    v = find_version(await versions_of(gw, ws, agent), number)
    # The restored text is arbitrary, so stop regenerating the prompt from the simple fields.
    agent.prompt_mode = "custom"
    await gw.save_draft(ws.test_org_id, agent.test_workflow_id, agent.name, v["definition"])
    agent.version += 1
    await session.flush()
    return agent


async def get_flow(gw: PlatformGateway, ws: ProductWorkspaceModel, agent: ProductAgentModel) -> dict:
    return await gw.working_definition(ws.test_org_id, agent.test_workflow_id) or {"nodes": [], "edges": []}


async def save_flow(
    session: AsyncSession,
    gw: PlatformGateway,
    ws: ProductWorkspaceModel,
    agent: ProductAgentModel,
    definition: dict,
    expected_version: int | None,
) -> ProductAgentModel:
    if expected_version is not None and expected_version != agent.version:
        raise product_error(
            409,
            "edited_elsewhere",
            "Someone else changed this agent while you were editing. Reload to see their changes.",
        )
    current = await get_flow(gw, ws, agent)
    merged = flows.keep_agent_prompt(definition, current)
    flows.check_flow(merged)
    await gw.save_draft(ws.test_org_id, agent.test_workflow_id, agent.name, merged)
    agent.version += 1
    await session.flush()
    return agent
