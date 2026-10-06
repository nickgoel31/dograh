"""Who may see what in a reseller / white-label deployment."""

from fastapi import Depends, HTTPException

from api.db import db_client
from api.db.models import OrganizationModel, UserModel
from api.enums import UserRole
from api.services.auth.depends import require_role


def is_owner(user: UserModel) -> bool:
    """The platform owner (super admin) - sees everything."""
    return bool(
        getattr(user, "is_superuser", False)
        or getattr(user, "role", None) == UserRole.SUPER_ADMIN.value
    )


async def models_hidden_for(user: UserModel) -> bool:
    """True when provider / model / cost details must be withheld from ``user``."""
    if is_owner(user) or not user.selected_organization_id:
        return False
    org = await db_client.get_organization_by_id(user.selected_organization_id)
    return bool(org and org.hide_model_details)


async def forbid_if_models_hidden(user: UserModel) -> None:
    if await models_hidden_for(user):
        raise HTTPException(
            status_code=403,
            detail="Model settings are managed by your service provider.",
        )


class ResellerContext:
    def __init__(self, user: UserModel, org: OrganizationModel):
        self.user = user
        self.org = org


async def reseller_context(
    user: UserModel = Depends(require_role([UserRole.ADMIN])),
) -> ResellerContext:
    """Dependency for ``/reseller`` routes: an admin of a reseller organization."""
    if not user.selected_organization_id:
        raise HTTPException(status_code=400, detail="User has no selected organization")
    org = await db_client.get_organization_by_id(user.selected_organization_id)
    if org is None or not org.is_reseller:
        raise HTTPException(status_code=403, detail="Reseller access required")
    if not org.is_active:
        raise HTTPException(status_code=403, detail="Organization is deactivated")
    return ResellerContext(user, org)


async def child_org_or_404(ctx: ResellerContext, child_id: int) -> OrganizationModel:
    child = await db_client.get_child_organization(ctx.org.id, child_id)
    if child is None:
        raise HTTPException(status_code=404, detail="Client not found")
    return child
