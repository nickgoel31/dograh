"""Try the agent's draft in a typed conversation, using the real instructions, tools and knowledge, on the private test copy."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from api.product import agents as agent_svc
from api.product.deps import Ctx, require
from api.product.errors import product_error
from api.product.ids import decode_id, encode_id
from api.product.llm_gateway import AgentTextGateway, get_text
from api.product.roles import Perm

router = APIRouter(prefix="/product/agents", tags=["agents"])


class TrySay(BaseModel):
    session: str = Field(max_length=60)
    text: str = Field(min_length=1, max_length=500)


def _out(r, session: str | None = None) -> dict:
    return {"session": session or encode_id("try", r.run_id), "reply": r.text, "ended": r.ended, "tools": list(r.tools or [])}


@router.post("/{agent_id}/try/start")
async def try_start(agent_id: str, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE)), text: AgentTextGateway = Depends(get_text)):
    agent = await agent_svc.get_agent(ctx.session, ctx.workspace, agent_id)
    try:
        return _out(await text.start(ctx.workspace.test_org_id, ctx.user.id, agent.test_workflow_id))
    except Exception:  # noqa: BLE001
        raise product_error(502, "try_failed", "We couldn't start the practice chat. Check that calling is set up for your workspace, then try again.")


@router.post("/{agent_id}/try/say")
async def try_say(agent_id: str, body: TrySay, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE)), text: AgentTextGateway = Depends(get_text)):
    agent = await agent_svc.get_agent(ctx.session, ctx.workspace, agent_id)
    run_id = decode_id("try", body.session)
    if run_id is None:
        raise product_error(400, "bad_session", "This practice chat has expired. Start a new one.")
    try:
        return _out(await text.say(ctx.workspace.test_org_id, ctx.user.id, agent.test_workflow_id, run_id, body.text.strip()), body.session)
    except Exception:  # noqa: BLE001
        raise product_error(502, "try_failed", "The agent couldn't answer just now. Please try again.")
