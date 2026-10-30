"""Product layer: the white-label API the customer-facing web app talks to.

Kept separate from the core platform modules so upstream merges stay small.
It only touches core code through ``api.routes.main`` (one include) and
``api.alembic.env`` (one import).
"""
