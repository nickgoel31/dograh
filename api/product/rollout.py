"""Which existing customers may use the new experience.

``PRODUCT_NEW_UI_ORGS`` decides, by platform organization id:
  - unset or empty: no existing customer (safe default; classic UI only, nothing changes for anyone)
  - ``12,15``: only those organizations
  - ``*``: every existing customer

Brand-new accounts created on the new site and people already inside a product workspace are never blocked.
Going back to the classic UI is never blocked either.
"""

import os

from sqlalchemy import select

from api.db.models import organization_users_association
from api.db.product_models import ProductMembershipModel

NOT_ENABLED = "Your account is still on the classic experience, so please keep using the classic app. We'll let you know when the new one is ready for you."


def _everyone() -> bool:
    return os.getenv("PRODUCT_NEW_UI_ORGS", "").strip() == "*"


def org_allowed(org_id: int) -> bool:
    if _everyone():
        return True
    return org_id in {int(x) for x in os.getenv("PRODUCT_NEW_UI_ORGS", "").replace(" ", "").split(",") if x.isdigit()}


async def _org_ids(session, user_id: int) -> list[int]:
    return list((await session.scalars(select(organization_users_association.c.organization_id).where(organization_users_association.c.user_id == user_id))).all())


async def user_eligible(session, user) -> bool:
    """Already in a product workspace, or belongs to an organization that has been switched on."""
    if _everyone() or await session.scalar(select(ProductMembershipModel.id).where(ProductMembershipModel.user_id == user.id).limit(1)):
        return True
    return any(org_allowed(o) for o in await _org_ids(session, user.id))


async def is_held_back(session, user) -> bool:
    """A pre-existing customer (has an organization, no product workspace) whose organization is not switched on."""
    if await session.scalar(select(ProductMembershipModel.id).where(ProductMembershipModel.user_id == user.id).limit(1)):
        return False
    orgs = await _org_ids(session, user.id)
    return bool(orgs) and not any(org_allowed(o) for o in orgs)
