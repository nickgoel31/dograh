"""add topup_minutes

Revision ID: e10c410b0214
Revises: c425d3445750
Create Date: 2026-08-01 20:25:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'e10c410b0214'
down_revision = 'e10c410b0213'
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.add_column('organization_usage_cycles', sa.Column('topup_minutes', sa.Float(), nullable=True, server_default='0.0'))

def downgrade() -> None:
    op.drop_column('organization_usage_cycles', 'topup_minutes')
