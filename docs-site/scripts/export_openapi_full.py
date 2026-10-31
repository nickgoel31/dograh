"""Build an OpenAPI file with EVERY product router (the shipped export script leaves out developers, team, public API, etc.).
Run from the repo root: python docs-site/scripts/export_openapi_full.py"""
import importlib, json, os, sys
sys.path.insert(0, ".")
for k in ("DATABASE_URL", "REDIS_URL", "MINIO_PUBLIC_ENDPOINT"):
    os.environ.setdefault(k, {"DATABASE_URL": "postgresql+asyncpg://u:p@localhost/x", "REDIS_URL": "redis://localhost:6379", "MINIO_PUBLIC_ENDPOINT": "http://localhost:9000"}[k])
from fastapi import FastAPI
from api.product import config
from api.product.export_openapi import build_app
app = build_app()
extra = ["account_router", "connectors_router", "contacts_router", "developers_router", "google_auth", "help_router", "integrations_router", "phonetest_router", "flowtry_router", "public_api", "team_router", "widget_router"]
have = {id(r.endpoint) for r in app.routes if hasattr(r, "endpoint")}
for name in extra:
    try:
        m = importlib.import_module(f"api.product.{name}")
    except Exception as e:
        print("skip", name, repr(e)[:80]); continue
    for attr in ("router", "ops_router"):
        r = getattr(m, attr, None)
        if r is not None:
            try:
                app.include_router(r, prefix="/api/v1")
            except Exception as e:
                print("skip", name, attr, repr(e)[:80])
spec = app.openapi()
# hide internal-only paths
spec["paths"] = {p: v for p, v in spec["paths"].items() if "/hooks/" not in p}
spec["info"]["title"] = "Swarvo AI API"
spec["info"]["description"] = "Product API used by the Swarvo AI app, and the public API under /api/v1/public (API-key access)."
os.makedirs("docs-site/src/data", exist_ok=True)
json.dump(spec, open("docs-site/src/data/openapi.json", "w", encoding="utf-8"), indent=1)
print(len(spec["paths"]), "paths")
