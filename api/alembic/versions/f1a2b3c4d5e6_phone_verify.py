"""phone number check before the sign-up bonus

Revision ID: f1a2b3c4d5e6
Revises: e0f1a2b3c4d5
Create Date: 2026-11-05 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f1a2b3c4d5e6"
down_revision: Union[str, None] = "e0f1a2b3c4d5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("product_billing_settings", sa.Column("verified_phone", sa.String(20), nullable=True))
    op.add_column("product_billing_settings", sa.Column("phone_verified_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("product_billing_settings", sa.Column("otp_phone", sa.String(20), nullable=True))
    op.add_column("product_billing_settings", sa.Column("otp_hash", sa.String(64), nullable=True))
    op.add_column("product_billing_settings", sa.Column("otp_expires_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("product_billing_settings", sa.Column("otp_sent_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("product_billing_settings", sa.Column("otp_tries", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("product_billing_settings", sa.Column("otp_sends_today", sa.Integer(), nullable=False, server_default="0"))
    op.create_index("uq_product_verified_phone", "product_billing_settings", ["verified_phone"], unique=True)


def downgrade() -> None:
    op.drop_index("uq_product_verified_phone", table_name="product_billing_settings")
    for c in ("otp_sends_today", "otp_tries", "otp_sent_at", "otp_expires_at", "otp_hash", "otp_phone", "phone_verified_at", "verified_phone"):
        op.drop_column("product_billing_settings", c)
