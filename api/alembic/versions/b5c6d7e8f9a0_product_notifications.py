"""product notifications

Revision ID: b5c6d7e8f9a0
Revises: a4b5c6d7e8f9
Create Date: 2026-11-01 10:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b5c6d7e8f9a0"
down_revision: Union[str, None] = "a4b5c6d7e8f9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "product_notifications",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("workspace_id", sa.Integer(), sa.ForeignKey("product_workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("body", sa.String(400), nullable=True),
        sa.Column("link", sa.String(200), nullable=True),
        sa.Column("dedupe_key", sa.String(80), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("workspace_id", "dedupe_key", name="uq_product_notification_dedupe"),
    )
    op.create_index("ix_product_notifications_ws", "product_notifications", ["workspace_id", "id"])
    op.create_table(
        "product_campaign_audit",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("workspace_id", sa.Integer(), sa.ForeignKey("product_workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("campaign_ref", sa.Integer(), nullable=False),
        sa.Column("action", sa.String(16), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("detail", sa.JSON(), nullable=False),
    )
    op.create_index("ix_product_campaign_audit_ws", "product_campaign_audit", ["workspace_id", "campaign_ref"])


def downgrade() -> None:
    op.drop_index("ix_product_campaign_audit_ws", table_name="product_campaign_audit")
    op.drop_table("product_campaign_audit")
    op.drop_index("ix_product_notifications_ws", table_name="product_notifications")
    op.drop_table("product_notifications")
