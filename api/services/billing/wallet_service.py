"""Ledger based wallet.

Design
------
* **Buckets** hold prepaid minutes (monthly allowance, top-ups, adjustments).
* **Money balance** (``organizations.balance``) pays for any minutes that no
  bucket covers ("overage") at ``billing_rate`` per minute.
* **Ledger** is append-only. Every mutation of a bucket or of the money balance
  happens in the same transaction as its ledger row, and every mutation is
  serialized per organization by locking the organization row.
* A workflow run is billed **exactly once**: usage rows are protected by a
  unique index on ``workflow_run_id`` and ``record_usage`` is idempotent, so
  retried jobs and the periodic reconciler can never double-count.
* Monthly allowances are *granted* (and logged) at period boundaries, never
  recomputed from history, so changing a plan later cannot rewrite the past.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from loguru import logger
from sqlalchemy import and_, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from api.db import db_client
from api.db.models import (
    OrganizationModel,
    WalletBucketModel,
    WalletLedgerModel,
    WorkflowModel,
    WorkflowRunModel,
)
from api.services.billing.periods import (
    billed_seconds_for,
    period_for,
    period_starts_between,
    within_contract,
)

EPS = 1e-9
LOW_BALANCE_MINUTES = 30.0


class WalletError(Exception):
    """Raised for invalid wallet operations (maps to HTTP 400)."""


@dataclass
class UsageResult:
    billed_seconds: int = 0
    minutes_from_buckets: float = 0.0
    overage_minutes: float = 0.0
    money_charged: float = 0.0
    already_recorded: bool = False
    ledger_id: int | None = None


@dataclass
class CallAdmission:
    allowed: bool
    reason: str = ""
    available_minutes: float = 0.0


@dataclass
class WalletSummary:
    data: dict[str, Any] = field(default_factory=dict)


@asynccontextmanager
async def _session():
    """Session that keeps loaded attributes readable after commit (async-safe)."""
    async with db_client.async_session() as session:
        session.sync_session.expire_on_commit = False
        yield session


def _now() -> datetime:
    return datetime.now(UTC)


def _r(x: float, nd: int = 6) -> float:
    return round(float(x), nd)


# ---------------------------------------------------------------------------
# Internals (all take an open session and assume the org row is locked)
# ---------------------------------------------------------------------------
async def _lock_org(session, organization_id: int) -> OrganizationModel:
    org = (
        await session.execute(
            select(OrganizationModel)
            .where(OrganizationModel.id == organization_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if org is None:
        raise WalletError(f"Organization {organization_id} not found")
    return org


def _active_filter(now: datetime):
    return and_(
        WalletBucketModel.minutes_remaining > EPS,
        WalletBucketModel.valid_from <= now,
        or_(WalletBucketModel.expires_at.is_(None), WalletBucketModel.expires_at > now),
    )


async def _active_minutes(session, organization_id: int, now: datetime) -> float:
    total = (
        await session.execute(
            select(func.coalesce(func.sum(WalletBucketModel.minutes_remaining), 0.0)).where(
                WalletBucketModel.organization_id == organization_id, _active_filter(now)
            )
        )
    ).scalar_one()
    return float(total or 0.0)


async def _add_ledger(
    session, org: OrganizationModel, now: datetime, entry_type: str, **kw
) -> WalletLedgerModel:
    entry = WalletLedgerModel(
        organization_id=org.id,
        entry_type=entry_type,
        created_at=now,
        minutes_balance_after=_r(await _active_minutes(session, org.id, now)),
        money_balance_after=_r(org.balance or 0.0, 4),
        **kw,
    )
    session.add(entry)
    await session.flush()
    return entry


async def _expire_buckets(session, org: OrganizationModel, now: datetime) -> None:
    expired = (
        (
            await session.execute(
                select(WalletBucketModel)
                .where(
                    WalletBucketModel.organization_id == org.id,
                    WalletBucketModel.minutes_remaining > EPS,
                    WalletBucketModel.expires_at.is_not(None),
                    WalletBucketModel.expires_at <= now,
                )
                .with_for_update()
            )
        )
        .scalars()
        .all()
    )
    for bucket in expired:
        lost = bucket.minutes_remaining
        bucket.minutes_remaining = 0.0
        await _add_ledger(
            session,
            org,
            now,
            "expiry",
            bucket_id=bucket.id,
            minutes_delta=_r(-lost),
            description=f"{bucket.kind} minutes expired",
        )


async def _grant_monthly_allowances(session, org: OrganizationModel, now: datetime) -> None:
    """Create the allowance bucket for every period that has started."""
    limit = float(org.monthly_minutes_limit or 0.0)
    cur_start, _ = period_for(org.quota_reset_day, now)

    last = (
        await session.execute(
            select(func.max(WalletBucketModel.valid_from)).where(
                WalletBucketModel.organization_id == org.id,
                WalletBucketModel.kind == "monthly_allowance",
            )
        )
    ).scalar_one()

    if org.monthly_carry_forward:
        starts = period_starts_between(last, org.quota_reset_day, cur_start)
    else:
        # Unused allowance does not roll over, so only the current period matters.
        starts = (
            [cur_start]
            if last is None or (last.year, last.month) < (cur_start.year, cur_start.month)
            else []
        )

    for start in starts:
        ref = f"monthly:{start:%Y-%m-%d}"
        _, end = period_for(org.quota_reset_day, start)
        minutes = (
            limit
            if limit > 0
            and within_contract(
                start,
                (org.monthly_minutes_start_year, org.monthly_minutes_start_month),
                (org.monthly_minutes_end_year, org.monthly_minutes_end_month),
            )
            else 0.0
        )
        inserted = (
            await session.execute(
                pg_insert(WalletBucketModel)
                .values(
                    organization_id=org.id,
                    kind="monthly_allowance",
                    minutes_total=minutes,
                    minutes_remaining=minutes,
                    valid_from=start,
                    expires_at=None if org.monthly_carry_forward else end,
                    source_ref=ref,
                    created_at=now,
                )
                .on_conflict_do_nothing(index_elements=["organization_id", "source_ref"])
                .returning(WalletBucketModel.id)
            )
        ).scalar_one_or_none()
        if inserted is not None and minutes > 0:
            await _add_ledger(
                session,
                org,
                now,
                "grant",
                bucket_id=inserted,
                minutes_delta=_r(minutes),
                description=f"Monthly allowance for period starting {start:%Y-%m-%d}",
                details={"period_start": start.isoformat(), "period_end": end.isoformat()},
            )


async def _prepare(session, organization_id: int, now: datetime) -> OrganizationModel:
    org = await _lock_org(session, organization_id)
    await _expire_buckets(session, org, now)
    await _grant_monthly_allowances(session, org, now)
    await _expire_buckets(session, org, now)  # non-carry buckets created in the past
    return org


async def _consume(session, org_id: int, minutes: float, now: datetime):
    """Take ``minutes`` from active buckets (soonest expiry first, then oldest)."""
    buckets = (
        (
            await session.execute(
                select(WalletBucketModel)
                .where(WalletBucketModel.organization_id == org_id, _active_filter(now))
                .order_by(
                    WalletBucketModel.expires_at.asc().nulls_last(), WalletBucketModel.id.asc()
                )
                .with_for_update()
            )
        )
        .scalars()
        .all()
    )
    left = minutes
    taken: list[dict] = []
    for b in buckets:
        if left <= EPS:
            break
        use = min(b.minutes_remaining, left)
        b.minutes_remaining = _r(b.minutes_remaining - use)
        left -= use
        taken.append({"bucket_id": b.id, "kind": b.kind, "minutes": _r(use)})
    return _r(minutes - max(left, 0.0)), _r(max(left, 0.0)), taken


async def _charge_wholesale(
    session, child: OrganizationModel, workflow_run_id: int, billed_seconds: int, now: datetime
) -> None:
    """Debit the reseller (parent) wallet for a client call at the wholesale rate.

    Lock order is always child -> parent so concurrent calls cannot deadlock.
    """
    parent = await _lock_org(session, child.parent_org_id)
    rate = float(parent.wholesale_rate or 0.0)
    if rate <= 0:
        return
    charge = _r(billed_seconds / 60.0 * rate, 4)
    parent.balance = _r((parent.balance or 0.0) - charge, 4)  # may go negative
    await _add_ledger(
        session,
        parent,
        now,
        "wholesale",
        workflow_run_id=workflow_run_id,
        source_org_id=child.id,
        money_delta=_r(-charge, 4),
        billed_seconds=billed_seconds,
        rate_snapshot=rate,
        description=f"Client usage: call #{workflow_run_id}",
        details={"minutes": _r(billed_seconds / 60.0)},
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
async def record_usage(
    organization_id: int,
    workflow_run_id: int,
    duration_seconds: float,
    *,
    now: datetime | None = None,
) -> UsageResult:
    """Bill one finished call. Safe to call any number of times per run."""
    now = now or _now()
    async with _session() as session:
        org = await _prepare(session, organization_id, now)

        existing = (
            await session.execute(
                select(WalletLedgerModel).where(
                    WalletLedgerModel.workflow_run_id == workflow_run_id,
                    WalletLedgerModel.entry_type == "usage",
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            await session.commit()
            return UsageResult(
                billed_seconds=existing.billed_seconds or 0,
                already_recorded=True,
                ledger_id=existing.id,
            )

        pulse = org.billing_pulse or 60
        billed = billed_seconds_for(duration_seconds, pulse)
        minutes = billed / 60.0
        rate = float(org.billing_rate or 0.0)

        taken: list[dict] = []
        from_buckets = overage = charge = 0.0
        if org.wallet_enabled and minutes > 0:
            from_buckets, overage, taken = await _consume(session, org.id, minutes, now)
            if overage > EPS and rate > 0:
                charge = _r(overage * rate, 4)
                org.balance = _r((org.balance or 0.0) - charge, 4)  # may go negative
        entry = await _add_ledger(
            session,
            org,
            now,
            "usage",
            workflow_run_id=workflow_run_id,
            minutes_delta=_r(-from_buckets),
            money_delta=_r(-charge, 4),
            overage_minutes=_r(overage),
            billed_seconds=billed,
            rate_snapshot=rate,
            pulse_snapshot=pulse,
            description=f"Call #{workflow_run_id}",
            details={
                "raw_duration_seconds": round(float(duration_seconds or 0), 3),
                "buckets": taken,
                "wallet_enabled": bool(org.wallet_enabled),
            },
        )
        if org.parent_org_id and billed > 0:
            await _charge_wholesale(session, org, workflow_run_id, billed, now)
        await session.commit()
        return UsageResult(
            billed_seconds=billed,
            minutes_from_buckets=from_buckets,
            overage_minutes=overage,
            money_charged=charge,
            ledger_id=entry.id,
        )


async def check_can_start_call(organization_id: int, *, now: datetime | None = None) -> CallAdmission:
    """Admission control: may this organization start another call right now?"""
    now = now or _now()
    async with _session() as session:
        org = await _prepare(session, organization_id, now)
        minutes = await _active_minutes(session, org.id, now)
        money = float(org.balance or 0.0)
        rate = float(org.billing_rate or 0.0)
        parent = (
            await session.get(OrganizationModel, org.parent_org_id)
            if org.parent_org_id
            else None
        )
        await session.commit()

    if parent is not None:
        # Deliberately vague: clients must not learn about their provider's wallet.
        unavailable = (
            "Calling is temporarily unavailable for this workspace. "
            "Please contact your provider."
        )
        if not parent.is_active:
            return CallAdmission(False, unavailable)
        w_rate = float(parent.wholesale_rate or 0.0)
        if (
            w_rate > 0
            and not parent.allow_overdraft
            and (parent.balance or 0.0) < w_rate * (org.billing_pulse or 60) / 60.0
        ):
            return CallAdmission(False, unavailable)

    if not org.wallet_enabled or org.allow_overdraft:
        return CallAdmission(True, available_minutes=minutes)
    available = minutes + (max(money, 0.0) / rate if rate > 0 else 0.0)
    needed = (org.billing_pulse or 60) / 60.0
    if available + EPS < needed:
        return CallAdmission(
            False,
            "Your wallet has no remaining minutes or balance. Please top up to continue.",
            available,
        )
    return CallAdmission(True, available_minutes=available)


async def grant_minutes(
    organization_id: int,
    minutes: float,
    *,
    kind: str = "topup",
    expires_at: datetime | None = None,
    description: str | None = None,
    actor_user_id: int | None = None,
    idempotency_key: str | None = None,
) -> int:
    if minutes <= 0:
        raise WalletError("minutes must be positive")
    now = _now()
    async with _session() as session:
        org = await _prepare(session, organization_id, now)
        if idempotency_key and await _idempotent_hit(session, org.id, idempotency_key):
            await session.commit()
            return 0
        bucket = WalletBucketModel(
            organization_id=org.id,
            kind=kind,
            minutes_total=_r(minutes),
            minutes_remaining=_r(minutes),
            valid_from=now,
            expires_at=expires_at,
            created_at=now,
        )
        session.add(bucket)
        await session.flush()
        entry = await _add_ledger(
            session,
            org,
            now,
            "topup" if kind == "topup" else "adjustment",
            bucket_id=bucket.id,
            minutes_delta=_r(minutes),
            description=description or f"{kind} of {minutes:g} minutes",
            idempotency_key=idempotency_key,
            created_by=actor_user_id,
        )
        await session.commit()
        return entry.id


async def credit_money(
    organization_id: int,
    amount: float,
    *,
    description: str | None = None,
    actor_user_id: int | None = None,
    idempotency_key: str | None = None,
) -> int:
    """Add (or, with a negative amount, remove) money from the wallet."""
    if abs(amount) < EPS:
        raise WalletError("amount must be non-zero")
    now = _now()
    async with _session() as session:
        org = await _prepare(session, organization_id, now)
        if idempotency_key and await _idempotent_hit(session, org.id, idempotency_key):
            await session.commit()
            return 0
        org.balance = _r((org.balance or 0.0) + amount, 4)
        entry = await _add_ledger(
            session,
            org,
            now,
            "money_topup" if amount > 0 else "adjustment",
            money_delta=_r(amount, 4),
            description=description or ("Wallet top-up" if amount > 0 else "Wallet debit"),
            idempotency_key=idempotency_key,
            created_by=actor_user_id,
        )
        await session.commit()
        return entry.id


async def remove_minutes(
    organization_id: int,
    minutes: float,
    *,
    description: str | None = None,
    actor_user_id: int | None = None,
) -> int:
    """Manually deduct minutes (correction). Fails if not enough are available."""
    if minutes <= 0:
        raise WalletError("minutes must be positive")
    now = _now()
    async with _session() as session:
        org = await _prepare(session, organization_id, now)
        taken, short, parts = await _consume(session, org.id, minutes, now)
        if short > EPS:
            await session.rollback()
            raise WalletError(f"Only {taken:g} minutes available to remove")
        entry = await _add_ledger(
            session,
            org,
            now,
            "adjustment",
            minutes_delta=_r(-taken),
            description=description or f"Manual deduction of {minutes:g} minutes",
            details={"buckets": parts},
            created_by=actor_user_id,
        )
        await session.commit()
        return entry.id


async def refund_usage(
    workflow_run_id: int, *, organization_id: int, actor_user_id: int | None = None
) -> dict[str, float]:
    """Return a billed call's minutes and overage charge to the wallet.

    Deleting a call log never changes billing; refunds are explicit, recorded in
    the ledger and can only happen once per call.
    """
    now = _now()
    async with _session() as session:
        entry = (
            await session.execute(
                select(WalletLedgerModel).where(
                    WalletLedgerModel.workflow_run_id == workflow_run_id,
                    WalletLedgerModel.entry_type == "usage",
                )
            )
        ).scalar_one_or_none()
        if entry is None or entry.organization_id != organization_id:
            raise WalletError("This call was never billed to this organization's wallet")

        org = await _prepare(session, entry.organization_id, now)
        await session.refresh(entry)
        details = dict(entry.details or {})
        if details.get("refunded"):
            raise WalletError("This call was already refunded")

        restored = 0.0
        for part in details.get("buckets", []):
            bucket = await session.get(WalletBucketModel, part["bucket_id"], with_for_update=True)
            minutes = float(part["minutes"])
            if bucket is not None and (bucket.expires_at is None or bucket.expires_at > now):
                bucket.minutes_remaining = _r(bucket.minutes_remaining + minutes)
                bucket.minutes_total = max(bucket.minutes_total, bucket.minutes_remaining)
            else:
                # Original pool is gone/expired: give the minutes back as a fresh pool.
                session.add(
                    WalletBucketModel(
                        organization_id=org.id,
                        kind="adjustment",
                        minutes_total=_r(minutes),
                        minutes_remaining=_r(minutes),
                        valid_from=now,
                        created_at=now,
                    )
                )
            restored += minutes

        money_back = _r(-(entry.money_delta or 0.0), 4)
        if money_back:
            org.balance = _r((org.balance or 0.0) + money_back, 4)

        entry.details = {**details, "refunded": True}
        await _add_ledger(
            session,
            org,
            now,
            "adjustment",
            workflow_run_id=workflow_run_id,
            minutes_delta=_r(restored),
            money_delta=money_back,
            description=f"Refund of call #{workflow_run_id}",
            details={"refund_of": entry.id},
            created_by=actor_user_id,
        )
        if org.parent_org_id:
            await _refund_wholesale(session, org, workflow_run_id, now, actor_user_id)
        await session.commit()
        return {"minutes": _r(restored), "money": money_back}


async def _refund_wholesale(
    session,
    child: OrganizationModel,
    workflow_run_id: int,
    now: datetime,
    actor_user_id: int | None,
) -> None:
    parent = await _lock_org(session, child.parent_org_id)
    charge_row = (
        await session.execute(
            select(WalletLedgerModel).where(
                WalletLedgerModel.organization_id == parent.id,
                WalletLedgerModel.entry_type == "wholesale",
                WalletLedgerModel.workflow_run_id == workflow_run_id,
                WalletLedgerModel.source_org_id == child.id,
            )
        )
    ).scalar_one_or_none()
    if charge_row is None or (charge_row.details or {}).get("refunded"):
        return
    back = _r(-(charge_row.money_delta or 0.0), 4)
    parent.balance = _r((parent.balance or 0.0) + back, 4)
    charge_row.details = {**(charge_row.details or {}), "refunded": True}
    await _add_ledger(
        session,
        parent,
        now,
        "adjustment",
        workflow_run_id=workflow_run_id,
        source_org_id=child.id,
        money_delta=back,
        description=f"Refund of client call #{workflow_run_id}",
        details={"refund_of": charge_row.id},
        created_by=actor_user_id,
    )


async def _idempotent_hit(session, org_id: int, key: str) -> bool:
    return (
        await session.execute(
            select(WalletLedgerModel.id).where(
                WalletLedgerModel.organization_id == org_id,
                WalletLedgerModel.idempotency_key == key,
            )
        )
    ).first() is not None


async def get_summary(organization_id: int, *, now: datetime | None = None) -> dict[str, Any]:
    """Wallet snapshot. Read-only apart from lazily granting due allowances."""
    now = now or _now()
    async with _session() as session:
        org = await _prepare(session, organization_id, now)
        p_start, p_end = period_for(org.quota_reset_day, now)
        buckets = (
            (
                await session.execute(
                    select(WalletBucketModel)
                    .where(WalletBucketModel.organization_id == org.id, _active_filter(now))
                    .order_by(WalletBucketModel.expires_at.asc().nulls_last(), WalletBucketModel.id)
                )
            )
            .scalars()
            .all()
        )
        used_seconds = (
            await session.execute(
                select(func.coalesce(func.sum(WalletLedgerModel.billed_seconds), 0)).where(
                    WalletLedgerModel.organization_id == org.id,
                    WalletLedgerModel.entry_type == "usage",
                    WalletLedgerModel.created_at >= p_start,
                    WalletLedgerModel.created_at < p_end,
                )
            )
        ).scalar_one()
        overage_total = (
            await session.execute(
                select(func.coalesce(func.sum(WalletLedgerModel.overage_minutes), 0.0)).where(
                    WalletLedgerModel.organization_id == org.id,
                    WalletLedgerModel.entry_type == "usage",
                    WalletLedgerModel.created_at >= p_start,
                    WalletLedgerModel.created_at < p_end,
                )
            )
        ).scalar_one()
        await session.commit()

        minutes_total = sum(b.minutes_remaining for b in buckets)
        carry = sum(b.minutes_remaining for b in buckets if b.valid_from < p_start)
        rate = float(org.billing_rate or 0.0)
        money = float(org.balance or 0.0)
        money_minutes = (max(money, 0.0) / rate) if rate > 0 else 0.0
        available = minutes_total + money_minutes
        return {
            "wallet_enabled": bool(org.wallet_enabled),
            "currency": org.billing_currency or "INR",
            # legacy field names (kept so older clients keep working)
            "balance": _r(money, 2),
            "billing_rate": rate,
            "billing_pulse": org.billing_pulse or 60,
            "monthly_minutes_limit": float(org.monthly_minutes_limit or 0.0),
            "carry_forward_minutes": _r(carry, 2),
            "minutes_used": _r((used_seconds or 0) / 60.0, 2),
            "minutes_remaining": _r(minutes_total, 2),
            # new fields
            "minutes_available": _r(available, 2),
            "overage_minutes_this_period": _r(overage_total, 2),
            "monthly_carry_forward": bool(org.monthly_carry_forward),
            "allow_overdraft": bool(org.allow_overdraft),
            "period_start": p_start.isoformat(),
            "period_end": p_end.isoformat(),
            "next_reset": p_end.isoformat(),
            "low_balance": bool(org.wallet_enabled and available < LOW_BALANCE_MINUTES),
            "out_of_balance": bool(org.wallet_enabled and available <= EPS),
            "buckets": [
                {
                    "id": b.id,
                    "kind": b.kind,
                    "minutes_remaining": _r(b.minutes_remaining, 2),
                    "minutes_total": _r(b.minutes_total, 2),
                    "expires_at": b.expires_at.isoformat() if b.expires_at else None,
                }
                for b in buckets
            ],
        }


async def list_ledger(
    organization_id: int,
    *,
    limit: int = 50,
    offset: int = 0,
    entry_type: str | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
) -> tuple[list[dict], int]:
    async with _session() as session:
        q = select(WalletLedgerModel).where(WalletLedgerModel.organization_id == organization_id)
        if entry_type:
            q = q.where(WalletLedgerModel.entry_type == entry_type)
        if start:
            q = q.where(WalletLedgerModel.created_at >= start)
        if end:
            q = q.where(WalletLedgerModel.created_at <= end)
        total = (await session.execute(select(func.count()).select_from(q.subquery()))).scalar_one()
        rows = (
            (
                await session.execute(
                    q.order_by(WalletLedgerModel.id.desc()).limit(limit).offset(offset)
                )
            )
            .scalars()
            .all()
        )
        return [
            {
                "id": e.id,
                "entry_type": e.entry_type,
                "created_at": e.created_at.isoformat() if e.created_at else None,
                "workflow_run_id": e.workflow_run_id,
                "minutes_delta": e.minutes_delta,
                "money_delta": e.money_delta,
                "overage_minutes": e.overage_minutes,
                "billed_seconds": e.billed_seconds,
                "rate": e.rate_snapshot,
                "minutes_balance_after": e.minutes_balance_after,
                "money_balance_after": e.money_balance_after,
                "description": e.description,
            }
            for e in rows
        ], total


def _duration_from_run(cost_info: dict | None, usage_info: dict | None) -> float:
    for src in (cost_info or {}, usage_info or {}):
        for key in ("call_duration_seconds", "call_duration"):
            v = src.get(key)
            if v:
                try:
                    return float(v)
                except (TypeError, ValueError):
                    pass
    return 0.0


async def bill_workflow_run(workflow_run_id: int) -> UsageResult | None:
    """Bill a finished run from whatever duration information it has."""
    run = await db_client.get_workflow_run_by_id(workflow_run_id)
    if not run:
        return None
    workflow = await db_client.get_workflow_by_id(run.workflow_id)
    if not workflow or workflow.organization_id is None:
        return None
    return await record_usage(
        workflow.organization_id,
        workflow_run_id,
        _duration_from_run(run.cost_info, run.usage_info),
    )


async def reconcile_unbilled_runs(
    organization_id: int | None = None, *, limit: int = 500, min_age_minutes: int = 10
) -> dict[str, int]:
    """Bill completed runs that never reached the ledger (crashed jobs etc.)."""
    cutoff = _now() - timedelta(minutes=min_age_minutes)
    async with _session() as session:
        billed_exists = (
            select(WalletLedgerModel.id)
            .where(
                WalletLedgerModel.workflow_run_id == WorkflowRunModel.id,
                WalletLedgerModel.entry_type == "usage",
            )
            .exists()
        )
        q = (
            select(WorkflowRunModel.id, WorkflowModel.organization_id)
            .join(WorkflowModel, WorkflowModel.id == WorkflowRunModel.workflow_id)
            .join(OrganizationModel, OrganizationModel.id == WorkflowModel.organization_id)
            .where(
                WorkflowRunModel.is_completed.is_(True),
                WorkflowRunModel.created_at < cutoff,
                OrganizationModel.wallet_started_at.is_not(None),
                WorkflowRunModel.created_at >= OrganizationModel.wallet_started_at,
                ~billed_exists,
            )
            .order_by(WorkflowRunModel.id)
            .limit(limit)
        )
        if organization_id is not None:
            q = q.where(WorkflowModel.organization_id == organization_id)
        rows = (await session.execute(q)).all()

    stats = {"found": len(rows), "billed": 0, "failed": 0}
    for run_id, _org_id in rows:
        try:
            await bill_workflow_run(run_id)
            stats["billed"] += 1
        except Exception as exc:  # noqa: BLE001
            stats["failed"] += 1
            logger.error(f"Wallet reconcile failed for run {run_id}: {exc}")
    if rows:
        logger.info(f"Wallet reconcile: {stats}")
    return stats


async def audit_org(organization_id: int) -> dict[str, Any]:
    """Compare materialized balances with the ledger (drift detection)."""
    async with _session() as session:
        org = await session.get(OrganizationModel, organization_id)
        if not org:
            raise WalletError("Organization not found")
        ledger_minutes, ledger_money = (
            await session.execute(
                select(
                    func.coalesce(func.sum(WalletLedgerModel.minutes_delta), 0.0),
                    func.coalesce(func.sum(WalletLedgerModel.money_delta), 0.0),
                ).where(WalletLedgerModel.organization_id == organization_id)
            )
        ).one()
        bucket_minutes = (
            await session.execute(
                select(func.coalesce(func.sum(WalletBucketModel.minutes_remaining), 0.0)).where(
                    WalletBucketModel.organization_id == organization_id
                )
            )
        ).scalar_one()
    return {
        "ledger_minutes": _r(ledger_minutes, 4),
        "bucket_minutes": _r(bucket_minutes, 4),
        "minutes_drift": _r(ledger_minutes - bucket_minutes, 4),
        "ledger_money": _r(ledger_money, 4),
        "money_balance": _r(org.balance or 0.0, 4),
        "money_drift": _r(ledger_money - (org.balance or 0.0), 4),
    }


async def client_stats(
    parent_id: int, *, start: datetime, end: datetime
) -> dict[int, dict[str, float]]:
    """Per-client usage and wholesale cost for a reseller over [start, end)."""
    async with _session() as session:
        child_ids = [
            row[0]
            for row in (
                await session.execute(
                    select(OrganizationModel.id).where(
                        OrganizationModel.parent_org_id == parent_id
                    )
                )
            ).all()
        ]
        stats: dict[int, dict[str, float]] = {
            cid: {"calls": 0, "minutes": 0.0, "wholesale_cost": 0.0, "overage_revenue": 0.0}
            for cid in child_ids
        }
        if not child_ids:
            return stats

        usage_rows = await session.execute(
            select(
                WalletLedgerModel.organization_id,
                func.count(WalletLedgerModel.id),
                func.coalesce(func.sum(WalletLedgerModel.billed_seconds), 0),
                func.coalesce(func.sum(WalletLedgerModel.money_delta), 0.0),
            )
            .where(
                WalletLedgerModel.organization_id.in_(child_ids),
                WalletLedgerModel.entry_type == "usage",
                WalletLedgerModel.created_at >= start,
                WalletLedgerModel.created_at < end,
            )
            .group_by(WalletLedgerModel.organization_id)
        )
        for cid, calls, seconds, money in usage_rows.all():
            stats[cid]["calls"] = int(calls)
            stats[cid]["minutes"] = _r(seconds / 60.0, 2)
            stats[cid]["overage_revenue"] = _r(-money, 2)

        cost_rows = await session.execute(
            select(
                WalletLedgerModel.source_org_id,
                func.coalesce(func.sum(WalletLedgerModel.money_delta), 0.0),
            )
            .where(
                WalletLedgerModel.organization_id == parent_id,
                WalletLedgerModel.source_org_id.in_(child_ids),
                WalletLedgerModel.created_at >= start,
                WalletLedgerModel.created_at < end,
            )
            .group_by(WalletLedgerModel.source_org_id)
        )
        for cid, money in cost_rows.all():
            stats[cid]["wholesale_cost"] = _r(-money, 2)
        return stats
