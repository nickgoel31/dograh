"""Guided setup behind the home page: read the business's website, suggest what to build, and prepare the plan. Nothing here creates anything."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select

from api.db.product_models import ProductAgentModel, ProductIntegrationModel
from api.product import agent_writer, setup_flow, site_reader
from api.product.deps import Ctx, get_ctx
from api.product.errors import product_error
from api.product.knowledge_router import KnowledgeGateway, get_knowledge, kind_of, status_of
from api.product.llm_gateway import LLMGateway, get_llm
from api.product.style import LANGUAGES
from api.utils import rate_limit

router = APIRouter(prefix="/product/assistant/setup", tags=["assistant"])


def get_fetcher():
    """The website downloader. Tests replace it."""
    from api.utils import safe_fetch

    return safe_fetch.fetch_url


class ResearchBody(BaseModel):
    url: str = Field(default="", max_length=300)
    notes: str = Field(default="", max_length=3000)  # used when there is no website


class PlanBody(BaseModel):
    usecase: str = Field(default="receptionist", max_length=200)  # a template key, or the person's own words
    languages: list[str] = Field(default_factory=list, max_length=2)
    profile: dict = Field(default_factory=dict)
    website: str | None = Field(default=None, max_length=300)
    wishes: str = Field(default="", max_length=1500)  # anything extra the person said about what the agent should do


@router.get("/state")
async def state(ctx: Ctx = Depends(get_ctx), kb: KnowledgeGateway = Depends(get_knowledge)):
    """What is already set up, so the guide does not ask for it again."""
    docs = await kb.list(ctx.workspace.test_org_id, ctx.user.id)
    sites = [d for d in docs if kind_of(d) == "Website" and status_of(d) != "failed"]
    agents = [{"id": a.public_id, "name": a.name, "role": a.role, "status": a.status} for a in (await ctx.session.scalars(
        select(ProductAgentModel).where(ProductAgentModel.workspace_id == ctx.workspace.id).order_by(ProductAgentModel.id))).all()]
    return {
        "website": sites[0].get("source_url") if sites else None,
        "website_docs": [{"id": d["id"], "url": d.get("source_url")} for d in sites][:5],
        "knowledge_count": len(docs),
        "agents": agents,
        "recommended": setup_flow.recommended(agents),
    }


@router.post("/research")
async def research(body: ResearchBody, ctx: Ctx = Depends(get_ctx), llm: LLMGateway = Depends(get_llm), fetch=Depends(get_fetcher)):
    """Read the website (or the owner's own description) and write a profile of the business."""
    await rate_limit.enforce(f"psetup:{ctx.user.id}", 12, 600, "You're going quickly. Give it a minute and try again.")
    url = site_reader.normalise(body.url)
    if not url and len(body.notes.strip()) < 15:
        raise product_error(400, "need_something", "Give me your website, or a few sentences about your business.")
    pages: list[site_reader.Page] = []
    if url:
        try:
            pages = await site_reader.read_site(url, fetch)
        except ValueError as e:
            if len(body.notes.strip()) < 15:
                raise product_error(400, "site_unreadable", str(e))
    profile, by_ai = await setup_flow.build_profile(llm, ctx.workspace.test_org_id, ctx.user.id, pages, body.notes)
    if not profile["business"]:
        profile["business"] = ctx.workspace.name
    return {"url": pages[0].url if pages else None, "pages": [{"url": p.url, "title": p.title or p.url} for p in pages], "profile": profile, "text": setup_flow.profile_text(profile, pages[0].url if pages else None), "by_ai": by_ai}


@router.post("/plan")
async def plan(body: PlanBody, ctx: Ctx = Depends(get_ctx), llm: LLMGateway = Depends(get_llm)):
    """What will be set up for this job: the agent (written from the profile), its voice, the services it needs and the knowledge it gets."""
    await rate_limit.enforce(f"psetup:{ctx.user.id}", 24, 600, "You're going quickly. Give it a minute and try again.")
    langs = [x for x in body.languages if x in LANGUAGES][:2] or [x for x in (body.profile.get("languages") or []) if x in LANGUAGES][:2] or ["English"]
    profile = setup_flow.clean_profile(body.profile or {}, {"languages": langs})
    notes = "\n\n".join(x for x in (setup_flow.profile_text(profile, body.website), body.wishes.strip()) if x)
    draft, generated = await agent_writer.write_agent(llm, ctx.workspace.test_org_id, ctx.user.id, usecase=body.usecase, description=notes, industry=profile["industry"] if profile["industry"] != "General" else "", language=langs[0])
    if profile["business"]:
        draft["business"] = profile["business"][:60]
    cat, usable = await setup_flow.usable_voices(ctx.session, ctx.user.email)
    connected = {r.kind for r in (await ctx.session.scalars(select(ProductIntegrationModel).where(ProductIntegrationModel.workspace_id == ctx.workspace.id))).all()}
    return {
        "agent": {**draft, "generated": generated},
        "languages": langs,
        "voice": setup_flow.pick_voice(cat, usable, langs),
        "tools": setup_flow.tool_suggestions(body.usecase, connected),
        "knowledge": {"website": body.website, "faqs": len(profile["faqs"]), "has_profile": bool(profile["summary"] or profile["services"])},
    }
