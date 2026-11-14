"""Who may use the swarvo-tts 2.5 voices. They are "coming soon" for everyone until the platform owner switches them on, for everybody or for chosen workspaces.

The switch lives in the database (one row in product_platform_settings), so the owner changes it from the Admin page without a deploy.
"""

from __future__ import annotations

import os

from sqlalchemy import select

from api.db.product_models import ProductPlatformSettingModel, ProductWorkspaceModel

KEY = "swarvo_tts"
DISCOUNT_ENV = "SWARVO_TTS_DISCOUNT_PERCENT"
DEFAULT_DISCOUNT = 20.0


def discount_percent() -> float:
    """How much cheaper each minute is when the agent speaks with a swarvo-tts voice."""
    from api.services.billing import voice_discount

    return voice_discount.percent()


async def get_setting(session) -> dict:
    row = await session.get(ProductPlatformSettingModel, KEY)
    v = dict(row.value or {}) if row is not None else {}
    return {"everyone": bool(v.get("everyone", False)), "workspaces": [str(x) for x in (v.get("workspaces") or [])]}


async def put_setting(session, *, everyone: bool | None = None, workspaces: list[str] | None = None) -> dict:
    cur = await get_setting(session)
    if everyone is not None:
        cur["everyone"] = bool(everyone)
    if workspaces is not None:
        cur["workspaces"] = sorted(set(workspaces))
    row = await session.get(ProductPlatformSettingModel, KEY)
    if row is None:
        session.add(ProductPlatformSettingModel(key=KEY, value=cur))
    else:
        row.value = cur
    await session.flush()
    return cur


async def set_workspace(session, public_id: str, enabled: bool) -> dict:
    cur = await get_setting(session)
    ws = set(cur["workspaces"])
    (ws.add if enabled else ws.discard)(public_id)
    return await put_setting(session, workspaces=list(ws))


async def allowed(session, workspace: ProductWorkspaceModel | None, email: str | None = None) -> bool:
    """Can this workspace use swarvo-tts voices right now? The platform owner always can."""
    from api.product.admin_router import admin_emails

    if email is None and workspace is not None:  # no person given: judge by the workspace owner
        from api.db.models import UserModel

        owner = await session.get(UserModel, workspace.owner_user_id)
        email = owner.email if owner is not None else None
    if (email or "").strip().lower() in admin_emails():
        return True
    cur = await get_setting(session)
    return cur["everyone"] or (workspace is not None and workspace.public_id in cur["workspaces"])


async def workspace_ids_with_access(session) -> set[str]:
    return set((await get_setting(session))["workspaces"])


async def ws_by_public_id(session, public_id: str) -> ProductWorkspaceModel | None:
    return await session.scalar(select(ProductWorkspaceModel).where(ProductWorkspaceModel.public_id == public_id))
