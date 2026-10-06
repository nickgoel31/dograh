"""wallet ledger: buckets, ledger, org wallet settings (+ backfill from legacy)

Revision ID: a7c1d2e3f4b5
Revises: f0a1b2c3d4e5
Create Date: 2026-10-05 12:00:00.000000

"""
from datetime import datetime, timezone
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from dateutil.relativedelta import relativedelta

revision: str = "a7c1d2e3f4b5"
down_revision: Union[str, None] = "f0a1b2c3d4e5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _period_start(reset_day: int, now: datetime) -> datetime:
    reset_day = min(max(reset_day or 1, 1), 28)
    if now.day >= reset_day:
        return now.replace(day=reset_day, hour=0, minute=0, second=0, microsecond=0)
    return (now - relativedelta(months=1)).replace(
        day=reset_day, hour=0, minute=0, second=0, microsecond=0
    )


def _legacy_remaining_minutes(org, cycles, now: datetime) -> float:
    """Re-implements the legacy ``GET /organizations/wallet`` replay so that
    customers see exactly the same remaining minutes right after migrating."""
    limit = float(org["monthly_minutes_limit"] or 0.0)
    cur_start = _period_start(org["quota_reset_day"], now)

    def within_contract(ps: datetime) -> bool:
        if limit <= 0:
            return False
        sy, sm = org["monthly_minutes_start_year"], org["monthly_minutes_start_month"]
        ey, em = org["monthly_minutes_end_year"], org["monthly_minutes_end_month"]
        if sy is not None and sm is not None and (ps.year, ps.month) < (sy, sm):
            return False
        if ey is not None and em is not None and (ps.year, ps.month) > (ey, em):
            return False
        return True

    rows = []
    for c in cycles:
        ps = c["period_start"]
        if ps.tzinfo is None:
            ps = ps.replace(tzinfo=timezone.utc)
        if ps > now:
            continue
        used = (
            c["custom_minutes_used"]
            if c["custom_minutes_used"] is not None
            else (c["total_duration_seconds"] or 0) / 60.0
        )
        rows.append((ps, float(used), float(c["topup_minutes"] or 0.0)))
    if not rows or rows[-1][0] < cur_start:
        rows.append((cur_start, 0.0, 0.0))

    carry = 0.0
    topup_carry = 0.0
    remaining = 0.0
    for ps, used, topup in rows:
        active = within_contract(ps)
        if not active and carry <= 0 and topup_carry <= 0 and topup <= 0:
            carry = topup_carry = 0.0
            remaining = 0.0
            continue
        base = limit if active else 0.0
        topup_balance = topup_carry + topup
        total_allowed = base + carry + topup_balance
        remaining = max(0.0, total_allowed - used)
        after_cf = max(0.0, used - carry)
        after_base = max(0.0, after_cf - base)
        carry = max(0.0, base - after_cf)
        topup_carry = max(0.0, topup_balance - after_base)
    return remaining


def upgrade() -> None:
    op.add_column("organizations", sa.Column("wallet_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("organizations", sa.Column("wallet_started_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("organizations", sa.Column("billing_currency", sa.String(8), nullable=False, server_default=sa.text("'INR'")))
    op.add_column("organizations", sa.Column("monthly_carry_forward", sa.Boolean(), nullable=False, server_default=sa.text("true")))
    op.add_column("organizations", sa.Column("allow_overdraft", sa.Boolean(), nullable=False, server_default=sa.text("false")))

    op.create_table(
        "wallet_buckets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("minutes_total", sa.Float(), nullable=False),
        sa.Column("minutes_remaining", sa.Float(), nullable=False),
        sa.Column("valid_from", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source_ref", sa.String(128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("organization_id", "source_ref", name="uq_wallet_bucket_source"),
    )
    op.create_index("ix_wallet_buckets_id", "wallet_buckets", ["id"])
    op.create_index("idx_wallet_buckets_org_active", "wallet_buckets", ["organization_id", "expires_at"])

    op.create_table(
        "wallet_ledger",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("entry_type", sa.String(24), nullable=False),
        sa.Column("workflow_run_id", sa.Integer(), sa.ForeignKey("workflow_runs.id", ondelete="SET NULL"), nullable=True),
        sa.Column("bucket_id", sa.Integer(), sa.ForeignKey("wallet_buckets.id", ondelete="SET NULL"), nullable=True),
        sa.Column("minutes_delta", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("money_delta", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("overage_minutes", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("billed_seconds", sa.Integer(), nullable=True),
        sa.Column("rate_snapshot", sa.Float(), nullable=True),
        sa.Column("pulse_snapshot", sa.Integer(), nullable=True),
        sa.Column("minutes_balance_after", sa.Float(), nullable=True),
        sa.Column("money_balance_after", sa.Float(), nullable=True),
        sa.Column("description", sa.String(500), nullable=True),
        sa.Column("details", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("idempotency_key", sa.String(128), nullable=True),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_wallet_ledger_id", "wallet_ledger", ["id"])
    op.create_index("idx_wallet_ledger_org_created", "wallet_ledger", ["organization_id", "created_at"])
    op.create_index(
        "uq_wallet_ledger_usage_per_run", "wallet_ledger", ["workflow_run_id"], unique=True,
        postgresql_where=sa.text("entry_type = 'usage' AND workflow_run_id IS NOT NULL"),
    )
    op.create_index(
        "uq_wallet_ledger_idempotency", "wallet_ledger", ["organization_id", "idempotency_key"], unique=True,
        postgresql_where=sa.text("idempotency_key IS NOT NULL"),
    )

    # ------------------------------------------------------------------
    # Backfill: carry every existing wallet over as an opening bucket.
    # ------------------------------------------------------------------
    bind = op.get_bind()
    now = datetime.now(timezone.utc)
    orgs = bind.execute(sa.text(
        "SELECT id, balance, billing_rate, monthly_minutes_limit, quota_reset_day, "
        "monthly_minutes_start_year, monthly_minutes_start_month, "
        "monthly_minutes_end_year, monthly_minutes_end_month FROM organizations"
    )).mappings().all()

    for org in orgs:
        org = dict(org)
        limit = float(org["monthly_minutes_limit"] or 0.0)
        balance = float(org["balance"] or 0.0)
        enabled = limit > 0 or balance > 0
        bind.execute(
            sa.text("UPDATE organizations SET wallet_started_at = :now, wallet_enabled = :en WHERE id = :id"),
            {"now": now, "en": enabled, "id": org["id"]},
        )
        if not enabled:
            continue

        cycles = bind.execute(sa.text(
            "SELECT period_start, total_duration_seconds, custom_minutes_used, topup_minutes "
            "FROM organization_usage_cycles WHERE organization_id = :id ORDER BY period_start ASC"
        ), {"id": org["id"]}).mappings().all()
        remaining = round(_legacy_remaining_minutes(org, [dict(c) for c in cycles], now), 6)
        cur_start = _period_start(org["quota_reset_day"], now)

        bucket_id = bind.execute(sa.text(
            "INSERT INTO wallet_buckets (organization_id, kind, minutes_total, minutes_remaining, "
            "valid_from, expires_at, source_ref, created_at) "
            "VALUES (:org, 'opening', :m, :m, :now, NULL, 'opening', :now) RETURNING id"
        ), {"org": org["id"], "m": remaining, "now": now}).scalar()
        # Marker so the current period's allowance is not granted a second time.
        bind.execute(sa.text(
            "INSERT INTO wallet_buckets (organization_id, kind, minutes_total, minutes_remaining, "
            "valid_from, expires_at, source_ref, created_at) "
            "VALUES (:org, 'monthly_allowance', 0, 0, :start, :start, :ref, :now)"
        ), {"org": org["id"], "start": cur_start, "now": now, "ref": f"monthly:{cur_start:%Y-%m-%d}"})
        bind.execute(sa.text(
            "INSERT INTO wallet_ledger (organization_id, entry_type, bucket_id, minutes_delta, money_delta, "
            "minutes_balance_after, money_balance_after, description, details, created_at) "
            "VALUES (:org, 'grant', :b, :m, :bal, :m, :bal, "
            "'Opening balance migrated from legacy wallet', '{}', :now)"
        ), {"org": org["id"], "b": bucket_id, "m": remaining, "bal": balance, "now": now})


def downgrade() -> None:
    op.drop_table("wallet_ledger")
    op.drop_table("wallet_buckets")
    op.drop_column("organizations", "allow_overdraft")
    op.drop_column("organizations", "monthly_carry_forward")
    op.drop_column("organizations", "billing_currency")
    op.drop_column("organizations", "wallet_started_at")
    op.drop_column("organizations", "wallet_enabled")
