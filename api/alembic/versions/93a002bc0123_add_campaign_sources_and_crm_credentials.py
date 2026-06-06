"""add_campaign_sources_and_crm_credentials

Revision ID: 93a002bc0123
Revises: 92a11b6cc8fc
Create Date: 2026-06-06 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '93a002bc0123'
down_revision: Union[str, None] = '92a11b6cc8fc'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add columns to campaigns table
    op.add_column(
        "campaigns",
        sa.Column("source_config", sa.JSON(), nullable=False, server_default='{}')
    )
    op.add_column(
        "campaigns",
        sa.Column("source_total_fetched", sa.Integer(), nullable=False, server_default='0')
    )
    op.add_column(
        "campaigns",
        sa.Column("source_sync_errors", sa.JSON(), nullable=False, server_default='[]')
    )
    op.add_column(
        "campaigns",
        sa.Column("auto_sync_enabled", sa.Boolean(), nullable=False, server_default='false')
    )
    op.add_column(
        "campaigns",
        sa.Column("auto_sync_interval_minutes", sa.Integer(), nullable=False, server_default='60')
    )
    op.add_column(
        "campaigns",
        sa.Column("auto_sync_only_new", sa.Boolean(), nullable=False, server_default='true')
    )

    # 2. Create crm_credentials table
    op.create_table(
        "crm_credentials",
        sa.Column("id", sa.Integer(), nullable=False, primary_key=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("credentials", sa.String(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default='true'),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
    )
    # Create index
    op.create_index(
        "ix_crm_credentials_organization_id",
        "crm_credentials",
        ["organization_id"]
    )
    # Create unique constraint
    op.create_unique_constraint(
        "unique_org_crm_credential_name_provider",
        "crm_credentials",
        ["organization_id", "name", "provider"]
    )


def downgrade() -> None:
    # Drop crm_credentials table
    op.drop_table("crm_credentials")

    # Drop columns from campaigns table
    op.drop_column("campaigns", "source_config")
    op.drop_column("campaigns", "source_total_fetched")
    op.drop_column("campaigns", "source_sync_errors")
    op.drop_column("campaigns", "auto_sync_enabled")
    op.drop_column("campaigns", "auto_sync_interval_minutes")
    op.drop_column("campaigns", "auto_sync_only_new")
