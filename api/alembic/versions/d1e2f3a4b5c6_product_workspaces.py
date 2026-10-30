"""product workspaces, memberships, user profiles

Revision ID: d1e2f3a4b5c6
Revises: c9e3f4a5b6d7
Create Date: 2026-10-30 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d1e2f3a4b5c6"
down_revision: Union[str, None] = "c9e3f4a5b6d7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "product_workspaces",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("public_id", sa.String(32), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("owner_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("live_org_id", sa.Integer(), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("test_org_id", sa.Integer(), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column(
            "parent_workspace_id",
            sa.Integer(),
            sa.ForeignKey("product_workspaces.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("live_org_id"),
        sa.UniqueConstraint("test_org_id"),
    )
    op.create_index("ix_product_workspaces_id", "product_workspaces", ["id"])
    op.create_index("ix_product_workspaces_public_id", "product_workspaces", ["public_id"], unique=True)
    op.create_table(
        "product_memberships",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.Integer(),
            sa.ForeignKey("product_workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("workspace_id", "user_id", name="uq_product_membership"),
    )
    op.create_index("ix_product_memberships_user", "product_memberships", ["user_id"])
    op.create_table(
        "product_user_profiles",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("display_name", sa.String(120), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("product_user_profiles")
    op.drop_index("ix_product_memberships_user", table_name="product_memberships")
    op.drop_table("product_memberships")
    op.drop_index("ix_product_workspaces_public_id", table_name="product_workspaces")
    op.drop_index("ix_product_workspaces_id", table_name="product_workspaces")
    op.drop_table("product_workspaces")
