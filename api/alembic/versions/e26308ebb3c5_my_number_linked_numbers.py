"""my number: linked numbers, test calls, devices, funnel

Revision ID: e26308ebb3c5
Revises: e7f8a9b0c1d2
"""

import sqlalchemy as sa
from alembic import op

revision = "e26308ebb3c5"
down_revision = "e7f8a9b0c1d2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "product_linked_numbers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("public_id", sa.String(32), nullable=False, unique=True),
        sa.Column("workspace_id", sa.Integer(), sa.ForeignKey("product_workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("e164", sa.String(20), nullable=False),
        sa.Column("operator", sa.String(24)),
        sa.Column("otp_hash", sa.String(64)),
        sa.Column("otp_expires_at", sa.DateTime(timezone=True)),
        sa.Column("otp_tries", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("verified_at", sa.DateTime(timezone=True)),
        sa.Column("consent", sa.JSON()),
        sa.Column("default_agent_id", sa.String(32)),
        sa.Column("mode", sa.String(16), nullable=False, server_default="schedule"),
        sa.Column("schedule", sa.JSON()),
        sa.Column("vip_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("forwarding_status", sa.JSON()),
        sa.Column("routing", sa.String(16), nullable=False, server_default="shared_pool"),
        sa.Column("dedicated_number_id", sa.Integer()),
        sa.Column("forward_target", sa.String(24)),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("paused_until", sa.DateTime(timezone=True)),
        sa.Column("status", sa.String(14), nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_product_linked_numbers_public_id", "product_linked_numbers", ["public_id"])
    op.create_index("ix_product_linked_numbers_e164", "product_linked_numbers", ["e164"])
    op.create_index("ix_linked_numbers_workspace", "product_linked_numbers", ["workspace_id"])
    op.create_table(
        "product_linked_test_calls",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("linked_number_id", sa.Integer(), sa.ForeignKey("product_linked_numbers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("state", sa.String(16), nullable=False, server_default="ringing"),
        sa.Column("reason", sa.String(200)),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )
    op.create_table(
        "product_devices",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token", sa.String(512), nullable=False, unique=True),
        sa.Column("platform", sa.String(10), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_product_devices_user_id", "product_devices", ["user_id"])
    op.create_table(
        "product_funnel_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("step", sa.String(40), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_product_funnel_events_user_id", "product_funnel_events", ["user_id"])


def downgrade() -> None:
    for t in ("product_funnel_events", "product_devices", "product_linked_test_calls", "product_linked_numbers"):
        op.drop_table(t)
