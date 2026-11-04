"""Automatic identity verification for Indian numbers, through Plivo's Compliance API.

When Plivo is the number carrier, the customer's verification is sent to Plivo as soon as they submit it, and Plivo's answer
(accepted or rejected, with a reason) comes back on its own. Anything that goes wrong here leaves the verification waiting for a
person to review, exactly as before, so this can only make things faster.
"""

import base64
import json
import logging
import os
import re

log = logging.getLogger(__name__)

# What a document the customer uploaded is called on our side, matched by words in Plivo's own name for the document.
KIND_WORDS = (
    ("gst", ("gst",)),
    ("business_proof", ("registration", "incorporation", "udyam", "partnership", "business")),
    ("pan", ("pan",)),
    ("address_proof", ("address",)),
)
STATUS = {"accepted": "approved", "rejected": "rejected", "suspended": "rejected", "expired": "rejected"}


class ComplianceError(Exception):
    pass


def enabled() -> bool:
    return os.getenv("PRODUCT_KYC_AUTO", "1") != "0" and bool(os.getenv("PRODUCT_PLIVO_AUTH_ID") and os.getenv("PRODUCT_PLIVO_AUTH_TOKEN"))


def user_type(business_type: str) -> str:
    return "individual" if business_type in ("individual", "sole_proprietor") else "business"


def needs_business_papers(business_type: str) -> bool:
    return user_type(business_type) == "business"


def _doc_types(obj) -> list[dict]:
    """Plivo's list of required documents, wherever the reply puts it."""
    found: list[dict] = []

    def walk(o):
        if isinstance(o, dict):
            ident = o.get("document_type_id") or (o.get("id") if ("proof_required" in o or "data_fields" in o) else None)
            if ident:
                found.append({"id": str(ident), "name": str(o.get("name") or o.get("document_name") or o.get("document_type") or o.get("label") or ""),
                              "required": bool(o.get("proof_required", True)),
                              "fields": [str(f.get("field_name") or f.get("name")) for f in (o.get("data_fields") or []) if isinstance(f, dict)]})
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    walk(obj)
    seen, out = set(), []
    for d in found:
        if d["id"] not in seen:
            seen.add(d["id"])
            out.append(d)
    return out


def kind_of(name: str) -> str | None:
    low = name.lower()
    for kind, words in KIND_WORDS:
        if any(w in low for w in words):
            return kind
    return None


class PlivoCompliance:
    def __init__(self, auth_id: str, auth_token: str, transport=None):
        self._id, self._token, self._transport = auth_id, auth_token, transport

    def _client(self):
        import httpx

        return httpx.AsyncClient(base_url=f"https://api.plivo.com/v1/Account/{self._id}/PhoneNumber/Compliance/", auth=(self._id, self._token), timeout=40, transport=self._transport)

    async def requirements(self, business_type: str) -> list[dict]:
        async with self._client() as c:
            r = await c.get("Requirements", params={"country_iso": "IN", "number_type": "local", "user_type": user_type(business_type)})
        if r.status_code >= 400:
            raise ComplianceError(f"requirements {r.status_code}: {r.text[:200]}")
        return _doc_types(r.json())

    async def submit(self, data: dict, docs: list[dict], callback_url: str | None) -> str:
        """Send the verification. Returns Plivo's compliance id. Raises ComplianceError with a reason we can show the operator."""
        required = await self.requirements(data["business_type"])
        if not required:
            raise ComplianceError("Plivo returned no document list for this kind of customer")
        have = {d["kind"]: d for d in docs}
        meta, files, used = [], {}, set()
        for i, t in enumerate(required):
            kind = kind_of(t["name"])
            d = have.get(kind) if kind else None
            if d is None or d["name"] in used:
                if t["required"]:
                    raise ComplianceError(f"missing a document Plivo needs: {t['name']}")
                continue
            used.add(d["name"])
            fields = {}
            for f in t["fields"]:
                v = {"business_name": data.get("business_name"), "gstin": data.get("gstin"), "pan": data.get("pan"), "address": data.get("address")}.get(f)
                if v:
                    fields[f] = v
            meta.append({"document_type_id": t["id"], **({"data_fields": fields} if fields else {})})
            files[f"documents[{len(meta) - 1}].file"] = (re.sub(r"[^A-Za-z0-9._-]", "_", d["name"])[:90] or "document", base64.b64decode(d["b64"]), d["mime"])
        body = {"country_iso": "IN", "number_type": "local", "alias": (data.get("business_name") or "customer")[:60],
                "end_user": {"type": user_type(data["business_type"]), "name": data["business_name"]}, "documents": meta}
        if callback_url and callback_url.startswith("https://"):
            body["callback_url"], body["callback_method"] = callback_url, "POST"
        async with self._client() as c:
            r = await c.post("", data={"data": json.dumps(body)}, files=files)
        if r.status_code not in (200, 201, 202):
            raise ComplianceError(f"submit {r.status_code}: {r.text[:300]}")
        cid = (r.json() or {}).get("compliance_id")
        if not cid:
            raise ComplianceError("Plivo accepted the request but sent no application id")
        return str(cid)

    async def status(self, compliance_id: str) -> tuple[str, str | None]:
        """('submitted' | 'approved' | 'rejected', reason)."""
        async with self._client() as c:
            r = await c.get(compliance_id)
        if r.status_code >= 400:
            raise ComplianceError(f"status {r.status_code}")
        j = r.json() or {}
        s = str(j.get("status", "")).lower()
        return STATUS.get(s, "submitted"), (j.get("rejection_reason") or None)

    async def link(self, number: str, compliance_id: str) -> None:
        async with self._client() as c:
            r = await c.post("Link/", json={"numbers": [{"number": number.lstrip("+"), "compliance_application_id": compliance_id}]})
        if r.status_code >= 400:
            raise ComplianceError(f"link {r.status_code}: {r.text[:200]}")


def get_compliance() -> "PlivoCompliance | None":
    """The seam tests replace. None when automatic verification is off or Plivo isn't the carrier."""
    if not enabled():
        return None
    return PlivoCompliance(os.environ["PRODUCT_PLIVO_AUTH_ID"], os.environ["PRODUCT_PLIVO_AUTH_TOKEN"])
