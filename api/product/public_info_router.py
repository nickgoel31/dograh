"""Public pages that need no sign-in: platform status, changelog, API reference and the SDK files."""

from pathlib import Path

from fastapi import APIRouter, Depends
from fastapi.responses import PlainTextResponse

from api.product import api_reference, status_page
from api.product.changelog import CHANGELOG
from api.product.deps import get_session
from api.product.errors import product_error

router = APIRouter(prefix="/product/public", tags=["public-info"])
SDK_DIR = Path(__file__).parent / "sdk"
SDK_FILES = {"python": "swarvo.py", "typescript": "swarvo.ts"}


@router.get("/status")
async def status(session=Depends(get_session)):
    return await status_page.summary(session)


@router.get("/changelog")
async def changelog():
    return [{"date": e["date"], "title": e["title"], "items": [{"kind": k, "text": t} for k, t in e["items"]]} for e in CHANGELOG]


@router.get("/api-reference")
async def reference():
    return api_reference.reference("{base}")


@router.get("/sdk/{lang}", response_class=PlainTextResponse)
async def sdk(lang: str):
    name = SDK_FILES.get(lang)
    if name is None:
        raise product_error(404, "not_found", "There is no client for that language yet.")
    return PlainTextResponse((SDK_DIR / name).read_text(encoding="utf-8"), headers={"Content-Disposition": f'attachment; filename="{name}"'})
