"""add wallet and billing

Revision ID: e10c410b0213
Revises: d4d54d8a14c7
Create Date: 2026-06-05 16:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e10c410b0213'
down_revision: Union[str, None] = 'd4d54d8a14c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "organizations",
        sa.Column("balance", sa.Float(), nullable=False, server_default="0.0")
    )
    op.add_column(
        "organizations",
        sa.Column("billing_rate", sa.Float(), nullable=False, server_default="0.0")
    )
    op.add_column(
        "organizations",
        sa.Column("billing_pulse", sa.Integer(), nullable=False, server_default="60")
    )


def downgrade() -> None:
    op.drop_column("organizations", "balance")
    op.drop_column("organizations", "billing_rate")
    op.drop_column("organizations", "billing_pulse")
