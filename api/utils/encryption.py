import base64
import hashlib
import json
from typing import Any, Dict
from cryptography.fernet import Fernet
from api.constants import OSS_JWT_SECRET

# Derive a 32-byte url-safe base64 key from OSS_JWT_SECRET
key_bytes = hashlib.sha256(OSS_JWT_SECRET.encode("utf-8")).digest()
FERNET_KEY = base64.urlsafe_b64encode(key_bytes)
cipher = Fernet(FERNET_KEY)


def encrypt_data(data: str) -> str:
    """Encrypt plain text data to an encrypted string."""
    if not data:
        return ""
    return cipher.encrypt(data.encode("utf-8")).decode("utf-8")


def decrypt_data(token: str) -> str:
    """Decrypt an encrypted string to plain text."""
    if not token:
        return ""
    return cipher.decrypt(token.encode("utf-8")).decode("utf-8")


def encrypt_json(data: Dict[str, Any]) -> str:
    """Encrypt a JSON dict to an encrypted string."""
    return encrypt_data(json.dumps(data))


def decrypt_json(token: str) -> Dict[str, Any]:
    """Decrypt an encrypted string to a JSON dict."""
    decrypted = decrypt_data(token)
    if not decrypted:
        return {}
    return json.loads(decrypted)
