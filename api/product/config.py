"""Product-level configuration. Brand and defaults come from env, never code."""

import os

PRODUCT_NAME = os.getenv("PRODUCT_NAME", "Vocalis")
SESSION_COOKIE_NAME = os.getenv("PRODUCT_SESSION_COOKIE", "vocalis_session")
# Secure cookies everywhere except local development over plain HTTP.
SESSION_COOKIE_SECURE = os.getenv("PRODUCT_COOKIE_SECURE", "true").lower() == "true"
SESSION_COOKIE_SAMESITE = os.getenv("PRODUCT_COOKIE_SAMESITE", "lax")
SESSION_MAX_AGE_SECONDS = int(os.getenv("PRODUCT_SESSION_HOURS", "720")) * 3600

WORKSPACE_HEADER = "X-Workspace"
ENVIRONMENT_HEADER = "X-Environment"
DEFAULT_ENVIRONMENT = "test"

PRICE_PER_MIN = float(os.getenv("PRICE_PER_MIN", "6"))
CURRENCY = os.getenv("CURRENCY", "INR")
