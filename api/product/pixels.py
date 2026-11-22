"""Swarvo Pixel devices: ids and activation codes, signing a device in (the first time creates its account), and what a device has used.

A device has a printed id (SWARVO-0001) and an activation code (XXXX-XXXX-XXXX-XXXX). The code is the device's password: it signs a person in on the
web, and the device itself sends it when it connects. It is stored only as a hash, so it can be shown once when it is made.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select

from api.constants import OSS_JWT_SECRET
from api.db.models import UserModel
from api.db.product_models import ProductPixelModel, ProductPixelSessionModel, ProductUserProfileModel
from api.utils.auth import hash_password

ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no 0/O/1/I/L: easy to read off a sticker
ONLINE_WITHIN = timedelta(seconds=50)  # a connected device refreshes its "last seen" every ~20 seconds
EMAIL_DOMAIN = os.getenv("PRODUCT_DEVICE_EMAIL_DOMAIN", "devices.swarvoai.com")


def new_code() -> str:
    raw = "".join(secrets.choice(ALPHABET) for _ in range(16))
    return "-".join(raw[i : i + 4] for i in range(0, 16, 4))


def clean_code(code: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (code or "").upper())


def clean_device_id(device_id: str) -> str:
    return re.sub(r"[^A-Z0-9-]", "", (device_id or "").strip().upper())[:40]


def hash_code(code: str) -> str:
    return hmac.new(OSS_JWT_SECRET.encode(), clean_code(code).encode(), hashlib.sha256).hexdigest()


def code_ok(device: ProductPixelModel | None, code: str) -> bool:
    """Constant-time check; also burns the same time when the device does not exist."""
    expected = device.code_hash if device is not None else hash_code("x" * 16)
    return hmac.compare_digest(expected, hash_code(code)) and device is not None


async def find(session, device_id: str) -> ProductPixelModel | None:
    return await session.scalar(select(ProductPixelModel).where(ProductPixelModel.device_id == clean_device_id(device_id)))


async def authenticate(session, device_id: str, code: str) -> ProductPixelModel | None:
    device = await find(session, device_id)
    return device if code_ok(device, code) else None


async def create_batch(session, *, count: int, prefix: str = "SWARVO", batch: str = "") -> list[tuple[ProductPixelModel, str]]:
    """New devices with the next ids (SWARVO-0007, ...). Returns each device with its plain code: this is the only time it is visible."""
    prefix = re.sub(r"[^A-Z0-9]", "", prefix.upper())[:12] or "SWARVO"
    last = 0
    for (d,) in (await session.execute(select(ProductPixelModel.device_id).where(ProductPixelModel.device_id.like(f"{prefix}-%")))).all():
        m = re.fullmatch(rf"{re.escape(prefix)}-(\d+)", d)
        if m:
            last = max(last, int(m.group(1)))
    out = []
    for i in range(1, count + 1):
        code = new_code()
        dev = ProductPixelModel(device_id=f"{prefix}-{last + i:04d}", code_hash=hash_code(code), batch=batch.strip()[:60], name="")
        session.add(dev)
        out.append((dev, code))
    await session.flush()
    return out


async def sign_in(session, device: ProductPixelModel) -> UserModel:
    """The device's account. The first sign-in creates it (a user and a workspace named after the device); after that it is the same one."""
    from api.product.service import create_workspace

    if device.user_id is not None:
        user = await session.get(UserModel, device.user_id)
        if user is not None:
            return user
    name = device.name or f"Swarvo Pixel {device.device_id}"
    user = UserModel(provider_id=f"usr_{uuid.uuid4().hex}", email=f"{device.device_id.lower()}@{EMAIL_DOMAIN}",
                     password_hash=hash_password(secrets.token_urlsafe(24)), role="admin")  # nobody knows this password: the device code is how it signs in
    session.add(user)
    await session.flush()
    session.add(ProductUserProfileModel(user_id=user.id, display_name=name))
    ws = await create_workspace(session, user, name)
    device.user_id, device.workspace_id = user.id, ws.id
    device.name = device.name or name
    device.status = "active"
    device.claimed_at = datetime.now(UTC)
    await session.flush()
    return user


def is_online(device: ProductPixelModel, now: datetime | None = None) -> bool:
    seen = device.last_seen_at
    if seen is None:
        return False
    if seen.tzinfo is None:
        seen = seen.replace(tzinfo=UTC)
    return (now or datetime.now(UTC)) - seen < ONLINE_WITHIN


async def usage(session, pixel_ids: list[int]) -> dict[int, dict]:
    """Conversation counts and minutes per device: today and all time."""
    if not pixel_ids:
        return {}
    start = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    rows = (await session.execute(
        select(ProductPixelSessionModel.pixel_id, func.count(), func.coalesce(func.sum(ProductPixelSessionModel.seconds), 0))
        .where(ProductPixelSessionModel.pixel_id.in_(pixel_ids)).group_by(ProductPixelSessionModel.pixel_id))).all()
    today = (await session.execute(
        select(ProductPixelSessionModel.pixel_id, func.coalesce(func.sum(ProductPixelSessionModel.seconds), 0))
        .where(ProductPixelSessionModel.pixel_id.in_(pixel_ids), ProductPixelSessionModel.started_at >= start).group_by(ProductPixelSessionModel.pixel_id))).all()
    out = {i: {"sessions": 0, "minutes": 0.0, "minutes_today": 0.0} for i in pixel_ids}
    for pid, n, secs in rows:
        out[pid].update(sessions=int(n), minutes=round(int(secs) / 60, 1))
    for pid, secs in today:
        out[pid]["minutes_today"] = round(int(secs) / 60, 1)
    return out
