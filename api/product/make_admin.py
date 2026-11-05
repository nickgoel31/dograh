"""Create (or reset the password of) the platform owner's admin account.

    ADMIN_EMAIL=admin@twjlabs.com ADMIN_PASSWORD=... python -m api.product.make_admin

Run it inside the API container (scripts/create_admin.sh does this and asks for the password without showing it). If no password
is given, a random one is made and printed once. The account is a platform superuser, which together with its email being in
PRODUCT_ADMIN_EMAILS opens the Admin area. Re-running only resets the password.
"""

import asyncio
import os
import secrets
import uuid
from datetime import UTC, datetime

from sqlalchemy import select

from api.db import db_client
from api.db.models import UserModel
from api.db.product_models import ProductBillingSettingsModel, ProductUserProfileModel
from api.product import admin_router
from api.product.service import create_workspace, list_workspaces
from api.utils.auth import hash_password


async def run(email: str, password: str) -> None:
    email = email.strip().lower()
    if email not in admin_router.admin_emails():
        raise SystemExit(f"{email} is not in PRODUCT_ADMIN_EMAILS, so it would not get admin access. Add it there first.")
    async with db_client.async_session() as s:
        user = await s.scalar(select(UserModel).where(UserModel.email == email))
        if user is None:
            user = UserModel(provider_id=f"usr_{uuid.uuid4().hex}", email=email, password_hash=hash_password(password), role="admin", is_superuser=True)
            s.add(user)
            await s.flush()
            s.add(ProductUserProfileModel(user_id=user.id, display_name="Admin"))
            ws = await create_workspace(s, user, "Swarvo admin")
            s.add(ProductBillingSettingsModel(workspace_id=ws.id, auto_topup_enabled=False, first_grant_done=True, phone_verified_at=datetime.now(UTC)))  # no bonus, no number check
            print("Created the admin account.")
        else:
            user.password_hash, user.is_superuser = hash_password(password), True
            if not await list_workspaces(s, user.id):
                await create_workspace(s, user, "Swarvo admin")
            print("The account already existed: its password was reset and admin access confirmed.")
        await s.commit()


if __name__ == "__main__":
    pw = os.getenv("ADMIN_PASSWORD", "").strip()
    generated = not pw
    pw = pw or secrets.token_urlsafe(18)
    asyncio.run(run(os.getenv("ADMIN_EMAIL", "admin@twjlabs.com"), pw))
    if generated:
        print(f"Password (shown once, save it now): {pw}")
