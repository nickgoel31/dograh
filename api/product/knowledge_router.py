"""Knowledge: what the agent can look up. Ingestion, chunking and search are the platform's; this layer scopes, renames and simplifies."""

from __future__ import annotations

import time
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Protocol

import jwt
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api.constants import OSS_JWT_SECRET
from api.product import agents as agent_svc
from api.product.deps import Ctx, get_ctx, require
from api.product.errors import product_error
from api.product.gateway import PlatformGateway, get_gateway
from api.product.ids import decode_id, encode_id
from api.product.roles import Perm

router = APIRouter(prefix="/product/knowledge", tags=["knowledge"])
REFRESH_CHOICES = (1, 6, 12, 24, 168)
MAX_TEXT = 200_000


class KnowledgeGateway(Protocol):
    async def list(self, org_id: int, user_id: int) -> list[dict]: ...
    async def add_url(self, org_id: int, user_id: int, url: str, refresh_hours: int | None) -> None: ...
    async def add_text(self, org_id: int, user_id: int, filename: str, text: str) -> None: ...
    async def file_upload(self, org_id: int, user_id: int, filename: str, mime: str) -> dict: ...
    async def process_file(self, org_id: int, user_id: int, document_uuid: str, s3_key: str) -> None: ...
    async def delete(self, org_id: int, user_id: int, document_uuid: str) -> None: ...
    async def search(self, org_id: int, user_id: int, query: str, document_uuids: list[str] | None, limit: int) -> list[dict]: ...


class CoreKnowledge:
    """Calls the platform's own knowledge-base handlers on behalf of the workspace's organization."""

    @staticmethod
    def _user(org_id: int, user_id: int):
        return SimpleNamespace(id=user_id, provider_id=f"u{user_id}", selected_organization_id=org_id, is_superuser=False, role="admin")

    @staticmethod
    async def _call(coro):
        try:
            return await coro
        except HTTPException as e:
            msg = "That address can't be used. Check it starts with http:// or https://." if e.status_code in (400, 422) else "We couldn't do that right now. Please try again."
            raise product_error(400 if e.status_code in (400, 422) else 502, "knowledge_failed", msg)

    async def list(self, org_id, user_id):
        from api.routes import knowledge_base as kb

        res = await self._call(kb.list_documents(status=None, limit=100, offset=0, user=self._user(org_id, user_id)))
        return [d.model_dump() for d in res.documents]

    async def add_url(self, org_id, user_id, url, refresh_hours):
        from api.routes import knowledge_base as kb
        from api.schemas.knowledge_base import ProcessUrlRequestSchema

        await self._call(kb.process_url(ProcessUrlRequestSchema(url=url, refresh_interval_hours=refresh_hours), user=self._user(org_id, user_id)))

    async def file_upload(self, org_id, user_id, filename, mime):
        from api.routes import knowledge_base as kb
        from api.schemas.knowledge_base import DocumentUploadRequestSchema

        r = await self._call(kb.get_upload_url(DocumentUploadRequestSchema(filename=filename, mime_type=mime), user=self._user(org_id, user_id)))
        return {"upload_url": r.upload_url, "document_uuid": r.document_uuid, "s3_key": r.s3_key}

    async def process_file(self, org_id, user_id, document_uuid, s3_key):
        from api.routes import knowledge_base as kb
        from api.schemas.knowledge_base import ProcessDocumentRequestSchema

        await self._call(kb.process_document(ProcessDocumentRequestSchema(document_uuid=document_uuid, s3_key=s3_key), user=self._user(org_id, user_id)))

    async def add_text(self, org_id, user_id, filename, text):
        import httpx

        up = await self.file_upload(org_id, user_id, filename, "text/plain")
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.put(up["upload_url"], content=text.encode(), headers={"Content-Type": "text/plain"})
        if r.status_code >= 300:
            raise product_error(502, "knowledge_failed", "We couldn't save that. Please try again.")
        await self.process_file(org_id, user_id, up["document_uuid"], up["s3_key"])

    async def delete(self, org_id, user_id, document_uuid):
        from api.routes import knowledge_base as kb

        await self._call(kb.delete_document(document_uuid, user=self._user(org_id, user_id)))

    async def search(self, org_id, user_id, query, document_uuids, limit):
        from api.routes import knowledge_base as kb
        from api.schemas.knowledge_base import ChunkSearchRequestSchema

        r = await self._call(kb.search_chunks(ChunkSearchRequestSchema(query=query, limit=limit, document_uuids=document_uuids), user=self._user(org_id, user_id)))
        return [c.model_dump() for c in r.chunks]


_kb: KnowledgeGateway = CoreKnowledge()


def get_knowledge() -> KnowledgeGateway:
    return _kb


# ---------------- views ----------------
def kind_of(d: dict) -> str:
    name = (d.get("filename") or "").lower()
    if d.get("source_url"):
        return "Website"
    if name.startswith("qa - "):
        return "Q&A"
    return "PDF" if name.endswith(".pdf") or "pdf" in (d.get("mime_type") or "") else "Text"


def status_of(d: dict) -> str:
    s = (d.get("processing_status") or "").lower()
    return "ready" if s == "completed" else "failed" if s == "failed" else "learning"


class DocOut(BaseModel):
    id: str
    title: str
    kind: str
    status: str  # ready | learning | failed
    updated: str | None
    size: int
    problem: str | None = None  # friendly, only when failed
    refresh_hours: int | None = None


def _out(d: dict) -> DocOut:
    title = d["filename"]
    if title.lower().startswith("qa - "):
        title = title[5:]
    st = status_of(d)
    upd = d.get("last_refreshed_at") or d.get("updated_at") or d.get("created_at")
    return DocOut(id=encode_id("doc", d["id"]), title=title.removesuffix(".txt") if kind_of(d) in ("Text", "Q&A") else title, kind=kind_of(d), status=st,
                  updated=upd.isoformat() if hasattr(upd, "isoformat") else upd, size=int(d.get("file_size_bytes") or 0),
                  problem="We couldn't read this source. Try adding it again." if st == "failed" else None, refresh_hours=d.get("refresh_interval_hours"))


async def _docs(ctx: Ctx, kb: KnowledgeGateway) -> list[dict]:
    """The workspace's sources (the Test copy is the canonical one)."""
    return await kb.list(ctx.workspace.test_org_id, ctx.user.id)


async def _both(ctx: Ctx, kb: KnowledgeGateway, call) -> None:
    """Run an ingest call for the Test org (errors shown) and its Live twin (best effort, repaired on go-live)."""
    await call(ctx.workspace.test_org_id)
    try:
        await call(ctx.workspace.live_org_id)
    except Exception:  # noqa: BLE001 - never block the customer on the twin
        pass


async def remap_for_live(graph: dict, kb: KnowledgeGateway, ws, user_id: int) -> dict:
    """Swap Test document links for their Live twins (matched by name) in a graph about to go live."""
    test = {d["document_uuid"]: d["filename"] for d in await kb.list(ws.test_org_id, user_id)}
    live = {d["filename"]: d["document_uuid"] for d in await kb.list(ws.live_org_id, user_id)}
    out = {**graph, "nodes": []}
    for n in graph.get("nodes", []):
        data = dict(n.get("data") or {})
        if data.get("document_uuids"):
            data["document_uuids"] = [live[test[u]] for u in data["document_uuids"] if u in test and test[u] in live]
        out["nodes"].append({**n, "data": data})
    return out


async def _find(ctx: Ctx, kb: KnowledgeGateway, public_id: str) -> dict:
    n = decode_id("doc", public_id)
    d = next((d for d in await _docs(ctx, kb) if d["id"] == n), None) if n else None
    if d is None:
        raise product_error(404, "document_not_found", "We couldn't find that knowledge source.")
    return d


class UrlBody(BaseModel):
    url: str = Field(max_length=2048)
    refresh_hours: int | None = 24


class TextBody(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    text: str = Field(min_length=1, max_length=MAX_TEXT)


class QA(BaseModel):
    q: str = Field(min_length=1, max_length=500)
    a: str = Field(min_length=1, max_length=4000)


class QABody(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    pairs: list[QA] = Field(min_length=1, max_length=200)


class FileBody(BaseModel):
    filename: str = Field(min_length=1, max_length=200)
    mime_type: str = Field(default="application/pdf", max_length=100)


class TicketBody(BaseModel):
    ticket: str


class QuestionBody(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    agent_id: str | None = None


class AnswerOut(BaseModel):
    found: bool
    answer: str | None = None
    source: str | None = None
    score: float | None = None


async def _name_free(ctx: Ctx, kb: KnowledgeGateway, filename: str) -> None:
    if any(d["filename"].lower() == filename.lower() for d in await _docs(ctx, kb)):
        raise product_error(409, "name_taken", "You already have a source with that name. Pick another name.")


def _clean_name(s: str) -> str:
    return "".join(ch for ch in s if ch not in '\\/:*?"<>|\r\n').strip()[:100] or "Untitled"


@router.get("", response_model=list[DocOut])
async def list_sources(ctx: Ctx = Depends(get_ctx), kb: KnowledgeGateway = Depends(get_knowledge)):
    return [_out(d) for d in await _docs(ctx, kb)]


@router.get("/gaps")
async def gaps(ctx: Ctx = Depends(get_ctx)):
    """Questions callers asked in the last 30 days that the agent could not answer, most asked first."""
    from sqlalchemy import select

    from api.db.product_models import ProductCallInsightModel

    rows = (await ctx.session.scalars(select(ProductCallInsightModel).where(
        ProductCallInsightModel.workspace_id == ctx.workspace.id, ProductCallInsightModel.created_at > datetime.now(UTC) - timedelta(days=30),
        ProductCallInsightModel.unanswered.is_not(None)).order_by(ProductCallInsightModel.run_id.desc()).limit(500))).all()
    seen: dict[str, dict] = {}
    for r in rows:
        for q in r.unanswered or []:
            e = seen.setdefault(q.lower().rstrip("?. "), {"question": q, "count": 0})
            e["count"] += 1
    return sorted(seen.values(), key=lambda e: -e["count"])[:30]


@router.post("/url", response_model=list[DocOut], status_code=201)
async def add_url(body: UrlBody, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE)), kb: KnowledgeGateway = Depends(get_knowledge)):
    if not body.url.lower().startswith(("http://", "https://")):
        raise product_error(400, "bad_url", "Enter the full web address, starting with http:// or https://.")
    if body.refresh_hours is not None and body.refresh_hours not in REFRESH_CHOICES:
        raise product_error(400, "bad_refresh", "Choose how often to re-read the page: hourly, 6, 12 or 24 hours, or weekly.")
    await _both(ctx, kb, lambda org: kb.add_url(org, ctx.user.id, body.url.strip(), body.refresh_hours))
    return [_out(d) for d in await _docs(ctx, kb)]


@router.post("/text", status_code=201)
async def add_text(body: TextBody, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE)), kb: KnowledgeGateway = Depends(get_knowledge)):
    name = f"{_clean_name(body.title)}.txt"
    await _name_free(ctx, kb, name)
    await _both(ctx, kb, lambda org: kb.add_text(org, ctx.user.id, name, body.text))
    return {"ok": True}


@router.post("/qa", status_code=201)
async def add_qa(body: QABody, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE)), kb: KnowledgeGateway = Depends(get_knowledge)):
    text = "\n\n".join(f"Question: {p.q.strip()}\nAnswer: {p.a.strip()}" for p in body.pairs)
    name = f"QA - {_clean_name(body.title)}.txt"
    await _name_free(ctx, kb, name)
    await _both(ctx, kb, lambda org: kb.add_text(org, ctx.user.id, name, text))
    return {"ok": True}


@router.post("/file")
async def start_file(body: FileBody, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE)), kb: KnowledgeGateway = Depends(get_knowledge)):
    """Step 1 of a file upload: a one-time upload address. The browser PUTs the file there, then calls /file/process."""
    name = _clean_name(body.filename)
    await _name_free(ctx, kb, name)
    test = await kb.file_upload(ctx.workspace.test_org_id, ctx.user.id, name, body.mime_type)
    live = await kb.file_upload(ctx.workspace.live_org_id, ctx.user.id, name, body.mime_type)
    claims = {"w": ctx.workspace.id, "t": [test["document_uuid"], test["s3_key"]], "l": [live["document_uuid"], live["s3_key"]],
              "exp": datetime.now(UTC) + timedelta(minutes=30)}
    return {"upload_urls": [test["upload_url"], live["upload_url"]], "ticket": jwt.encode(claims, OSS_JWT_SECRET, algorithm="HS256")}


@router.post("/file/process", status_code=202)
async def finish_file(body: TicketBody, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE)), kb: KnowledgeGateway = Depends(get_knowledge)):
    try:
        t = jwt.decode(body.ticket, OSS_JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise product_error(400, "upload_expired", "That upload expired. Please choose the file again.")
    if t.get("w") != ctx.workspace.id:  # a ticket from another workspace is useless here
        raise product_error(400, "upload_expired", "That upload expired. Please choose the file again.")
    await kb.process_file(ctx.workspace.test_org_id, ctx.user.id, *t["t"])
    try:
        await kb.process_file(ctx.workspace.live_org_id, ctx.user.id, *t["l"])
    except Exception:  # noqa: BLE001
        pass
    return {"ok": True}


@router.delete("/{doc_id}", status_code=204)
async def remove(doc_id: str, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE)), kb: KnowledgeGateway = Depends(get_knowledge)):
    d = await _find(ctx, kb, doc_id)
    await kb.delete(ctx.workspace.test_org_id, ctx.user.id, d["document_uuid"])
    try:
        twin = next((x for x in await kb.list(ctx.workspace.live_org_id, ctx.user.id) if x["filename"] == d["filename"]), None)
        if twin:
            await kb.delete(ctx.workspace.live_org_id, ctx.user.id, twin["document_uuid"])
    except Exception:  # noqa: BLE001
        pass


@router.post("/ask", response_model=AnswerOut)
async def ask(body: QuestionBody, ctx: Ctx = Depends(get_ctx), kb: KnowledgeGateway = Depends(get_knowledge), gw: PlatformGateway = Depends(get_gateway)):
    """What the agent would find for this question: the best passage and where it came from."""
    only = None
    if body.agent_id:
        agent = await agent_svc.get_agent(ctx.session, ctx.workspace, body.agent_id)
        only = await _attached_uuids(ctx, gw, agent)
        if not only:
            return AnswerOut(found=False)
    hits = await kb.search(ctx.workspace.test_org_id, ctx.user.id, body.question.strip(), only, 3)
    if not hits:
        return AnswerOut(found=False)
    best = max(hits, key=lambda h: h["similarity"])
    text = (best.get("chunk_text") or "").strip()
    return AnswerOut(found=True, answer=text[:600], source=best["filename"].removesuffix(".txt"), score=round(float(best["similarity"]), 2))


# ---------------- attach to an agent ----------------
_NODES = ("startCall", "agentNode")


async def _attached_uuids(ctx: Ctx, gw: PlatformGateway, agent) -> list[str]:
    graph = await agent_svc.get_flow(gw, ctx.workspace, agent)
    seen: list[str] = []
    for n in graph.get("nodes", []):
        if n.get("type") in _NODES:
            for u in (n.get("data") or {}).get("document_uuids") or []:
                if u not in seen:
                    seen.append(u)
    return seen


class AttachBody(BaseModel):
    document_ids: list[str] = Field(max_length=100)


@router.get("/agent/{agent_id}", response_model=list[str])
async def attached(agent_id: str, ctx: Ctx = Depends(get_ctx), kb: KnowledgeGateway = Depends(get_knowledge), gw: PlatformGateway = Depends(get_gateway)):
    agent = await agent_svc.get_agent(ctx.session, ctx.workspace, agent_id)
    by_uuid = {d["document_uuid"]: encode_id("doc", d["id"]) for d in await _docs(ctx, kb)}
    return [by_uuid[u] for u in await _attached_uuids(ctx, gw, agent) if u in by_uuid]


@router.put("/agent/{agent_id}", response_model=list[str])
async def attach(agent_id: str, body: AttachBody, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE)),
                 kb: KnowledgeGateway = Depends(get_knowledge), gw: PlatformGateway = Depends(get_gateway)):
    agent = await agent_svc.get_agent(ctx.session, ctx.workspace, agent_id)
    docs = {encode_id("doc", d["id"]): d["document_uuid"] for d in await _docs(ctx, kb)}
    if any(i not in docs for i in body.document_ids):
        raise product_error(404, "document_not_found", "One of those knowledge sources no longer exists.")
    uuids = [docs[i] for i in dict.fromkeys(body.document_ids)]
    graph = await agent_svc.get_flow(gw, ctx.workspace, agent)
    for n in graph.get("nodes", []):
        if n.get("type") in _NODES:
            n.setdefault("data", {})["document_uuids"] = list(uuids)
    await gw.save_draft(ctx.workspace.test_org_id, agent.test_workflow_id, agent.name, graph)
    agent.version += 1
    await ctx.session.commit()
    return list(dict.fromkeys(body.document_ids))
