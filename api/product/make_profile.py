"""Create the default model profile from the AI/voice/speech settings an existing account already uses.

    python -m api.product.make_profile --email you@example.com [--slug std]

Run it inside the API container. New customers' agents then use the same providers and keys, without anyone
typing a key again. Keys are copied inside the database and never printed. Does nothing if the slug exists.
"""

import argparse
import asyncio

from sqlalchemy import select

from api.db import db_client
from api.db.models import ModelProfileModel, UserConfigurationModel, UserModel
from api.services.reseller import profiles as profile_service


def profile_config_from(raw: dict) -> dict:
    """The parts of a user's configuration a profile can carry; raises ProfileConfigError if there is nothing usable."""
    return profile_service.normalize_config(raw or {})


def summary(config: dict) -> str:
    parts = []
    for k in ("llm", "tts", "stt", "realtime"):
        v = config.get(k)
        if v:
            parts.append(f"{k}: {v.get('provider', '?')} / {v.get('model', '?')}")
    return ", ".join(parts)


async def run(email: str, slug: str) -> int:
    async with db_client.async_session() as s:
        if await s.scalar(select(ModelProfileModel.id).where(ModelProfileModel.slug == slug)):
            print(f"A profile named '{slug}' already exists. Nothing changed.")
            return 0
        user = await s.scalar(select(UserModel).where(UserModel.email == email.lower()))
        if user is None:
            print(f"No account with the email {email}.")
            return 1
        row = await s.scalar(select(UserConfigurationModel).where(UserConfigurationModel.user_id == user.id))
    try:
        config = profile_config_from(row.configuration if row else {})
    except profile_service.ProfileConfigError as e:
        print(f"That account has no usable AI/voice settings yet: {e}")
        return 1
    await db_client.create_model_profile(slug=slug, display_name="Standard", description=None, tier=None, capabilities=[], config=config, allowed_org_ids=[], is_active=True)
    print(f"Created profile '{slug}' from {email}: {summary(config)}")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--email", required=True)
    ap.add_argument("--slug", default="std")
    a = ap.parse_args()
    raise SystemExit(asyncio.run(run(a.email, a.slug)))
