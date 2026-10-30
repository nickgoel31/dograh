"""Workspace roles and the permission matrix.

Roles live on the membership (a person can be Owner of one workspace and
Viewer of another), unlike the core ``users.role`` column.
"""

from enum import Enum


class Role(str, Enum):
    OWNER = "owner"
    ADMIN = "admin"
    DEVELOPER = "developer"
    VIEWER = "viewer"


class Perm(str, Enum):
    READ = "read"
    AGENTS_WRITE = "agents.write"
    TOOLS_WRITE = "tools.write"
    API_KEYS_MANAGE = "api_keys.manage"
    WEBHOOKS_MANAGE = "webhooks.manage"
    TEAM_MANAGE = "team.manage"
    BILLING_MANAGE = "billing.manage"
    WORKSPACE_DELETE = "workspace.delete"
    WORKSPACE_CREATE_CHILD = "workspace.create_child"


_READ = {Perm.READ}
_DEV = _READ | {
    Perm.AGENTS_WRITE,
    Perm.TOOLS_WRITE,
    Perm.API_KEYS_MANAGE,
    Perm.WEBHOOKS_MANAGE,
}
_ADMIN = _DEV | {Perm.TEAM_MANAGE, Perm.BILLING_MANAGE, Perm.WORKSPACE_CREATE_CHILD}

# Owner: everything. Admin: everything except destroying the workspace.
# Developer: build things, no team/billing. Viewer: read-only.
MATRIX: dict[Role, frozenset[Perm]] = {
    Role.OWNER: frozenset(set(Perm)),
    Role.ADMIN: frozenset(_ADMIN),
    Role.DEVELOPER: frozenset(_DEV),
    Role.VIEWER: frozenset(_READ),
}


def can(role: str | Role, perm: Perm) -> bool:
    try:
        return perm in MATRIX[Role(role)]
    except ValueError:
        return False
