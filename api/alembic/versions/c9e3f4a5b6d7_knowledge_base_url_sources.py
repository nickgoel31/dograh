"""knowledge base URL sources with scheduled refresh

Revision ID: c9e3f4a5b6d7
Revises: b8d2e3f4a5c6
Create Date: 2026-10-21 10:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c9e3f4a5b6d7"
down_revision: Union[str, None] = "b8d2e3f4a5c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "knowledge_base_documents"


def upgrade() -> None:
    op.add_column(TABLE, sa.Column("refresh_interval_hours", sa.Integer(), nullable=True))
    op.add_column(TABLE, sa.Column("last_refreshed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(TABLE, sa.Column("last_refresh_attempt_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(TABLE, sa.Column("last_refresh_error", sa.Text(), nullable=True))
    op.add_column(TABLE, sa.Column("source_etag", sa.String(), nullable=True))
    op.add_column(TABLE, sa.Column("source_last_modified", sa.String(), nullable=True))
    op.create_index(
        "idx_kb_documents_refresh_due",
        TABLE,
        ["refresh_interval_hours"],
        postgresql_where=sa.text("source_url IS NOT NULL AND refresh_interval_hours IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("idx_kb_documents_refresh_due", table_name=TABLE)
    for col in (
        "source_last_modified",
        "source_etag",
        "last_refresh_error",
        "last_refresh_attempt_at",
        "last_refreshed_at",
        "refresh_interval_hours",
    ):
        op.drop_column(TABLE, col)
