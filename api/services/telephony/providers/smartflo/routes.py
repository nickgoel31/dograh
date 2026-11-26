"""Smartflo routes, mounted under /api/v1/telephony.

  /smartflo/dynamic/{key}  Smartflo's "dynamic endpoint": it posts the call's numbers here and we answer, within 2 seconds, with the wss address
                           of the stream for that call. {key} is the account's secret endpoint key.
  /smartflo/webhook/{key}  Smartflo's webhook: call details and the recording when a call ends.
"""

from __future__ import annotations

import hmac
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from loguru import logger
from pipecat.utils.run_context import set_current_run_id
from sqlalchemy import select

from api.db import db_client
from api.db.models import TelephonyConfigurationModel, WorkflowModel, WorkflowRunModel
from api.enums import WorkflowRunState
from api.services.telephony.status_processor import StatusCallbackRequest, _process_status_update
from api.utils.common import get_backend_endpoints

from . import payload as pl

router = APIRouter()


def _decline(message: str, status: int = 404) -> JSONResponse:
    """Smartflo hangs the call up on anything but a 200 with exactly {success, wss_url}, so a refusal is a 4xx."""
    return JSONResponse(status_code=status, content={"success": False, "message": message})


async def read_payload(request: Request) -> dict:
    """Query string, form or JSON body, merged."""
    data: dict = dict(request.query_params)
    try:
        ctype = request.headers.get("content-type", "")
        if "json" in ctype:
            body = await request.json()
            if isinstance(body, dict):
                data.update(body)
        elif request.method == "POST":
            data.update(dict(await request.form()))
    except Exception:  # noqa: BLE001 - an empty or odd body is not an error here
        pass
    return data


async def find_config(key: str):
    """The Smartflo telephony configuration whose secret endpoint key this is."""
    async with db_client.async_session() as s:
        rows = (await s.scalars(select(TelephonyConfigurationModel).where(TelephonyConfigurationModel.provider == "smartflo"))).all()
    for r in rows:
        k = (r.credentials or {}).get("endpoint_key")
        if k and hmac.compare_digest(str(k), key):
            return r
    return None


async def _recent_runs(org_id: int) -> list[dict]:
    since = datetime.now(UTC) - pl.OUTBOUND_WINDOW - timedelta(minutes=1)
    async with db_client.async_session() as s:
        rows = (await s.scalars(
            select(WorkflowRunModel).join(WorkflowModel, WorkflowRunModel.workflow_id == WorkflowModel.id)
            .where(WorkflowModel.organization_id == org_id, WorkflowRunModel.state == WorkflowRunState.INITIALIZED.value, WorkflowRunModel.created_at > since)
            .order_by(WorkflowRunModel.id.desc()).limit(50))).all()
        return [{"id": r.id, "workflow_id": r.workflow_id, "created_at": r.created_at, "initial_context": r.initial_context, "gathered_context": r.gathered_context} for r in rows]


async def _answer(config, run_id: int, workflow_id: int, user_id: int, call_id: str):
    set_current_run_id(run_id)
    _, wss = await get_backend_endpoints()
    return JSONResponse({"success": True, "wss_url": f"{wss}/api/v1/telephony/ws/{workflow_id}/{user_id}/{run_id}?token={pl.ws_token(run_id)}"})


@router.api_route("/smartflo/dynamic/{key}", methods=["GET", "POST"], include_in_schema=False)
async def smartflo_dynamic(key: str, request: Request):
    """A call needs a stream. Either it is the second leg of a click-to-call we started (a run is waiting for that customer), or it is a new
    inbound call to one of the account's numbers."""
    from api.routes.telephony import _create_inbound_workflow_run
    from api.services.campaign.campaign_call_dispatcher import campaign_call_dispatcher
    from api.services.campaign.rate_limiter import rate_limiter
    from api.services.quota_service import check_dograh_quota_by_user_id
    from api.services.telephony.providers.smartflo.provider import SmartfloProvider

    config = await find_config(key)
    if config is None:
        return _decline("Unknown endpoint", 404)
    data = pl.flatten(await read_payload(request))
    call_id = str(pl.get(data, "callId", "call_id", default=""))
    frm, to = pl.get(data, "fromNumber", "from_number", "from", default=""), pl.get(data, "toNumber", "to_number", "to", default="")
    org_id = config.organization_id

    # 1. outbound: the run waiting for this customer
    pending = pl.pick_pending_outbound(await _recent_runs(org_id), config.id, [frm, to])
    if pending:
        run = await db_client.get_workflow_run_by_id(pending)
        wf = await db_client.get_workflow_by_id(run.workflow_id)
        gc = {**(run.gathered_context or {}), "smartflo_connected": True, "smartflo_call_id": call_id}
        await db_client.update_workflow_run(pending, gathered_context=gc)
        logger.info(f"[run {pending}] Smartflo outbound call connected, stream requested")
        return await _answer(config, pending, wf.id, wf.user_id, call_id)

    # 2. inbound: find the number that was called
    phone_row = None
    for cand in pl.number_candidates(to):
        phone_row = await db_client.find_active_phone_number_for_inbound(org_id, cand, "smartflo")
        if phone_row:
            break
    if phone_row is None or phone_row.telephony_configuration_id != config.id:
        logger.warning(f"Smartflo inbound: no number matched to={to} for config {config.id}")
        return _decline("This number is not set up.")
    if not phone_row.inbound_workflow_id:
        return _decline("No agent is answering this number.")
    workflow = await db_client.get_workflow(phone_row.inbound_workflow_id, organization_id=org_id)
    if workflow is None:
        return _decline("Agent not found.")

    from api.product.hours import inbound_gate

    if await inbound_gate(phone_row):  # closed hours or a paused agent: no stream, the call is declined
        return _decline("Not taking calls right now.")
    if not (await check_dograh_quota_by_user_id(workflow.user_id, workflow_id=workflow.id)).has_quota:
        return _decline("No balance.")
    slot = await rate_limiter.try_acquire_concurrent_slot(
        org_id, workflow.id, await campaign_call_dispatcher.get_org_concurrent_limit(org_id), await campaign_call_dispatcher.get_workflow_concurrent_limit(workflow.id))
    if not slot:
        return _decline("Too many calls at once.")
    try:
        normalized = SmartfloProvider.parse_inbound_webhook(data)
        run_id = await _create_inbound_workflow_run(
            workflow.id, workflow.user_id, "smartflo", normalized, telephony_configuration_id=config.id, from_phone_number_id=phone_row.id)
        await rate_limiter.store_workflow_slot_mapping(run_id, org_id, workflow.id, slot)
        await db_client.update_workflow_run(run_id, gathered_context={"provider": "smartflo", "call_id": call_id, "smartflo_call_id": call_id})
    except Exception as e:  # noqa: BLE001
        await rate_limiter.release_concurrent_slot(org_id, workflow.id, slot)
        logger.error(f"Smartflo inbound run could not be created: {e}")
        return _decline("Could not start the call.", 500)
    return await _answer(config, run_id, workflow.id, workflow.user_id, call_id)


async def find_run(config, d: dict) -> int | None:
    """The run a webhook is about: the run id we put in custom_identifier, else the call or reference id we stored."""
    rid = pl.custom_run_id(d)
    ids = {str(x) for x in (pl.get(d, "ref_id"), pl.get(d, "call_id"), pl.get(d, "uuid")) if x}
    async with db_client.async_session() as s:
        if rid:
            run = await s.get(WorkflowRunModel, rid)
            wf = await s.get(WorkflowModel, run.workflow_id) if run else None
            if run and wf and wf.organization_id == config.organization_id:
                return run.id
        if not ids:
            return None
        rows = (await s.scalars(
            select(WorkflowRunModel).join(WorkflowModel, WorkflowRunModel.workflow_id == WorkflowModel.id)
            .where(WorkflowModel.organization_id == config.organization_id, WorkflowRunModel.created_at > datetime.now(UTC) - timedelta(days=2))
            .order_by(WorkflowRunModel.id.desc()).limit(500))).all()
    for r in rows:
        gc = r.gathered_context or {}
        if ids & {str(gc.get(k)) for k in ("call_id", "smartflo_ref_id", "smartflo_call_sid", "smartflo_call_id") if gc.get(k)}:
            return r.id
    return None


@router.post("/smartflo/webhook/{key}", include_in_schema=False)
async def smartflo_webhook(key: str, request: Request):
    """Call details when a call ends: the outcome, how long it lasted, and the recording."""
    config = await find_config(key)
    if config is None:
        return JSONResponse(status_code=404, content={"status": "unknown endpoint"})
    d = pl.flatten(await read_payload(request))
    run_id = await find_run(config, d)
    if run_id is None:
        logger.info(f"Smartflo webhook for an unknown call: {sorted(d)[:12]}")
        return {"status": "ignored", "reason": "call_not_found"}
    set_current_run_id(run_id)
    run = await db_client.get_workflow_run_by_id(run_id)
    info = {k: v for k, v in {
        "recording_url": pl.get(d, "recording_url"), "duration": pl.get(d, "billsec", "answered_seconds", "duration"), "status": pl.call_status(d),
        "hangup_cause": pl.get(d, "hangup_cause_description", "hangup_cause_key", "reason"), "disposition": pl.get(d, "disposition"),
        "agent": pl.get(d, "answered_agent_name", "agent_name"),
    }.items() if v not in (None, "")}
    gc = {**(run.gathered_context or {}), "smartflo": {**((run.gathered_context or {}).get("smartflo") or {}), **info}}
    await db_client.update_workflow_run(run_id, gathered_context=gc)
    if not pl.is_final(d):
        return {"status": "stored"}
    await _process_status_update(run_id, StatusCallbackRequest(
        call_id=str(pl.get(d, "ref_id", "call_id", default="")), status=pl.call_status(d), from_number=pl.get(d, "caller_id_number", "customer_number"),
        to_number=pl.get(d, "call_to_number", "did_number"), direction=pl.get(d, "direction"), duration=str(info.get("duration") or ""), extra=d))
    return {"status": "success"}
