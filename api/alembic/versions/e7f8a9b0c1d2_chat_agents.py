"""chat agents: their own instructions, model, flow, widget; per-message billing; takeover notes

Revision ID: e7f8a9b0c1d2
Revises: d6e7f8a9b0c1
Create Date: 2026-11-16 10:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e7f8a9b0c1d2"
down_revision: Union[str, None] = "d6e7f8a9b0c1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "product_chat_agents",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("workspace_id", sa.Integer(), sa.ForeignKey("product_workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("public_id", sa.String(32), nullable=False, unique=True),
        sa.Column("key", sa.String(40), nullable=False, unique=True),
        sa.Column("name", sa.String(60), nullable=False),
        sa.Column("emoji", sa.String(8)),
        sa.Column("use_case", sa.String(20), nullable=False, server_default="support"),
        sa.Column("status", sa.String(8), nullable=False, server_default="draft"),
        sa.Column("prompt", sa.Text(), nullable=False, server_default=""),
        sa.Column("model", sa.String(40), nullable=False, server_default="gpt-4.1-mini"),
        sa.Column("temperature", sa.Float(), nullable=False, server_default="0.4"),
        sa.Column("reply_length", sa.String(8), nullable=False, server_default="short"),
        sa.Column("tone", sa.String(16), nullable=False, server_default="Friendly"),
        sa.Column("language", sa.String(20), nullable=False, server_default="auto"),
        sa.Column("use_knowledge", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("memory", sa.Integer(), nullable=False, server_default="16"),
        sa.Column("flow", sa.JSON()),
        sa.Column("handover", sa.JSON()),
        sa.Column("widget", sa.JSON()),
        sa.Column("origins", sa.JSON()),
        sa.Column("history", sa.JSON()),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_product_chat_agents_workspace_id", "product_chat_agents", ["workspace_id"])
    op.create_index("ix_product_chat_agents_key", "product_chat_agents", ["key"])
    op.add_column("product_chat_settings", sa.Column("whatsapp_agent_id", sa.Integer()))
    op.add_column("product_chat_settings", sa.Column("canned", sa.JSON()))
    op.add_column("product_chat_sessions", sa.Column("chat_agent_id", sa.Integer()))
    op.add_column("product_chat_sessions", sa.Column("flow_state", sa.JSON()))
    op.add_column("product_chat_sessions", sa.Column("assigned_to", sa.Integer()))
    op.create_index("ix_product_chat_sessions_chat_agent_id", "product_chat_sessions", ["chat_agent_id"])
    op.add_column("product_chat_messages", sa.Column("meta", sa.JSON()))
    op.add_column("product_chat_messages", sa.Column("charge", sa.Float()))
    op.add_column("product_chat_messages", sa.Column("model", sa.String(40)))
    op.add_column("product_chat_messages", sa.Column("settled", sa.Boolean(), nullable=False, server_default=sa.true()))


def downgrade() -> None:
    for c in ("settled", "model", "charge", "meta"):
        op.drop_column("product_chat_messages", c)
    op.drop_index("ix_product_chat_sessions_chat_agent_id", table_name="product_chat_sessions")
    for c in ("assigned_to", "flow_state", "chat_agent_id"):
        op.drop_column("product_chat_sessions", c)
    op.drop_column("product_chat_settings", "canned")
    op.drop_column("product_chat_settings", "whatsapp_agent_id")
    op.drop_table("product_chat_agents")
