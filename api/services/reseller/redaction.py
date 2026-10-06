"""Strip provider / model / vendor-cost details from API payloads.

Applied whenever the caller belongs to an organization with
``hide_model_details`` (resellers and their clients). The platform owner always
gets the full picture.
"""

from typing import Any

from fastapi import HTTPException

from api.services.reseller.context import models_hidden_var

_KEEP_USAGE = ("call_duration_seconds",)


def hidden() -> bool:
    """True while serving a request from a tenant that must not see model details."""
    return models_hidden_var.get()


def forbid_if_hidden() -> None:
    if hidden():
        raise HTTPException(
            status_code=403, detail="Not available - managed by your service provider."
        )


def cost_info_for_caller(cost_info: dict | None) -> dict | None:
    return public_cost_info(cost_info) if hidden() else cost_info


def usage_info_for_caller(usage_info: dict | None) -> dict | None:
    return public_usage_info(usage_info) if hidden() else usage_info


def public_cost_info(cost_info: dict | None) -> dict | None:
    """Only the call duration: no vendor costs, token counts or breakdowns."""
    if not cost_info:
        return cost_info
    return {k: cost_info.get(k) for k in _KEEP_USAGE if k in cost_info}


def public_usage_info(usage_info: dict | None) -> dict | None:
    if not usage_info:
        return usage_info
    return {k: usage_info.get(k) for k in _KEEP_USAGE if k in usage_info}


def redact_workflow_configurations(
    config: dict | None, profile_name: str | None = None
) -> dict | None:
    """Replace raw ``model_overrides`` with an opaque managed-by-platform marker."""
    if not config:
        return config
    redacted = {k: v for k, v in config.items() if k != "model_overrides"}
    if config.get("model_overrides"):
        redacted["model_overrides"] = {"managed": True}
    if profile_name:
        redacted["model_profile_name"] = profile_name
    return redacted


def redact_run_dict(run: dict[str, Any]) -> dict[str, Any]:
    """Redact a serialized workflow-run payload in place and return it."""
    if "cost_info" in run:
        run["cost_info"] = public_cost_info(run.get("cost_info"))
    if "usage_info" in run:
        run["usage_info"] = public_usage_info(run.get("usage_info"))
    for key in ("dograh_token_usage", "charge_usd", "total_cost_usd"):
        run.pop(key, None)
    return run
