"""Tata Smartflo telephony configuration schemas."""

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class SmartfloConfigurationRequest(BaseModel):
    """Request schema for Tata Smartflo configuration."""

    provider: Literal["smartflo"] = Field(default="smartflo")
    account_token: str = Field(..., description="Smartflo Account API Token (API Connect in the Smartflo dashboard)")
    click_to_call_key: Optional[str] = Field(
        default=None,
        description="Click to Call Support API Key whose destination is the Voice Streaming endpoint. Used for every number unless one is set below.",
    )
    click_to_call_keys: Dict[str, str] = Field(default_factory=dict, description="A Click to Call key per number, when numbers use different keys")
    endpoint_key: Optional[str] = Field(
        default=None,
        description="Secret that identifies this account in the endpoint and webhook addresses. Generated on save.",
    )
    from_numbers: List[str] = Field(default_factory=list, description="Smartflo numbers (DIDs) in E.164 format")


class SmartfloConfigurationResponse(BaseModel):
    """Response schema for Tata Smartflo configuration with masked sensitive fields."""

    provider: Literal["smartflo"] = Field(default="smartflo")
    account_token: str  # Masked
    click_to_call_key: Optional[str] = None  # Masked
    click_to_call_keys: Dict[str, str] = Field(default_factory=dict)  # Masked
    endpoint_key: Optional[str] = None
    from_numbers: List[str]
