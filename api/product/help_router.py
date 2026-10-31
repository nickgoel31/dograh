"""Help: article search, honest status, contact form, and an AI helper that answers only from the articles."""

import os
import re

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select, text

from api.db.models import ModelProfileModel
from api.db.product_models import ProductSupportMessageModel
from api.product import audit
from api.product.deps import Ctx, get_ctx, get_session
from api.product.help_content import ARTICLES
from api.product.llm_gateway import LLMGateway, get_llm

router = APIRouter(prefix="/product/help", tags=["help"])

STOP = {"the", "a", "an", "to", "of", "and", "or", "my", "how", "do", "i", "is", "it", "can", "what", "in", "on", "for", "you", "your", "me", "with"}


class ArticleOut(BaseModel):
    id: str
    title: str
    section: str
    body: str


class StatusItem(BaseModel):
    name: str
    state: str  # ok | down | not_set_up
    detail: str


class ContactBody(BaseModel):
    subject: str = Field(min_length=1, max_length=160)
    body: str = Field(min_length=1, max_length=4000)


class AskBody(BaseModel):
    question: str = Field(min_length=2, max_length=500)


class AskOut(BaseModel):
    answer: str
    articles: list[ArticleOut]
    from_ai: bool


def _words(s: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", s.lower()) if w not in STOP and len(w) > 1}


def search(q: str | None, limit: int = 20) -> list[ArticleOut]:
    items = [ArticleOut(id=i, title=t, section=s, body=b) for i, t, s, b in ARTICLES]
    if not q or not q.strip():
        return items[:limit]
    qw = _words(q)
    scored = []
    for a in items:
        tw, bw = _words(a.title), _words(a.body)
        score = 3 * len(qw & tw) + len(qw & bw) + (2 if q.lower().strip() in a.title.lower() else 0)
        if score:
            scored.append((score, a))
    return [a for _, a in sorted(scored, key=lambda x: -x[0])][:limit]


@router.get("/articles", response_model=list[ArticleOut])
async def articles(q: str | None = None):
    return search(q)


@router.get("/status", response_model=list[StatusItem])
async def status(session=Depends(get_session)):
    """What this server can tell about itself. It does not probe outside providers."""
    out = []
    try:
        await session.execute(text("select 1"))
        out.append(StatusItem(name="App and database", state="ok", detail="Working."))
    except Exception:  # noqa: BLE001
        out.append(StatusItem(name="App and database", state="down", detail="The database isn't answering."))
    has_models = bool(await session.scalar(select(ModelProfileModel.id).where(ModelProfileModel.is_active.is_(True)).limit(1)))
    out.append(StatusItem(name="Voice and AI models", state="ok" if has_models else "not_set_up", detail="Ready." if has_models else "No voice/AI model profile is set up yet."))
    pay = bool(os.getenv("RAZORPAY_KEY_ID") and os.getenv("RAZORPAY_KEY_SECRET"))
    out.append(StatusItem(name="Payments", state="ok" if pay else "not_set_up", detail="Configured." if pay else "Online top-ups aren't switched on yet."))
    tel = bool(os.getenv("PRODUCT_TWILIO_ACCOUNT_SID") and os.getenv("PRODUCT_TWILIO_AUTH_TOKEN"))
    out.append(StatusItem(name="Phone numbers", state="ok" if tel else "not_set_up", detail="Configured." if tel else "Buying real numbers isn't switched on yet."))
    return out


@router.post("/contact")
async def contact(body: ContactBody, ctx: Ctx = Depends(get_ctx)):
    ctx.session.add(ProductSupportMessageModel(workspace_id=ctx.workspace.id, user_id=ctx.user.id, subject=body.subject.strip(), body=body.body.strip()))
    await audit.record(ctx.session, ctx.workspace.id, ctx.user.id, "support.message", body.subject.strip()[:100])
    await ctx.session.commit()
    return {"ok": True, "message": f"Thanks, your message is with the {os.getenv('PRODUCT_NAME', 'support')} team. We'll reply to {ctx.user.email}."}


@router.post("/ask", response_model=AskOut)
async def ask(body: AskBody, ctx: Ctx = Depends(get_ctx), llm: LLMGateway = Depends(get_llm)):
    found = search(body.question, 3)
    if not found:
        return AskOut(answer="I couldn't find that in the help pages. You can send a message to our team from the Contact tab.", articles=[], from_ai=False)
    context = "\n\n".join(f"# {a.title}\n{a.body}" for a in found)
    system = ("You are the help assistant. Answer the question using ONLY the help pages below, in two or three plain sentences. "
              "If they don't contain the answer, say you aren't sure and suggest contacting the team. Never invent features, prices or steps.\n\n" + context)
    try:
        answer = (await llm.complete(ctx.workspace.test_org_id, ctx.user.id, system, [{"role": "user", "content": body.question}])).strip()
        if answer:
            return AskOut(answer=answer, articles=found, from_ai=True)
    except Exception:  # noqa: BLE001 - help must work without a model
        pass
    return AskOut(answer=f"This page should help: {found[0].title}. {found[0].body}", articles=found, from_ai=False)
