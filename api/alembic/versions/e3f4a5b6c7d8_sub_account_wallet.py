"""Sub-accounts that share their parent's wallet: caps and pause switch

Revision ID: e3f4a5b6c7d8
Revises: d2e3f4a5b6c7
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e3f4a5b6c7d8"
down_revision: Union[str, None] = "d2e3f4a5b6c7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("organizations", sa.Column("wallet_org_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True))
    op.add_column("organizations", sa.Column("wallet_cap_value", sa.Float(), nullable=True))
    op.add_column("organizations", sa.Column("wallet_cap_minutes", sa.Float(), nullable=True))
    op.add_column("organizations", sa.Column("calls_paused", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_index("ix_organizations_wallet_org_id", "organizations", ["wallet_org_id"])
    op.add_column("product_workspaces", sa.Column("billing_mode", sa.String(8), nullable=False, server_default="own"))
    op.add_column("product_workspaces", sa.Column("suspended", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column("product_workspaces", "suspended")
    op.drop_column("product_workspaces", "billing_mode")
    op.drop_index("ix_organizations_wallet_org_id", table_name="organizations")
    op.drop_column("organizations", "calls_paused")
    op.drop_column("organizations", "wallet_cap_minutes")
    op.drop_column("organizations", "wallet_cap_value")
    op.drop_column("organizations", "wallet_org_id")
