"""Low balance, auto top-up: we email the owner a one-tap payment link for their chosen amount (at most once a day).
Money is never taken without the customer paying, so this works with any card or UPI."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from api.db.models import UserModel
from api.db.product_models import ProductBillingSettingsModel, ProductPaymentModel, ProductWorkspaceModel
from api.product import config, emailer
from api.product.payments import PaymentError, get_payments
from api.product.privacy import get_settings


async def send_links(session, wallet, mailer: emailer.Mailer, provider=None, now: datetime | None = None) -> int:
    now = now or datetime.now(UTC)
    prov = provider or get_payments()
    if prov is None or not hasattr(prov, "create_link"):
        return 0
    sent = 0
    for b in (await session.scalars(select(ProductBillingSettingsModel).where(ProductBillingSettingsModel.auto_topup_enabled.is_(True)))).all():
        if not (b.auto_topup_threshold and b.auto_topup_amount):
            continue
        ws = await session.get(ProductWorkspaceModel, b.workspace_id)
        if ws is None or ws.adopted:
            continue
        st = await get_settings(session, ws.id)
        if st.topup_link_at and now - st.topup_link_at < timedelta(hours=24):
            continue
        if float((await wallet.summary(ws.live_org_id)).get("balance") or 0) >= b.auto_topup_threshold:
            continue
        owner = await session.get(UserModel, ws.owner_user_id)
        if owner is None or not owner.email:
            continue
        try:
            link_id, url = await prov.create_link(b.auto_topup_amount, config.CURRENCY, f"auto-{ws.id}-{int(now.timestamp())}", owner.email, f"Add money to your {config.PRODUCT_NAME} balance")
        except PaymentError:
            continue
        session.add(ProductPaymentModel(workspace_id=ws.id, provider=prov.name, order_id=link_id, amount=b.auto_topup_amount, currency=config.CURRENCY, kind="link"))
        st.topup_link_at = now
        await mailer.send(owner.email, "Your balance is running low", f"Your balance is low. Add {config.CURRENCY} {b.auto_topup_amount:,.0f} in one tap: {url}",
                          emailer.wrap("Your balance is running low", f"<p>Your balance for <b>{ws.name}</b> is below your reminder level. Add <b>{config.CURRENCY} {b.auto_topup_amount:,.0f}</b> in one tap, so your agents keep answering.</p>", ("Add money", url)))
        sent += 1
    await session.commit()
    return sent
