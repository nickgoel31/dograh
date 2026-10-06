from typing import Dict

from loguru import logger

from api.services.billing import wallet_service


async def reconcile_wallets(ctx: Dict) -> None:
    """Cron: bill completed calls that never made it into the wallet ledger."""
    try:
        await wallet_service.reconcile_unbilled_runs()
    except Exception as exc:  # noqa: BLE001
        logger.error(f"Wallet reconcile cron failed: {exc}")
