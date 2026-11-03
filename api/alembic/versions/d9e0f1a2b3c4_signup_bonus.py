"""signup bonus

Revision ID: d9e0f1a2b3c4
Revises: c8d9e0f1a2b3
Create Date: 2026-11-04 10:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d9e0f1a2b3c4"
down_revision: Union[str, None] = "c8d9e0f1a2b3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("product_billing_settings", sa.Column("signup_bonus_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("product_billing_settings", "signup_bonus_at")
