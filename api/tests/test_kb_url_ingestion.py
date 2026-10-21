"""URL knowledge-base sources: refresh keeps old content until new content is ready."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api.tasks import knowledge_base_processing as kb
from api.utils.safe_fetch import FetchedContent, FetchError

pytestmark = pytest.mark.anyio


def _doc(**kw):
    base = dict(
        id=7, organization_id=1, created_by=3, filename="docs.example.com/faq",
        source_url="https://docs.example.com/faq", retrieval_mode="chunked",
        file_hash="oldhash", processing_status="completed",
        source_etag='"v1"', source_last_modified=None,
    )
    base.update(kw)
    return SimpleNamespace(**base)


def _page(body=b"<html>new</html>"):
    return FetchedContent("https://docs.example.com/faq", "text/html", ".html", body, etag='"v2"')


@pytest.fixture
def env():
    db = MagicMock()
    db.get_document_by_id = AsyncMock(return_value=_doc())
    db.compute_file_hash = MagicMock(return_value="newhash")
    db.get_mime_type = MagicMock(return_value="text/html")
    for name in (
        "update_document_metadata", "update_document_status", "create_chunks_batch",
        "delete_chunks_by_ids", "record_document_refresh", "update_document_full_text",
    ):
        setattr(db, name, AsyncMock())
    db.get_chunk_ids_for_document = AsyncMock(return_value=[1, 2, 3])
    db.get_document_by_hash = AsyncMock(return_value=None)
    db.get_user_configurations = AsyncMock(
        return_value=SimpleNamespace(
            embeddings=SimpleNamespace(provider="openai", api_key="k", model="m", base_url=None)
        )
    )
    mps = MagicMock()
    mps.process_document = AsyncMock(
        return_value={"chunks": [{"chunk_text": "a", "chunk_index": 0}], "docling_metadata": {}}
    )
    embed = MagicMock()
    embed.get_model_id.return_value = "m"
    embed.get_embedding_dimension.return_value = 3
    embed.embed_texts = AsyncMock(return_value=[[0.1, 0.2, 0.3]])
    with patch.object(kb, "db_client", db), patch.object(kb, "mps_service_key_client", mps), patch.object(
        kb, "OpenAIEmbeddingService", MagicMock(return_value=embed)
    ):
        yield SimpleNamespace(db=db, mps=mps, embed=embed)


async def test_changed_page_replaces_chunks_after_new_ones_are_stored(env):
    calls = []
    env.db.create_chunks_batch.side_effect = lambda *_: calls.append("create")
    env.db.delete_chunks_by_ids.side_effect = lambda *_: calls.append("delete_old")
    with patch.object(kb, "fetch_url", AsyncMock(return_value=_page())):
        await kb.refresh_knowledge_base_url(None, 7, "prov")

    assert calls == ["create", "delete_old"]  # never an empty window
    env.db.delete_chunks_by_ids.assert_awaited_once_with([1, 2, 3])
    assert env.db.record_document_refresh.await_args.kwargs["success"] is True


async def test_unchanged_page_skips_embedding(env):
    env.db.compute_file_hash.return_value = "oldhash"
    with patch.object(kb, "fetch_url", AsyncMock(return_value=_page())):
        await kb.refresh_knowledge_base_url(None, 7, "prov")

    env.mps.process_document.assert_not_awaited()
    env.embed.embed_texts.assert_not_awaited()
    env.db.create_chunks_batch.assert_not_awaited()
    assert env.db.record_document_refresh.await_args.kwargs["success"] is True


async def test_304_not_modified_costs_nothing(env):
    with patch.object(kb, "fetch_url", AsyncMock(return_value=None)) as fetch:
        await kb.refresh_knowledge_base_url(None, 7, "prov")
    assert fetch.await_args.kwargs["etag"] == '"v1"'  # conditional request
    env.mps.process_document.assert_not_awaited()


async def test_failed_refresh_keeps_old_content_and_records_error(env):
    with patch.object(kb, "fetch_url", AsyncMock(side_effect=FetchError("HTTP 500"))):
        await kb.refresh_knowledge_base_url(None, 7, "prov")

    env.db.delete_chunks_by_ids.assert_not_awaited()
    env.db.update_document_status.assert_not_awaited()  # still "completed"
    kwargs = env.db.record_document_refresh.await_args.kwargs
    assert kwargs["success"] is False and "HTTP 500" in kwargs["error"]


async def test_empty_refreshed_page_does_not_wipe_good_content(env):
    env.mps.process_document.return_value = {"chunks": [], "docling_metadata": {}}
    with patch.object(kb, "fetch_url", AsyncMock(return_value=_page())):
        await kb.refresh_knowledge_base_url(None, 7, "prov")

    env.db.delete_chunks_by_ids.assert_not_awaited()
    assert env.db.record_document_refresh.await_args.kwargs["success"] is False


async def test_initial_fetch_failure_marks_document_failed(env):
    with patch.object(kb, "fetch_url", AsyncMock(side_effect=FetchError("nope"))):
        await kb.process_knowledge_base_url(None, 7, 1, "prov")
    statuses = [c.args[1] for c in env.db.update_document_status.await_args_list]
    assert statuses == ["processing", "failed"]


async def test_json_pages_are_sent_to_the_processor_as_text(env):
    seen = {}

    async def fake_process(**kw):
        seen["path"] = kw["file_path"]
        seen["text"] = open(kw["file_path"], encoding="utf-8").read()
        return {"chunks": [{"chunk_text": "a", "chunk_index": 0}], "docling_metadata": {}}

    env.mps.process_document.side_effect = fake_process
    page = FetchedContent("https://x.io/api", "application/json", ".json", b'{"a":1}')
    with patch.object(kb, "fetch_url", AsyncMock(return_value=page)):
        await kb.process_knowledge_base_url(None, 7, 1, "prov")

    assert seen["path"].endswith(".txt")
    assert '"a": 1' in seen["text"]


async def test_error_text_with_braces_still_marks_the_document_failed(env):
    # MPS error bodies look like {"detail": "..."}; logging them used to raise
    # KeyError inside the handler, leaving the document stuck on "processing".
    env.mps.process_document.side_effect = RuntimeError('{"detail":"Unsupported document format"}')
    with patch.object(kb, "fetch_url", AsyncMock(return_value=_page())):
        with pytest.raises(RuntimeError):
            await kb.process_knowledge_base_url(None, 7, 1, "prov")

    statuses = [c.args[1] for c in env.db.update_document_status.await_args_list]
    assert statuses[-1] == "failed"
