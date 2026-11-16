"""push alerts: which alerts were sent to phones, phone-only alerts, and each person's alert switches

Revision ID: f8a9b0c1d2e3
Revises: e26308ebb3c5
Create Date: 2026-11-17 10:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f8a9b0c1d2e3"
down_revision: Union[str, None] = "e26308ebb3c5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("product_notifications", sa.Column("pushed_at", sa.DateTime(timezone=True)))
    op.add_column("product_notifications", sa.Column("push_only", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("product_notifications", sa.Column("actor_id", sa.Integer()))
    op.add_column("product_user_profiles", sa.Column("push_prefs", sa.JSON()))
    # Alerts that already exist must not be pushed when this goes live.
    op.execute("UPDATE product_notifications SET pushed_at = now()")


def downgrade() -> None:
    op.drop_column("product_user_profiles", "push_prefs")
    op.drop_column("product_notifications", "actor_id")
    op.drop_column("product_notifications", "push_only")
    op.drop_column("product_notifications", "pushed_at")
