"""Smartflo call operation strategies for the frame serializer: hang up, and the end of a transfer."""

from typing import Any, Dict

from loguru import logger
from pipecat.serializers.call_strategies import HangupStrategy, TransferStrategy

from . import api_client


def call_ids(context: Dict[str, Any]) -> list[tuple[str, str]]:
    """Every identifier we have for the call, best first: the reference from click to call, then the call id from the stream."""
    ref, cid = context.get("ref_id"), context.get("call_id")
    return [("ref_id", ref), ("call_id", cid), ("ref_id", cid)] if ref or cid else []


class SmartfloHangupStrategy(HangupStrategy):
    """Hangs up the call with Smartflo's REST API."""

    async def execute_hangup(self, context: Dict[str, Any]) -> bool:
        token, ids = context.get("account_token"), call_ids(context)
        if not token or not ids:
            logger.warning("[Smartflo] hangup needs the account token and a call id")
            return False
        try:
            return await api_client.hangup(token, ids)
        except Exception as e:  # noqa: BLE001
            logger.error(f"[Smartflo] hangup error: {e}")
            return False


class SmartfloTransferStrategy(TransferStrategy):
    """The transfer itself already happened when the transfer tool called Smartflo (SmartfloProvider.transfer_call): Smartflo moves the live
    call to the destination in one step. All that is left when the pipeline ends is to clear the transfer record, and not to hang up."""

    async def execute_transfer(self, context: Dict[str, Any]) -> bool:
        try:
            from api.services.telephony.call_transfer_manager import get_call_transfer_manager

            manager = await get_call_transfer_manager()
            for cid in (context.get("call_id"), context.get("ref_id")):
                tc = await manager.find_transfer_context_for_call(cid) if cid else None
                if tc:
                    await manager.remove_transfer_context(tc.transfer_id)
                    break
        except Exception as e:  # noqa: BLE001 - the record expires on its own
            logger.warning(f"[Smartflo] could not clear the transfer record: {e}")
        return True
