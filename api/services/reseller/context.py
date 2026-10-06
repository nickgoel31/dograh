"""Request-scoped flag: hide provider / model / vendor-cost details.

Set once per authenticated request by ``get_user`` and read by the response
builders, so a redaction rule cannot be forgotten on any single endpoint.
"""

from contextvars import ContextVar

models_hidden_var: ContextVar[bool] = ContextVar("models_hidden", default=False)
