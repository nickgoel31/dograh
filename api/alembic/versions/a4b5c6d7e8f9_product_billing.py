"""product billing: settings, payments, invoices

Revision ID: a4b5c6d7e8f9
Revises: f3a4b5c6d7e8
Create Date: 2026-10-31 10:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a4b5c6d7e8f9"
down_revision: Union[str, None] = "f3a4b5c6d7e8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

WS = sa.ForeignKey("product_workspaces.id", ondelete="CASCADE")


def upgrade() -> None:
    op.create_table(
        "product_billing_settings",
        sa.Column("workspace_id", sa.Integer(), WS, primary_key=True),
        sa.Column("spend_limit", sa.Float(), nullable=True),
        sa.Column("auto_topup_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("auto_topup_threshold", sa.Float(), nullable=True),
        sa.Column("auto_topup_amount", sa.Float(), nullable=True),
        sa.Column("billing_name", sa.String(160), nullable=True),
        sa.Column("billing_gstin", sa.String(20), nullable=True),
        sa.Column("billing_state", sa.String(2), nullable=True),
        sa.Column("billing_address", sa.String(400), nullable=True),
        sa.Column("first_grant_done", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_table(
        "product_payments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("workspace_id", sa.Integer(), sa.ForeignKey("product_workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(16), nullable=False),
        sa.Column("order_id", sa.String(64), nullable=False, unique=True),
        sa.Column("payment_id", sa.String(64), nullable=True),
        sa.Column("amount", sa.Float(), nullable=False),
        sa.Column("currency", sa.String(8), nullable=False),
        sa.Column("status", sa.String(8), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_product_payments_workspace", "product_payments", ["workspace_id"])
    op.create_table(
        "product_invoices",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("workspace_id", sa.Integer(), sa.ForeignKey("product_workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("period", sa.String(7), nullable=False),
        sa.Column("number", sa.String(32), nullable=True, unique=True),
        sa.Column("minutes", sa.Float(), nullable=False),
        sa.Column("taxable", sa.Float(), nullable=False),
        sa.Column("tax", sa.JSON(), nullable=False),
        sa.Column("total", sa.Float(), nullable=False),
        sa.Column("currency", sa.String(8), nullable=False),
        sa.Column("bill_to", sa.JSON(), nullable=False),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("workspace_id", "period", name="uq_product_invoice_period"),
    )


def downgrade() -> None:
    op.drop_table("product_invoices")
    op.drop_index("ix_product_payments_workspace", table_name="product_payments")
    op.drop_table("product_payments")
    op.drop_table("product_billing_settings")
