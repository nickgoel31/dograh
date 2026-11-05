from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel
from sqlalchemy import delete, select

from api.db.product_models import ProductVoiceFavoriteModel
from api.product import models_config, voice_samples
from api.product import voices as catalogue
from api.product.deps import Ctx, get_ctx
from api.product.errors import product_error

router = APIRouter(prefix="/product/voices", tags=["voices"])


class VoiceOut(BaseModel):
    id: str
    name: str
    language: str
    style: str | None
    gender: str | None
    age: str | None
    accent: str | None
    provider: str
    favorite: bool = False
    available: bool = True  # false until the voice's engine is set up (no key yet)
    description: str | None = None
    has_sample: bool = False
    brain_levels: bool = True  # false when this voice runs on one fixed AI model (Fast/Balanced/Smartest don't apply)
    # Pre-generated sample clips are not available yet.
    preview_url: str | None = None


def _out(v: catalogue.Voice, favs: set[str], ready: dict[str, bool] | None = None) -> VoiceOut:
    return VoiceOut(
        id=v.id, name=v.name, language=v.language, style=v.style, gender=v.gender,
        age=v.age, accent=v.accent, provider=v.provider, favorite=v.id in favs,
        available=(ready or {}).get(v.engine, True), description=v.tts.get("description"), brain_levels=models_config.brain_applies(v.engine), has_sample=v.engine in ("inworld", "swarvo") and (ready or {}).get(v.engine, False),
    )


async def _favs(ctx: Ctx) -> set[str]:
    rows = await ctx.session.scalars(
        select(ProductVoiceFavoriteModel.voice_id).where(ProductVoiceFavoriteModel.user_id == ctx.user.id)
    )
    return set(rows)


@router.get("", response_model=list[VoiceOut])
async def list_voices(
    language: str | None = Query(default=None, max_length=40),
    q: str | None = Query(default=None, max_length=60),
    ctx: Ctx = Depends(get_ctx),
):
    favs = await _favs(ctx)
    ready = {e: await models_config.engine_ready(ctx.session, e) for e in ("inworld", "google", "swarvo")}
    out = []
    for v in catalogue.catalogue():
        if not catalogue.can_use(v, ctx.user.email):
            continue
        if language and v.language.lower() != language.lower():
            continue
        if q and q.lower() not in f"{v.name} {v.style or ''} {v.tts.get('description') or ''}".lower():
            continue
        out.append(_out(v, favs, ready))
    return out


@router.get("/listening")
async def listening(ctx: Ctx = Depends(get_ctx)):
    """What a swarvo-tts voice can listen with, and whether each is set up."""
    from api.product import style as style_mod

    return {
        "engines": [
            {"id": "assemblyai", "label": "AssemblyAI Universal 3.5 Pro", "available": await models_config.listening_ready(ctx.session, "assemblyai")},
            {"id": "deepgram", "label": "Deepgram Nova-3", "available": await models_config.listening_ready(ctx.session, "deepgram"),
             "languages": [{"id": k, "label": v} for k, v in style_mod.DEEPGRAM_LANGUAGES.items()], "default_language": "hi"},
        ],
    }


@router.get("/{voice_id}/sample")
async def sample(voice_id: str, ctx: Ctx = Depends(get_ctx)):
    v = catalogue.find(voice_id)
    if v is not None and v.engine == "swarvo" and catalogue.can_use(v, ctx.user.email):
        prof = await models_config.engine_profile(ctx.session, "swarvo")
        t = ((prof.config or {}).get("tts") or {}) if prof else {}
        audio = await voice_samples.make_swarvo(t.get("base_url"), t.get("api_key"), v.tts["voice"]) if t.get("api_key") else None
        if audio is None:
            raise product_error(502, "sample_failed", "We couldn't make a sample right now. Please try again.")
        return Response(audio, media_type="audio/wav", headers={"Cache-Control": "private, max-age=86400"})
    prof = await models_config.engine_profile(ctx.session, "inworld") if v and v.engine == "inworld" else None
    key = ((prof.config or {}).get("realtime") or {}).get("api_key") if prof else None
    if v is None or not key:
        raise product_error(404, "no_sample", "There's no sample for this voice yet.")
    audio = await voice_samples.make(key, v.tts["voice"], v.tts.get("lang", "en"))
    if audio is None:
        raise product_error(502, "sample_failed", "We couldn't make a sample right now. Please try again.")
    return Response(audio, media_type="audio/mpeg", headers={"Cache-Control": "private, max-age=86400"})


@router.put("/{voice_id}/favorite", response_model=VoiceOut)
async def favorite(voice_id: str, ctx: Ctx = Depends(get_ctx)):
    v = catalogue.find(voice_id)
    if v is None or not catalogue.can_use(v, ctx.user.email):
        raise product_error(404, "voice_not_found", "We couldn't find that voice.")
    if voice_id not in await _favs(ctx):
        ctx.session.add(ProductVoiceFavoriteModel(user_id=ctx.user.id, voice_id=voice_id))
        await ctx.session.commit()
    return _out(v, {voice_id})


@router.delete("/{voice_id}/favorite", response_model=VoiceOut)
async def unfavorite(voice_id: str, ctx: Ctx = Depends(get_ctx)):
    v = catalogue.find(voice_id)
    if v is None or not catalogue.can_use(v, ctx.user.email):
        raise product_error(404, "voice_not_found", "We couldn't find that voice.")
    await ctx.session.execute(
        delete(ProductVoiceFavoriteModel).where(
            ProductVoiceFavoriteModel.user_id == ctx.user.id, ProductVoiceFavoriteModel.voice_id == voice_id
        )
    )
    await ctx.session.commit()
    return _out(v, set())
