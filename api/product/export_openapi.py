"""Write the product-only OpenAPI spec (no platform routes or names).

    python -m api.product.export_openapi vocalis-web/openapi.json
"""

import json
import sys

from fastapi import FastAPI

from api.product import config
from api.product.agents_router import router as agents_router
from api.product.calls_router import router as calls_router
from api.product.conversations_router import router as conversations_router
from api.product.billing_router import router as billing_router
from api.product.numbers_router import router as numbers_router
from api.product.voices_router import router as voices_router
from api.product.router import router


def build_app() -> FastAPI:
    app = FastAPI(title=f"{config.PRODUCT_NAME} API", version="0.1.0", openapi_url="/openapi.json")
    app.include_router(router, prefix="/api/v1")
    app.include_router(agents_router, prefix="/api/v1")
    app.include_router(voices_router, prefix="/api/v1")
    app.include_router(calls_router, prefix="/api/v1")
    app.include_router(conversations_router, prefix="/api/v1")
    app.include_router(numbers_router, prefix="/api/v1")
    app.include_router(billing_router, prefix="/api/v1")
    return app


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "openapi.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(build_app().openapi(), f, indent=2)
    print(f"wrote {out}")
