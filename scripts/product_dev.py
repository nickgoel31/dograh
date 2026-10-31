"""Run the product API for looking around: in-memory database, stand-ins for the platform.

Not for production. Calls, uploads, payments and phone numbers are simulated; data resets on restart.

    python scripts/product_dev.py            # API on http://localhost:8000
    cd vocalis-web && npm run dev            # web app on http://localhost:5174 (proxies /api to :8000)
"""

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
for k, v in {
    "DATABASE_URL": "postgresql+asyncpg://dev/dev", "REDIS_URL": "redis://dev", "MINIO_PUBLIC_ENDPOINT": "http://localhost:9000",
    "PRODUCT_COOKIE_SECURE": "false", "PRODUCT_ALLOWED_ORIGINS": "http://localhost:5174,http://localhost:5173",
    "PRODUCT_PROFILES": '{"default":"inworld","inworld":"inworld","google":"google"}', "PRODUCT_FREE_MINUTES": "30", "PRODUCT_NEW_UI_ORGS": "*",
}.items():
    os.environ.setdefault(k, v)

import uvicorn  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from api.db import models  # noqa: E402
from api.product import (agents_router, analytics_router, billing_router, calls_router, campaigns_router, conversations_router, deps, developers_router, gateway, handoff_router, help_router, home_router,  # noqa: E402
                         import_router, knowledge_router, labs_router, llm_gateway, notifications, numbers_router, payments, public_api, team_router, tools_router, voices_router, widget_router)
from api.product import router as product_router  # noqa: E402
from api.tests.product.support import (PROFILES, TABLES, FakeCampaigns, FakeGateway, FakeKB, FakeLLM, FakeText, FakeTools, FakeWallet)  # noqa: E402

for t in TABLES:
    t.indexes.clear()
    for c in t.columns:
        c.server_default = None

engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
Session = async_sessionmaker(engine, expire_on_commit=False)


async def _session():
    async with Session() as s:
        yield s


async def _no_limit(*a, **k):
    return None


product_router.rate_limit.enforce = _no_limit
os.environ.setdefault("PRODUCT_ALLOW_PRIVATE_WEBHOOKS", "true")
app = FastAPI(title="Product dev API")
for r in (product_router, analytics_router, labs_router, handoff_router, import_router, agents_router, voices_router, calls_router, conversations_router, numbers_router, billing_router,
          campaigns_router, home_router, knowledge_router, notifications, tools_router, developers_router, help_router, public_api, team_router, widget_router):
    app.include_router(r.router, prefix="/api/v1")
app.include_router(developers_router.ops_router, prefix="/api/v1")
fake, wallet = FakeGateway(), FakeWallet()
kb, tl, cp = FakeKB(), FakeTools(), FakeCampaigns()
app.dependency_overrides.update({
    deps.get_session: _session, gateway.get_gateway: lambda: fake, payments.get_wallet: lambda: wallet,
    llm_gateway.get_text: lambda: FakeText(), llm_gateway.get_llm: lambda: FakeLLM(), labs_router.get_session_factory: lambda: Session,
    knowledge_router.get_knowledge: lambda: kb, tools_router.get_tools: lambda: tl, campaigns_router.get_campaigns: lambda: cp,
})


@app.on_event("startup")
async def _init():
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: models.Base.metadata.create_all(c, tables=TABLES))
    async with Session() as s:
        llm = {"provider": "openai", "api_key": "dev", "model": "dev"}
        rt = {"inworld": {"provider": "inworld_realtime", "api_key": "dev-key", "model": "google-ai-studio/gemini-3.1-flash-lite", "voice": "Seema", "stt_model": "assemblyai/universal-3-5-pro", "tts_model": "inworld-tts-2", "language": "auto"},
              "google": {"provider": "google_realtime", "api_key": "", "model": "gemini-3.1-flash-live-preview", "voice": "Zephyr", "language": "en-hi"}}
        for slug, cfg in rt.items():  # the real voice engines; Google has no key yet, so its voices show as "Coming soon"
            s.add(models.ModelProfileModel(slug=slug, display_name=slug, config={"is_realtime": True, "llm": llm, "realtime": cfg}, is_active=True))
        await s.commit()
        await _seed_old_account(s)


async def _seed_old_account(s):
    """An account from before the new product, so the "bring over your organization" screen can be tried:
    old@example.com / old-password, with an organization and two agents."""
    from sqlalchemy import insert

    from api.product.definition import build_definition
    from api.utils.auth import hash_password

    u = models.UserModel(provider_id="old_demo", email="old@example.com", password_hash=hash_password("old-password"), role="admin")
    org = models.OrganizationModel(provider_id="org_old_demo", name="Swarvo Clinic")
    s.add_all([u, org])
    await s.flush()
    await s.execute(insert(models.organization_users_association).values(user_id=u.id, organization_id=org.id))
    for i, name in enumerate(("Front desk", "Appointment booker"), start=500):
        fake.published[(org.id, i)] = build_definition(name=name, prompt=f"You are the {name.lower()} for Swarvo Clinic.", greeting="Hello!")
        fake.names[(org.id, i)] = name
    await s.commit()


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="warning")
