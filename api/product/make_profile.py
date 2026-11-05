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

    # swarvo-tts: our own speech model. It only speaks, so its profile is a normal listen > think > speak one, and the listening (STT) and
    # thinking (LLM) parts are separate services (not a realtime one): listening is AssemblyAI (universal-3-5-pro, its own website and key),
    # thinking is the Inworld model router with the same Inworld key as the Inworld voices.
    swarvo_key, swarvo_url = os.getenv("SWARVO_TTS_KEY", "").strip(), os.getenv("SWARVO_TTS_BASE_URL", "").strip().rstrip("/")
    profiles = await db_client.list_model_profiles()
    existing = next((p for p in profiles if p.slug == "swarvo"), None)
    inworld_row = next((p for p in profiles if p.slug == "inworld"), None)
    aai_key = os.getenv("ASSEMBLYAI_API_KEY", "").strip() or (((existing.config or {}).get("stt") or {}).get("api_key") if existing and ((existing.config or {}).get("stt") or {}).get("provider") == "assemblyai" else "")
    ik = inworld_key or (((inworld_row.config or {}).get("realtime") or {}).get("api_key") if inworld_row else "") or ""
    if existing is None and not swarvo_key:
        pass
    elif not ik:
        print("The swarvo-tts profile thinks through Inworld, so it needs the Inworld key. Give it here or set up the Inworld voices first.")
    elif not aai_key:
        print("The swarvo-tts profile listens through AssemblyAI, so it needs the AssemblyAI key.")
    else:
        old_tts = dict(((existing.config or {}).get("tts") or {})) if existing else {}
        tts = {"provider": "swarvo_tts", "model": "swarvo-tts-2.5", "voice": "Ritvik", "language": "hi", **old_tts}
        if swarvo_key:
            tts["api_key"] = swarvo_key
        if swarvo_url:
            tts["base_url"] = swarvo_url
        if not tts.get("api_key") or not tts.get("base_url"):
            print("The swarvo-tts profile needs both the swarvo-tts key and its service address.")
        else:
            cfg = {"is_realtime": False, "tts": tts,
                   "llm": {"provider": "inworld_llm", "api_key": ik, "model": "google-ai-studio/gemini-3.1-flash-lite"},
                   "stt": {"provider": "assemblyai", "api_key": aai_key, "model": "universal-3-5-pro", "language": "en"}}
            if base.get("embeddings"):
                cfg["embeddings"] = base["embeddings"]
            cfg = profile_service.normalize_config(cfg)
            if existing is None:
                await db_client.create_model_profile(slug="swarvo", display_name="swarvo-tts 2.5", description=None, tier=None, capabilities=[], config=cfg, allowed_org_ids=[], is_active=True)
                print("Created profile 'swarvo' (swarvo-tts speech, Inworld listening and thinking).")
            else:
                await db_client.update_model_profile(existing.id, config=cfg)
                print("Updated profile 'swarvo'.")
            existing = True
    done["swarvo"] = bool(existing)

    # Optional second listening choice for swarvo-tts voices: Deepgram Nova-3 (Hindi and the other Indian languages it supports, very fast).
    dg_key = os.getenv("DEEPGRAM_API_KEY", "").strip()
    dg = next((p for p in await db_client.list_model_profiles() if p.slug == "swarvo_deepgram"), None)
    if dg_key:
        old = dict(((dg.config or {}).get("stt") or {})) if dg else {}
        cfg = profile_service.normalize_config({"stt": {"provider": "deepgram", "model": "nova-3-general", "language": "hi", **old, "api_key": dg_key}})
        if dg is None:
            await db_client.create_model_profile(slug="swarvo_deepgram", display_name="swarvo-tts listening: Deepgram", description=None, tier=None, capabilities=[], config=cfg, allowed_org_ids=[], is_active=True)
            print("Created the Deepgram listening option.")
        else:
            await db_client.update_model_profile(dg.id, config=cfg)
            print("Updated the Deepgram key.")
        dg = True
    done["deepgram listening"] = bool(dg)

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
