"""ARQ background tasks for processing knowledge base documents.

Document conversion and chunking live in the Model Proxy Service (MPS);
these tasks get the file (from S3 for uploads, from the web for URL sources),
call MPS, then handle the embedding and DB writes locally.

URL sources are *living* documents: ``refresh_due_knowledge_base_urls`` (cron)
re-fetches them on their schedule and only re-embeds when the content changed.
New chunks are written before the old ones are removed, so the agent keeps
answering from the previous version while a refresh is in progress - and keeps
it if the refresh fails.
"""

import json
import os
import tempfile
from typing import Literal

from loguru import logger

from api.db import db_client
from api.db.models import KnowledgeBaseChunkModel
from api.services.configuration.registry import ServiceProviders
from api.services.gen_ai import AzureOpenAIEmbeddingService, OpenAIEmbeddingService
from api.services.mps_service_key_client import mps_service_key_client
from api.services.storage import storage_fs
from api.utils.safe_fetch import FetchError, UnsafeURLError, fetch_url

MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024

IngestResult = Literal["completed", "unchanged", "failed"]


async def _ingest_local_file(
    *,
    document_id: int,
    temp_file_path: str,
    filename: str,
    organization_id: int,
    created_by_provider_id: str,
    max_tokens: int,
    retrieval_mode: str,
    is_refresh: bool = False,
) -> IngestResult:
    """Convert, chunk, embed and store one local file for ``document_id``."""
    file_size = os.path.getsize(temp_file_path)
    logger.info(f"Document {document_id}: file size {file_size} bytes")

    async def fail(message: str) -> None:
        # A failed *refresh* must not take a working document offline: it is
        # reported to the caller, which records the error and keeps old content.
        if is_refresh:
            raise ValueError(message)
        await db_client.update_document_status(
            document_id, "failed", error_message=message
        )

    if file_size > MAX_FILE_SIZE_BYTES:
        error_message = (
            f"File size ({file_size / (1024 * 1024):.1f}MB) exceeds the "
            f"maximum allowed size of {MAX_FILE_SIZE_BYTES // (1024 * 1024)}MB."
        )
        logger.warning("Document {}: {}", document_id, error_message)
        await fail(error_message)
        return "failed"

    file_hash = db_client.compute_file_hash(temp_file_path)
    mime_type = db_client.get_mime_type(temp_file_path)

    document = await db_client.get_document_by_id(document_id)
    if not document:
        raise Exception(f"Document {document_id} not found")

    if is_refresh:
        if document.file_hash == file_hash and document.processing_status == "completed":
            logger.info(f"Document {document_id}: content unchanged, skipping re-embedding")
            return "unchanged"
    else:
        # Reject duplicates (same hash already ingested for this org).
        existing_doc = await db_client.get_document_by_hash(file_hash, organization_id)
        if existing_doc and existing_doc.id != document_id:
            error_message = (
                f"This file is a duplicate of '{existing_doc.filename}'. "
                f"Please delete the duplicate files and consolidate them into a "
                f"single unique file before uploading."
            )
            logger.warning(
                f"Duplicate document detected: {document_id} is duplicate of "
                f"{existing_doc.id} ({existing_doc.filename})"
            )
            await db_client.update_document_metadata(
                document_id,
                file_size_bytes=file_size,
                file_hash=file_hash,
                mime_type=mime_type,
            )
            await db_client.update_document_status(
                document_id,
                "failed",
                error_message=error_message,
                docling_metadata={
                    "duplicate_of": existing_doc.document_uuid,
                    "duplicate_filename": existing_doc.filename,
                },
            )
            return "failed"

    if not is_refresh:
        await db_client.update_document_metadata(
            document_id, file_size_bytes=file_size, file_hash=file_hash, mime_type=mime_type
        )

    logger.info(f"Delegating document processing to MPS (mode={retrieval_mode})")
    mps_response = await mps_service_key_client.process_document(
        file_path=temp_file_path,
        filename=filename,
        content_type=mime_type or "application/octet-stream",
        retrieval_mode=retrieval_mode,
        max_tokens=max_tokens,
        organization_id=organization_id,
        created_by=created_by_provider_id,
    )
    docling_metadata = mps_response.get("docling_metadata", {})

    if retrieval_mode == "full_document":
        full_text = mps_response.get("full_text") or ""
        await db_client.update_document_full_text(document_id, full_text)
        await db_client.update_document_metadata(
            document_id, file_size_bytes=file_size, file_hash=file_hash, mime_type=mime_type
        )
        await db_client.update_document_status(
            document_id, "completed", total_chunks=0, docling_metadata=docling_metadata
        )
        logger.info(
            f"Successfully processed full_document {document_id}. "
            f"Text length: {len(full_text)} chars"
        )
        return "completed"

    # Chunked mode: fetch user embedding config, embed, and persist chunks.
    embeddings_provider = None
    embeddings_api_key = None
    embeddings_model = None
    embeddings_base_url = None
    embeddings_endpoint = None
    embeddings_api_version = None
    if document.created_by:
        user_config = await db_client.get_user_configurations(
            document.created_by, organization_id=organization_id
        )
        if user_config.embeddings:
            embeddings_provider = getattr(user_config.embeddings, "provider", None)
            embeddings_api_key = user_config.embeddings.api_key
            embeddings_model = user_config.embeddings.model
            embeddings_base_url = getattr(user_config.embeddings, "base_url", None)
            embeddings_endpoint = getattr(user_config.embeddings, "endpoint", None)
            embeddings_api_version = getattr(user_config.embeddings, "api_version", None)
            logger.info(
                f"Using user embeddings config: provider={embeddings_provider}, "
                f"model={embeddings_model}"
            )

    if not embeddings_api_key:
        error_message = (
            "API key not configured. Please set your API key in "
            "Model Configurations > Embedding to process documents."
        )
        logger.warning("Document {}: {}", document_id, error_message)
        await fail(error_message)
        return "failed"

    if embeddings_provider == ServiceProviders.AZURE.value and embeddings_endpoint:
        embedding_service = AzureOpenAIEmbeddingService(
            db_client=db_client,
            api_key=embeddings_api_key,
            endpoint=embeddings_endpoint,
            model_id=embeddings_model or "text-embedding-3-small",
            api_version=embeddings_api_version or "2024-02-15-preview",
        )
    else:
        embedding_service = OpenAIEmbeddingService(
            db_client=db_client,
            api_key=embeddings_api_key,
            model_id=embeddings_model or "text-embedding-3-small",
            base_url=embeddings_base_url,
        )

    mps_chunks = mps_response.get("chunks", [])
    if not mps_chunks:
        logger.warning(f"Document {document_id}: MPS returned zero chunks")
        if is_refresh:
            # Don't replace good content with an empty page.
            raise ValueError("The refreshed page produced no readable content")

    chunk_records = []
    chunk_texts = []
    for chunk in mps_chunks:
        contextualized = chunk.get("contextualized_text") or chunk["chunk_text"]
        chunk_records.append(
            KnowledgeBaseChunkModel(
                document_id=document_id,
                organization_id=organization_id,
                chunk_text=chunk["chunk_text"],
                contextualized_text=contextualized,
                chunk_index=chunk["chunk_index"],
                chunk_metadata=chunk.get("chunk_metadata") or {},
                embedding_model=embedding_service.get_model_id(),
                embedding_dimension=embedding_service.get_embedding_dimension(),
                token_count=chunk.get("token_count", 0),
            )
        )
        chunk_texts.append(contextualized)

    logger.info(
        f"Generating embeddings for {len(chunk_texts)} chunks "
        f"using {embedding_service.get_model_id()}"
    )
    embeddings = await embedding_service.embed_texts(chunk_texts)
    for chunk_record, embedding in zip(chunk_records, embeddings):
        chunk_record.embedding = embedding

    old_chunk_ids = await db_client.get_chunk_ids_for_document(document_id) if is_refresh else []

    logger.info("Storing chunks in database")
    await db_client.create_chunks_batch(chunk_records)
    # New version is in place: only now drop the old one.
    await db_client.delete_chunks_by_ids(old_chunk_ids)

    await db_client.update_document_metadata(
        document_id, file_size_bytes=file_size, file_hash=file_hash, mime_type=mime_type
    )
    await db_client.update_document_status(
        document_id,
        "completed",
        total_chunks=len(chunk_records),
        docling_metadata=docling_metadata,
    )
    logger.info(
        f"Successfully processed knowledge base document {document_id}. "
        f"Total chunks: {len(chunk_records)}"
    )
    return "completed"


def _remove_quietly(path: str | None) -> None:
    if path and os.path.exists(path):
        try:
            os.remove(path)
            logger.debug(f"Cleaned up temp file: {path}")
        except Exception as e:
            logger.warning(f"Failed to clean up temp file {path}: {e}")


async def process_knowledge_base_document(
    ctx,
    document_id: int,
    s3_key: str,
    organization_id: int,
    created_by_provider_id: str,
    max_tokens: int = 128,
    retrieval_mode: str = "chunked",
):
    """Process an uploaded document via MPS: download, call MPS, embed, store.

    Args:
        ctx: ARQ context
        document_id: Database ID of the document
        s3_key: S3 key where the file is stored
        organization_id: Organization ID
        created_by_provider_id: Uploading user's provider ID (for OSS-mode auth to MPS)
        max_tokens: Maximum number of tokens per chunk (default: 128)
        retrieval_mode: "chunked" for vector search or "full_document" for full text
    """
    logger.info(
        f"Processing knowledge base document: document_id={document_id}, "
        f"s3_key={s3_key}, org={organization_id}, mode={retrieval_mode}"
    )

    temp_file_path = None
    try:
        await db_client.update_document_status(document_id, "processing")

        filename = s3_key.split("/")[-1]
        file_extension = os.path.splitext(filename)[1] or ".bin"

        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=file_extension)
        temp_file_path = temp_file.name
        temp_file.close()

        logger.info(f"Downloading file from S3: {s3_key}")
        download_success = await storage_fs.adownload_file(s3_key, temp_file_path)
        if not download_success:
            raise Exception(f"Failed to download file from S3: {s3_key}")
        if not os.path.exists(temp_file_path):
            raise FileNotFoundError(f"Downloaded file not found: {temp_file_path}")

        await _ingest_local_file(
            document_id=document_id,
            temp_file_path=temp_file_path,
            filename=filename,
            organization_id=organization_id,
            created_by_provider_id=created_by_provider_id,
            max_tokens=max_tokens,
            retrieval_mode=retrieval_mode,
        )
    except Exception as e:
        logger.opt(exception=True).error(
            "Error processing knowledge base document {}: {}", document_id, str(e)
        )
        await db_client.update_document_status(
            document_id, "failed", error_message=str(e)
        )
        raise
    finally:
        _remove_quietly(temp_file_path)


def _processor_filename(display_name: str, extension: str) -> str:
    """File name sent to the document processor.

    The processor decides how to read a file from its extension. A URL source's
    display name ("host/path") has none, so add the one matching what we fetched
    and make sure no path separators survive.
    """
    name = display_name.replace("/", "_").replace("\\", "_").strip("_") or "page"
    return name if name.lower().endswith(extension) else f"{name}{extension}"


async def _fetch_and_ingest_url(
    document_id: int,
    created_by_provider_id: str,
    max_tokens: int,
    *,
    is_refresh: bool,
) -> IngestResult:
    document = await db_client.get_document_by_id(document_id)
    if not document or not document.source_url:
        raise ValueError(f"Document {document_id} has no source URL")

    fetched = await fetch_url(
        document.source_url,
        # Conditional request: an unchanged page answers 304 and costs nothing.
        etag=document.source_etag if is_refresh else None,
        last_modified=document.source_last_modified if is_refresh else None,
    )
    if fetched is None:
        logger.info(f"Document {document_id}: source not modified (304)")
        await db_client.record_document_refresh(document_id, success=True)
        return "unchanged"

    extension, body = fetched.extension, fetched.body
    if fetched.content_type == "application/json":
        # The document processor does not accept raw JSON; give it readable text.
        try:
            body = json.dumps(json.loads(body), indent=2, ensure_ascii=False).encode("utf-8")
        except ValueError:
            pass
        extension = ".txt"

    temp_file_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=extension) as temp_file:
            temp_file.write(body)
            temp_file_path = temp_file.name

        result = await _ingest_local_file(
            document_id=document_id,
            temp_file_path=temp_file_path,
            filename=_processor_filename(document.filename, extension),
            organization_id=document.organization_id,
            created_by_provider_id=created_by_provider_id,
            max_tokens=max_tokens,
            retrieval_mode=document.retrieval_mode,
            is_refresh=is_refresh,
        )
    finally:
        _remove_quietly(temp_file_path)

    if result in ("completed", "unchanged"):
        await db_client.record_document_refresh(
            document_id,
            success=True,
            etag=fetched.etag or "",
            last_modified=fetched.last_modified or "",
        )
    return result


async def process_knowledge_base_url(
    ctx,
    document_id: int,
    organization_id: int,
    created_by_provider_id: str,
    max_tokens: int = 128,
):
    """First ingestion of a URL source."""
    logger.info(f"Processing knowledge base URL: document_id={document_id}, org={organization_id}")
    try:
        await db_client.update_document_status(document_id, "processing")
        await _fetch_and_ingest_url(
            document_id, created_by_provider_id, max_tokens, is_refresh=False
        )
    except (UnsafeURLError, FetchError) as e:
        logger.warning("Knowledge base URL {} rejected: {}", document_id, str(e))
        await db_client.update_document_status(document_id, "failed", error_message=str(e))
        await db_client.record_document_refresh(document_id, success=False, error=str(e))
    except Exception as e:
        logger.opt(exception=True).error(
            "Error processing knowledge base URL {}: {}", document_id, str(e)
        )
        await db_client.update_document_status(document_id, "failed", error_message=str(e))
        await db_client.record_document_refresh(document_id, success=False, error=str(e))
        raise


async def refresh_knowledge_base_url(
    ctx,
    document_id: int,
    created_by_provider_id: str,
    max_tokens: int = 128,
):
    """Re-fetch a URL source; the previous content stays live unless it changed."""
    logger.info(f"Refreshing knowledge base URL: document_id={document_id}")
    try:
        result = await _fetch_and_ingest_url(
            document_id, created_by_provider_id, max_tokens, is_refresh=True
        )
        logger.info(f"Knowledge base URL {document_id} refresh finished: {result}")
    except Exception as e:  # keep serving the old content, just record why
        logger.warning("Refresh of knowledge base URL {} failed: {}", document_id, str(e))
        await db_client.record_document_refresh(document_id, success=False, error=str(e))


async def refresh_due_knowledge_base_urls(ctx) -> None:
    """Cron: enqueue a refresh for every URL document whose interval has elapsed."""
    from api.tasks.arq import enqueue_job
    from api.tasks.function_names import FunctionNames

    due = await db_client.get_documents_due_for_refresh()
    for doc in due:
        owner = await db_client.get_user_by_id(doc.created_by)
        if owner is None:
            continue
        # Mark the attempt first so a slow job isn't enqueued again next hour.
        await db_client.mark_refresh_attempt(doc.id)
        await enqueue_job(
            FunctionNames.REFRESH_KNOWLEDGE_BASE_URL,
            doc.id,
            str(owner.provider_id),
            128,
        )
    if due:
        logger.info(f"Enqueued {len(due)} knowledge base URL refresh(es)")
