"""add_whatsapp_followup_integration

Revision ID: 94a002bc0124
Revises: 93a002bc0123
Create Date: 2026-06-06 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '94a002bc0124'
down_revision: Union[str, None] = '93a002bc0123'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add columns to organizations table
    op.add_column(
        "organizations",
        sa.Column("whatsapp_enabled", sa.Boolean(), nullable=False, server_default='false')
    )
    op.add_column(
        "organizations",
        sa.Column("whatsapp_phone_number_id", sa.String(), nullable=True)
    )
    op.add_column(
        "organizations",
        sa.Column("whatsapp_access_token", sa.String(), nullable=True)
    )
    op.add_column(
        "organizations",
        sa.Column("whatsapp_business_account_id", sa.String(), nullable=True)
    )
    op.add_column(
        "organizations",
        sa.Column("whatsapp_webhook_verify_token", sa.String(), nullable=True)
    )

    # 2. Create whatsapp_messages table
    op.create_table(
        "whatsapp_messages",
        sa.Column("id", sa.Integer(), nullable=False, primary_key=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("workflow_run_id", sa.Integer(), sa.ForeignKey("workflow_runs.id", ondelete="SET NULL"), nullable=True),
        sa.Column("direction", sa.String(length=32), nullable=False),
        sa.Column("message_type", sa.String(length=64), nullable=True),
        sa.Column("whatsapp_message_id", sa.String(length=256), nullable=True),
        sa.Column("recipient_phone", sa.String(length=64), nullable=False),
        sa.Column("template_name", sa.String(length=256), nullable=True),
        sa.Column("template_language", sa.String(length=32), nullable=True),
        sa.Column("message_body", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=64), nullable=False, server_default='pending'),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    # Create index
    op.create_index(
        "ix_whatsapp_messages_whatsapp_message_id",
        "whatsapp_messages",
        ["whatsapp_message_id"],
        unique=True
    )
    op.create_index(
        "ix_whatsapp_messages_organization_id",
        "whatsapp_messages",
        ["organization_id"]
    )
    op.create_index(
        "ix_whatsapp_messages_workflow_run_id",
        "whatsapp_messages",
        ["workflow_run_id"]
    )


def downgrade() -> None:
    # Drop indices and table
    op.drop_index("ix_whatsapp_messages_workflow_run_id", table_name="whatsapp_messages")
    op.drop_index("ix_whatsapp_messages_organization_id", table_name="whatsapp_messages")
    op.drop_index("ix_whatsapp_messages_whatsapp_message_id", table_name="whatsapp_messages")
    op.drop_table("whatsapp_messages")

    # Drop columns from organizations table
    op.drop_column("organizations", "whatsapp_enabled")
    op.drop_column("organizations", "whatsapp_phone_number_id")
    op.drop_column("organizations", "whatsapp_access_token")
    op.drop_column("organizations", "whatsapp_business_account_id")
    op.drop_column("organizations", "whatsapp_webhook_verify_token")
