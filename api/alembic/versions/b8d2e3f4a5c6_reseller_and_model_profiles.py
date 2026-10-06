"""reseller tenancy, model profiles, wholesale ledger source

Revision ID: b8d2e3f4a5c6
Revises: a7c1d2e3f4b5
Create Date: 2026-10-05 15:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b8d2e3f4a5c6"
down_revision: Union[str, None] = "a7c1d2e3f4b5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "model_profiles",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("slug", sa.String(64), nullable=False, unique=True),
        sa.Column("display_name", sa.String(100), nullable=False),
        sa.Column("description", sa.String(500), nullable=True),
        sa.Column("tier", sa.String(32), nullable=True),
        sa.Column("capabilities", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
        sa.Column("config", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("allowed_org_ids", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_model_profiles_id", "model_profiles", ["id"])

    op.add_column("organizations", sa.Column("parent_org_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True))
    op.create_index("ix_organizations_parent_org_id", "organizations", ["parent_org_id"])
    op.add_column("organizations", sa.Column("is_reseller", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("organizations", sa.Column("hide_model_details", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("organizations", sa.Column("wholesale_rate", sa.Float(), nullable=True))
    op.add_column("organizations", sa.Column("max_child_orgs", sa.Integer(), nullable=True))
    op.add_column("organizations", sa.Column("model_profile_id", sa.Integer(), sa.ForeignKey("model_profiles.id", ondelete="SET NULL"), nullable=True))

    op.add_column("wallet_ledger", sa.Column("source_org_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True))
    op.create_index("idx_wallet_ledger_source_org", "wallet_ledger", ["source_org_id", "created_at"])


def downgrade() -> None:
    op.drop_index("idx_wallet_ledger_source_org", table_name="wallet_ledger")
    op.drop_column("wallet_ledger", "source_org_id")
    op.drop_column("organizations", "model_profile_id")
    op.drop_column("organizations", "max_child_orgs")
    op.drop_column("organizations", "wholesale_rate")
    op.drop_column("organizations", "hide_model_details")
    op.drop_column("organizations", "is_reseller")
    op.drop_index("ix_organizations_parent_org_id", table_name="organizations")
    op.drop_column("organizations", "parent_org_id")
    op.drop_table("model_profiles")
