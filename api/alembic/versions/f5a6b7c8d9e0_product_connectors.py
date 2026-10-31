"""connectors: after-call pushes, unanswered questions, security settings

Revision ID: f5a6b7c8d9e0
Revises: e4f5a6b7c8d9
Create Date: 2026-12-23 10:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f5a6b7c8d9e0"
down_revision: Union[str, None] = "e4f5a6b7c8d9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "product_pushes",
        sa.Column("run_id", sa.Integer(), primary_key=True),
        sa.Column("kind", sa.String(16), primary_key=True),
        sa.Column("workspace_id", sa.Integer(), sa.ForeignKey("product_workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ok", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_product_pushes_ws", "product_pushes", ["workspace_id"])
    op.add_column("product_call_insights", sa.Column("unanswered", sa.JSON(), nullable=True))
    op.add_column("product_settings", sa.Column("ip_allowlist", sa.JSON(), nullable=True))
    op.add_column("product_settings", sa.Column("sso_domain", sa.String(120), nullable=True))
    op.add_column("product_settings", sa.Column("sso_required", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("product_settings", sa.Column("topup_link_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("product_payments", sa.Column("kind", sa.String(8), nullable=False, server_default="topup"))


def downgrade() -> None:
    op.drop_column("product_payments", "kind")
    op.drop_column("product_settings", "topup_link_at")
    op.drop_column("product_settings", "sso_required")
    op.drop_column("product_settings", "sso_domain")
    op.drop_column("product_settings", "ip_allowlist")
    op.drop_column("product_call_insights", "unanswered")
    op.drop_table("product_pushes")
