"""Who did what, per workspace. Callers commit."""

from api.db.product_models import ProductAuditModel


async def record(session, workspace_id: int, user_id: int | None, action: str, target: str | None = None, detail: dict | None = None) -> None:
    session.add(ProductAuditModel(workspace_id=workspace_id, user_id=user_id, action=action[:60], target=(target or "")[:120] or None, detail=detail))
    await session.flush()
