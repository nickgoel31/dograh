"""Contacts page: everyone your agents talked to, with notes and tags, plus the do-not-call list."""

import csv
import io
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select

from api.db.product_models import ProductBlockModel, ProductContactModel
from api.product import contacts as ct
from api.product.deps import Ctx, get_ctx, require
from api.product.errors import product_error
from api.product.ids import decode_id, encode_id
from api.product.roles import Perm

router = APIRouter(prefix="/product/contacts", tags=["contacts"])


class ContactOut(BaseModel):
    id: str
    phone: str
    name: str | None
    notes: str | None
    tags: list[str]
    calls: int
    last_call: str | None
    blocked: bool


class ContactPage(BaseModel):
    contacts: list[ContactOut]
    total: int


class ContactPatch(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    notes: str | None = Field(default=None, max_length=2000)
    tags: list[str] | None = Field(default=None, max_length=10)


class BlockBody(BaseModel):
    numbers: str = Field(min_length=3, max_length=100_000)  # one or many, separated by commas, spaces or new lines


class BlockOut(BaseModel):
    id: str
    phone: str
    reason: str
    added: str


def _out(c: ProductContactModel, blocked: set[str]) -> ContactOut:
    return ContactOut(id=encode_id("ctc", c.id), phone=c.phone, name=c.name, notes=c.notes, tags=list(c.tags or []), calls=c.calls or 0,
                      last_call=c.last_call_at.isoformat() if c.last_call_at else None, blocked=c.phone in blocked)


@router.get("", response_model=ContactPage)
async def list_contacts(q: str | None = Query(default=None, max_length=60), page: int = Query(default=1, ge=1), limit: int = Query(default=25, ge=1, le=100), ctx: Ctx = Depends(get_ctx)):
    await ct.sync(ctx.session, ctx.workspace)
    await ctx.session.commit()
    stmt = select(ProductContactModel).where(ProductContactModel.workspace_id == ctx.workspace.id)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(ProductContactModel.phone.ilike(like), ProductContactModel.name.ilike(like), ProductContactModel.notes.ilike(like)))
    total = await ctx.session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (await ctx.session.scalars(stmt.order_by(ProductContactModel.last_call_at.desc().nullslast(), ProductContactModel.id.desc()).offset((page - 1) * limit).limit(limit))).all()
    blocked = await ct.blocked_set(ctx.session, ctx.workspace.id)
    return ContactPage(contacts=[_out(c, blocked) for c in rows], total=total)


@router.get("/export/csv")
async def export_csv(ctx: Ctx = Depends(get_ctx)):
    await ct.sync(ctx.session, ctx.workspace)
    await ctx.session.commit()
    blocked = await ct.blocked_set(ctx.session, ctx.workspace.id)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["phone", "name", "calls", "last_call", "tags", "notes", "do_not_call"])
    for c in (await ctx.session.scalars(select(ProductContactModel).where(ProductContactModel.workspace_id == ctx.workspace.id).order_by(ProductContactModel.id))).all():
        w.writerow([c.phone, c.name or "", c.calls, c.last_call_at.isoformat() if c.last_call_at else "", ";".join(c.tags or []), c.notes or "", "yes" if c.phone in blocked else ""])
    return Response(buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="contacts.csv"'})


@router.get("/blocked", response_model=list[BlockOut])
async def blocked(ctx: Ctx = Depends(get_ctx)):
    rows = (await ctx.session.scalars(select(ProductBlockModel).where(ProductBlockModel.workspace_id == ctx.workspace.id).order_by(ProductBlockModel.id.desc()).limit(2000))).all()
    return [BlockOut(id=encode_id("blk", b.id), phone=b.phone, reason=b.reason, added=b.created_at.isoformat() if b.created_at else "") for b in rows]


@router.post("/blocked")
async def add_blocked(body: BlockBody, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE))):
    import re

    added = skipped = 0
    for raw in re.split(r"[,;\s]+", body.numbers):
        if not raw:
            continue
        if await ct.block(ctx.session, ctx.workspace.id, raw, "added"):
            added += 1
        else:
            skipped += 1
    await ctx.session.commit()
    return {"added": added, "skipped": skipped}


@router.delete("/blocked/{block_id}", status_code=204)
async def unblock(block_id: str, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE))):
    n = decode_id("blk", block_id)
    row = await ctx.session.scalar(select(ProductBlockModel).where(ProductBlockModel.id == n, ProductBlockModel.workspace_id == ctx.workspace.id)) if n else None
    if row is None:
        raise product_error(404, "block_not_found", "We couldn't find that number.")
    await ctx.session.delete(row)
    await ctx.session.commit()


@router.patch("/{contact_id}", response_model=ContactOut)
async def update(contact_id: str, body: ContactPatch, ctx: Ctx = Depends(require(Perm.AGENTS_WRITE))):
    n = decode_id("ctc", contact_id)
    c = await ctx.session.scalar(select(ProductContactModel).where(ProductContactModel.id == n, ProductContactModel.workspace_id == ctx.workspace.id)) if n else None
    if c is None:
        raise product_error(404, "contact_not_found", "We couldn't find that contact.")
    if body.name is not None:
        c.name = body.name.strip() or None
    if body.notes is not None:
        c.notes = body.notes.strip() or None
    if body.tags is not None:
        c.tags = sorted({t.strip()[:30] for t in body.tags if t.strip()})
    await ctx.session.commit()
    return _out(c, await ct.blocked_set(ctx.session, ctx.workspace.id))
