"""Tata Smartflo telephony provider package."""

import secrets
from typing import Any, Dict

from api.services.telephony.registry import ProviderSpec, ProviderUIField, ProviderUIMetadata, register

from .config import SmartfloConfigurationRequest, SmartfloConfigurationResponse
from .provider import SmartfloProvider
from .transport import create_transport


def _config_loader(value: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "provider": "smartflo",
        "account_token": value.get("account_token"),
        "click_to_call_key": value.get("click_to_call_key"),
        "click_to_call_keys": value.get("click_to_call_keys") or {},
        "endpoint_key": value.get("endpoint_key"),
        "from_numbers": value.get("from_numbers", []),
    }


async def _ensure_endpoint_key(credentials: Dict[str, Any]) -> Dict[str, Any]:
    """Give the account its secret endpoint key on first save. It is part of the addresses Smartflo calls, so it must not be guessable."""
    if credentials.get("endpoint_key"):
        return credentials
    return {**credentials, "endpoint_key": secrets.token_urlsafe(24)}


_UI_METADATA = ProviderUIMetadata(
    display_name="Tata Smartflo",
    docs_url="https://docs.smartflo.tatatelebusiness.com/docs/bi-directional-audio-streaming-integration-document",
    fields=[
        ProviderUIField(name="account_token", label="Account API Token", type="password", sensitive=True,
                        description="Smartflo dashboard > API Connect > Account API Token"),
        ProviderUIField(name="click_to_call_key", label="Click to Call API Key", type="password", sensitive=True, required=False,
                        description="API Connect > Click to Call Support API. Its destination must be the Voice Bot endpoint. Needed for outbound calls."),
        ProviderUIField(name="endpoint_key", label="Endpoint key", type="text", required=False,
                        description="Generated for you on save. It is part of the addresses you give Smartflo."),
        ProviderUIField(name="from_numbers", label="Phone Numbers", type="string-array", description="E.164 Smartflo numbers (DIDs)"),
    ],
)

SPEC = ProviderSpec(
    name="smartflo",
    provider_cls=SmartfloProvider,
    config_loader=_config_loader,
    transport_factory=create_transport,
    transport_sample_rate=8000,
    config_request_cls=SmartfloConfigurationRequest,
    config_response_cls=SmartfloConfigurationResponse,
    ui_metadata=_UI_METADATA,
    account_id_credential_field="endpoint_key",
    preprocess_credentials_on_save=_ensure_endpoint_key,
)

register(SPEC)

__all__ = ["SPEC", "SmartfloConfigurationRequest", "SmartfloConfigurationResponse", "SmartfloProvider", "create_transport"]
