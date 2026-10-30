"""Public identifiers. Internal integer ids and platform uuids never leave the API."""

import hashlib
import secrets

_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789"


def new_public_id(prefix: str, length: int = 16) -> str:
    return f"{prefix}_" + "".join(secrets.choice(_ALPHABET) for _ in range(length))


def user_public_id(provider_id: str) -> str:
    """Stable, non-reversible id for a user derived from its internal provider id."""
    return "usr_" + hashlib.sha256(provider_id.encode()).hexdigest()[:16]
