"""product testing lab and insights tables

Revision ID: d7e8f9a0b1c2
Revises: c6d7e8f9a0b1
Create Date: 2026-11-03 10:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d7e8f9a0b1c2"
down_revision: Union[str, None] = "c6d7e8f9a0b1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

WS = lambda: sa.ForeignKey("product_workspaces.id", ondelete="CASCADE")  # noqa: E731
AG = lambda: sa.ForeignKey("product_agents.id", ondelete="CASCADE")  # noqa: E731


def upgrade() -> None:
    op.add_column("product_billing_settings", sa.Column("human_cost_per_min", sa.Float(), nullable=True))
    op.create_table(
        "product_test_cases",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("workspace_id", sa.Integer(), WS(), nullable=False),
        sa.Column("agent_id", sa.Integer(), AG(), nullable=False),
        sa.Column("say", sa.String(500), nullable=False),
        sa.Column("expect", sa.String(500), nullable=False),
        sa.Column("must_call", sa.String(80), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_product_test_cases_agent", "product_test_cases", ["agent_id"])
    op.create_table(
        "product_test_results",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("case_id", sa.Integer(), sa.ForeignKey("product_test_cases.id", ondelete="CASCADE"), nullable=False),
        sa.Column("agent_version", sa.Integer(), nullable=False),
        sa.Column("passed", sa.Boolean(), nullable=False),
        sa.Column("note", sa.String(300), nullable=True),
        sa.Column("reply", sa.String(1000), nullable=True),
        sa.Column("ran_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("case_id", "agent_version", name="uq_product_test_result"),
    )
    op.create_table(
        "product_sim_runs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("workspace_id", sa.Integer(), WS(), nullable=False),
        sa.Column("agent_id", sa.Integer(), AG(), nullable=False),
        sa.Column("ab_test_id", sa.Integer(), nullable=True),
        sa.Column("variant", sa.String(1), nullable=True),
        sa.Column("persona", sa.String(24), nullable=False),
        sa.Column("status", sa.String(8), nullable=False),
        sa.Column("score", sa.Integer(), nullable=True),
        sa.Column("note", sa.String(300), nullable=True),
        sa.Column("transcript", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_product_sim_runs_agent", "product_sim_runs", ["agent_id", "id"])
    op.create_table(
        "product_ab_tests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("workspace_id", sa.Integer(), WS(), nullable=False),
        sa.Column("agent_id", sa.Integer(), AG(), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("prompt_a", sa.String(20000), nullable=False),
        sa.Column("prompt_b", sa.String(20000), nullable=False),
        sa.Column("workflow_a", sa.Integer(), nullable=False),
        sa.Column("workflow_b", sa.Integer(), nullable=False),
        sa.Column("runs_per_variant", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(8), nullable=False),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "product_insights",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("workspace_id", sa.Integer(), WS(), nullable=False),
        sa.Column("week", sa.String(8), nullable=False),
        sa.Column("items", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("workspace_id", "week", name="uq_product_insight_week"),
    )


def downgrade() -> None:
    for t in ("product_insights", "product_ab_tests", "product_sim_runs", "product_test_results", "product_test_cases"):
        op.drop_table(t)
    op.drop_column("product_billing_settings", "human_cost_per_min")
