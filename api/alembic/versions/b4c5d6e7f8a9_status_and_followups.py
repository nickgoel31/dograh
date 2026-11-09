"""status checks, WhatsApp follow-up text and payment link

Revision ID: b4c5d6e7f8a9
Revises: a3b4c5d6e7f8
Create Date: 2026-11-09 10:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b4c5d6e7f8a9"
down_revision: Union[str, None] = "a3b4c5d6e7f8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "product_status_checks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("component", sa.String(40), nullable=False),
        sa.Column("ok", sa.Boolean(), nullable=False),
        sa.Column("ms", sa.Integer(), nullable=True),
    )
    op.create_index("ix_product_status_checks_comp_at", "product_status_checks", ["component", "at"])
    op.add_column("product_settings", sa.Column("whatsapp_after_call", sa.String(500), nullable=True))
    op.add_column("product_settings", sa.Column("payment_link", sa.String(500), nullable=True))


def downgrade() -> None:
    op.drop_column("product_settings", "payment_link")
    op.drop_column("product_settings", "whatsapp_after_call")
    op.drop_index("ix_product_status_checks_comp_at", table_name="product_status_checks")
    op.drop_table("product_status_checks")
