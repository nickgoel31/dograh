"""Bring an existing organization and its agents into the new product.

The existing organization becomes the workspace's *Live* side in place, so live agents, phone numbers, knowledge and
billing keep working exactly as they do now. A new, empty Test organization is added next to it, and each live agent
gets a Test copy to edit safely.
"""

from copy import deepcopy

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from api.db.models import OrganizationModel, UserModel, organization_users_association
from api.db.product_models import ProductAgentModel, ProductMembershipModel, ProductWorkspaceModel
from api.product import models_config, rollout
from api.product.deps import get_user_only
from api.product.errors import product_error
from api.product.gateway import PlatformGateway, get_gateway
from api.product.ids import decode_id, encode_id, new_public_id
from api.product.roles import Role
from api.product.service import _create_org

router = APIRouter(prefix="/product/import", tags=["import"])
ADMIN_ROLES = ("admin", "super_admin")


class Candidate(BaseModel):
    id: str
    name: str
    agents: int


class ImportBody(BaseModel):
    organization_id: str
    name: str | None = Field(default=None, max_length=120)


def _copy_for_test(defn: dict) -> dict:
    """A safe editing copy: no links to the live organization's documents/tools, no API triggers (their paths must stay unique)."""
    d = deepcopy(defn or {})
    drop = {n["id"] for n in d.get("nodes", []) if n.get("type") == "trigger"}
    d["nodes"] = [n for n in d.get("nodes", []) if n["id"] not in drop]
    d["edges"] = [e for e in d.get("edges", []) if e.get("source") not in drop and e.get("target") not in drop]
    for n in d["nodes"]:
        data = n.get("data") or {}
        for k in ("document_uuids", "tool_uuids"):
            if k in data:
                data[k] = []
    return d


def _start_prompt(defn: dict) -> str:
    for n in (defn or {}).get("nodes", []):
        if n.get("type") == "startCall":
            return (n.get("data") or {}).get("prompt", "") or ""
    return ""


@router.get("/candidates", response_model=list[Candidate])
async def candidates(base=Depends(get_user_only), gw: PlatformGateway = Depends(get_gateway)):
    """Organizations the signed-in person administers that aren't part of a workspace yet."""
    session, user = base
    taken = set((await session.scalars(select(ProductWorkspaceModel.live_org_id))).all()) | set((await session.scalars(select(ProductWorkspaceModel.test_org_id))).all())
    orgs = (await session.scalars(
        select(OrganizationModel).join(organization_users_association, organization_users_association.c.organization_id == OrganizationModel.id)
        .where(organization_users_association.c.user_id == user.id, OrganizationModel.is_active.is_(True)))).all()
    out = []
    for o in orgs:
        if o.id in taken or user.role not in ADMIN_ROLES or not rollout.org_allowed(o.id):
            continue
        n = len([a for a in await gw.list_agents(o.id) if a["active"]])
        out.append(Candidate(id=encode_id("org", o.id), name=o.name or "Your organization", agents=n))
    return out


@router.post("", status_code=201)
async def import_org(body: ImportBody, base=Depends(get_user_only), gw: PlatformGateway = Depends(get_gateway)):
    session, user = base
    org_id = decode_id("org", body.organization_id)
    member = org_id and await session.scalar(select(func.count()).select_from(organization_users_association).where(
        organization_users_association.c.user_id == user.id, organization_users_association.c.organization_id == org_id))
    org = await session.get(OrganizationModel, org_id) if member else None
    if org is None:  # not yours looks the same as not existing
        raise product_error(404, "organization_not_found", "We couldn't find that organization.")
    if not rollout.org_allowed(org.id):
        raise product_error(403, "not_enabled", rollout.NOT_ENABLED)
    if user.role not in ADMIN_ROLES:
        raise product_error(403, "not_allowed", "Only an administrator can bring an organization over. Ask one to do it.")
    if await session.scalar(select(ProductWorkspaceModel.id).where(
            (ProductWorkspaceModel.live_org_id == org.id) | (ProductWorkspaceModel.test_org_id == org.id))):
        raise product_error(409, "already_imported", "That organization has already been brought over.")

    name = (body.name or org.name or "My workspace").strip()[:120]
    test = await _create_org(session, f"{name} (test)", user.id)
    ws = ProductWorkspaceModel(public_id=new_public_id("ws"), name=name, owner_user_id=user.id, live_org_id=org.id, test_org_id=test.id, adopted=True)
    session.add(ws)
    await session.flush()
    session.add(ProductMembershipModel(workspace_id=ws.id, user_id=user.id, role=Role.OWNER.value))
    members = (await session.execute(
        select(UserModel.id, UserModel.role).join(organization_users_association, organization_users_association.c.user_id == UserModel.id)
        .where(organization_users_association.c.organization_id == org.id, UserModel.id != user.id))).all()
    for uid, role in members:  # core admin -> Admin, anyone else -> Viewer (read-only until an owner changes it)
        session.add(ProductMembershipModel(workspace_id=ws.id, user_id=uid, role=Role.ADMIN.value if role == "admin" else Role.VIEWER.value))
    await models_config.ensure_org_profiles(session, test.id)  # the existing Live org keeps whatever models it already uses

    imported = skipped = 0
    for a in await gw.list_agents(org.id):
        if not a["active"]:
            skipped += 1
            continue
        copy_id = await gw.create_agent(test.id, user.id, a["name"], _copy_for_test(a["definition"]))
        session.add(ProductAgentModel(
            public_id=new_public_id("agt"), workspace_id=ws.id, name=a["name"][:120], role="", business="", what_you_do="",
            prompt_mode="custom",  # keep their wording exactly as written
            status="live", test_workflow_id=copy_id, live_workflow_id=a["id"],
        ))
        imported += 1
    await session.commit()
    return {"workspace_id": ws.public_id, "imported": imported, "skipped": skipped}
