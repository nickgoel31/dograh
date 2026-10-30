"""Tenant isolation, roles and environment resolution for the product layer.

Self-contained (in-memory SQLite) so it runs without Postgres:
    DATABASE_URL=postgresql+asyncpg://x/x REDIS_URL=redis://x \
    python -m pytest api/tests/product --noconftest
"""

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from api.db import models, product_models
from api.product import config, deps, router as product_router
from api.product.roles import MATRIX, Perm, Role, can

TABLES = [
    models.UserModel.__table__,
    models.OrganizationModel.__table__,
    models.organization_users_association,
    product_models.ProductWorkspaceModel.__table__,
    product_models.ProductMembershipModel.__table__,
    product_models.ProductUserProfileModel.__table__,
]


@pytest_asyncio.fixture
async def client(monkeypatch):
    engine = create_async_engine(
        "sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    async with engine.begin() as conn:
        # SQLite can't parse Postgres-only server defaults; strip them for the test DDL.
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

    monkeypatch.setattr(product_router.rate_limit, "enforce", _no_limit)
    monkeypatch.setattr(config, "SESSION_COOKIE_SECURE", False)
    app = FastAPI()
    app.include_router(product_router.router)
    app.dependency_overrides[deps.get_session] = _session
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        c.session_factory = Session
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


async def test_signup_creates_workspace_with_two_environments(client):
    me, _ = await signup(client, "a@x.com")
    assert me["current_workspace"]["role"] == "owner"
    assert me["current_workspace"]["id"].startswith("ws_")
    assert me["user"]["id"].startswith("usr_")
    assert me["environment"] == "test"
    assert me["brand"] == config.PRODUCT_NAME


async def test_cookie_session_works(client):
    await signup(client, "a@x.com")
    r = await client.get("/product/me")
    assert r.status_code == 200 and r.json()["user"]["email"] == "a@x.com"


async def test_requires_sign_in(client):
    r = await client.get("/product/me")
    assert r.status_code == 401 and r.json()["detail"]["code"] == "not_signed_in"


async def test_users_cannot_see_each_others_workspaces(client):
    me_a, tok_a = await signup(client, "a@x.com")
    me_b, tok_b = await signup(client, "b@x.com")
    client.cookies.clear()
    ws_a = me_a["current_workspace"]["id"]
    ws_b = me_b["current_workspace"]["id"]
    assert ws_a != ws_b

    listed = (await client.get("/product/workspaces", headers=bearer(tok_b))).json()
    assert [w["id"] for w in listed] == [ws_b]

    # B asking for A's workspace gets the same answer as a workspace that doesn't exist.
    spoof = await client.get("/product/me", headers=bearer(tok_b, **{config.WORKSPACE_HEADER: ws_a}))
    missing = await client.get("/product/me", headers=bearer(tok_b, **{config.WORKSPACE_HEADER: "ws_nope"}))
    assert spoof.status_code == missing.status_code == 404
    assert spoof.json() == missing.json()


async def test_test_and_live_resolve_to_different_orgs(client):
    me, tok = await signup(client, "a@x.com")
    client.cookies.clear()
    seen = {}
    for env in ("test", "live"):
        r = await client.get("/product/me", headers=bearer(tok, **{config.ENVIRONMENT_HEADER: env}))
        assert r.status_code == 200 and r.json()["environment"] == env
    bad = await client.get("/product/me", headers=bearer(tok, **{config.ENVIRONMENT_HEADER: "prod"}))
    assert bad.status_code == 400

    from sqlalchemy import select

    async with client.session_factory() as s:
        ws = (await s.execute(select(product_models.ProductWorkspaceModel))).scalar_one()
        assert ws.test_org_id != ws.live_org_id
        assert deps.org_for_environment(ws, "test") == ws.test_org_id
        assert deps.org_for_environment(ws, "live") == ws.live_org_id


async def test_roles_are_per_membership(client):
    from sqlalchemy import select

    me_a, tok_a = await signup(client, "a@x.com")
    me_b, tok_b = await signup(client, "b@x.com")
    client.cookies.clear()
    async with client.session_factory() as s:
        ws = (
            await s.execute(
                select(product_models.ProductWorkspaceModel).where(
                    product_models.ProductWorkspaceModel.public_id == me_a["current_workspace"]["id"]
                )
            )
        ).scalar_one()
        b = (await s.execute(select(models.UserModel).where(models.UserModel.email == "b@x.com"))).scalar_one()
        s.add(product_models.ProductMembershipModel(workspace_id=ws.id, user_id=b.id, role="viewer"))
        await s.commit()
    r = await client.get(
        "/product/me", headers=bearer(tok_b, **{config.WORKSPACE_HEADER: me_a["current_workspace"]["id"]})
    )
    assert r.status_code == 200
    assert r.json()["current_workspace"]["role"] == "viewer"
    assert r.json()["permissions"] == ["read"]
    # ...while B is still owner of their own workspace.
    own = await client.get("/product/me", headers=bearer(tok_b))
    assert own.json()["current_workspace"]["role"] == "owner"


async def test_duplicate_signup_and_bad_login_are_generic(client):
    await signup(client, "a@x.com")
    dup = await client.post(
        "/product/auth/signup", json={"email": "A@x.com", "password": "password123", "name": "x"}
    )
    assert dup.status_code == 400 and dup.json()["detail"]["code"] == "signup_failed"
    bad = await client.post("/product/auth/login", json={"email": "a@x.com", "password": "wrong"})
    nouser = await client.post("/product/auth/login", json={"email": "z@x.com", "password": "wrong"})
    assert bad.status_code == nouser.status_code == 401
    assert bad.json() == nouser.json()


async def test_no_platform_names_in_responses(client):
    me, _ = await signup(client, "a@x.com")
    assert "dograh" not in str(me).lower()


def test_permission_matrix():
    assert all(can(Role.OWNER, p) for p in Perm)
    assert not can(Role.ADMIN, Perm.WORKSPACE_DELETE)
    assert can(Role.ADMIN, Perm.BILLING_MANAGE)
    assert can(Role.DEVELOPER, Perm.API_KEYS_MANAGE)
    assert not can(Role.DEVELOPER, Perm.BILLING_MANAGE)
    assert not can(Role.DEVELOPER, Perm.TEAM_MANAGE)
    assert MATRIX[Role.VIEWER] == {Perm.READ}
    assert not can("nonsense", Perm.READ)
