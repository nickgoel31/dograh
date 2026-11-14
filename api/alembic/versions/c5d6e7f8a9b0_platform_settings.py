"""platform-wide settings (the owner's switches)

Revision ID: c5d6e7f8a9b0
Revises: b4c5d6e7f8a9
Create Date: 2026-11-15 10:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c5d6e7f8a9b0"
down_revision: Union[str, None] = "b4c5d6e7f8a9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "product_platform_settings",
        sa.Column("key", sa.String(60), primary_key=True),
        sa.Column("value", sa.JSON(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("product_platform_settings")
