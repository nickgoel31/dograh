from typing import Dict, List, Optional

from pydantic import BaseModel


class TierConfig(BaseModel):
    label: str
    maxCalls: Optional[int] = None  # None represents Infinity


class BillingPrices(BaseModel):
    per_minute: float
    per_30s: float


class BillingConfigurationRequest(BaseModel):
    tiers: List[TierConfig]
    prices: Dict[str, BillingPrices]


class BillingConfigurationResponse(BaseModel):
    tiers: List[TierConfig]
    prices: Dict[str, BillingPrices]
    configured: bool = False
