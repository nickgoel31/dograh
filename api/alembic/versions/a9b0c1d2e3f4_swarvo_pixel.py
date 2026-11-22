"""Swarvo Pixel: voice devices with their activation codes, and the conversations held on them

Revision ID: a9b0c1d2e3f4
Revises: f8a9b0c1d2e3
Create Date: 2026-11-22 10:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a9b0c1d2e3f4"
down_revision: Union[str, None] = "f8a9b0c1d2e3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "product_pixels",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("device_id", sa.String(40), nullable=False),
        sa.Column("code_hash", sa.String(64), nullable=False),
        sa.Column("batch", sa.String(60), nullable=False, server_default=""),
        sa.Column("name", sa.String(120), nullable=False, server_default=""),
        sa.Column("status", sa.String(12), nullable=False, server_default="ready"),
        sa.Column("workspace_id", sa.Integer(), sa.ForeignKey("product_workspaces.id", ondelete="SET NULL")),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("agent_id", sa.Integer(), sa.ForeignKey("product_agents.id", ondelete="SET NULL")),
        sa.Column("fw", sa.String(24), nullable=False, server_default=""),
        sa.Column("conn_id", sa.String(32)),
        sa.Column("last_seen_at", sa.DateTime(timezone=True)),
        sa.Column("claimed_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_product_pixels_device_id", "product_pixels", ["device_id"], unique=True)
    op.create_index("ix_product_pixels_workspace_id", "product_pixels", ["workspace_id"])
    op.create_table(
        "product_pixel_sessions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("pixel_id", sa.Integer(), sa.ForeignKey("product_pixels.id", ondelete="CASCADE"), nullable=False),
        sa.Column("workspace_id", sa.Integer(), nullable=False),
        sa.Column("run_id", sa.Integer()),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("ended_at", sa.DateTime(timezone=True)),
        sa.Column("seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("end_reason", sa.String(24), nullable=False, server_default=""),
    )
    op.create_index("ix_pixel_sessions_pixel_started", "product_pixel_sessions", ["pixel_id", "started_at"])


def downgrade() -> None:
    op.drop_index("ix_pixel_sessions_pixel_started", table_name="product_pixel_sessions")
    op.drop_table("product_pixel_sessions")
    op.drop_index("ix_product_pixels_workspace_id", table_name="product_pixels")
    op.drop_index("ix_product_pixels_device_id", table_name="product_pixels")
    op.drop_table("product_pixels")
