"""Workspace security rules: which networks may sign in, and company-wide Google sign-in (SSO) for an email domain."""

import ipaddress

from fastapi import Request
from sqlalchemy import select

from api.db.product_models import ProductMembershipModel, ProductSettingsModel
from api.product.errors import product_error
from api.product.roles import Role


def client_ip(request: Request) -> str:
    """The caller's address as our own proxy saw it (the last hop it added), so a visitor can't pick it themselves."""
    fwd = request.headers.get("x-forwarded-for")
    return (fwd.split(",")[-1].strip() if fwd else (request.client.host if request.client else "")) or "unknown"


def parse_networks(items: list[str]) -> list[str]:
    out = []
    for raw in items:
        try:
            out.append(str(ipaddress.ip_network(raw.strip(), strict=False)))
        except ValueError:
            raise product_error(400, "bad_network", f"“{raw.strip()}” isn't an address we can read. Use something like 203.0.113.7 or 203.0.113.0/24.")
    return out


def allowed(networks: list[str] | None, ip: str) -> bool:
    if not networks:
        return True
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return any(addr in ipaddress.ip_network(n, strict=False) for n in networks)


async def check_network(session, workspace_id: int, request: Request) -> None:
    networks = await session.scalar(select(ProductSettingsModel.ip_allowlist).where(ProductSettingsModel.workspace_id == workspace_id))
    if networks and not allowed(networks, client_ip(request)):
        raise product_error(403, "network_not_allowed", "This workspace can only be used from approved networks. Ask a workspace owner to add yours.")


async def sso_workspace(session, email: str) -> int | None:
    """The workspace whose company requires Google sign-in for this email's domain."""
    domain = email.rsplit("@", 1)[-1].lower()
    return await session.scalar(select(ProductSettingsModel.workspace_id).where(ProductSettingsModel.sso_required.is_(True), ProductSettingsModel.sso_domain == domain))


async def join_sso_workspace(session, workspace_id: int, user_id: int) -> None:
    have = await session.scalar(select(ProductMembershipModel).where(ProductMembershipModel.workspace_id == workspace_id, ProductMembershipModel.user_id == user_id))
    if have is None:
        session.add(ProductMembershipModel(workspace_id=workspace_id, user_id=user_id, role=Role.VIEWER.value))
