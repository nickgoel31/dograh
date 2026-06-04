"""merge_upstream_with_custom_features

Revision ID: d4d54d8a14c7
Revises: 2b3c4d5e6f7a, 384be6596b36
Create Date: 2026-06-04 14:49:08.358730

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4d54d8a14c7'
down_revision: Union[str, None] = ('2b3c4d5e6f7a', '384be6596b36')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
