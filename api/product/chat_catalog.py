"""What chat agents can run on and what a message costs.

Only a reply the AI writes on its own (free-form text) is charged, per message. Scripted flow messages, buttons, the visitor's own messages and replies from a
person on your team are free. A model's price is per AI reply, not per word, so a long conversation is easy to estimate. Volume discounts apply to the
month's AI replies. Prices are in the wallet's currency and can be changed with environment variables without a release.
"""

from __future__ import annotations

import os

# key -> (label, provider, model id, tier, price per AI reply, who it suits)
_MODELS: list[tuple[str, str, str, str, float, str]] = [
    ("gpt-4.1-nano", "Swift", "openai", "fast", 0.25, "Very quick and cheap. Good for simple questions and menus."),
    ("gpt-4.1-mini", "Balanced", "openai", "balanced", 0.60, "The best mix of quality, speed and price. A good default."),
    ("gpt-4o-mini", "Everyday", "openai", "balanced", 0.60, "Friendly and fast. Strong at short, natural replies."),
    ("gpt-4.1", "Smart", "openai", "smart", 2.00, "Careful, thorough answers for harder questions and longer instructions."),
    ("gpt-4o", "Expert", "openai", "smart", 2.50, "Our most capable chat model. Best for sales and sensitive conversations."),
]
TIERS = {"fast": "Quick", "balanced": "Balanced", "smart": "Smart"}
DEFAULT_MODEL = "gpt-4.1-mini"

# Discount on the whole price once the workspace has used this many AI replies in the month.
SLABS: list[tuple[int, float, str]] = [(0, 0.0, "Up to 5,000 replies"), (5_000, 0.15, "5,001 to 25,000"), (25_000, 0.30, "25,001 to 100,000"), (100_000, 0.40, "More than 100,000")]


def _price(model: str, base: float) -> float:
    env = os.getenv("PRODUCT_CHAT_PRICE_" + model.upper().replace(".", "_").replace("-", "_"), "").strip()
    try:
        return round(float(env), 4) if env else base
    except ValueError:
        return base


def available() -> bool:
    """Chat agents run on the platform's own AI key."""
    return bool(os.getenv("PRODUCT_ASSISTANT_OPENAI_KEY", "").strip())


def catalogue() -> list[dict]:
    return [{"id": mid, "name": label, "provider": prov, "tier": tier, "tier_label": TIERS[tier], "price": _price(mid, base), "blurb": blurb} for mid, label, prov, tier, base, blurb in _MODELS]


BY_ID = {m["id"]: m for m in catalogue()}


def model_or_default(model: str | None) -> str:
    return model if model in BY_ID else DEFAULT_MODEL


def discount_for(month_replies: int) -> float:
    d = 0.0
    for floor, off, _ in SLABS:
        if month_replies >= floor:
            d = off
    return d


def price_for(model: str, month_replies: int = 0) -> float:
    """What the next AI reply costs, given how many have been used this month."""
    base = catalogue_price(model)
    return round(base * (1 - discount_for(month_replies)), 4)


def catalogue_price(model: str) -> float:
    return next((m["price"] for m in catalogue() if m["id"] == model), _price(DEFAULT_MODEL, 0.60))


def pricing() -> dict:
    return {"models": catalogue(), "slabs": [{"from": f, "discount": d, "label": lbl} for f, d, lbl in SLABS], "free": [
        "Scripted flow messages and buttons", "Everything your visitors write", "Replies from your team when they take over", "Knowledge lookups", "The website chat widget and WhatsApp",
    ], "currency": os.getenv("CURRENCY", "INR"), "per": "AI reply"}
