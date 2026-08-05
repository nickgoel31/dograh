"""add concurrency limits and generic queued runs columns

Revision ID: f0a1b2c3d4e5
Revises: e10c410b0214
Create Date: 2026-08-06 02:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f0a1b2c3d4e5'
down_revision: Union[str, None] = 'e10c410b0214'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add concurrency_limit columns
    op.add_column('organizations', sa.Column('concurrency_limit', sa.Integer(), nullable=True))
    op.add_column('workflows', sa.Column('concurrency_limit', sa.Integer(), nullable=True))

    # 2. Update queued_runs table to support generic (non-campaign) call queuing
    op.alter_column('queued_runs', 'campaign_id', existing_type=sa.Integer(), nullable=True)
    op.add_column(
        'queued_runs',
        sa.Column('workflow_id', sa.Integer(), sa.ForeignKey('workflows.id', ondelete='CASCADE'), nullable=True)
    )
    op.add_column(
        'queued_runs',
        sa.Column('organization_id', sa.Integer(), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=True)
    )
    op.add_column(
        'queued_runs',
        sa.Column('telephony_configuration_id', sa.Integer(), sa.ForeignKey('telephony_configurations.id', ondelete='SET NULL'), nullable=True)
    )

    # 3. Add partial index for generic queued runs
    op.create_index(
        'idx_queued_runs_generic_state_optimized',
        'queued_runs',
        ['state', 'created_at'],
        unique=False,
        postgresql_where=sa.text("campaign_id IS NULL AND state = 'queued'")
    )


def downgrade() -> None:
    op.drop_index('idx_queued_runs_generic_state_optimized', table_name='queued_runs')
    op.drop_column('queued_runs', 'telephony_configuration_id')
    op.drop_column('queued_runs', 'organization_id')
    op.drop_column('queued_runs', 'workflow_id')
    op.alter_column('queued_runs', 'campaign_id', existing_type=sa.Integer(), nullable=False)
    op.drop_column('workflows', 'concurrency_limit')
    op.drop_column('organizations', 'concurrency_limit')
