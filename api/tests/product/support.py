"""Shared test helpers for the product layer (in-memory SQLite + a fake platform)."""

import itertools
from contextlib import asynccontextmanager
from copy import deepcopy

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from api.db import models, product_models
from api.product import agents_router, calls_router, config, deps, gateway, voices_router
from api.product import router as product_router

TABLES = [
    models.UserModel.__table__,
    models.OrganizationModel.__table__,
    models.organization_users_association,
    product_models.ProductWorkspaceModel.__table__,
    product_models.ProductMembershipModel.__table__,
    product_models.ProductUserProfileModel.__table__,
    product_models.ProductAgentModel.__table__,
    product_models.ProductVoiceFavoriteModel.__table__,
]


class FakeGateway:
    """In-memory stand-in for the platform workflow store, keyed by (org, id)."""

    def __init__(self):
        self._ids = itertools.count(1)
        self.published: dict[tuple[int, int], dict] = {}
        self.drafts: dict[tuple[int, int], dict] = {}
        self.names: dict[tuple[int, int], str] = {}
        self.runs: list[tuple[int, int, int]] = []
        self.served: list[tuple[int, int, int]] = []

    async def create_agent(self, org_id, user_id, name, definition):
        i = next(self._ids)
        self.published[(org_id, i)] = deepcopy(definition)
        self.names[(org_id, i)] = name
        return i

    async def save_draft(self, org_id, agent_ref, name, definition):
        if (org_id, agent_ref) not in self.published:
            raise LookupError("wrong org")
        self.drafts[(org_id, agent_ref)] = deepcopy(definition)
        self.names[(org_id, agent_ref)] = name

    async def publish(self, org_id, agent_ref):
        key = (org_id, agent_ref)
        if key not in self.published:
            raise LookupError("wrong org")
        if key in self.drafts:
            self.published[key] = self.drafts.pop(key)

    async def published_definition(self, org_id, agent_ref):
        return deepcopy(self.published.get((org_id, agent_ref)))

    async def working_definition(self, org_id, agent_ref):
        key = (org_id, agent_ref)
        return deepcopy(self.drafts.get(key) or self.published.get(key))


@asynccontextmanager
async def make_client(monkeypatch):
    engine = create_async_engine(
        "sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    async with engine.begin() as conn:
        for t in TABLES:
            for c in t.columns:
                c.server_default = None
        await conn.run_sync(lambda c: models.Base.metadata.create_all(c, tables=TABLES))
    Session = async_sessionmaker(engine, expire_on_commit=False)

    async def _session():
        async with Session() as s:
            yield s

    async def _no_limit(*a, **k):
        return None

    fake = FakeGateway()
    monkeypatch.setattr(product_router.rate_limit, "enforce", _no_limit)
    monkeypatch.setattr(config, "SESSION_COOKIE_SECURE", False)
    app = FastAPI()
    app.include_router(product_router.router)
    app.include_router(agents_router.router)
    app.include_router(voices_router.router)
    app.include_router(calls_router.router)
    app.dependency_overrides[deps.get_session] = _session
    app.dependency_overrides[gateway.get_gateway] = lambda: fake
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        c.session_factory = Session
        c.fake = fake
        yield c
    await engine.dispose()


async def signup(client, email, name="Ann"):
    r = await client.post(
        "/product/auth/signup", json={"email": email, "password": "password123", "name": name}
    )
    assert r.status_code == 200, r.text
    return r.json(), r.cookies.get(config.SESSION_COOKIE_NAME)


def bearer(token, **extra):
    return {"Authorization": f"Bearer {token}", **extra}


async def _start_test_run(self, org_id, user_id, agent_ref):
    if (org_id, agent_ref) not in self.published:
        raise LookupError("wrong org")
    self.runs.append((org_id, user_id, agent_ref))
    return len(self.runs)


async def _serve_signaling(self, ws, org_id, user_id, agent_ref, run_id):
    self.served.append((org_id, agent_ref, run_id))
    await ws.accept()
    await ws.send_json({"type": "answer", "payload": {"run": run_id}})
    await ws.close()


FakeGateway.start_test_run = _start_test_run
FakeGateway.serve_signaling = _serve_signaling
