import io
import csv
from datetime import datetime
from types import SimpleNamespace

from api.services.reports.run_report import build_run_report_csv


def test_build_run_report_csv_phone_number_resolution():
    """
    Test that the phone number resolution correctly falls back and prioritizes
    caller_number for inbound calls, and phone_number for outbound calls,
    as required by the bug fix.
    """
    runs = [
        # Inbound run with only caller_number
        SimpleNamespace(
            id=1,
            campaign_id=None,
            workflow_id=10,
            definition_id="def_1",
            created_at=datetime(2026, 1, 1),
            initial_context={"caller_number": "+1234567890"},
            gathered_context={},
            cost_info={},
            public_access_token="token_1",
            call_type="inbound",
        ),
        # Outbound run with only phone_number
        SimpleNamespace(
            id=2,
            campaign_id=100,
            workflow_id=20,
            definition_id="def_2",
            created_at=datetime(2026, 1, 2),
            initial_context={"phone_number": "+0987654321"},
            gathered_context={},
            cost_info={},
            public_access_token="token_2",
            call_type="outbound",
        ),
        # Run with no keys set
        SimpleNamespace(
            id=3,
            campaign_id=200,
            workflow_id=30,
            definition_id="def_3",
            created_at=datetime(2026, 1, 3),
            initial_context={},
            gathered_context={},
            cost_info={},
            public_access_token="token_3",
            call_type="outbound",
        ),
        # Run with all keys set, inbound - should prioritize caller_number
        SimpleNamespace(
            id=4,
            campaign_id=300,
            workflow_id=40,
            definition_id="def_4",
            created_at=datetime(2026, 1, 4),
            initial_context={
                "caller_number": "caller_4",
                "called_number": "called_4",
                "phone_number": "phone_4",
            },
            gathered_context={},
            cost_info={},
            public_access_token="token_4",
            call_type="inbound",
        ),
    ]

    csv_io = build_run_report_csv(runs)
    csv_str = csv_io.getvalue()

    # Parse the CSV string back
    reader = csv.DictReader(io.StringIO(csv_str))
    rows = list(reader)

    assert len(rows) == 4

    # Check Phone Number column
    assert rows[0]["Phone Number"] == "+1234567890"
    assert rows[1]["Phone Number"] == "+0987654321"
    assert rows[2]["Phone Number"] == ""
    assert rows[3]["Phone Number"] == "caller_4"
