"""merge org fields

Revision ID: 2b3c4d5e6f7a
Revises: 1a2b3c4d5e6f, 742a7dcd57ce
Create Date: 2026-05-31 19:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2b3c4d5e6f7a'
down_revision: Union[str, Sequence[str], None] = ('1a2b3c4d5e6f', '742a7dcd57ce')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
