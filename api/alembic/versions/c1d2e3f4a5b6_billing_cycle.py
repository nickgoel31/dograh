"""Billing cycle (30 or 60 seconds) the platform owner can set per customer, for voice agents and for IVR

Revision ID: c1d2e3f4a5b6
Revises: b0c1d2e3f4a5
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c1d2e3f4a5b6"
down_revision: Union[str, None] = "b0c1d2e3f4a5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("product_billing_settings", sa.Column("voice_pulse", sa.Integer(), nullable=True))
    op.add_column("product_billing_settings", sa.Column("ivr_pulse", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("product_billing_settings", "ivr_pulse")
    op.drop_column("product_billing_settings", "voice_pulse")
