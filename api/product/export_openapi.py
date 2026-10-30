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
from api.product.campaigns_router import router as campaigns_router
from api.product.handoff_router import router as handoff_router
from api.product.analytics_router import router as analytics_router
from api.product.home_router import router as home_router
from api.product.labs_router import router as lab_router
from api.product.import_router import router as import_router
from api.product.knowledge_router import router as knowledge_router
from api.product.notifications import router as notifications_router
from api.product.tools_router import router as tools_router
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
    for r in (analytics_router, lab_router, handoff_router, import_router, billing_router, campaigns_router, home_router, knowledge_router, notifications_router, tools_router):
        app.include_router(r, prefix="/api/v1")
    return app


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "openapi.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(build_app().openapi(), f, indent=2)
    print(f"wrote {out}")
