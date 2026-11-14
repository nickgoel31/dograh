"""sign-in with OAuth for the MCP server

Revision ID: d6e7f8a9b0c1
Revises: c5d6e7f8a9b0
Create Date: 2026-11-15 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d6e7f8a9b0c1"
down_revision: Union[str, None] = "c5d6e7f8a9b0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("product_api_keys", sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("product_api_keys", sa.Column("grant_id", sa.String(32), nullable=True))
    op.create_index("ix_product_api_keys_grant_id", "product_api_keys", ["grant_id"])
    op.create_table(
        "product_oauth_clients",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("client_id", sa.String(48), nullable=False, unique=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("redirect_uris", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )
    op.create_table(
        "product_oauth_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("public_id", sa.String(32), nullable=False, unique=True),
        sa.Column("kind", sa.String(8), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("client_id", sa.String(48), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("workspace_id", sa.Integer(), sa.ForeignKey("product_workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("access", sa.String(4), nullable=False),
        sa.Column("redirect_uri", sa.String(500)),
        sa.Column("code_challenge", sa.String(128)),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True)),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.Column("last_used_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_product_oauth_tokens_token_hash", "product_oauth_tokens", ["token_hash"])


def downgrade() -> None:
    op.drop_table("product_oauth_tokens")
    op.drop_table("product_oauth_clients")
    op.drop_index("ix_product_api_keys_grant_id", table_name="product_api_keys")
    op.drop_column("product_api_keys", "grant_id")
    op.drop_column("product_api_keys", "expires_at")
