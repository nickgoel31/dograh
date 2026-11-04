"""chat agents

Revision ID: e0f1a2b3c4d5
Revises: d9e0f1a2b3c4
Create Date: 2026-11-04 14:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e0f1a2b3c4d5"
down_revision: Union[str, None] = "d9e0f1a2b3c4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "product_chat_settings",
        sa.Column("workspace_id", sa.Integer(), sa.ForeignKey("product_workspaces.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("key", sa.String(40), nullable=False),
        sa.Column("agent_id", sa.Integer(), sa.ForeignKey("product_agents.id", ondelete="SET NULL"), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("config", sa.JSON(), nullable=True),
        sa.Column("origins", sa.JSON(), nullable=True),
        sa.Column("whatsapp", sa.JSON(), nullable=True),
        sa.Column("notify_email", sa.String(160), nullable=True),
        sa.Column("wa_phone_id", sa.String(40), nullable=True),
    )
    op.create_index("ix_product_chat_settings_wa_phone_id", "product_chat_settings", ["wa_phone_id"])
    op.create_index("ix_product_chat_settings_key", "product_chat_settings", ["key"], unique=True)
    op.create_table(
        "product_chat_sessions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("workspace_id", sa.Integer(), sa.ForeignKey("product_workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("agent_id", sa.Integer(), nullable=True),
        sa.Column("channel", sa.String(12), nullable=False, server_default="web"),
        sa.Column("contact", sa.String(80), nullable=False, server_default=""),
        sa.Column("name", sa.String(120), nullable=True),
        sa.Column("email", sa.String(160), nullable=True),
        sa.Column("run_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(8), nullable=False, server_default="bot"),
        sa.Column("unread", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("rating", sa.Integer(), nullable=True),
        sa.Column("last_text", sa.String(200), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("handoff_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_product_chat_sessions_ws_last", "product_chat_sessions", ["workspace_id", "last_at"])
    op.create_table(
        "product_chat_messages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("session_id", sa.Integer(), sa.ForeignKey("product_chat_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(8), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("ext_id", sa.String(80), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_product_chat_messages_session_id", "product_chat_messages", ["session_id"])
    op.create_index("ix_product_chat_messages_ext_id", "product_chat_messages", ["ext_id"])


def downgrade() -> None:
    op.drop_table("product_chat_messages")
    op.drop_table("product_chat_sessions")
    op.drop_table("product_chat_settings")
