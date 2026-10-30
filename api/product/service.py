"""Workspace/user logic. Takes an AsyncSession so it is testable and atomic."""

import uuid
from dataclasses import dataclass

from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.db.models import OrganizationModel, UserModel, organization_users_association
from api.db.product_models import (
    ProductMembershipModel,
    ProductUserProfileModel,
    ProductWorkspaceModel,
)
from api.product.ids import new_public_id
from api.product.roles import Role


@dataclass
class WorkspaceView:
    workspace: ProductWorkspaceModel
    role: str


async def _create_org(session: AsyncSession, name: str, user_id: int) -> OrganizationModel:
    org = OrganizationModel(provider_id=f"org_{uuid.uuid4().hex}", name=name)
    session.add(org)
    await session.flush()
    await session.execute(
        insert(organization_users_association).values(user_id=user_id, organization_id=org.id)
    )
    return org


async def create_workspace(
    session: AsyncSession, user: UserModel, name: str, parent_id: int | None = None
) -> ProductWorkspaceModel:
    """One workspace = a live org + a test org, owner membership. Caller commits."""
    live = await _create_org(session, name, user.id)
    test = await _create_org(session, f"{name} (test)", user.id)
    ws = ProductWorkspaceModel(
        public_id=new_public_id("ws"),
        name=name,
        owner_user_id=user.id,
        live_org_id=live.id,
        test_org_id=test.id,
        parent_workspace_id=parent_id,
    )
    session.add(ws)
    await session.flush()
    session.add(ProductMembershipModel(workspace_id=ws.id, user_id=user.id, role=Role.OWNER.value))
    if user.selected_organization_id is None:
        user.selected_organization_id = test.id
    await session.flush()
    return ws


async def list_workspaces(session: AsyncSession, user_id: int) -> list[WorkspaceView]:
    rows = await session.execute(
        select(ProductWorkspaceModel, ProductMembershipModel.role)
        .join(ProductMembershipModel, ProductMembershipModel.workspace_id == ProductWorkspaceModel.id)
        .where(ProductMembershipModel.user_id == user_id)
        .order_by(ProductWorkspaceModel.id)
    )
    return [WorkspaceView(ws, role) for ws, role in rows.all()]


async def get_display_name(session: AsyncSession, user_id: int) -> str | None:
    row = await session.get(ProductUserProfileModel, user_id)
    return row.display_name if row else None


def org_for_environment(ws: ProductWorkspaceModel, environment: str) -> int:
    return ws.test_org_id if environment == "test" else ws.live_org_id


def default_view(views: list[WorkspaceView]) -> WorkspaceView:
    """Workspace used when the client doesn't name one: the first one they own."""
    return next((v for v in views if v.role == Role.OWNER.value), views[0])
