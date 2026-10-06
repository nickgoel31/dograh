"""Vonage telephony configuration schemas."""

from typing import Optional, List, Literal

from pydantic import BaseModel, Field


class VonageConfigurationRequest(BaseModel):
    """Request schema for Vonage configuration."""

    provider: Literal["vonage"] = Field(default="vonage")
    api_key: str = Field(..., description="Vonage API Key")
    api_secret: str = Field(..., description="Vonage API Secret")
    application_id: str = Field(..., description="Vonage Application ID")
    private_key: str = Field(..., description="Private key for JWT generation")
    from_numbers: List[str] = Field(
        default_factory=list,
        description="List of Vonage phone numbers (without + prefix)",
    )
    signature_secret: Optional[str] = Field(
        default=None,
        description=(
            "Vonage signature secret used to verify signed webhooks "
            "(Authorization: Bearer JWT). Strongly recommended."
        ),
    )


class VonageConfigurationResponse(BaseModel):
    """Response schema for Vonage configuration with masked sensitive fields."""

    provider: Literal["vonage"] = Field(default="vonage")
    application_id: str  # Not sensitive, can show full
    api_key: str  # Masked
    api_secret: str  # Masked
    private_key: str  # Masked
    from_numbers: List[str]
    signature_secret: Optional[str] = None  # Masked
