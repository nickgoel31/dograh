"""Swarvo IVR: menus and the calls into them

Revision ID: b0c1d2e3f4a5
Revises: a9b0c1d2e3f4
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b0c1d2e3f4a5"
down_revision: Union[str, None] = "a9b0c1d2e3f4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "product_ivrs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("public_id", sa.String(24), nullable=False),
        sa.Column("workspace_id", sa.Integer(), sa.ForeignKey("product_workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("status", sa.String(10), nullable=False, server_default="draft"),
        sa.Column("flow", sa.JSON(), nullable=False),
        sa.Column("settings", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_product_ivrs_public_id", "product_ivrs", ["public_id"], unique=True)
    op.create_index("ix_product_ivrs_workspace_id", "product_ivrs", ["workspace_id"])
    op.create_table(
        "product_ivr_calls",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("ivr_id", sa.Integer(), sa.ForeignKey("product_ivrs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("workspace_id", sa.Integer(), nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=False),
        sa.Column("number_id", sa.Integer()),
        sa.Column("config_id", sa.Integer()),
        sa.Column("call_uuid", sa.String(64), nullable=False),
        sa.Column("from_number", sa.String(32), nullable=False, server_default=""),
        sa.Column("to_number", sa.String(32), nullable=False, server_default=""),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("last_at", sa.DateTime(timezone=True)),
        sa.Column("outcome", sa.String(16), nullable=False, server_default="menu"),
        sa.Column("trail", sa.JSON(), nullable=False),
        sa.Column("vars", sa.JSON(), nullable=False),
        sa.Column("voicemail_url", sa.String(500)),
        sa.Column("run_id", sa.Integer()),
        sa.Column("seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("billed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("minutes", sa.Float(), nullable=False, server_default="0"),
        sa.Column("amount", sa.Float(), nullable=False, server_default="0"),
    )
    op.create_index("ix_product_ivr_calls_call_uuid", "product_ivr_calls", ["call_uuid"], unique=True)
    op.create_index("ix_product_ivr_calls_workspace_id", "product_ivr_calls", ["workspace_id"])
    op.create_index("ix_ivr_calls_ivr_started", "product_ivr_calls", ["ivr_id", "started_at"])


def downgrade() -> None:
    op.drop_table("product_ivr_calls")
    op.drop_table("product_ivrs")
