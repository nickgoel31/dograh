"""merge upstream folders migration with RBAC

Revision ID: f89239b21f04
Revises: 6bd9f67ec994, a1b2c3d4e5f7
Create Date: 2026-05-31 13:42:04.609492

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f89239b21f04'
down_revision: Union[str, None] = ('6bd9f67ec994', 'a1b2c3d4e5f7')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
