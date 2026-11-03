"""kyc

Revision ID: c8d9e0f1a2b3
Revises: b7c8d9e0f1a2
Create Date: 2026-12-26 10:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c8d9e0f1a2b3"
down_revision: Union[str, None] = "b7c8d9e0f1a2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "product_kyc",
        sa.Column("workspace_id", sa.Integer(), sa.ForeignKey("product_workspaces.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("status", sa.String(12), nullable=False, server_default="submitted"),
        sa.Column("data", sa.JSON(), nullable=True),
        sa.Column("docs", sa.JSON(), nullable=True),
        sa.Column("note", sa.String(400), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("product_kyc")
