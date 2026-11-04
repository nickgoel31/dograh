"""Identity verification (KYC) for buying phone numbers where the carrier requires it (India by default).

The customer fills in business details and uploads documents. We keep them for review. The operator checks them against
the carrier's own process, then approves or rejects here. Until a workspace is approved it can't buy numbers in those countries.
"""

import base64
import json
import logging
import os
import re
import secrets
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Header, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select

from api.db.product_models import ProductKycModel, ProductWorkspaceModel
from api.product import audit, emailer, plivo_kyc
from api.product.deps import Ctx, get_ctx, get_session, require
from api.product.errors import product_error
from api.product.notifications import notify
from api.product.roles import Perm

log = logging.getLogger(__name__)
router = APIRouter(prefix="/product/kyc", tags=["kyc"])
hooks_router = APIRouter(prefix="/product/hooks", tags=["kyc"])
ops_router = APIRouter(prefix="/product/ops/kyc", tags=["ops"])
MAX_DOC = 2_500_000
DOC_KINDS = {"pan": "PAN card", "address_proof": "Address proof", "business_proof": "Business registration", "gst": "GST certificate"}
TYPES = ("individual", "sole_proprietor", "partnership", "company")


def prefixes() -> list[str]:
    """Number prefixes that need KYC. Set PRODUCT_KYC_PREFIXES to change (comma separated), or to 'none' to turn KYC off."""
    raw = os.getenv("PRODUCT_KYC_PREFIXES", "+91").strip()
    return [] if raw.lower() == "none" else [p.strip() for p in raw.split(",") if p.strip()]


def needed_for(number: str) -> bool:
    return any(number.startswith(p) for p in prefixes())


async def get_row(session, workspace_id: int) -> ProductKycModel | None:
    return await session.get(ProductKycModel, workspace_id)


async def is_approved(session, workspace_id: int) -> bool:
    row = await get_row(session, workspace_id)
    return bool(row and row.status == "approved")


class DocIn(BaseModel):
    kind: str
    name: str = Field(max_length=120)
    mime: str = Field(max_length=60)
    data_b64: str = Field(max_length=4_000_000)


class KycBody(BaseModel):
    business_name: str = Field(min_length=2, max_length=160)
    business_type: str
    contact_name: str = Field(min_length=2, max_length=120)
    contact_email: str = Field(min_length=5, max_length=160, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    contact_phone: str = Field(min_length=7, max_length=20)
    address: str = Field(min_length=5, max_length=300)
    city: str = Field(min_length=2, max_length=80)
    state: str = Field(min_length=2, max_length=80)
    postal_code: str = Field(min_length=3, max_length=12)
    pan: str = Field(min_length=10, max_length=10)
    gstin: str | None = Field(default=None, max_length=15)
    documents: list[DocIn] = Field(default_factory=list, max_length=6)


class KycOut(BaseModel):
    required_for: list[str]
    status: str  # none | submitted | approved | rejected
    note: str | None = None
    data: dict = {}
    documents: list[dict] = []
    submitted_at: str | None = None
    auto: bool = False  # the carrier checks it automatically (business papers are then required)


def _mask(pan: str) -> str:
    return pan[:2] + "******" + pan[-2:] if len(pan) == 10 else ""


def _view(row: ProductKycModel | None) -> KycOut:
    if row is None:
        return KycOut(required_for=prefixes(), status="none", auto=plivo_kyc.enabled())
    d = {k: v for k, v in (row.data or {}).items() if k not in ("plivo_id", "auto_error", "checked_at")}
    return KycOut(required_for=prefixes(), status=row.status, note=row.note, data={**d, "pan": _mask(d.get("pan", ""))},
                  documents=[{"kind": x["kind"], "label": DOC_KINDS.get(x["kind"], x["kind"]), "name": x["name"]} for x in row.docs or []],
                  submitted_at=row.submitted_at.isoformat() if row.submitted_at else None, auto=plivo_kyc.enabled())


@router.get("", response_model=KycOut)
async def status(ctx: Ctx = Depends(get_ctx), comp=Depends(plivo_kyc.get_compliance), mailer: emailer.Mailer = Depends(emailer.get_mailer)):
    row = await get_row(ctx.session, ctx.workspace.id)
    if row is not None and comp is not None and row.status == "submitted" and (row.data or {}).get("plivo_id"):
        last = float((row.data or {}).get("checked_at") or 0)
        if datetime.now(UTC).timestamp() - last > 60:  # ask the carrier at most once a minute
            await sync_one(ctx.session, row, comp, mailer)
    return _view(row)


async def _finish(session, row: ProductKycModel, new: str, note: str | None, mailer: emailer.Mailer | None) -> None:
    """Record an approval or rejection and tell the customer."""
    row.status, row.note, row.reviewed_at = new, (note or "").strip()[:400] or None, datetime.now(UTC)
    ok = new == "approved"
    await notify(session, row.workspace_id, "kyc", "Verification approved" if ok else "Verification needs changes",
                 "You can now buy numbers in India." if ok else (row.note or "Open Phone Numbers to see what to fix."), "/numbers", f"kyc-dec:{int(row.reviewed_at.timestamp())}")
    await session.commit()
    to = (row.data or {}).get("contact_email")
    if to and mailer is not None:
        await mailer.send(to, "Your verification was approved" if ok else "Your verification needs changes",
                          "You can now buy phone numbers." if ok else f"Please fix this and submit again: {row.note}")


async def sync_one(session, row: ProductKycModel, comp, mailer: emailer.Mailer | None) -> bool:
    """Ask the carrier how a verification is going and record the answer. True when it was decided."""
    pid = (row.data or {}).get("plivo_id")
    if not pid:
        return False
    row.data = {**(row.data or {}), "checked_at": datetime.now(UTC).timestamp()}
    try:
        new, why = await comp.status(pid)
    except Exception as e:  # noqa: BLE001 - try again on the next check
        log.warning("kyc status check failed for workspace %s: %s", row.workspace_id, e)
        await session.commit()
        return False
    if new == "submitted":
        await session.commit()
        return False
    await _finish(session, row, new, why if new == "rejected" else None, mailer)
    return True


async def sync_all(session, comp, mailer: emailer.Mailer | None) -> int:
    """Part of the scheduled job: settle every verification the carrier is checking."""
    if comp is None:
        return 0
    rows = (await session.scalars(select(ProductKycModel).where(ProductKycModel.status == "submitted"))).all()
    done = 0
    for r in rows:
        if (r.data or {}).get("plivo_id") and await sync_one(session, r, comp, mailer):
            done += 1
    return done


@hooks_router.post("/plivo-kyc")
async def plivo_callback(request: Request, session=Depends(get_session), comp=Depends(plivo_kyc.get_compliance), mailer: emailer.Mailer = Depends(emailer.get_mailer)):
    """The carrier tells us a verification changed. We never trust what the message says: we ask the carrier directly."""
    if comp is None:
        return {"ok": True}
    cid = None
    try:
        text = (await request.body()).decode("utf-8", "ignore")
        try:
            j = json.loads(text)
            cid = (j.get("compliance_id") or (j.get("data") or {}).get("compliance_id")) if isinstance(j, dict) else None
        except ValueError:
            m = re.search(r"compliance_id=([0-9a-fA-F-]{8,})", text)
            cid = m.group(1) if m else None
    except Exception:  # noqa: BLE001
        cid = None
    rows = (await session.scalars(select(ProductKycModel).where(ProductKycModel.status == "submitted"))).all()
    for r in rows:
        if (r.data or {}).get("plivo_id") and (not cid or (r.data or {}).get("plivo_id") == cid):
            await sync_one(session, r, comp, mailer)
    return {"ok": True}


@router.put("", response_model=KycOut)
async def submit(body: KycBody, ctx: Ctx = Depends(require(Perm.BILLING_MANAGE)), mailer: emailer.Mailer = Depends(emailer.get_mailer), comp=Depends(plivo_kyc.get_compliance)):
    row = await get_row(ctx.session, ctx.workspace.id)
    if row is not None and row.status == "approved":
        raise product_error(409, "kyc_approved", "Your verification is already approved. Contact support to change it.")
    if body.business_type not in TYPES:
        raise product_error(400, "bad_type", "Choose the kind of business.")
    pan = body.pan.strip().upper()
    if not re.fullmatch(r"[A-Z]{5}[0-9]{4}[A-Z]", pan):
        raise product_error(400, "bad_pan", "That PAN doesn't look right. It has 5 letters, 4 numbers and 1 letter, like ABCDE1234F.")
    gst = (body.gstin or "").strip().upper() or None
    if gst and not re.fullmatch(r"[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]", gst):
        raise product_error(400, "bad_gstin", "That GST number doesn't look right. It has 15 characters.")
    docs = []
    for d in body.documents:
        if d.kind not in DOC_KINDS or d.mime not in ("application/pdf", "image/jpeg", "image/png"):
            raise product_error(400, "bad_document", "Upload PDF, JPG or PNG files only.")
        try:
            raw = base64.b64decode(d.data_b64, validate=True)
        except ValueError:
            raise product_error(400, "bad_document", "We couldn't read one of the files. Try uploading it again.")
        if len(raw) > MAX_DOC or not raw:
            raise product_error(400, "document_too_big", "Each file must be under 2.5 MB.")
        docs.append({"kind": d.kind, "name": d.name, "mime": d.mime, "b64": d.data_b64})
    kinds = {x["kind"] for x in docs}
    have_before = {x["kind"] for x in (row.docs or [])} if row else set()
    if not ({"pan"} <= (kinds | have_before)) or not ({"address_proof"} <= (kinds | have_before)):
        raise product_error(400, "documents_missing", "Please upload your PAN card and an address proof.")
    if row is not None and not docs:
        docs = row.docs or []
    if comp is not None and plivo_kyc.needs_business_papers(body.business_type):
        if not {"business_proof", "gst"} <= (kinds | have_before) or not gst:
            raise product_error(400, "documents_missing", "For a business we also need your registration certificate, your GST certificate and your GST number.")
    data = {**body.model_dump(exclude={"documents"}), "pan": pan, "gstin": gst}
    if comp is not None:
        from api.constants import BACKEND_API_ENDPOINT

        merged = {d["kind"]: d for d in (row.docs if row and row.docs else [])}
        merged.update({d["kind"]: d for d in docs})
        try:
            data["plivo_id"] = await comp.submit(data, list(merged.values()), f"{BACKEND_API_ENDPOINT}/api/v1/product/hooks/plivo-kyc")
            data["auto"] = True
        except Exception as e:  # noqa: BLE001 - a person reviews it instead, as before
            data["auto_error"] = str(e)[:300]
            log.warning("automatic KYC submission failed for workspace %s: %s", ctx.workspace.id, e)
    now = datetime.now(UTC)
    if row is None:
        row = ProductKycModel(workspace_id=ctx.workspace.id)
        ctx.session.add(row)
    row.status, row.data, row.docs, row.note, row.submitted_at, row.reviewed_at = "submitted", data, docs, None, now, None
    await audit.record(ctx.session, ctx.workspace.id, ctx.user.id, "kyc.submitted", None)
    await notify(ctx.session, ctx.workspace.id, "kyc", "Verification received", "We'll review your documents and tell you here, usually within 1-2 working days.", "/numbers", f"kyc-sub:{int(now.timestamp())}")
    await ctx.session.commit()
    to = os.getenv("PRODUCT_KYC_NOTIFY", "").strip()
    if to and not (row.data or {}).get("plivo_id"):  # when the carrier is checking it, nobody else needs to
        failed = (row.data or {}).get("auto_error")
        await mailer.send(to, "New KYC to review", f"{ctx.workspace.name} (workspace {ctx.workspace.id}) submitted KYC: {body.business_name}." + (f" The automatic check failed: {failed}" if failed else ""))
    return _view(row)


# ---- the operator's side (same secret as the scheduled job) ----

def _ops(secret: str | None) -> None:
    want = os.getenv("PRODUCT_OPS_SECRET")
    if not want:
        raise product_error(404, "not_found", "Not found.")
    if not secret or not secrets.compare_digest(secret, want):
        raise product_error(401, "bad_ops_secret", "Not allowed.")


@ops_router.get("")
async def pending(status: str = "submitted", x_ops_secret: str | None = Header(default=None), session=Depends(get_session)):
    _ops(x_ops_secret)
    rows = (await session.execute(select(ProductKycModel, ProductWorkspaceModel).join(ProductWorkspaceModel, ProductWorkspaceModel.id == ProductKycModel.workspace_id).where(ProductKycModel.status == status))).all()
    return [{"workspace_id": k.workspace_id, "workspace": w.name, "business": (k.data or {}).get("business_name"), "type": (k.data or {}).get("business_type"), "pan": (k.data or {}).get("pan"), "gstin": (k.data or {}).get("gstin"),
             "contact": (k.data or {}).get("contact_name"), "email": (k.data or {}).get("contact_email"), "phone": (k.data or {}).get("contact_phone"),
             "address": ", ".join(str((k.data or {}).get(x, "")) for x in ("address", "city", "state", "postal_code")), "documents": [d["name"] for d in k.docs or []],
             "submitted_at": k.submitted_at.isoformat() if k.submitted_at else None} for k, w in rows]


@ops_router.get("/{workspace_id}/documents/{index}")
async def document(workspace_id: int, index: int, x_ops_secret: str | None = Header(default=None), session=Depends(get_session)):
    _ops(x_ops_secret)
    row = await get_row(session, workspace_id)
    if row is None or not 0 <= index < len(row.docs or []):
        raise product_error(404, "not_found", "Not found.")
    d = row.docs[index]
    return Response(base64.b64decode(d["b64"]), media_type=d["mime"], headers={"Content-Disposition": f'attachment; filename="{re.sub(r"[^A-Za-z0-9._-]", "_", d["name"])}"'})


class Decision(BaseModel):
    status: str = Field(pattern="^(approved|rejected)$")
    note: str | None = Field(default=None, max_length=400)


@ops_router.post("/{workspace_id}")
async def decide(workspace_id: int, body: Decision, x_ops_secret: str | None = Header(default=None), session=Depends(get_session), mailer: emailer.Mailer = Depends(emailer.get_mailer)):
    _ops(x_ops_secret)
    row = await get_row(session, workspace_id)
    if row is None:
        raise product_error(404, "not_found", "Not found.")
    if body.status == "rejected" and not (body.note or "").strip():
        raise product_error(400, "note_needed", "Say why, so the customer knows what to fix.")
    row.status, row.note, row.reviewed_at = body.status, (body.note or "").strip() or None, datetime.now(UTC)
    ok = body.status == "approved"
    await notify(session, workspace_id, "kyc", "Verification approved" if ok else "Verification needs changes",
                 "You can now buy numbers in India." if ok else (row.note or "Open Phone Numbers to see what to fix."), "/numbers", f"kyc-dec:{int(row.reviewed_at.timestamp())}")
    await session.commit()
    to = (row.data or {}).get("contact_email")
    if to:
        await mailer.send(to, "Your verification was approved" if ok else "Your verification needs changes",
                          "You can now buy phone numbers." if ok else f"Please fix this and submit again: {row.note}")
    return {"ok": True}
