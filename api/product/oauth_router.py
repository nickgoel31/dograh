"""Sign in with OAuth for the MCP server, so anyone can connect Claude (or ChatGPT) with one click: Connect, sign in to Swarvo, Allow.

The shape is the standard one the MCP specification asks for: the client finds us through two small discovery documents, registers itself, sends the
person to the consent page (a page in the app, so the person signs in the normal way), gets a one-time code back, and swaps it (with its PKCE proof) for an
access token that lasts an hour plus a refresh token. An access token is an ordinary MCP token (swm_r_/swm_f_) that expires, so the MCP server does not need
a second way of checking people. Only hashes are stored. A person sees their connections under Developers and can remove one at any time.
"""

import base64
import hashlib
import os
import secrets
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode, urlparse

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, update

from api.db.product_models import ProductApiKeyModel, ProductOAuthClientModel, ProductOAuthTokenModel
from api.product import audit
from api.product import developers as dev
from api.product.deps import Ctx, get_session, require
from api.product.errors import product_error
from api.product.ids import new_public_id
from api.product.roles import Perm

router = APIRouter(prefix="/product/oauth", tags=["oauth"])

ACCESS_TOKEN_SECONDS = 3600
CODE_SECONDS = 300
REFRESH_DAYS = 90
MAX_REDIRECTS = 10


def _now() -> datetime:
    return datetime.now(UTC)


def _aware(d: datetime | None) -> datetime | None:
    return d.replace(tzinfo=UTC) if d is not None and d.tzinfo is None else d  # SQLite hands back naive times


def _origin(request: Request) -> str:
    """The public address of this site (https, even though the proxy talks to us over http)."""
    fixed = os.getenv("PRODUCT_PUBLIC_URL", "").strip().rstrip("/")
    if fixed:
        return fixed
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or "localhost"
    local = host.split(":")[0] in ("localhost", "127.0.0.1")
    proto = "http" if local else "https"
    return f"{proto}://{host}"


def _api_base(request: Request) -> str:
    return f"{_origin(request)}/api/v1/product/oauth"


def _app_url(request: Request) -> str:
    return (os.getenv("PRODUCT_APP_URL", "").strip() or _origin(request)).rstrip("/")


def _h(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def _redirect_ok(uri: str) -> bool:
    try:
        u = urlparse(uri)
    except Exception:  # noqa: BLE001
        return False
    if u.fragment or not u.netloc or len(uri) > 500:
        return False
    if u.scheme == "https":
        return True
    return u.scheme == "http" and (u.hostname or "") in ("localhost", "127.0.0.1", "[::1]", "::1")


def _oauth_error(status: int, code: str, text: str) -> JSONResponse:
    return JSONResponse({"error": code, "error_description": text}, status_code=status, headers={"Cache-Control": "no-store"})


# ---------- discovery ----------
def authorization_server(request: Request) -> dict:
    base = _api_base(request)
    return {
        "issuer": base,
        "authorization_endpoint": f"{_app_url(request)}/connect/authorize",
        "token_endpoint": f"{base}/token",
        "registration_endpoint": f"{base}/register",
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none"],
        "scopes_supported": ["read", "full"],
    }


def protected_resource(request: Request) -> dict:
    return {"resource": f"{_origin(request)}/api/v1/swarvo-mcp", "authorization_servers": [_api_base(request)], "bearer_methods_supported": ["header"],
            "scopes_supported": ["read", "full"], "resource_name": "Swarvo AI"}


@router.get("/.well-known/oauth-authorization-server")
@router.get("/.well-known/openid-configuration")
async def discovery(request: Request):
    return authorization_server(request)


@router.get("/.well-known/oauth-protected-resource")
async def resource_metadata(request: Request):
    return protected_resource(request)


# ---------- registration ----------
class RegisterBody(BaseModel):
    client_name: str = Field(default="AI assistant", max_length=120)
    redirect_uris: list[str] = Field(min_length=1, max_length=MAX_REDIRECTS)


@router.post("/register", status_code=201)
async def register(body: RegisterBody, request: Request, session=Depends(get_session)):
    from api.utils import rate_limit

    ip = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "x")).split(",")[0].strip()
    await rate_limit.enforce(f"oauth-reg:{ip}", 30, 3600, "Too many registrations. Try again later.")
    if not all(_redirect_ok(u) for u in body.redirect_uris):
        return _oauth_error(400, "invalid_redirect_uri", "Redirect addresses must be https (or http on localhost).")
    name = (body.client_name or "AI assistant").strip()[:120] or "AI assistant"
    c = ProductOAuthClientModel(client_id="swc_" + secrets.token_urlsafe(18), name=name, redirect_uris=list(dict.fromkeys(body.redirect_uris)), created_at=_now())
    session.add(c)
    await session.commit()
    return {"client_id": c.client_id, "client_name": c.name, "redirect_uris": c.redirect_uris, "token_endpoint_auth_method": "none",
            "grant_types": ["authorization_code", "refresh_token"], "response_types": ["code"]}


# ---------- consent page support ----------
async def _client(session, client_id: str, redirect_uri: str) -> ProductOAuthClientModel:
    c = await session.scalar(select(ProductOAuthClientModel).where(ProductOAuthClientModel.client_id == client_id))
    if c is None or redirect_uri not in (c.redirect_uris or []):
        raise product_error(400, "bad_client", "This app isn't registered, or the return address doesn't match. Go back to the app and try connecting again.")
    return c


@router.get("/client")
async def client_info(client_id: str, redirect_uri: str, session=Depends(get_session)):
    c = await _client(session, client_id, redirect_uri)
    return {"name": c.name, "host": urlparse(redirect_uri).hostname or ""}


class ApproveBody(BaseModel):
    client_id: str
    redirect_uri: str
    state: str | None = Field(default=None, max_length=500)
    code_challenge: str | None = Field(default=None, max_length=128)
    code_challenge_method: str = "S256"
    access: str = Field(default="full", pattern="^(read|full)$")
    approve: bool = True


def _back(uri: str, **params) -> str:
    q = urlencode({k: v for k, v in params.items() if v is not None})
    return f"{uri}{'&' if '?' in uri else '?'}{q}"


@router.post("/approve")
async def approve(body: ApproveBody, ctx: Ctx = Depends(require(Perm.API_KEYS_MANAGE))):
    """The person said Allow (or Don't allow) on the consent page. Returns where to send them back to."""
    c = await _client(ctx.session, body.client_id, body.redirect_uri)
    if not body.approve:
        return {"redirect_url": _back(body.redirect_uri, error="access_denied", state=body.state)}
    if not body.code_challenge or body.code_challenge_method != "S256":
        raise product_error(400, "bad_request", "This app didn't send the security check (PKCE) that is required. Go back to the app and try again.")
    code = secrets.token_urlsafe(32)
    ctx.session.add(ProductOAuthTokenModel(public_id=new_public_id("oauth"), kind="code", token_hash=_h(code), client_id=c.client_id, user_id=ctx.user.id, workspace_id=ctx.workspace.id,
                                           access=body.access, redirect_uri=body.redirect_uri, code_challenge=body.code_challenge, expires_at=_now() + timedelta(seconds=CODE_SECONDS), created_at=_now()))
    await audit.record(ctx.session, ctx.workspace.id, ctx.user.id, "mcp_connection.approved", c.client_id, {"app": c.name, "access": body.access})
    await ctx.session.commit()
    return {"redirect_url": _back(body.redirect_uri, code=code, state=body.state)}


# ---------- token ----------
async def _issue(session, grant: ProductOAuthTokenModel, client_name: str) -> dict:
    """A fresh access token for this connection, and a fresh refresh token (the old one stops working)."""
    raw = ("swm_r_" if grant.access == "read" else "swm_f_") + secrets.token_urlsafe(32)
    session.add(ProductApiKeyModel(workspace_id=grant.workspace_id, public_id=new_public_id("mcp"), name=f"{client_name} (signed in)"[:80], environment="mcp", hint=f"{raw[:6]}{raw[6:10]}…{raw[-4:]}",
                                   key_hash=dev.hash_key(raw), created_by=grant.user_id, created_at=_now(), expires_at=_now() + timedelta(seconds=ACCESS_TOKEN_SECONDS), grant_id=grant.public_id))
    refresh = "swr_" + secrets.token_urlsafe(40)
    grant.kind = "refresh"
    grant.token_hash = _h(refresh)
    grant.expires_at = _now() + timedelta(days=REFRESH_DAYS)
    grant.used_at = None
    grant.last_used_at = _now()
    grant.redirect_uri = None
    grant.code_challenge = None
    await session.commit()
    return {"access_token": raw, "token_type": "Bearer", "expires_in": ACCESS_TOKEN_SECONDS, "refresh_token": refresh, "scope": grant.access}


def _pkce_ok(verifier: str, challenge: str) -> bool:
    digest = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return secrets.compare_digest(digest, challenge)


@router.post("/token")
async def token(request: Request, session=Depends(get_session)):
    form = {k: str(v) for k, v in (await request.form()).items()}
    kind = form.get("grant_type")
    if kind == "authorization_code":
        code, verifier = form.get("code", ""), form.get("code_verifier", "")
        row = await session.scalar(select(ProductOAuthTokenModel).where(ProductOAuthTokenModel.token_hash == _h(code), ProductOAuthTokenModel.kind == "code")) if code else None
        if row is None or row.revoked_at is not None or _aware(row.expires_at) < _now():
            return _oauth_error(400, "invalid_grant", "That sign-in code is not valid or has expired.")
        if row.used_at is not None:  # a code can only be used once; a second try means it leaked, so end this connection
            row.revoked_at = _now()
            await session.execute(update(ProductApiKeyModel).where(ProductApiKeyModel.grant_id == row.public_id).values(revoked_at=_now()))
            await session.commit()
            return _oauth_error(400, "invalid_grant", "That sign-in code was already used.")
        if form.get("client_id") != row.client_id or form.get("redirect_uri") != row.redirect_uri:
            return _oauth_error(400, "invalid_grant", "The app or return address doesn't match.")
        if not verifier or not row.code_challenge or not _pkce_ok(verifier, row.code_challenge):
            return _oauth_error(400, "invalid_grant", "The security check (PKCE) didn't match.")
        row.used_at = _now()
        client = await session.scalar(select(ProductOAuthClientModel).where(ProductOAuthClientModel.client_id == row.client_id))
        out = await _issue(session, row, client.name if client else "AI assistant")
        return JSONResponse(out, headers={"Cache-Control": "no-store", "Pragma": "no-cache"})
    if kind == "refresh_token":
        raw = form.get("refresh_token", "")
        row = await session.scalar(select(ProductOAuthTokenModel).where(ProductOAuthTokenModel.token_hash == _h(raw), ProductOAuthTokenModel.kind == "refresh")) if raw else None
        if row is None or row.revoked_at is not None or _aware(row.expires_at) < _now():
            return _oauth_error(400, "invalid_grant", "This connection has ended. Connect again from the app.")
        if form.get("client_id") and form["client_id"] != row.client_id:
            return _oauth_error(400, "invalid_grant", "The app doesn't match.")
        client = await session.scalar(select(ProductOAuthClientModel).where(ProductOAuthClientModel.client_id == row.client_id))
        out = await _issue(session, row, client.name if client else "AI assistant")
        return JSONResponse(out, headers={"Cache-Control": "no-store", "Pragma": "no-cache"})
    return _oauth_error(400, "unsupported_grant_type", "Use authorization_code or refresh_token.")


# ---------- the person's connections ----------
class ConnectionOut(BaseModel):
    id: str
    app: str
    access: str
    connected: str
    last_used: str | None


@router.get("/connections", response_model=list[ConnectionOut])
async def connections(ctx: Ctx = Depends(require(Perm.API_KEYS_MANAGE))):
    rows = (await ctx.session.scalars(select(ProductOAuthTokenModel).where(
        ProductOAuthTokenModel.workspace_id == ctx.workspace.id, ProductOAuthTokenModel.kind == "refresh", ProductOAuthTokenModel.revoked_at.is_(None)).order_by(ProductOAuthTokenModel.id.desc()))).all()
    names = {c.client_id: c.name for c in (await ctx.session.scalars(select(ProductOAuthClientModel).where(ProductOAuthClientModel.client_id.in_({r.client_id for r in rows})))).all()} if rows else {}
    now = _now()
    return [ConnectionOut(id=r.public_id, app=names.get(r.client_id, "AI assistant"), access=r.access, connected=r.created_at.isoformat() if r.created_at else "",
                          last_used=r.last_used_at.isoformat() if r.last_used_at else None) for r in rows if _aware(r.expires_at) >= now]


@router.delete("/connections/{connection_id}")
async def disconnect(connection_id: str, ctx: Ctx = Depends(require(Perm.API_KEYS_MANAGE))):
    row = await ctx.session.scalar(select(ProductOAuthTokenModel).where(ProductOAuthTokenModel.public_id == connection_id, ProductOAuthTokenModel.workspace_id == ctx.workspace.id))
    if row is None:
        raise product_error(404, "key_not_found", "We couldn't find that connection.")
    row.revoked_at = row.revoked_at or _now()
    await ctx.session.execute(update(ProductApiKeyModel).where(ProductApiKeyModel.grant_id == row.public_id, ProductApiKeyModel.revoked_at.is_(None)).values(revoked_at=_now()))
    await audit.record(ctx.session, ctx.workspace.id, ctx.user.id, "mcp_connection.revoked", row.public_id)
    await ctx.session.commit()
    return {"ok": True}
