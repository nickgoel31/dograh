"""DB-backed wallet tests (run through the real migrations via ``db_session``)."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from api.db.models import OrganizationModel, WalletLedgerModel
from api.services.billing import wallet_service

pytestmark = pytest.mark.anyio

WORKFLOW_DEF = {"nodes": [], "edges": []}


async def _org(db_session, **kw) -> OrganizationModel:
    defaults = dict(
        provider_id=f"org_wallet_{datetime.now(UTC).timestamp()}",
        wallet_enabled=True,
        wallet_started_at=datetime.now(UTC) - timedelta(days=60),
        billing_pulse=60,
        billing_rate=2.0,
        monthly_minutes_limit=100.0,
        quota_reset_day=1,
    )
    defaults.update(kw)
    async with db_session.async_session() as s:
        org = OrganizationModel(**defaults)
        s.add(org)
        await s.commit()
        await s.refresh(org)
        return org


async def _run(db_session, org_id: int) -> int:
    user, _ = await db_session.get_or_create_user_by_provider_id(f"u_{org_id}")
    wf = await db_session.create_workflow(
        name="w", workflow_definition=WORKFLOW_DEF, user_id=user.id, organization_id=org_id
    )
    run = await db_session.create_workflow_run(
        name="r", workflow_id=wf.id, mode="webrtc", user_id=user.id, organization_id=org_id
    )
    return run.id


async def test_usage_is_idempotent_and_consumes_allowance(db_session):
    org = await _org(db_session)
    run_id = await _run(db_session, org.id)

    first = await wallet_service.record_usage(org.id, run_id, 61)
    again = await wallet_service.record_usage(org.id, run_id, 61)

    assert first.billed_seconds == 120 and not first.already_recorded
    assert again.already_recorded
    summary = await wallet_service.get_summary(org.id)
    assert summary["minutes_remaining"] == pytest.approx(98.0)
    assert summary["minutes_used"] == pytest.approx(2.0)
    assert summary["balance"] == 0  # covered by the allowance: no money charged

    async with db_session.async_session() as s:
        rows = (await s.execute(select(WalletLedgerModel).where(
            WalletLedgerModel.workflow_run_id == run_id,
            WalletLedgerModel.entry_type == "usage"))).scalars().all()
    assert len(rows) == 1


async def test_overage_is_charged_to_money_balance(db_session):
    org = await _org(db_session, monthly_minutes_limit=1.0, balance=100.0)
    run_id = await _run(db_session, org.id)

    res = await wallet_service.record_usage(org.id, run_id, 3 * 60)  # 3 min, 1 covered

    assert res.minutes_from_buckets == pytest.approx(1.0)
    assert res.overage_minutes == pytest.approx(2.0)
    assert res.money_charged == pytest.approx(4.0)  # 2 min * 2.0
    assert (await wallet_service.get_summary(org.id))["balance"] == pytest.approx(96.0)


async def test_topup_is_used_after_expiring_allowance_first(db_session):
    org = await _org(db_session, monthly_minutes_limit=5.0, monthly_carry_forward=False)
    await wallet_service.grant_minutes(org.id, 10.0)
    run_id = await _run(db_session, org.id)

    await wallet_service.record_usage(org.id, run_id, 4 * 60)

    summary = await wallet_service.get_summary(org.id)
    by_kind = {b["kind"]: b["minutes_remaining"] for b in summary["buckets"]}
    assert by_kind["monthly_allowance"] == pytest.approx(1.0)  # expiring pool used first
    assert by_kind["topup"] == pytest.approx(10.0)


async def test_admission_blocks_when_empty_unless_overdraft(db_session):
    org = await _org(db_session, monthly_minutes_limit=0.0, balance=0.0)
    assert not (await wallet_service.check_can_start_call(org.id)).allowed

    await wallet_service.credit_money(org.id, 10.0)
    assert (await wallet_service.check_can_start_call(org.id)).allowed

    od = await _org(db_session, monthly_minutes_limit=0.0, allow_overdraft=True,
                    provider_id="org_overdraft")
    assert (await wallet_service.check_can_start_call(od.id)).allowed


async def test_idempotency_key_prevents_double_topup(db_session):
    org = await _org(db_session, monthly_minutes_limit=0.0)
    await wallet_service.credit_money(org.id, 50.0, idempotency_key="pay_123")
    await wallet_service.credit_money(org.id, 50.0, idempotency_key="pay_123")
    assert (await wallet_service.get_summary(org.id))["balance"] == pytest.approx(50.0)


async def test_audit_has_no_drift_after_mixed_operations(db_session):
    org = await _org(db_session, monthly_minutes_limit=10.0, balance=0.0)
    await wallet_service.credit_money(org.id, 25.0)
    await wallet_service.grant_minutes(org.id, 5.0)
    run_id = await _run(db_session, org.id)
    await wallet_service.record_usage(org.id, run_id, 14 * 60)

    audit = await wallet_service.audit_org(org.id)
    assert audit["minutes_drift"] == pytest.approx(0.0, abs=1e-6)
    assert audit["money_drift"] == pytest.approx(0.0, abs=1e-6)


async def _reseller_pair(db_session, wholesale=1.0, parent_balance=100.0, **child_kw):
    parent = await _org(
        db_session, provider_id="org_reseller", is_reseller=True, wholesale_rate=wholesale,
        balance=parent_balance, monthly_minutes_limit=0.0,
    )
    child = await _org(
        db_session, provider_id="org_client", parent_org_id=parent.id,
        hide_model_details=True, **child_kw,
    )
    return parent, child


async def test_client_usage_debits_reseller_at_wholesale_rate(db_session):
    parent, child = await _reseller_pair(db_session, wholesale=1.5)
    run_id = await _run(db_session, child.id)

    await wallet_service.record_usage(child.id, run_id, 120)  # 2 minutes
    await wallet_service.record_usage(child.id, run_id, 120)  # idempotent

    assert (await wallet_service.get_summary(parent.id))["balance"] == pytest.approx(97.0)
    stats = await wallet_service.client_stats(
        parent.id, start=datetime.now(UTC) - timedelta(days=1), end=datetime.now(UTC) + timedelta(days=1)
    )
    assert stats[child.id]["minutes"] == pytest.approx(2.0)
    assert stats[child.id]["wholesale_cost"] == pytest.approx(3.0)


async def test_client_blocked_when_reseller_cannot_pay(db_session):
    _, child = await _reseller_pair(db_session, wholesale=2.0, parent_balance=0.0)
    admission = await wallet_service.check_can_start_call(child.id)
    assert not admission.allowed
    # The client-facing message must not reveal anything about the reseller wallet.
    assert "wallet" not in admission.reason.lower() and "balance" not in admission.reason.lower()


async def test_refund_reverses_client_and_reseller_charges(db_session):
    parent, child = await _reseller_pair(db_session, wholesale=1.0, monthly_minutes_limit=10.0)
    run_id = await _run(db_session, child.id)
    await wallet_service.record_usage(child.id, run_id, 180)
    assert (await wallet_service.get_summary(parent.id))["balance"] == pytest.approx(97.0)

    await wallet_service.refund_usage(run_id, organization_id=child.id)

    assert (await wallet_service.get_summary(parent.id))["balance"] == pytest.approx(100.0)
    assert (await wallet_service.get_summary(child.id))["minutes_remaining"] == pytest.approx(10.0)
    with pytest.raises(wallet_service.WalletError):
        await wallet_service.refund_usage(run_id, organization_id=child.id)


async def test_model_profile_applies_in_memory_only(db_session):
    org = await _org(db_session)
    user, _ = await db_session.get_or_create_user_by_provider_id("profile_user")
    await db_session.update_user_selected_organization(user.id, org.id)
    profile = await db_session.create_model_profile(
        slug="std", display_name="Standard",
        config={"llm": {"provider": "openai", "api_key": "sk-test", "model": "gpt-4.1"}},
    )
    await db_session.update_organization_fields(org.id, model_profile_id=profile.id)

    applied = await db_session.get_user_configurations(user.id)
    stored = await db_session.get_user_configurations(user.id, apply_profile=False)

    assert applied.llm is not None and applied.llm.model == "gpt-4.1"
    assert stored.llm is None  # never persisted on the tenant's own config
