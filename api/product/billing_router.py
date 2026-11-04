"""Billing & usage for the workspace. Money is always the Live organization's; Test mode is free and never touches it."""

import json
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Header, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select

from api.db.product_models import ProductAgentModel, ProductInvoiceModel, ProductPaymentModel, ProductWorkspaceModel
from api.product import billing as bl
from api.product import config, emailer, pricing, rates
from api.product.deps import Ctx, get_ctx, get_session, require
from api.product.notifications import notify
from api.product.errors import product_error
from api.product.payments import PaymentError, PaymentProvider, WalletGateway, get_payments, get_wallet
from api.product.roles import Perm

router = APIRouter(prefix="/product/billing", tags=["billing"])
MIN_TOPUP, MAX_TOPUP = 100.0, 100000.0


class SettingsOut(BaseModel):
    spend_limit: float | None
    auto_topup_enabled: bool
    auto_topup_threshold: float | None
    auto_topup_amount: float | None
    billing_name: str | None
    billing_gstin: str | None
    billing_state: str | None
    billing_address: str | None


class SummaryOut(BaseModel):
    currency: str
    price_per_min: float
    free_mode: bool  # Test mode: nothing is charged
    balance: float
    minutes_available: float
    month_usage_value: float
    month_minutes: float
    spend_limit: float | None
    limit_state: str  # ok | warn | limit
    low_balance: bool
    settings: SettingsOut
    payments_enabled: bool
    slabs: list[dict] = []
    next_rate_at: int | None = None  # wallet minutes at which the next cheaper slab starts
    next_rate: float | None = None
    next_rate_balance: float | None = None  # wallet balance needed to reach that slab
    contact_sales_above: int = 100000


class SettingsBody(BaseModel):
    spend_limit: float | None = Field(default=None, ge=0, le=10_000_000)
    clear_spend_limit: bool = False
    auto_topup_enabled: bool | None = None
    auto_topup_threshold: float | None = Field(default=None, ge=0)
    auto_topup_amount: float | None = Field(default=None, ge=0)
    billing_name: str | None = Field(default=None, max_length=160)
    billing_gstin: str | None = Field(default=None, max_length=20, pattern=r"^[0-9A-Za-z]*$")
    billing_state: str | None = Field(default=None, max_length=2, pattern=r"^\d{0,2}$")
    billing_address: str | None = Field(default=None, max_length=400)


class TopupBody(BaseModel):
    amount: float


class TopupOut(BaseModel):
    order_id: str
    key: str
    amount: float
    currency: str


class ConfirmBody(BaseModel):
    order_id: str
    payment_id: str
    signature: str


class InvoiceOut(BaseModel):
    number: str
    period: str
    minutes: float
    taxable: float
    tax: float
    total: float
    currency: str


def _settings_out(s) -> SettingsOut:
    return SettingsOut(
        spend_limit=s.spend_limit, auto_topup_enabled=bool(s.auto_topup_enabled), auto_topup_threshold=s.auto_topup_threshold,
        auto_topup_amount=s.auto_topup_amount, billing_name=s.billing_name, billing_gstin=s.billing_gstin,
        billing_state=s.billing_state, billing_address=s.billing_address,
    )


class WalletOut(BaseModel):
    balance: float
    minutes_available: float
    currency: str
    low_balance: bool


@router.get("/wallet", response_model=WalletOut)
async def wallet_chip(ctx: Ctx = Depends(get_ctx), wallet: WalletGateway = Depends(get_wallet)):
    """A small balance readout for the page header. Any member may see it."""
    await bl.ensure_billing(ctx.session, wallet, ctx.workspace)
    await ctx.session.commit()
    w = await wallet.summary(ctx.workspace.live_org_id)
    return WalletOut(balance=float(w.get("balance", 0)), minutes_available=float(w.get("minutes_available", 0)), currency=config.CURRENCY, low_balance=bool(w.get("low_balance")))


class PriceOut(BaseModel):
    currency: str
    slabs: list[dict]  # [{up_to, rate}]: minutes in the wallet, price per minute
    contact_sales_above: int
    number_monthly_local: float
    number_monthly_toll_free: float
    signup_bonus: float
    bonus_left: int


@router.get("/pricing", response_model=PriceOut)
async def price_list(ctx: Ctx = Depends(get_ctx)):
    """The public price list, for the pricing page. Any member may see it."""
    from api.product import pricing
    from api.product.numbers_router import _monthly

    return PriceOut(
        currency=config.CURRENCY, slabs=[{"up_to": a, "rate": b} for a, b in pricing.slabs()], contact_sales_above=pricing.slabs()[-1][0],
        number_monthly_local=_monthly("local"), number_monthly_toll_free=_monthly("toll_free"),
        signup_bonus=bl.signup_bonus(), bonus_left=await bl.bonus_left(ctx.session),
    )


class WelcomeOut(BaseModel):
    bonus: float  # the sign-up bonus this workspace received, 0 if none
    currency: str
    minutes_available: float


@router.get("/welcome", response_model=WelcomeOut)
async def welcome(ctx: Ctx = Depends(get_ctx), wallet: WalletGateway = Depends(get_wallet)):
    """What the first-visit welcome shows: the sign-up bonus this workspace was given. Any member may see it."""
    await bl.ensure_billing(ctx.session, wallet, ctx.workspace)
    await ctx.session.commit()
    s = await bl.get_settings(ctx.session, ctx.workspace)
    w = await wallet.summary(ctx.workspace.live_org_id)
    return WelcomeOut(bonus=bl.signup_bonus() if s.signup_bonus_at else 0.0, currency=config.CURRENCY, minutes_available=float(w.get("minutes_available", 0)))


@router.get("/summary", response_model=SummaryOut)
async def summary(ctx: Ctx = Depends(require(Perm.BILLING_MANAGE)), wallet: WalletGateway = Depends(get_wallet)):
    await bl.ensure_billing(ctx.session, wallet, ctx.workspace)
    await ctx.session.commit()
    s = await bl.get_settings(ctx.session, ctx.workspace)
    # The price follows the wallet: bring the wallet's rate up to date first so the minutes below are worked out at it.
    await rates.sync_org_rate(ctx.session, ctx.workspace)
    await ctx.session.commit()
    w = await wallet.summary(ctx.workspace.live_org_id)
    start, end = bl.month_bounds(bl.current_period())
    entries = await bl.usage_entries(ctx.session, ctx.workspace.live_org_id, start, end)
    balance = float(w.get("balance", 0) or 0)
    rate = await rates.workspace_rate(ctx.session, ctx.workspace)
    nxt = pricing.next_balance_step(balance, rate)
    value = round(sum(e["value"] for e in entries), 2)
    state = bl.limit_state(s.spend_limit, value)
    period = bl.current_period()
    if state == "limit":
        await notify(ctx.session, ctx.workspace.id, "spend", "You've reached your spending limit", "New calls are paused until you raise it.", "/billing", f"limit:{period}")
    elif state == "warn":
        await notify(ctx.session, ctx.workspace.id, "spend", "You've used 80% of your spending limit", "", "/billing", f"spend80:{period}")
    if w.get("low_balance"):
        await notify(ctx.session, ctx.workspace.id, "balance", "Your balance is running low", "Add money to keep taking calls.", "/billing", f"low:{datetime.now(UTC).strftime('%Y-%m-%d')}")
    await ctx.session.commit()
    return SummaryOut(
        currency=config.CURRENCY, price_per_min=rate, free_mode=False,
        balance=float(w.get("balance", 0)), minutes_available=float(w.get("minutes_available", 0)),
        month_usage_value=value, month_minutes=round(sum(e["minutes"] for e in entries), 2), spend_limit=s.spend_limit,
        limit_state=bl.limit_state(s.spend_limit, value), low_balance=bool(w.get("low_balance")),
        settings=_settings_out(s), payments_enabled=get_payments() is not None,
        slabs=[{"up_to": a, "rate": b} for a, b in pricing.slabs()], next_rate_at=(nxt[2] if nxt else None), next_rate=(nxt[1] if nxt else None), next_rate_balance=(nxt[0] if nxt else None), contact_sales_above=pricing.contact_sales_above(),
    )


@router.get("/usage")
async def usage(days: int = Query(default=30, ge=1, le=365), ctx: Ctx = Depends(require(Perm.BILLING_MANAGE))):
    end = datetime.now(UTC) + timedelta(days=1)
    entries = await bl.usage_entries(ctx.session, ctx.workspace.live_org_id, end - timedelta(days=days + 1), end)
    runs = {}
    if entries:
        from api.db.models import WorkflowRunModel

        ids = [e["run_id"] for e in entries if e["run_id"]]
        runs = dict((await ctx.session.execute(select(WorkflowRunModel.id, WorkflowRunModel.workflow_id).where(WorkflowRunModel.id.in_(ids)))).all()) if ids else {}
    agents = {a.live_workflow_id: a for a in (await ctx.session.scalars(
        select(ProductAgentModel).where(ProductAgentModel.workspace_id == ctx.workspace.id))).all() if a.live_workflow_id}
    by_day: dict[str, dict] = {}
    by_agent: dict[str, dict] = {}
    for e in entries:
        d = by_day.setdefault(e["at"].strftime("%Y-%m-%d"), {"day": e["at"].strftime("%Y-%m-%d"), "minutes": 0.0, "value": 0.0})
        d["minutes"] += e["minutes"]; d["value"] += e["value"]
        a = agents.get(runs.get(e["run_id"]))
        key = a.public_id if a else "other"
        g = by_agent.setdefault(key, {"agent_id": a.public_id if a else None, "name": a.name if a else "Other", "minutes": 0.0, "value": 0.0})
        g["minutes"] += e["minutes"]; g["value"] += e["value"]
    rnd = lambda rows: [{**r, "minutes": round(r["minutes"], 2), "value": round(r["value"], 2)} for r in rows]
    return {"currency": config.CURRENCY, "by_day": rnd(sorted(by_day.values(), key=lambda r: r["day"])), "by_agent": rnd(by_agent.values())}


@router.patch("/settings", response_model=SettingsOut)
async def update_settings(body: SettingsBody, ctx: Ctx = Depends(require(Perm.BILLING_MANAGE))):
    s = await bl.get_settings(ctx.session, ctx.workspace)
    for f in ("auto_topup_enabled", "auto_topup_threshold", "auto_topup_amount", "billing_name", "billing_gstin", "billing_state", "billing_address"):
        v = getattr(body, f)
        if v is not None:
            setattr(s, f, v or None if isinstance(v, str) else v)
    if body.clear_spend_limit:
        s.spend_limit = None
    elif body.spend_limit is not None:
        s.spend_limit = body.spend_limit or None
    await ctx.session.commit()
    return _settings_out(s)


def _provider() -> PaymentProvider:
    p = get_payments()
    if p is None:
        raise product_error(503, "payments_unavailable", "Adding money isn't available yet. Please contact support.")
    return p


@router.post("/topups", response_model=TopupOut)
async def start_topup(body: TopupBody, ctx: Ctx = Depends(require(Perm.BILLING_MANAGE))):
    if ctx.environment == "test":
        raise product_error(400, "test_is_free", "Test mode is free, so there's nothing to pay for. Switch to Live to add money.")
    if not MIN_TOPUP <= body.amount <= MAX_TOPUP:
        raise product_error(400, "bad_amount", f"Choose an amount between {MIN_TOPUP:g} and {MAX_TOPUP:g}.")
    prov = _provider()
    try:
        order = await prov.create_order(body.amount, config.CURRENCY, f"ws{ctx.workspace.id}-{int(datetime.now(UTC).timestamp())}")
    except PaymentError as e:
        raise product_error(502, "payment_start_failed", str(e))
    ctx.session.add(ProductPaymentModel(workspace_id=ctx.workspace.id, provider=prov.name, order_id=order, amount=body.amount, currency=config.CURRENCY))
    await ctx.session.commit()
    return TopupOut(order_id=order, key=prov.public_key, amount=body.amount, currency=config.CURRENCY)


async def _settle(session, wallet: WalletGateway, pay: ProductPaymentModel, payment_id: str | None) -> bool:
    """Credit a paid order exactly once. True if this call did the crediting."""
    if pay.status == "paid":
        return False
    pay.status, pay.payment_id = "paid", payment_id
    ws = await session.get(ProductWorkspaceModel, pay.workspace_id)
    await wallet.credit(ws.live_org_id, pay.amount, "Wallet top-up", f"pay:{pay.order_id}")  # same key => safe to repeat
    await session.commit()
    await rates.sync_org_rate(session, ws)  # a bigger wallet can unlock a cheaper slab straight away
    await session.commit()
    return True


@router.post("/topups/confirm")
async def confirm_topup(body: ConfirmBody, ctx: Ctx = Depends(require(Perm.BILLING_MANAGE)), wallet: WalletGateway = Depends(get_wallet), mailer: emailer.Mailer = Depends(emailer.get_mailer)):
    pay = await ctx.session.scalar(select(ProductPaymentModel).where(
        ProductPaymentModel.order_id == body.order_id, ProductPaymentModel.workspace_id == ctx.workspace.id))
    if pay is None:
        raise product_error(404, "payment_not_found", "We couldn't find that payment.")
    if not _provider().verify_checkout(body.order_id, body.payment_id, body.signature):
        raise product_error(400, "payment_unverified", "We couldn't confirm that payment. If money left your account, it will be added shortly.")
    await _settle(ctx.session, wallet, pay, body.payment_id)
    await mailer.send(ctx.user.email, "We received your payment", f"Thanks! {config.CURRENCY} {pay.amount:,.2f} was added to your balance.",
                      emailer.wrap("Payment received", f"<p>Thanks! <b>{config.CURRENCY} {pay.amount:,.2f}</b> was added to your balance. Your GST invoice is on the Billing page.</p>"))
    return {"ok": True}


class CancelBody(BaseModel):
    order_id: str


@router.post("/topups/cancel")
async def cancel_topup(body: CancelBody, ctx: Ctx = Depends(require(Perm.BILLING_MANAGE))):
    """The customer closed the payment window without paying."""
    pay = await ctx.session.scalar(select(ProductPaymentModel).where(
        ProductPaymentModel.order_id == body.order_id, ProductPaymentModel.workspace_id == ctx.workspace.id))
    if pay is not None and pay.status == "created":
        pay.status = "canceled"
        await ctx.session.commit()
    return {"ok": True}


@router.post("/webhooks/razorpay")
async def razorpay_webhook(request: Request, x_razorpay_signature: str | None = Header(default=None),
                           session=Depends(get_session), wallet: WalletGateway = Depends(get_wallet)):
    """Provider callback (no login). Trusted only if the signature checks out."""
    body = await request.body()
    prov = get_payments()
    if prov is None or not prov.verify_webhook(body, x_razorpay_signature or ""):
        return Response(status_code=400)
    try:
        ev = json.loads(body)
        ent = (ev.get("payload", {}).get("payment", {}) or {}).get("entity", {})
        order_id, payment_id = ent.get("order_id"), ent.get("id")
    except ValueError:
        return Response(status_code=400)
    if ev.get("event") == "payment_link.paid":  # a top-up link we emailed (low-balance auto top-up)
        link_id = ((ev.get("payload", {}).get("payment_link", {}) or {}).get("entity", {}) or {}).get("id")
        pay = await session.scalar(select(ProductPaymentModel).where(ProductPaymentModel.order_id == link_id)) if link_id else None
        if pay is not None:
            await _settle(session, wallet, pay, payment_id)
    if ev.get("event") in ("payment.captured", "order.paid") and order_id:
        pay = await session.scalar(select(ProductPaymentModel).where(ProductPaymentModel.order_id == order_id))
        if pay is not None:
            await _settle(session, wallet, pay, payment_id)
    return {"ok": True}


@router.get("/payments")
async def payments(ctx: Ctx = Depends(require(Perm.BILLING_MANAGE))):
    rows = (await ctx.session.scalars(select(ProductPaymentModel).where(ProductPaymentModel.workspace_id == ctx.workspace.id).order_by(ProductPaymentModel.id.desc()).limit(50))).all()
    now = datetime.now(UTC)

    def shown(r) -> str:  # an unpaid order nobody finished is "expired", not "created" forever
        if r.status == "created" and r.created_at and now - r.created_at > timedelta(minutes=30):
            return "expired"
        return r.status

    return [{"order_id": r.order_id, "amount": r.amount, "currency": r.currency, "status": shown(r), "at": r.created_at.isoformat() if r.created_at else None} for r in rows]


@router.get("/invoices", response_model=list[InvoiceOut])
async def invoices(ctx: Ctx = Depends(require(Perm.BILLING_MANAGE))):
    await bl.issue_missing_invoices(ctx.session, ctx.workspace)
    await ctx.session.commit()
    rows = (await ctx.session.scalars(select(ProductInvoiceModel).where(ProductInvoiceModel.workspace_id == ctx.workspace.id).order_by(ProductInvoiceModel.period.desc()))).all()
    return [InvoiceOut(number=r.number or "", period=r.period, minutes=r.minutes, taxable=r.taxable,
                       tax=round(r.total - r.taxable, 2), total=r.total, currency=r.currency) for r in rows]


@router.get("/invoices/{number}/pdf")
async def invoice_pdf(number: str, ctx: Ctx = Depends(require(Perm.BILLING_MANAGE))):
    inv = await ctx.session.scalar(select(ProductInvoiceModel).where(
        ProductInvoiceModel.number == number, ProductInvoiceModel.workspace_id == ctx.workspace.id))
    if inv is None:
        raise product_error(404, "invoice_not_found", "We couldn't find that invoice.")
    return Response(bl.invoice_pdf(inv), media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{inv.number}.pdf"'})
