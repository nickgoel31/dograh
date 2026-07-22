import pytest
from unittest.mock import AsyncMock, MagicMock
from datetime import datetime, UTC
from sqlalchemy.sql import Select

from api.db import db_client
from api.db.models import WorkflowRunModel

@pytest.mark.anyio
async def test_get_completed_runs_for_report_query_conditions():
    # 1. Setup mock session and execute result
    mock_session = MagicMock()
    mock_execute_result = MagicMock()
    
    # Mock data to return from session.execute(query).all()
    mock_run = MagicMock()
    mock_run.id = 123
    mock_run.workflow_id = 456
    mock_run.campaign_id = 789
    mock_run.created_at = datetime.now(UTC)
    mock_run.initial_context = {"phone_number": "+123456789"}
    mock_run.gathered_context = {"call_tags": ["not_connected"]}
    mock_run.cost_info = {}
    mock_run.public_access_token = "token"
    mock_run.call_type = "outbound"
    
    mock_execute_result.all.return_value = [mock_run]
    mock_session.execute = AsyncMock(return_value=mock_execute_result)
    
    # Mock the async_session context manager on db_client
    mock_async_session_cm = MagicMock()
    mock_async_session_cm.__aenter__.return_value = mock_session
    
    original_async_session = db_client.async_session
    db_client.async_session = MagicMock(return_value=mock_async_session_cm)
    
    try:
        # 2. Call the method
        runs = await db_client.get_completed_runs_for_report(campaign_id=789)
        
        # 3. Assertions
        assert len(runs) == 1
        assert runs[0].id == 123
        
        # Verify the query conditions
        db_client.async_session.assert_called_once()
        mock_session.execute.assert_called_once()
        
        query = mock_session.execute.call_args[0][0]
        assert isinstance(query, Select)
        
        # Check string representation of the compiled query to ensure it doesn't filter by is_completed or call_duration_seconds
        query_str = str(query.compile(compile_kwargs={"literal_binds": True}))
        assert "is_completed" not in query_str
        assert "call_duration_seconds" not in query_str
        assert "workflow_runs.campaign_id = 789" in query_str

    finally:
        db_client.async_session = original_async_session
