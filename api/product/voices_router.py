from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import delete, select

from api.db.product_models import ProductVoiceFavoriteModel
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
    # Pre-generated sample clips are not available yet.
    preview_url: str | None = None


def _out(v: catalogue.Voice, favs: set[str]) -> VoiceOut:
    return VoiceOut(
        id=v.id, name=v.name, language=v.language, style=v.style, gender=v.gender,
        age=v.age, accent=v.accent, provider=v.provider, favorite=v.id in favs,
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
    out = []
    for v in catalogue.catalogue():
        if language and v.language.lower() != language.lower():
            continue
        if q and q.lower() not in f"{v.name} {v.style or ''}".lower():
            continue
        out.append(_out(v, favs))
    return out


@router.put("/{voice_id}/favorite", response_model=VoiceOut)
async def favorite(voice_id: str, ctx: Ctx = Depends(get_ctx)):
    v = catalogue.find(voice_id)
    if v is None:
        raise product_error(404, "voice_not_found", "We couldn't find that voice.")
    if voice_id not in await _favs(ctx):
        ctx.session.add(ProductVoiceFavoriteModel(user_id=ctx.user.id, voice_id=voice_id))
        await ctx.session.commit()
    return _out(v, {voice_id})


@router.delete("/{voice_id}/favorite", response_model=VoiceOut)
async def unfavorite(voice_id: str, ctx: Ctx = Depends(get_ctx)):
    v = catalogue.find(voice_id)
    if v is None:
        raise product_error(404, "voice_not_found", "We couldn't find that voice.")
    await ctx.session.execute(
        delete(ProductVoiceFavoriteModel).where(
            ProductVoiceFavoriteModel.user_id == ctx.user.id, ProductVoiceFavoriteModel.voice_id == voice_id
        )
    )
    await ctx.session.commit()
    return _out(v, set())
