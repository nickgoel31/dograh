"""Swarvo AI: a tiny Python client for the public API. One file, no dependencies.

    from swarvo import Swarvo
    client = Swarvo("sk_test_...", base_url="https://app.swarvoai.com/api/v1")
    for call in client.calls(limit=10)["calls"]:
        print(call["id"], call["duration"], call["outcome"])

Keys that start with sk_test_ read your Test data; sk_live_ keys read your Live data.
"""

import hashlib
import hmac
import json
import time
import urllib.error
import urllib.parse
import urllib.request


class SwarvoError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(f"{status} {code}: {message}")
        self.status, self.code, self.message = status, code, message


class Swarvo:
    def __init__(self, api_key: str, base_url: str = "https://app.swarvoai.com/api/v1", timeout: float = 30.0, retries: int = 2):
        self.api_key, self.base_url, self.timeout, self.retries = api_key, base_url.rstrip("/"), timeout, retries

    def _get(self, path: str, params: dict | None = None):
        url = f"{self.base_url}/public{path}"
        if params:
            url += "?" + urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {self.api_key}", "Accept": "application/json"})
        for attempt in range(self.retries + 1):
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as r:
                    return json.loads(r.read().decode())
            except urllib.error.HTTPError as e:
                body = {}
                try:
                    body = json.loads(e.read().decode()).get("detail") or {}
                except Exception:  # noqa: BLE001
                    pass
                if e.code in (429, 502, 503, 504) and attempt < self.retries:
                    time.sleep(2**attempt)  # too many requests or a brief hiccup: wait and try again
                    continue
                code, msg = (body.get("code"), body.get("message")) if isinstance(body, dict) else (None, str(body))
                raise SwarvoError(e.code, code or "error", msg or e.reason) from None

    def me(self) -> dict:
        """Which workspace and environment (test or live) this key belongs to."""
        return self._get("/me")

    def agents(self) -> list[dict]:
        return self._get("/agents")

    def calls(self, page: int = 1, limit: int = 25, agent: str | None = None) -> dict:
        return self._get("/calls", {"page": page, "limit": limit, "agent": agent})

    def call(self, call_id: str) -> dict:
        """One call with its transcript, summary and extracted details."""
        return self._get(f"/calls/{call_id}")

    def all_calls(self, agent: str | None = None, page_size: int = 100):
        """Every call, one at a time, fetching pages as needed."""
        page = 1
        while True:
            data = self.calls(page=page, limit=page_size, agent=agent)
            yield from data["calls"]
            if page * page_size >= data["total"] or not data["calls"]:
                return
            page += 1


def verify_webhook(secret: str, header: str, body: bytes, tolerance: int = 300) -> bool:
    """Check a webhook really came from Swarvo. `header` is the signature header: t=<unix time>,v1=<hex>."""
    try:
        parts = dict(p.split("=", 1) for p in header.split(","))
        ts, sig = int(parts["t"]), parts["v1"]
    except (KeyError, ValueError):
        return False
    if abs(time.time() - ts) > tolerance:
        return False
    expected = hmac.new(secret.encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sig)
