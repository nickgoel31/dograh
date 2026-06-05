"""add_monthly_wallet_fields

Revision ID: 895f207e88ae
Revises: e10c410b0213
Create Date: 2026-06-06 03:16:51.869394

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '895f207e88ae'
down_revision: Union[str, None] = 'e10c410b0213'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "organizations",
        sa.Column("monthly_minutes_limit", sa.Float(), nullable=False, server_default="0.0")
    )
    op.add_column(
        "organization_usage_cycles",
        sa.Column("custom_minutes_used", sa.Float(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("organizations", "monthly_minutes_limit")
    op.drop_column("organization_usage_cycles", "custom_minutes_used")
