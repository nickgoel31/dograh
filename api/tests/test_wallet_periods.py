from datetime import datetime, timezone

from api.services.billing.periods import (
    billed_seconds_for,
    period_for,
    period_starts_between,
    within_contract,
)

UTC = timezone.utc


def dt(y, m, d, h=0):
    return datetime(y, m, d, h, tzinfo=UTC)


def test_period_for_reset_day_boundaries():
    # Before the reset day -> previous month's period
    assert period_for(15, dt(2026, 10, 14, 23)) == (dt(2026, 9, 15), dt(2026, 10, 15))
    # Exactly on the reset instant -> new period (no gap, no overlap)
    assert period_for(15, dt(2026, 10, 15)) == (dt(2026, 10, 15), dt(2026, 11, 15))
    # Year rollover
    assert period_for(1, dt(2026, 12, 31, 23)) == (dt(2026, 12, 1), dt(2027, 1, 1))
    assert period_for(20, dt(2027, 1, 5)) == (dt(2026, 12, 20), dt(2027, 1, 20))


def test_period_for_clamps_invalid_reset_day():
    assert period_for(31, dt(2026, 2, 28, 12))[0] == dt(2026, 2, 28)
    assert period_for(None, dt(2026, 3, 9))[0] == dt(2026, 3, 1)


def test_periods_tile_without_gaps():
    ts = dt(2026, 1, 20)
    for _ in range(30):
        start, end = period_for(10, ts)
        assert period_for(10, end)[0] == end
        ts = end


def test_period_starts_between_catches_up_missed_months():
    assert period_starts_between(None, 1, dt(2026, 10, 1)) == [dt(2026, 10, 1)]
    assert period_starts_between(dt(2026, 7, 1), 1, dt(2026, 10, 1)) == [
        dt(2026, 8, 1),
        dt(2026, 9, 1),
        dt(2026, 10, 1),
    ]
    assert period_starts_between(dt(2026, 10, 1), 1, dt(2026, 10, 1)) == []


def test_changing_reset_day_never_double_grants_in_a_month():
    # Last grant Oct 1, reset day moved to 15, today is Oct 20 -> current start Oct 15
    assert period_starts_between(dt(2026, 10, 1), 15, dt(2026, 10, 15)) == []
    assert period_starts_between(dt(2026, 10, 1), 15, dt(2026, 11, 15)) == [dt(2026, 11, 15)]


def test_billed_seconds_rounds_up_to_pulse():
    assert billed_seconds_for(0, 60) == 0
    assert billed_seconds_for(-5, 60) == 0
    assert billed_seconds_for(1, 60) == 60
    assert billed_seconds_for(60, 60) == 60
    assert billed_seconds_for(61, 60) == 120
    assert billed_seconds_for(61, 15) == 75
    assert billed_seconds_for(0.2, 1) == 1
    assert billed_seconds_for(10, None) == 60


def test_within_contract_window():
    assert within_contract(dt(2026, 5, 1), (None, None), (None, None))
    assert not within_contract(dt(2026, 4, 1), (2026, 5), (None, None))
    assert within_contract(dt(2026, 5, 1), (2026, 5), (2026, 5))
    assert not within_contract(dt(2026, 6, 1), (2026, 5), (2026, 5))
