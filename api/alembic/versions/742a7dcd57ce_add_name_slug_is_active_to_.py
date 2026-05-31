"""add name slug is_active to organizations

Revision ID: 742a7dcd57ce
Revises: f89239b21f04
Create Date: 2026-05-31 13:21:54.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "742a7dcd57ce"
down_revision: Union[str, None] = "f89239b21f04"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add new columns
    op.add_column("organizations", sa.Column("name", sa.String(), nullable=True))
    op.add_column("organizations", sa.Column("slug", sa.String(), nullable=True))
    op.add_column(
        "organizations",
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )
    
    # Create indexes for the new columns
    op.create_index(op.f("ix_organizations_name"), "organizations", ["name"], unique=False)
    op.create_index(op.f("ix_organizations_slug"), "organizations", ["slug"], unique=True)


def downgrade() -> None:
    # Drop indexes
    op.drop_index(op.f("ix_organizations_slug"), table_name="organizations")
    op.drop_index(op.f("ix_organizations_name"), table_name="organizations")
    
    # Drop columns
    op.drop_column("organizations", "is_active")
    op.drop_column("organizations", "slug")
    op.drop_column("organizations", "name")
