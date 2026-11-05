"""Billing logic: usage from the platform ledger, spend limit, GST invoices. The platform wallet does the debiting."""

import io
import logging
import os
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api.db.models import OrganizationModel, WalletLedgerModel
from api.db.product_models import ProductBillingSettingsModel, ProductInvoiceModel, ProductPracticeChargeModel, ProductWorkspaceModel
from api.product import config, phone_verify
from api.product.payments import WalletGateway

log = logging.getLogger(__name__)


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, "") or default)
    except ValueError:
        return default


def free_minutes() -> float:
    return _env_float("PRODUCT_FREE_MINUTES", 0.0)


def signup_bonus() -> float:
    """Money given to a new account (in the billing currency). 0 turns it off."""
    return _env_float("PRODUCT_SIGNUP_BONUS", 100.0)


def signup_bonus_limit() -> int:
    """Only this many accounts ever get the bonus."""
    return int(_env_float("PRODUCT_SIGNUP_BONUS_LIMIT", 1000))


async def bonus_given(session: AsyncSession) -> int:
    return await session.scalar(select(func.count()).select_from(ProductBillingSettingsModel).where(ProductBillingSettingsModel.signup_bonus_at.is_not(None))) or 0


async def bonus_left(session: AsyncSession) -> int:
    if signup_bonus() <= 0:
        return 0
    return max(0, signup_bonus_limit() - await bonus_given(session))


def gst_rate() -> float:
    return _env_float("PRODUCT_GST_RATE", 18.0)


def seller() -> dict:
    g = os.getenv
    return {"name": g("PRODUCT_SELLER_NAME", ""), "gstin": g("PRODUCT_SELLER_GSTIN", ""),
            "address": g("PRODUCT_SELLER_ADDRESS", ""), "state": g("PRODUCT_SELLER_STATE", ""), "sac": g("PRODUCT_INVOICE_SAC", "")}


async def get_settings(session: AsyncSession, ws: ProductWorkspaceModel) -> ProductBillingSettingsModel:
    s = await session.get(ProductBillingSettingsModel, ws.id)
    if s is None:
        try:  # two requests can arrive together on a new workspace; the loser reads the winner's row
            async with session.begin_nested():
                s = ProductBillingSettingsModel(workspace_id=ws.id, auto_topup_enabled=False, first_grant_done=False)
                session.add(s)
            await session.flush()
        except IntegrityError:
            s = await session.get(ProductBillingSettingsModel, ws.id)
    return s


async def ensure_billing(session: AsyncSession, wallet: WalletGateway, ws: ProductWorkspaceModel) -> None:
    """Live org bills at the product price; Test org never bills. Also gives any free trial minutes once. Caller commits."""
    org = await session.get(OrganizationModel, ws.live_org_id)
    if org is not None and not org.wallet_enabled and not ws.adopted:
        org.wallet_enabled = True
        org.billing_rate = config.PRICE_PER_MIN
        org.billing_currency = config.CURRENCY
        org.billing_pulse = 60
        org.allow_overdraft = False
    s = await get_settings(session, ws)
    if s.first_grant_done:
        return
    # Save what we changed above before talking to the wallet. The wallet works on its own database connection, so it would wait
    # forever for the row lock this request is still holding.
    await session.commit()
    try:
        if free_minutes() > 0:
            await wallet.grant_minutes(ws.live_org_id, free_minutes(), "Welcome minutes", f"welcome:{ws.id}")
        if await _give_signup_bonus(session, wallet, ws, s) is False:
            return  # waiting for the WhatsApp number check: ask again once it is done
    except Exception:  # noqa: BLE001 - a wallet problem must not stop the page; it is tried again next time (both grants are idempotent)
        log.warning("welcome grant failed for workspace %s", ws.id, exc_info=True)
        return
    s.first_grant_done = True


async def _give_signup_bonus(session: AsyncSession, wallet: WalletGateway, ws: ProductWorkspaceModel, s: ProductBillingSettingsModel) -> bool:
    """The first accounts to sign up get a little money to try the product. Brought-over organizations and sub-accounts do not."""
    amount = signup_bonus()
    created = ws.created_at if ws.created_at is None or ws.created_at.tzinfo else ws.created_at.replace(tzinfo=UTC)
    if amount <= 0 or ws.adopted or ws.parent_workspace_id is not None or s.signup_bonus_at is not None:
        return True
    if created is not None and datetime.now(UTC) - created > timedelta(days=3):  # only new sign-ups, not older workspaces opening billing for the first time
        return True
    if phone_verify.required(ws, s):  # no free money until the person has proved they own a WhatsApp number
        return False
    if await bonus_left(session) <= 0:
        return True
    s.signup_bonus_at = datetime.now(UTC)
    await wallet.credit(ws.live_org_id, amount, "Welcome bonus", f"signup-bonus:{ws.id}")
    return True


def month_bounds(period: str) -> tuple[datetime, datetime]:
    y, m = int(period[:4]), int(period[5:7])
    start = datetime(y, m, 1, tzinfo=UTC)
    end = datetime(y + (m == 12), 1 if m == 12 else m + 1, 1, tzinfo=UTC)
    return start, end


def current_period(now: datetime | None = None) -> str:
    return (now or datetime.now(UTC)).strftime("%Y-%m")


async def usage_entries(session: AsyncSession, org_id: int, start: datetime, end: datetime) -> list[dict]:
    rows = (await session.scalars(
        select(WalletLedgerModel).where(
            WalletLedgerModel.organization_id == org_id, WalletLedgerModel.entry_type == "usage",
            WalletLedgerModel.created_at >= start, WalletLedgerModel.created_at < end,
        ).order_by(WalletLedgerModel.id)
    )).all()
    out = []
    for r in rows:
        minutes = (r.billed_seconds or 0) / 60.0
        out.append({
            "run_id": r.workflow_run_id, "at": r.created_at, "minutes": minutes,
            "value": round(minutes * float(r.rate_snapshot or 0), 4),  # what the usage is worth at the price
            "charged": round(-float(r.money_delta or 0), 4),          # what was actually taken from the balance
        })
    return out


async def practice_entries(session: AsyncSession, ws: ProductWorkspaceModel, start: datetime, end: datetime) -> list[dict]:
    """Browser practice calls already charged to the Live wallet. They are not 'usage' rows in the platform ledger, so list them here."""
    rows = (await session.scalars(
        select(ProductPracticeChargeModel).where(
            ProductPracticeChargeModel.workspace_id == ws.id, ProductPracticeChargeModel.created_at >= start, ProductPracticeChargeModel.created_at < end
        ).order_by(ProductPracticeChargeModel.run_id)
    )).all()
    # Free minutes are not money, so what a practice call is worth is what it cost plus nothing for the free part.
    return [{"run_id": r.run_id, "at": r.created_at, "minutes": float(r.minutes or 0), "value": round(float(r.amount or 0), 4),
             "charged": round(float(r.amount or 0), 4), "practice": True} for r in rows]


def limit_state(limit: float | None, value: float) -> str:
    if not limit or limit <= 0:
        return "ok"
    return "limit" if value >= limit else "warn" if value >= 0.8 * limit else "ok"


async def month_value(session: AsyncSession, ws: ProductWorkspaceModel, now: datetime | None = None) -> float:
    start, end = month_bounds(current_period(now))
    return sum(e["value"] for e in await usage_entries(session, ws.live_org_id, start, end))


async def limit_reached(session: AsyncSession, live_org_id: int) -> bool:
    """For the inbound gate: has this workspace used up its monthly spend limit?"""
    ws = await session.scalar(select(ProductWorkspaceModel).where(ProductWorkspaceModel.live_org_id == live_org_id))
    if ws is None:
        return False
    s = await session.get(ProductBillingSettingsModel, ws.id)
    return bool(s and s.spend_limit) and limit_state(s.spend_limit, await month_value(session, ws)) == "limit"


# ---------------- invoices ----------------
def compute_tax(taxable: float, seller_state: str, customer_state: str | None) -> dict:
    rate = gst_rate()
    amount = round(taxable * rate / 100, 2)
    if seller_state and customer_state and seller_state == customer_state:
        half = round(amount / 2, 2)
        return {"rate": rate, "cgst": half, "sgst": round(amount - half, 2), "igst": 0.0}
    return {"rate": rate, "cgst": 0.0, "sgst": 0.0, "igst": amount}


async def issue_missing_invoices(session: AsyncSession, ws: ProductWorkspaceModel, now: datetime | None = None) -> None:
    """Invoice every finished month that had charges and no invoice yet. Never rewrites an issued invoice. Caller commits."""
    now = now or datetime.now(UTC)
    first = await session.scalar(select(WalletLedgerModel.created_at).where(
        WalletLedgerModel.organization_id == ws.live_org_id, WalletLedgerModel.entry_type == "usage").order_by(WalletLedgerModel.id).limit(1))
    if first is None:
        return
    have = set(await session.scalars(select(ProductInvoiceModel.period).where(ProductInvoiceModel.workspace_id == ws.id)))
    s, sel = await get_settings(session, ws), seller()
    y, m = first.year, first.month
    while f"{y:04d}-{m:02d}" < current_period(now):
        period = f"{y:04d}-{m:02d}"
        if period not in have:
            start, end = month_bounds(period)
            entries = await usage_entries(session, ws.live_org_id, start, end)
            taxable = round(sum(e["charged"] for e in entries), 2)
            if taxable > 0:
                tax = compute_tax(taxable, sel["state"], s.billing_state)
                inv = ProductInvoiceModel(
                    workspace_id=ws.id, period=period, minutes=round(sum(e["minutes"] for e in entries), 2), taxable=taxable, tax=tax,
                    total=round(taxable + tax["cgst"] + tax["sgst"] + tax["igst"], 2), currency=config.CURRENCY,
                    bill_to={"name": s.billing_name or ws.name, "gstin": s.billing_gstin, "state": s.billing_state, "address": s.billing_address},
                )
                session.add(inv)
                await session.flush()
                inv.number = f"INV-{period.replace('-', '')}-{inv.id:06d}"
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def invoice_pdf(inv: ProductInvoiceModel) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    sel = seller()
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    w, h = A4
    y = h - 60
    line = lambda text, size=10, x=50, bold=False: (c.setFont("Helvetica-Bold" if bold else "Helvetica", size), c.drawString(x, y, str(text)))
    line("TAX INVOICE", 18, bold=True); y -= 26
    line(f"Invoice no: {inv.number}"); y -= 14
    line(f"Date: {inv.issued_at.strftime('%d %b %Y') if inv.issued_at else ''}   Period: {inv.period}"); y -= 26
    line("From", 9, bold=True); y -= 13
    for t in (sel["name"], sel["address"], f"GSTIN: {sel['gstin']}" if sel["gstin"] else "", f"State code: {sel['state']}" if sel["state"] else ""):
        if t: line(t); y -= 13
    y -= 10
    line("Bill to", 9, bold=True); y -= 13
    b = inv.bill_to or {}
    for t in (b.get("name"), b.get("address"), f"GSTIN: {b['gstin']}" if b.get("gstin") else "", f"State code: {b['state']}" if b.get("state") else ""):
        if t: line(t); y -= 13
    y -= 18
    line("Description", 10, bold=True); line("SAC", 10, 300, True); line("Amount", 10, 450, True); y -= 14
    line(f"Voice call minutes ({inv.minutes:g} min)"); line(sel["sac"], 10, 300); line(f"{inv.taxable:,.2f} {inv.currency}", 10, 450); y -= 24
    t = inv.tax or {}
    for label, key in (("CGST", "cgst"), ("SGST", "sgst"), ("IGST", "igst")):
        if t.get(key):
            line(f"{label} @ {t['rate'] / (2 if key != 'igst' else 1):g}%", 10, 300); line(f"{t[key]:,.2f}", 10, 450); y -= 14
    y -= 6
    line("Total", 11, 300, True); line(f"{inv.total:,.2f} {inv.currency}", 11, 450, True)
    c.showPage()
    c.save()
    return buf.getvalue()
