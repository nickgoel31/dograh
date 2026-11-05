"""Create (or update) the two voice profiles new customers use, from keys you supply at run time.

    INWORLD_API_KEY=... [GOOGLE_API_KEY=...] python -m api.product.make_profile --email you@example.com

Run it inside the API container (scripts/setup_voices.sh does this and asks for the keys without showing them).

- Profile "inworld": realtime speech with the model/speech/voice settings below. Keys are only ever read from the
  environment of this one command, never stored in the code or the repository.
- Profile "google": realtime speech on Gemini Live. Its key may be left empty and added later by running this again.
- The AI model used for summaries and checks (the "llm" part) and the "embeddings" part are copied from the
  account named by --email, the same settings that account already uses in the classic UI.
- Re-running is safe: existing profiles only get the key(s) you supply updated. Customer workspaces made by
  the new app are pointed at the default profile; brought-over organizations are never touched.
"""

import argparse
import asyncio
import os

from sqlalchemy import select, update

from api.db import db_client
from api.db.models import ModelProfileModel, OrganizationModel, UserConfigurationModel, UserModel
from api.db.product_models import ProductWorkspaceModel
from api.services.reseller import profiles as profile_service

INWORLD_REALTIME = {
    "provider": "inworld_realtime",
    "model": "google-ai-studio/gemini-3.1-flash-lite",
    "voice": "Seema",
    "stt_model": "assemblyai/universal-3-5-pro",
    "tts_model": "inworld-tts-2",
    "language": "auto",
    "turn_detection": "server_vad",
    "stt_eagerness": "medium",
    "tts_speed": 1.5,
}
GOOGLE_REALTIME = {
    "provider": "google_realtime",
    "model": "gemini-3.1-flash-live-preview",
    "voice": "Zephyr",
    "language": "en-hi",
}


def build_config(realtime: dict, key: str, base: dict) -> dict:
    """A realtime profile: the realtime section plus the AI model for summaries/checks copied from `base`."""
    cfg = {"is_realtime": True, "realtime": {**realtime, "api_key": key}}
    for part in ("llm", "embeddings"):
        if base.get(part):
            cfg[part] = base[part]
    return profile_service.normalize_config(cfg)


async def run(email: str) -> int:
    inworld_key, google_key = os.getenv("INWORLD_API_KEY", "").strip(), os.getenv("GOOGLE_API_KEY", "").strip()
    async with db_client.async_session() as s:
        user = await s.scalar(select(UserModel).where(UserModel.email == email.lower()))
        row = await s.scalar(select(UserConfigurationModel).where(UserConfigurationModel.user_id == user.id)) if user else None
    if user is None:
        print(f"No account with the email {email}.")
        return 1
    base = dict(row.configuration) if row else {}
    if not base.get("llm"):
        print("That account has no AI model (LLM) set up in the classic UI yet. Set one there first, then run this again.")
        return 1

    done = {}
    for slug, name, realtime, key in (("inworld", "Inworld realtime", INWORLD_REALTIME, inworld_key), ("google", "Google realtime", GOOGLE_REALTIME, google_key)):
        existing = next((p for p in await db_client.list_model_profiles() if p.slug == slug), None)
        if existing is None:
            cfg = build_config(realtime, key, base)
            await db_client.create_model_profile(slug=slug, display_name=name, description=None, tier=None, capabilities=[], config=cfg, allowed_org_ids=[], is_active=True)
            print(f"Created profile '{slug}'" + (" with a key." if key else " WITHOUT a key (add it later)."))
        elif key:
            cfg = dict(existing.config or {})
            cfg["realtime"] = {**(cfg.get("realtime") or realtime), "api_key": key}
            await db_client.update_model_profile(existing.id, config=profile_service.normalize_config(cfg))
            print(f"Updated the key on profile '{slug}'.")
        else:
            print(f"Profile '{slug}' already exists; no new key given, left as it is.")
        done[slug] = bool(key or ((existing.config or {}).get("realtime", {}).get("api_key") if existing else ""))

    # swarvo-tts: our own speech model. It only speaks, so its profile is a normal listen > think > speak one: the thinking (llm) and
    # listening (stt) models are copied from the account above, the speech part points at the swarvo-tts service.
    swarvo_key, swarvo_url = os.getenv("SWARVO_TTS_KEY", "").strip(), os.getenv("SWARVO_TTS_BASE_URL", "").strip().rstrip("/")
    existing = next((p for p in await db_client.list_model_profiles() if p.slug == "swarvo"), None)
    if existing is None and swarvo_key:
        if not base.get("stt"):
            print("The swarvo-tts profile needs a speech-to-text model, and that account has none in the classic UI. Set one there, then run this again.")
        elif not swarvo_url:
            print("The swarvo-tts profile needs the service address (SWARVO_TTS_BASE_URL).")
        else:
            tts = {"provider": "swarvo_tts", "api_key": swarvo_key, "model": "swarvo-tts-2.5", "voice": "Ritvik", "language": "hi", "base_url": swarvo_url}
            cfg = {"is_realtime": False, "tts": tts, **{k: base[k] for k in ("llm", "stt", "embeddings") if base.get(k)}}
            await db_client.create_model_profile(slug="swarvo", display_name="swarvo-tts 2.5", description=None, tier=None, capabilities=[], config=profile_service.normalize_config(cfg), allowed_org_ids=[], is_active=True)
            print("Created profile 'swarvo' with a key.")
            existing = True
    elif existing is not None and (swarvo_key or swarvo_url):
        cfg = dict(existing.config or {})
        tts = dict(cfg.get("tts") or {"provider": "swarvo_tts", "model": "swarvo-tts-2.5", "voice": "Ritvik", "language": "hi"})
        if swarvo_key:
            tts["api_key"] = swarvo_key
        if swarvo_url:
            tts["base_url"] = swarvo_url
        cfg["tts"] = tts
        await db_client.update_model_profile(existing.id, config=profile_service.normalize_config(cfg))
        print("Updated the swarvo-tts profile.")
    elif existing is not None:
        print("Profile 'swarvo' already exists; nothing new given, left as it is.")
    done["swarvo"] = bool(existing and ((existing is True) or (existing.config or {}).get("tts", {}).get("api_key")))

    # Customer workspaces made by the new app use the Inworld profile by default (brought-over organizations are left alone).
    prof = next(p for p in await db_client.list_model_profiles() if p.slug == "inworld")
    async with db_client.async_session() as s:
        ws = (await s.execute(select(ProductWorkspaceModel.live_org_id, ProductWorkspaceModel.test_org_id).where(ProductWorkspaceModel.adopted.is_(False)))).all()
        ids = [i for pair in ws for i in pair]
        if ids:
            await s.execute(update(OrganizationModel).where(OrganizationModel.id.in_(ids)).values(model_profile_id=prof.id))
            await s.commit()
    print("Voice engines ready:", ", ".join(f"{k}={'yes' if v else 'needs a key'}" for k, v in done.items()))
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--email", required=True)
    a = ap.parse_args()
    raise SystemExit(asyncio.run(run(a.email)))
