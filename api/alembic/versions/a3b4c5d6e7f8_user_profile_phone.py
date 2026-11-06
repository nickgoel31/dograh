"""user profile: verified WhatsApp number and timezone

Revision ID: a3b4c5d6e7f8
Revises: f1a2b3c4d5e6
Create Date: 2026-11-06 10:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a3b4c5d6e7f8"
down_revision: Union[str, None] = "f1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

T = "product_user_profiles"


def upgrade() -> None:
    op.add_column(T, sa.Column("verified_phone", sa.String(20), nullable=True))
    op.add_column(T, sa.Column("phone_verified_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(T, sa.Column("otp_phone", sa.String(20), nullable=True))
    op.add_column(T, sa.Column("otp_hash", sa.String(64), nullable=True))
    op.add_column(T, sa.Column("otp_expires_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(T, sa.Column("otp_sent_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(T, sa.Column("otp_tries", sa.Integer(), nullable=False, server_default="0"))
    op.add_column(T, sa.Column("otp_sends_today", sa.Integer(), nullable=False, server_default="0"))
    op.add_column(T, sa.Column("timezone", sa.String(64), nullable=True))
    op.create_index("uq_product_user_verified_phone", T, ["verified_phone"], unique=True)


def downgrade() -> None:
    op.drop_index("uq_product_user_verified_phone", table_name=T)
    for c in ("timezone", "otp_sends_today", "otp_tries", "otp_sent_at", "otp_expires_at", "otp_hash", "otp_phone", "phone_verified_at", "verified_phone"):
        op.drop_column(T, c)
