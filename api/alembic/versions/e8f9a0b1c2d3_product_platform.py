"""product platform tables: api keys, webhooks, audit, invites, privacy settings, 2fa

Revision ID: e8f9a0b1c2d3
Revises: d7e8f9a0b1c2
Create Date: 2026-11-10 10:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e8f9a0b1c2d3"
down_revision: Union[str, None] = "d7e8f9a0b1c2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

WS = lambda: sa.ForeignKey("product_workspaces.id", ondelete="CASCADE")  # noqa: E731
US = lambda: sa.ForeignKey("users.id", ondelete="SET NULL")  # noqa: E731
NOW = lambda: sa.Column("created_at", sa.DateTime(timezone=True), nullable=True)  # noqa: E731


def upgrade() -> None:
    op.add_column("product_user_profiles", sa.Column("totp_secret", sa.String(64), nullable=True))
    op.add_column("product_user_profiles", sa.Column("totp_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_table(
        "product_api_keys",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("workspace_id", sa.Integer(), WS(), nullable=False),
        sa.Column("public_id", sa.String(32), nullable=False, unique=True),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("environment", sa.String(4), nullable=False),
        sa.Column("hint", sa.String(24), nullable=False),
        sa.Column("key_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("created_by", sa.Integer(), US(), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        NOW(),
    )
    op.create_index("ix_product_api_keys_key_hash", "product_api_keys", ["key_hash"])
    op.create_table(
        "product_api_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("workspace_id", sa.Integer(), WS(), nullable=False),
        sa.Column("key_id", sa.Integer(), sa.ForeignKey("product_api_keys.id", ondelete="SET NULL"), nullable=True),
        sa.Column("method", sa.String(8), nullable=False),
        sa.Column("path", sa.String(200), nullable=False),
        sa.Column("status", sa.Integer(), nullable=False),
        sa.Column("ms", sa.Integer(), nullable=False, server_default="0"),
        NOW(),
    )
    op.create_index("ix_product_api_logs_ws", "product_api_logs", ["workspace_id", "id"])
    op.create_table(
        "product_webhooks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("workspace_id", sa.Integer(), WS(), nullable=False),
        sa.Column("public_id", sa.String(32), nullable=False, unique=True),
        sa.Column("environment", sa.String(4), nullable=False),
        sa.Column("url", sa.String(500), nullable=False),
        sa.Column("secret", sa.String(80), nullable=False),
        sa.Column("events", sa.JSON(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        NOW(),
    )
    op.create_table(
        "product_deliveries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("webhook_id", sa.Integer(), sa.ForeignKey("product_webhooks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("event", sa.String(40), nullable=False),
        sa.Column("dedupe_key", sa.String(80), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(8), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("response_code", sa.Integer(), nullable=True),
        sa.Column("error", sa.String(300), nullable=True),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=True),
        NOW(),
        sa.UniqueConstraint("webhook_id", "dedupe_key", name="uq_product_delivery_key"),
    )
    op.create_index("ix_product_deliveries_wh", "product_deliveries", ["webhook_id", "id"])
    op.create_index("ix_product_deliveries_due", "product_deliveries", ["status", "next_attempt_at"])
    op.create_table(
        "product_audit",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("workspace_id", sa.Integer(), WS(), nullable=False),
        sa.Column("user_id", sa.Integer(), US(), nullable=True),
        sa.Column("action", sa.String(60), nullable=False),
        sa.Column("target", sa.String(120), nullable=True),
        sa.Column("detail", sa.JSON(), nullable=True),
        NOW(),
    )
    op.create_index("ix_product_audit_ws", "product_audit", ["workspace_id", "id"])
    op.create_table(
        "product_invites",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("workspace_id", sa.Integer(), WS(), nullable=False),
        sa.Column("public_id", sa.String(32), nullable=False, unique=True),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("invited_by", sa.Integer(), US(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        NOW(),
    )
    op.create_table(
        "product_settings",
        sa.Column("workspace_id", sa.Integer(), WS(), primary_key=True),
        sa.Column("record_calls", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("consent_announcement", sa.String(300), nullable=True),
        sa.Column("redact_pii", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("retention_days", sa.Integer(), nullable=True),
        sa.Column("widget_origins", sa.JSON(), nullable=True),
    )
    op.create_table(
        "product_support_messages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("workspace_id", sa.Integer(), WS(), nullable=False),
        sa.Column("user_id", sa.Integer(), US(), nullable=True),
        sa.Column("subject", sa.String(160), nullable=False),
        sa.Column("body", sa.String(4000), nullable=False),
        NOW(),
    )


def downgrade() -> None:
    for t in ("product_support_messages", "product_settings", "product_invites", "product_audit", "product_deliveries",
              "product_webhooks", "product_api_logs", "product_api_keys"):
        op.drop_table(t)
    op.drop_column("product_user_profiles", "totp_enabled")
    op.drop_column("product_user_profiles", "totp_secret")
