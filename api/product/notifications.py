"""In-app alerts. `notify` is idempotent per (workspace, dedupe_key) so a check can run on every page load."""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select, update

from api.db.product_models import ProductNotificationModel
from api.product.deps import Ctx, get_ctx
from api.product.errors import product_error
from api.product.ids import decode_id, encode_id

router = APIRouter(prefix="/product/notifications", tags=["notifications"])


async def notify(session, workspace_id: int, kind: str, title: str, body: str = "", link: str | None = None, dedupe_key: str | None = None) -> bool:
    """Create an alert once. Returns True if it was new. Caller commits."""
    if dedupe_key and await session.scalar(select(ProductNotificationModel.id).where(
            ProductNotificationModel.workspace_id == workspace_id, ProductNotificationModel.dedupe_key == dedupe_key)):
        return False
    session.add(ProductNotificationModel(workspace_id=workspace_id, kind=kind, title=title[:160], body=body[:400], link=link, dedupe_key=dedupe_key))
    await session.flush()
    return True


class NotificationOut(BaseModel):
    id: str
    kind: str
    title: str
    body: str
    link: str | None
    read: bool
    at: str


class NotificationsOut(BaseModel):
    unread: int
    items: list[NotificationOut]


@router.get("", response_model=NotificationsOut)
async def list_notifications(ctx: Ctx = Depends(get_ctx)):
    q = select(ProductNotificationModel).where(ProductNotificationModel.workspace_id == ctx.workspace.id)
    unread = await ctx.session.scalar(select(func.count()).select_from(q.where(ProductNotificationModel.read_at.is_(None)).subquery())) or 0
    rows = (await ctx.session.scalars(q.order_by(ProductNotificationModel.id.desc()).limit(20))).all()
    return NotificationsOut(unread=unread, items=[
        NotificationOut(id=encode_id("ntf", r.id), kind=r.kind, title=r.title, body=r.body or "", link=r.link,
                        read=r.read_at is not None, at=r.created_at.isoformat() if r.created_at else "") for r in rows])


@router.post("/read-all")
async def read_all(ctx: Ctx = Depends(get_ctx)):
    await ctx.session.execute(update(ProductNotificationModel).where(
        ProductNotificationModel.workspace_id == ctx.workspace.id, ProductNotificationModel.read_at.is_(None)).values(read_at=datetime.now(UTC)))
    await ctx.session.commit()
    return {"ok": True}


@router.post("/{notification_id}/read")
async def read_one(notification_id: str, ctx: Ctx = Depends(get_ctx)):
    nid = decode_id("ntf", notification_id)
    r = await ctx.session.scalar(select(ProductNotificationModel).where(
        ProductNotificationModel.id == nid, ProductNotificationModel.workspace_id == ctx.workspace.id)) if nid else None
    if r is None:
        raise product_error(404, "notification_not_found", "We couldn't find that notification.")
    r.read_at = r.read_at or datetime.now(UTC)
    await ctx.session.commit()
    return {"ok": True}
