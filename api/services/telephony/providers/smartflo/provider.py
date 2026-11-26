"""Tata Smartflo implementation of the TelephonyProvider interface.

How a call reaches us (Smartflo "Voice Streaming"): Smartflo opens a WebSocket to a server we run. The address comes from a "dynamic endpoint":
Smartflo posts the call's numbers to our /smartflo/dynamic/{key} route, which answers within 2 seconds with a signed wss address for that call
(routes.py). Inbound calls start from the number's destination in the Smartflo portal. Outbound calls start with the Click to Call Support API
(initiate_call): Smartflo rings the customer, then connects the call to our endpoint. Call details and recordings arrive on a webhook.
"""

from __future__ import annotations

import json
import random
from typing import TYPE_CHECKING, Any, Dict, List, Optional

from fastapi import HTTPException
from loguru import logger

from api.db import db_client
from api.enums import WorkflowRunMode
from api.services.telephony.base import CallInitiationResult, NormalizedInboundData, ProviderSyncResult, TelephonyProvider
from api.utils.telephony_address import normalize_telephony_address

from . import api_client
from .payload import number_candidates, tail, ws_token_ok

if TYPE_CHECKING:
    from fastapi import WebSocket


class SmartfloProvider(TelephonyProvider):
    PROVIDER_NAME = WorkflowRunMode.SMARTFLO.value
    WEBHOOK_ENDPOINT = "smartflo/dynamic"  # not an answer URL: Smartflo calls our dynamic endpoint itself

    def __init__(self, config: Dict[str, Any]):
        self.account_token = config.get("account_token")
        self.click_to_call_key = config.get("click_to_call_key")
        self.click_to_call_keys = config.get("click_to_call_keys") or {}
        self.endpoint_key = config.get("endpoint_key")
        self.from_numbers = config.get("from_numbers", [])
        self.api_base = config.get("api_base") or api_client.SMARTFLO_API_BASE  # tests point this at a fake server
        if isinstance(self.from_numbers, str):
            self.from_numbers = [self.from_numbers]

    # ---- helpers
    def key_for(self, number: Optional[str]) -> Optional[str]:
        """The Click to Call key for a number (its own, else the account's default)."""
        for n, k in self.click_to_call_keys.items():
            if number and tail(n) == tail(number):
                return k
        return self.click_to_call_key

    # ---- outbound
    async def initiate_call(
        self,
        to_number: str,
        webhook_url: str,
        workflow_run_id: Optional[int] = None,
        from_number: Optional[str] = None,
        **kwargs: Any,
    ) -> CallInitiationResult:
        if not self.validate_config():
            raise ValueError("Smartflo provider not properly configured")
        from_number = from_number or random.choice(self.from_numbers)
        key = self.key_for(from_number)
        if not key:
            raise HTTPException(status_code=400, detail=f"No Click to Call API key is set for {from_number}")
        custom = {"run": str(workflow_run_id)} if workflow_run_id else None
        ok, data = await api_client.click_to_call(self.account_token, api_key=key, customer_number=to_number, caller_id=from_number, custom=custom, base=self.api_base)
        if not ok:
            raise HTTPException(status_code=400, detail=f"Failed to initiate Smartflo call: {data.get('message') or data}")
        ref_id = str(data["ref_id"])
        return CallInitiationResult(
            call_id=ref_id, status="queued", caller_number=from_number,
            provider_metadata={"call_id": ref_id, "smartflo_ref_id": ref_id}, raw_response=data,
        )

    async def get_call_status(self, call_id: str) -> Dict[str, Any]:
        rec = await api_client.call_record(self.account_token, call_id, base=self.api_base)
        return rec or {"status": "unknown"}

    async def get_available_phone_numbers(self) -> List[str]:
        return self.from_numbers

    def validate_config(self) -> bool:
        return bool(self.account_token and self.from_numbers)

    async def verify_webhook_signature(self, url: str, params: Dict[str, Any], signature: str) -> bool:
        return True  # Smartflo does not sign requests; our routes are protected by the secret endpoint key in their address

    async def get_webhook_response(self, workflow_id: int, user_id: int, workflow_run_id: int) -> str:
        return ""  # there is no answer URL: Smartflo asks our dynamic endpoint for the stream address

    async def get_call_cost(self, call_id: str) -> Dict[str, Any]:
        try:
            rec = await api_client.call_record(self.account_token, call_id, base=self.api_base)
        except Exception as e:  # noqa: BLE001
            return {"cost_usd": 0.0, "duration": 0, "status": "error", "error": str(e)}
        if not rec:
            return {"cost_usd": 0.0, "duration": 0, "status": "unknown"}
        return {
            "cost_usd": 0.0,  # Smartflo bills in rupees; the amount is in raw_response
            "duration": int(rec.get("answered_seconds") or rec.get("call_duration") or 0),
            "status": rec.get("status", "unknown"), "price_unit": "INR", "cost_inr": rec.get("charges"), "raw_response": rec,
        }

    def parse_status_callback(self, data: Dict[str, Any]) -> Dict[str, Any]:
        from .payload import call_status, flatten, get

        d = flatten(data)
        return {
            "call_id": str(get(d, "ref_id", "call_id", "uuid", default="")), "status": call_status(d),
            "from_number": get(d, "caller_id_number", "customer_number"), "to_number": get(d, "call_to_number", "did_number"),
            "direction": get(d, "direction"), "duration": get(d, "billsec", "answered_seconds", "duration"), "extra": data,
        }

    # ---- the stream
    async def handle_websocket(self, websocket: "WebSocket", workflow_id: int, user_id: int, workflow_run_id: int) -> None:
        from api.services.pipecat.run_pipeline import run_pipeline_telephony

        if not ws_token_ok(workflow_run_id, websocket.query_params.get("token")):
            logger.warning(f"[run {workflow_run_id}] Smartflo stream refused: bad token")
            await websocket.close(code=4401, reason="Unauthorized")
            return

        # Smartflo sends `connected`, then `start`
        start_msg: dict = {}
        for _ in range(5):
            try:
                msg = json.loads(await websocket.receive_text())
            except Exception:  # noqa: BLE001
                continue
            if msg.get("event") == "start":
                start_msg = msg
                break
        if not start_msg:
            await websocket.close(code=4400, reason="Expected start event")
            return
        start = start_msg.get("start", {})
        stream_sid = start.get("streamSid") or start_msg.get("streamSid")
        call_sid = start.get("callSid")
        if not stream_sid:
            await websocket.close(code=4400, reason="Missing streamSid")
            return

        run = await db_client.get_workflow_run(workflow_run_id)
        gc = dict((run.gathered_context if run else None) or {})
        ref_id = gc.get("smartflo_ref_id")
        call_id = gc.get("call_id") or call_sid  # outbound calls already hold Smartflo's ref_id as their call id
        gc.update({"call_id": call_id, "smartflo_call_sid": call_sid, "smartflo_stream_sid": stream_sid, "smartflo_connected": True})
        await db_client.update_workflow_run(workflow_run_id, gathered_context=gc)
        if not call_id:
            await websocket.close(code=4400, reason="Missing call id")
            return

        await run_pipeline_telephony(
            websocket, provider_name=self.PROVIDER_NAME, workflow_id=workflow_id, workflow_run_id=workflow_run_id, user_id=user_id,
            call_id=str(call_id), transport_kwargs={"stream_id": stream_sid, "call_id": call_sid or call_id, "ref_id": ref_id},
        )

    # ---- inbound
    @classmethod
    def can_handle_webhook(cls, webhook_data: Dict[str, Any], headers: Dict[str, str]) -> bool:
        return False  # Smartflo never posts to the shared /inbound/run address; it uses its own endpoint

    @staticmethod
    def parse_inbound_webhook(webhook_data: Dict[str, Any]) -> NormalizedInboundData:
        from .payload import flatten, get

        d = flatten(webhook_data)
        frm, to = get(d, "fromNumber", "from_number", "from", default=""), get(d, "toNumber", "to_number", "to", default="")

        def canon(x: str) -> str:
            try:
                return normalize_telephony_address(f"+{x.lstrip('+')}" if x and x.replace("+", "").isdigit() else x).canonical if x else ""
            except Exception:  # noqa: BLE001
                return x

        return NormalizedInboundData(
            provider=SmartfloProvider.PROVIDER_NAME, call_id=str(get(d, "callId", "call_id", default="")), from_number=canon(str(frm)), to_number=canon(str(to)),
            direction="inbound", call_status=str(get(d, "status", default="")), account_id=None, raw_data=webhook_data,
        )

    @staticmethod
    def validate_account_id(config_data: dict, webhook_account_id: str) -> bool:
        return bool(config_data.get("endpoint_key")) and config_data.get("endpoint_key") == webhook_account_id

    async def verify_inbound_signature(self, url: str, webhook_data: Dict[str, Any], headers: Dict[str, str], body: str = "") -> bool:
        return True

    async def start_inbound_stream(self, *, websocket_url: str, workflow_run_id: int, normalized_data, backend_endpoint: str):
        from fastapi.responses import JSONResponse

        return JSONResponse({"success": True, "wss_url": websocket_url})

    async def configure_inbound(self, address: str, webhook_url: Optional[str]) -> ProviderSyncResult:
        # The destination of a number is set in the Smartflo portal (My Numbers > Configure Destination); there is no API for it.
        return ProviderSyncResult(ok=True)

    @staticmethod
    def generate_error_response(error_type: str, message: str) -> tuple:
        from fastapi.responses import JSONResponse

        return JSONResponse(status_code=404, content={"success": False, "message": message})

    @staticmethod
    def generate_validation_error_response(error_type) -> tuple:
        from fastapi.responses import JSONResponse

        from api.errors.telephony_errors import TELEPHONY_ERROR_MESSAGES, TelephonyError

        message = TELEPHONY_ERROR_MESSAGES.get(error_type, TELEPHONY_ERROR_MESSAGES[TelephonyError.GENERAL_AUTH_FAILED])
        return JSONResponse(status_code=404, content={"success": False, "message": message})

    # ---- transfer to a person
    def supports_transfers(self) -> bool:
        return True

    async def transfer_call(self, destination: str, transfer_id: str, conference_name: str, timeout: int = 30, **kwargs: Any) -> Dict[str, Any]:
        """Move the live call to `destination` with Smartflo's Call Operations API (Transfer). Smartflo does it in one step and does not tell us
        when the other person answers, so success is reported to the transfer tool straight away; it then ends our side of the call."""
        from api.services.telephony.call_transfer_manager import get_call_transfer_manager
        from api.services.telephony.transfer_event_protocol import TransferEvent, TransferEventType

        manager = await get_call_transfer_manager()
        ctx = await manager.get_transfer_context(transfer_id)
        original = ctx.original_call_sid if ctx else ""
        ids: list[tuple[str, str]] = []
        run = await db_client.get_workflow_run(ctx.workflow_run_id) if ctx and ctx.workflow_run_id else None
        gc = (run.gathered_context if run else None) or {}
        for kind, value in (("ref_id", gc.get("smartflo_ref_id")), ("call_id", gc.get("smartflo_call_sid")), ("call_id", original), ("ref_id", original)):
            if value:
                ids.append((kind, str(value)))
        digits = "".join(c for c in destination if c.isdigit())  # Smartflo takes the number without a +
        done = await api_client.transfer(self.account_token, ids, digits, base=self.api_base) if ids else False
        event = TransferEvent(
            type=TransferEventType.DESTINATION_ANSWERED if done else TransferEventType.TRANSFER_FAILED, transfer_id=transfer_id, original_call_sid=original or "",
            transfer_call_sid=original or None, conference_name=conference_name, status="success" if done else "failed",
            action="destination_answered" if done else "transfer_failed", reason=None if done else "provider_rejected",
            message="Call transferred." if done else "Smartflo could not transfer the call.",
        )
        await manager.publish_transfer_event(event)
        return {"call_sid": original, "status": "initiated" if done else "failed", "provider": self.PROVIDER_NAME}
