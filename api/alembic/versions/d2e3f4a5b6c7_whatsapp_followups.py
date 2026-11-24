"""WhatsApp follow-ups after calls, for AI voice agents and IVR menus

Revision ID: d2e3f4a5b6c7
Revises: c1d2e3f4a5b6
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d2e3f4a5b6c7"
down_revision: Union[str, None] = "c1d2e3f4a5b6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "product_followups",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("public_id", sa.String(24), nullable=False),
        sa.Column("workspace_id", sa.Integer(), sa.ForeignKey("product_workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("source", sa.String(8), nullable=False, server_default="all"),
        sa.Column("source_id", sa.String(32)),
        sa.Column("trigger", sa.String(16), nullable=False, server_default="any"),
        sa.Column("message", sa.String(600), nullable=False, server_default=""),
        sa.Column("link", sa.String(300)),
        sa.Column("delay_minutes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cooldown_hours", sa.Integer(), nullable=False, server_default="24"),
        sa.Column("consent", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_product_followups_public_id", "product_followups", ["public_id"], unique=True)
    op.create_index("ix_product_followups_workspace_id", "product_followups", ["workspace_id"])
    op.create_table(
        "product_followup_sends",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("followup_id", sa.Integer(), sa.ForeignKey("product_followups.id", ondelete="CASCADE"), nullable=False),
        sa.Column("workspace_id", sa.Integer(), nullable=False),
        sa.Column("call_key", sa.String(24), nullable=False),
        sa.Column("phone", sa.String(20), nullable=False),
        sa.Column("status", sa.String(8), nullable=False),
        sa.Column("reason", sa.String(60), nullable=False, server_default=""),
        sa.Column("at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("followup_id", "call_key", name="uq_followup_call"),
    )
    op.create_index("ix_followup_sends_ws_at", "product_followup_sends", ["workspace_id", "at"])


def downgrade() -> None:
    op.drop_table("product_followup_sends")
    op.drop_table("product_followups")
