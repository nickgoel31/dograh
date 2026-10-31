"""product agent human-feel settings and call summary emails

Revision ID: b1c2d3e4f5a6
Revises: a0b1c2d3e4f5
Create Date: 2026-12-01 10:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b1c2d3e4f5a6"
down_revision: Union[str, None] = "a0b1c2d3e4f5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("product_agents", sa.Column("style", sa.JSON(), nullable=True))
    op.add_column("product_settings", sa.Column("summary_emails", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("product_settings", "summary_emails")
    op.drop_column("product_agents", "style")
