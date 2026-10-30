"""product agents

Revision ID: e2f3a4b5c6d7
Revises: d1e2f3a4b5c6
Create Date: 2026-10-30 15:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e2f3a4b5c6d7"
down_revision: Union[str, None] = "d1e2f3a4b5c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "product_agents",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("public_id", sa.String(32), nullable=False),
        sa.Column(
            "workspace_id",
            sa.Integer(),
            sa.ForeignKey("product_workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("emoji", sa.String(16), nullable=False),
        sa.Column("color", sa.String(16), nullable=False),
        sa.Column("role", sa.String(120), nullable=False),
        sa.Column("tone", sa.String(24), nullable=False),
        sa.Column("business", sa.String(160), nullable=False),
        sa.Column("what_you_do", sa.String(2000), nullable=False),
        sa.Column("brain", sa.String(16), nullable=False),
        sa.Column("voice_id", sa.String(64), nullable=True),
        sa.Column("prompt_mode", sa.String(8), nullable=False),
        sa.Column("status", sa.String(8), nullable=False),
        sa.Column("test_workflow_id", sa.Integer(), nullable=False),
        sa.Column("live_workflow_id", sa.Integer(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_product_agents_public_id", "product_agents", ["public_id"], unique=True)
    op.create_index("ix_product_agents_workspace", "product_agents", ["workspace_id"])


def downgrade() -> None:
    op.drop_index("ix_product_agents_workspace", table_name="product_agents")
    op.drop_index("ix_product_agents_public_id", table_name="product_agents")
    op.drop_table("product_agents")
