"""Playground for the Swarvo API's text to speech model: type something, pick a voice, hear it."""

from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field

from api.product import models_config, swarvo_access
from api.product import voices as catalogue
from api.product.deps import Ctx, get_ctx
from api.product.errors import product_error
from api.utils import rate_limit

router = APIRouter(prefix="/product/swarvo-api", tags=["swarvo-api"])
MAX_TEXT = 500
LANGS = {"hi": "Hindi", "en": "English"}


class SpeakBody(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT)
    voice: str = Field(min_length=1, max_length=40)
    lang: str = "hi"
    mode: str = "chat"  # chat: natural pauses and fillers; read: plain reading
    speed: float = Field(default=1.0, ge=0.7, le=1.5)


@router.get("/tts/voices")
async def tts_voices(ctx: Ctx = Depends(get_ctx)):
    ok = await swarvo_access.allowed(ctx.session, ctx.workspace, ctx.user.email)
    voices = [{"name": v.tts["voice"], "gender": v.gender} for v in catalogue.catalogue() if v.engine == "swarvo"]
    return {"available": ok, "voices": voices, "languages": [{"code": c, "name": n} for c, n in LANGS.items()], "max_chars": MAX_TEXT}


@router.post("/tts")
async def speak(body: SpeakBody, ctx: Ctx = Depends(get_ctx)):
    if not await swarvo_access.allowed(ctx.session, ctx.workspace, ctx.user.email):
        raise product_error(403, "coming_soon", "Swarvo TTS 3 is coming soon. Ask us for early access.")
    await rate_limit.enforce(f"ptts:{ctx.user.id}", 20, 600, "You're going quickly. Give it a minute and try again.")
    names = {v.tts["voice"] for v in catalogue.catalogue() if v.engine == "swarvo"}
    if body.voice not in names or body.lang not in LANGS or body.mode not in ("chat", "read"):
        raise product_error(400, "bad_choice", "Pick one of the listed voices, languages and modes.")
    prof = await models_config.engine_profile(ctx.session, "swarvo")
    t = ((prof.config or {}).get("tts") or {}) if prof else {}
    base = (t.get("base_url") or "").rstrip("/")
    if not base or not t.get("api_key"):
        raise product_error(502, "tts_unavailable", "The voice engine isn't available right now. Please try again later.")
    try:
        async with httpx.AsyncClient(timeout=120) as c:
            r = await c.post(f"{base}/v1/speak", headers={"Authorization": f"Bearer {t['api_key']}"},
                             json={"text": body.text.strip(), "voice": body.voice, "lang": body.lang, "mode": body.mode, "speed": body.speed})
    except httpx.HTTPError:
        raise product_error(502, "tts_unavailable", "The voice engine didn't answer. Please try again.")
    if r.status_code != 200 or not r.content:
        raise product_error(502, "tts_unavailable", "We couldn't make that audio. Please try again.")
    return Response(r.content, media_type="audio/wav", headers={"Cache-Control": "no-store"})
