"""Public identifiers. Internal integer ids and platform uuids never leave the API."""

import hashlib
import secrets

_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789"


def new_public_id(prefix: str, length: int = 16) -> str:
    return f"{prefix}_" + "".join(secrets.choice(_ALPHABET) for _ in range(length))


def user_public_id(provider_id: str) -> str:
    """Stable, non-reversible id for a user derived from its internal provider id."""
    return "usr_" + hashlib.sha256(provider_id.encode()).hexdigest()[:16]


def _call_tag(run_id: int) -> str:
    import hmac

    from api.constants import OSS_JWT_SECRET

    return hmac.new(OSS_JWT_SECRET.encode(), f"call:{run_id}".encode(), "sha256").hexdigest()[:8]


def encode_call_id(run_id: int) -> str:
    """Opaque public call id. Reversible by the server only, and tamper-evident."""
    return f"call_{run_id:x}{_call_tag(run_id)}"


def decode_call_id(public_id: str) -> int | None:
    import hmac

    if not public_id.startswith("call_") or len(public_id) < 5 + 1 + 8:
        return None
    body = public_id[5:]
    head, tag = body[:-8], body[-8:]
    try:
        run_id = int(head, 16)
    except ValueError:
        return None
    return run_id if hmac.compare_digest(tag, _call_tag(run_id)) else None
