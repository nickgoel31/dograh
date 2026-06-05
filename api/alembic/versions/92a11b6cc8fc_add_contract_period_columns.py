"""add_contract_period_columns

Revision ID: 92a11b6cc8fc
Revises: 895f207e88ae
Create Date: 2026-06-06 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '92a11b6cc8fc'
down_revision: Union[str, None] = '895f207e88ae'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "organizations",
        sa.Column("monthly_minutes_start_year", sa.Integer(), nullable=True)
    )
    op.add_column(
        "organizations",
        sa.Column("monthly_minutes_start_month", sa.Integer(), nullable=True)
    )
    op.add_column(
        "organizations",
        sa.Column("monthly_minutes_end_year", sa.Integer(), nullable=True)
    )
    op.add_column(
        "organizations",
        sa.Column("monthly_minutes_end_month", sa.Integer(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("organizations", "monthly_minutes_start_year")
    op.drop_column("organizations", "monthly_minutes_start_month")
    op.drop_column("organizations", "monthly_minutes_end_year")
    op.drop_column("organizations", "monthly_minutes_end_month")
