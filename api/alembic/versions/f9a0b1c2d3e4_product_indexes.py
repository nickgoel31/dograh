"""product performance indexes for lookups by workspace

Revision ID: f9a0b1c2d3e4
Revises: e8f9a0b1c2d3
Create Date: 2026-11-17 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = "f9a0b1c2d3e4"
down_revision: Union[str, None] = "e8f9a0b1c2d3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

INDEXES = [
    ("ix_product_invites_ws", "product_invites", ["workspace_id"]),
    ("ix_product_api_keys_ws", "product_api_keys", ["workspace_id", "environment"]),
    ("ix_product_webhooks_ws", "product_webhooks", ["workspace_id", "environment"]),
    ("ix_product_ab_tests_ws", "product_ab_tests", ["workspace_id"]),
    ("ix_product_sim_runs_ws", "product_sim_runs", ["workspace_id"]),
    ("ix_product_support_messages_ws", "product_support_messages", ["workspace_id", "id"]),
]


def upgrade() -> None:
    for name, table, cols in INDEXES:
        op.create_index(name, table, cols)


def downgrade() -> None:
    for name, table, _ in reversed(INDEXES):
        op.drop_index(name, table_name=table)
