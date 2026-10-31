"""product contacts, do-not-call list, branding and SMS settings

Revision ID: d3e4f5a6b7c8
Revises: c2d3e4f5a6b7
Create Date: 2026-12-15 10:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d3e4f5a6b7c8"
down_revision: Union[str, None] = "c2d3e4f5a6b7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

WS = lambda: sa.ForeignKey("product_workspaces.id", ondelete="CASCADE")  # noqa: E731


def upgrade() -> None:
    for col in (sa.Column("brand_name", sa.String(60), nullable=True), sa.Column("brand_color", sa.String(9), nullable=True), sa.Column("logo_url", sa.String(500), nullable=True),
                sa.Column("sms_after_call", sa.String(300), nullable=True)):
        op.add_column("product_settings", col)
    op.create_table(
        "product_contacts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("workspace_id", sa.Integer(), WS(), nullable=False),
        sa.Column("phone", sa.String(24), nullable=False),
        sa.Column("name", sa.String(120), nullable=True),
        sa.Column("notes", sa.String(2000), nullable=True),
        sa.Column("tags", sa.JSON(), nullable=True),
        sa.Column("calls", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_call_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_run_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("workspace_id", "phone", name="uq_product_contact"),
    )
    op.create_index("ix_product_contacts_ws", "product_contacts", ["workspace_id", "last_call_at"])
    op.create_table(
        "product_blocklist",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("workspace_id", sa.Integer(), WS(), nullable=False),
        sa.Column("phone", sa.String(24), nullable=False),
        sa.Column("reason", sa.String(20), nullable=False, server_default="added"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("workspace_id", "phone", name="uq_product_block"),
    )


def downgrade() -> None:
    op.drop_table("product_blocklist")
    op.drop_table("product_contacts")
    for c in ("sms_after_call", "logo_url", "brand_color", "brand_name"):
        op.drop_column("product_settings", c)
