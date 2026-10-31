"""Team & Settings: members, invites, audit log, privacy settings, two-step sign-in, sub-accounts."""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select

from api.db.models import UserModel
from api.db.product_models import ProductAuditModel, ProductInviteModel, ProductMembershipModel, ProductUserProfileModel, ProductWorkspaceModel
from api.product import audit, config, emailer, privacy, totp
from api.product.deps import Ctx, get_ctx, get_user_only, require
from api.product.errors import product_error
from api.product.ids import new_public_id, user_public_id
from api.product.roles import Perm, Role
from api.product.service import create_workspace

router = APIRouter(prefix="/product/team", tags=["team"])

INVITE_DAYS = 7
INVITABLE = (Role.ADMIN.value, Role.DEVELOPER.value, Role.VIEWER.value)


class MemberOut(BaseModel):
    id: str
    email: str | None
    name: str | None
    role: str
    you: bool


class InviteBody(BaseModel):
    email: EmailStr
    role: str = Role.VIEWER.value


class InviteOut(BaseModel):
    id: str
    email: str
    role: str
    expires: str
    token: str | None = None  # only in the response that creates it


class TeamOut(BaseModel):
    members: list[MemberOut]
    invites: list[InviteOut]


class RoleBody(BaseModel):
    role: str


class AcceptBody(BaseModel):
    token: str = Field(min_length=10, max_length=100)


class SettingsBody(BaseModel):
    record_calls: bool
    consent_announcement: str | None = Field(default=None, max_length=300)
    redact_pii: bool
    retention_days: int | None = Field(default=None, ge=1, le=3650)
    widget_origins: list[str] = Field(default_factory=list, max_length=20)
    summary_emails: list[EmailStr] = Field(default_factory=list, max_length=5)


class SettingsOut(SettingsBody):
    notes: list[str] = []


class AuditOut(BaseModel):
    time: str
    who: str | None
    action: str
    target: str | None
    detail: dict | None


class CodeBody(BaseModel):
    code: str = Field(min_length=6, max_length=8)


def _hash(t: str) -> str:
    return hashlib.sha256(t.encode()).hexdigest()


async def _members(ctx: Ctx) -> list[tuple[ProductMembershipModel, UserModel, str | None]]:
    rows = (await ctx.session.execute(
        select(ProductMembershipModel, UserModel, ProductUserProfileModel.display_name)
        .join(UserModel, UserModel.id == ProductMembershipModel.user_id).outerjoin(ProductUserProfileModel, ProductUserProfileModel.user_id == UserModel.id)
        .where(ProductMembershipModel.workspace_id == ctx.workspace.id).order_by(ProductMembershipModel.id))).all()
    return [(m, u, n) for m, u, n in rows]


def _invite_out(i: ProductInviteModel, token: str | None = None) -> InviteOut:
    return InviteOut(id=i.public_id, email=i.email, role=i.role, expires=i.expires_at.isoformat(), token=token)


@router.get("", response_model=TeamOut)
async def team(ctx: Ctx = Depends(get_ctx)):
    members = [MemberOut(id=user_public_id(u.provider_id), email=u.email, name=n, role=m.role, you=u.id == ctx.user.id) for m, u, n in await _members(ctx)]
    invites: list[InviteOut] = []
    if ctx.role in (Role.OWNER.value, Role.ADMIN.value):
        rows = (await ctx.session.scalars(select(ProductInviteModel).where(
            ProductInviteModel.workspace_id == ctx.workspace.id, ProductInviteModel.accepted_at.is_(None), ProductInviteModel.revoked_at.is_(None)).order_by(ProductInviteModel.id.desc()))).all()
        invites = [_invite_out(i) for i in rows]
    return TeamOut(members=members, invites=invites)


@router.post("/invites", response_model=InviteOut, status_code=201)
async def invite(body: InviteBody, ctx: Ctx = Depends(require(Perm.TEAM_MANAGE)), mailer: emailer.Mailer = Depends(emailer.get_mailer)):
    if body.role not in INVITABLE:
        raise product_error(400, "bad_role", "Choose admin, developer or viewer.")
    email = body.email.lower()
    if any((u.email or "").lower() == email for _, u, _ in await _members(ctx)):
        raise product_error(400, "already_member", "That person is already on this team.")
    token = secrets.token_urlsafe(24)
    inv = ProductInviteModel(workspace_id=ctx.workspace.id, public_id=new_public_id("inv"), email=email, role=body.role, token_hash=_hash(token), invited_by=ctx.user.id,
                             expires_at=datetime.now(UTC) + timedelta(days=INVITE_DAYS), created_at=datetime.now(UTC))
    ctx.session.add(inv)
    await audit.record(ctx.session, ctx.workspace.id, ctx.user.id, "invite.created", email, {"role": body.role})
    await ctx.session.commit()
    link = f"{emailer.app_url()}/invite/{token}"
    await mailer.send(email, f"You're invited to {ctx.workspace.name}", f"{ctx.user.email} invited you to {ctx.workspace.name}. Join: {link}",
                      emailer.wrap("You're invited", f"<p>{ctx.user.email} invited you to <b>{ctx.workspace.name}</b>. The link works once, for {INVITE_DAYS} days, for this email only.</p>", ("Join the team", link)))
    return _invite_out(inv, token)


@router.delete("/invites/{invite_id}")
async def revoke_invite(invite_id: str, ctx: Ctx = Depends(require(Perm.TEAM_MANAGE))):
    inv = await ctx.session.scalar(select(ProductInviteModel).where(ProductInviteModel.public_id == invite_id, ProductInviteModel.workspace_id == ctx.workspace.id))
    if inv is None:
        raise product_error(404, "invite_not_found", "We couldn't find that invite.")
    inv.revoked_at = datetime.now(UTC)
    await audit.record(ctx.session, ctx.workspace.id, ctx.user.id, "invite.revoked", inv.email)
    await ctx.session.commit()
    return {"ok": True}


@router.post("/invites/accept")
async def accept(body: AcceptBody, base=Depends(get_user_only)):
    session, user = base
    inv = await session.scalar(select(ProductInviteModel).where(ProductInviteModel.token_hash == _hash(body.token)))
    now = datetime.now(UTC)
    exp = inv.expires_at.replace(tzinfo=UTC) if inv and inv.expires_at.tzinfo is None else (inv.expires_at if inv else None)
    if inv is None or inv.accepted_at or inv.revoked_at or exp < now:
        raise product_error(400, "invite_invalid", "This invite isn't valid any more. Ask for a new one.")
    if (user.email or "").lower() != inv.email:
        raise product_error(403, "invite_wrong_account", f"This invite was sent to {inv.email}. Sign in with that email to accept it.")
    if not await session.scalar(select(ProductMembershipModel.id).where(ProductMembershipModel.workspace_id == inv.workspace_id, ProductMembershipModel.user_id == user.id)):
        session.add(ProductMembershipModel(workspace_id=inv.workspace_id, user_id=user.id, role=inv.role))
    inv.accepted_at = now
    await audit.record(session, inv.workspace_id, user.id, "invite.accepted", inv.email, {"role": inv.role})
    ws = await session.get(ProductWorkspaceModel, inv.workspace_id)
    await session.commit()
    return {"workspace": ws.public_id, "name": ws.name, "role": inv.role}


async def _member(ctx: Ctx, member_id: str) -> tuple[ProductMembershipModel, UserModel]:
    m = next(((m, u) for m, u, _ in await _members(ctx) if user_public_id(u.provider_id) == member_id), None)
    if m is None:
        raise product_error(404, "member_not_found", "We couldn't find that person.")
    return m


@router.patch("/members/{member_id}")
async def change_role(member_id: str, body: RoleBody, ctx: Ctx = Depends(require(Perm.TEAM_MANAGE))):
    if body.role not in INVITABLE:
        raise product_error(400, "bad_role", "Choose admin, developer or viewer.")
    m, u = await _member(ctx, member_id)
    if m.role == Role.OWNER.value or u.id == ctx.user.id:
        raise product_error(400, "cannot_change", "The owner's role, and your own, can't be changed here.")
    before, m.role = m.role, body.role
    await audit.record(ctx.session, ctx.workspace.id, ctx.user.id, "member.role_changed", u.email, {"from": before, "to": body.role})
    await ctx.session.commit()
    return {"ok": True}


@router.delete("/members/{member_id}")
async def remove_member(member_id: str, ctx: Ctx = Depends(require(Perm.TEAM_MANAGE))):
    m, u = await _member(ctx, member_id)
    if m.role == Role.OWNER.value or u.id == ctx.user.id:
        raise product_error(400, "cannot_remove", "The owner, and yourself, can't be removed here.")
    await ctx.session.delete(m)
    await audit.record(ctx.session, ctx.workspace.id, ctx.user.id, "member.removed", u.email)
    await ctx.session.commit()
    return {"ok": True}


@router.get("/audit", response_model=list[AuditOut])
async def audit_log(limit: int = 100, ctx: Ctx = Depends(require(Perm.TEAM_MANAGE))):
    rows = (await ctx.session.execute(select(ProductAuditModel, UserModel.email).outerjoin(UserModel, UserModel.id == ProductAuditModel.user_id)
                                      .where(ProductAuditModel.workspace_id == ctx.workspace.id).order_by(ProductAuditModel.id.desc()).limit(max(1, min(limit, 500))))).all()
    return [AuditOut(time=a.created_at.isoformat() if a.created_at else "", who=e, action=a.action, target=a.target, detail=a.detail) for a, e in rows]


# ---- privacy ------------------------------------------------------------------

def _settings_out(s) -> SettingsOut:
    notes = ["Turning recording off hides playback here. Whether audio is captured at all is set on the voice platform (see the operator guide)."] if not s.record_calls else []
    if s.consent_announcement:
        notes.append("The announcement is added to an agent's greeting the next time that agent goes live.")
    if s.retention_days:
        notes.append("Older recordings and transcripts are cleared by the operator's daily job, or by the owner using Clear now.")
    return SettingsOut(record_calls=bool(s.record_calls), consent_announcement=s.consent_announcement, redact_pii=bool(s.redact_pii), retention_days=s.retention_days,
                       widget_origins=list(s.widget_origins or []), summary_emails=list(s.summary_emails or []), notes=notes)


@router.get("/settings", response_model=SettingsOut)
async def get_settings(ctx: Ctx = Depends(get_ctx)):
    out = _settings_out(await privacy.get_settings(ctx.session, ctx.workspace.id))
    await ctx.session.commit()
    return out


@router.put("/settings", response_model=SettingsOut)
async def put_settings(body: SettingsBody, ctx: Ctx = Depends(require(Perm.TEAM_MANAGE))):
    origins = []
    for o in body.widget_origins:
        o = o.strip().rstrip("/")
        if not (o.startswith("https://") or o.startswith("http://localhost")):
            raise product_error(400, "bad_origin", "Website addresses must look like https://example.com")
        origins.append(o)
    s = await privacy.get_settings(ctx.session, ctx.workspace.id)
    s.record_calls, s.redact_pii, s.retention_days = body.record_calls, body.redact_pii, body.retention_days
    s.consent_announcement = (body.consent_announcement or "").strip() or None
    s.widget_origins = origins
    s.summary_emails = sorted({str(e).lower() for e in body.summary_emails})
    await audit.record(ctx.session, ctx.workspace.id, ctx.user.id, "settings.updated", None, body.model_dump(exclude={"widget_origins", "summary_emails"}))
    await ctx.session.commit()
    return _settings_out(s)


@router.post("/privacy/purge")
async def purge(ctx: Ctx = Depends(require(Perm.WORKSPACE_DELETE))):
    n = await privacy.purge_expired(ctx.session, ctx.workspace)
    await audit.record(ctx.session, ctx.workspace.id, ctx.user.id, "privacy.purged", None, {"calls": n})
    await ctx.session.commit()
    return {"cleared": n}


# ---- two-step sign-in -------------------------------------------------------------

async def _profile(session, user) -> ProductUserProfileModel:
    p = await session.get(ProductUserProfileModel, user.id)
    if p is None:
        p = ProductUserProfileModel(user_id=user.id)
        session.add(p)
        await session.flush()
    return p


@router.get("/2fa")
async def two_fa_status(base=Depends(get_user_only)):
    session, user = base
    return {"enabled": bool((await _profile(session, user)).totp_enabled)}


@router.post("/2fa/setup")
async def two_fa_setup(base=Depends(get_user_only)):
    session, user = base
    p = await _profile(session, user)
    if p.totp_enabled:
        raise product_error(400, "already_on", "Two-step sign-in is already on.")
    p.totp_secret = totp.new_secret()
    await session.commit()
    return {"secret": p.totp_secret, "uri": totp.uri(p.totp_secret, user.email or "", config.PRODUCT_NAME)}


@router.post("/2fa/enable")
async def two_fa_enable(body: CodeBody, base=Depends(get_user_only)):
    session, user = base
    p = await _profile(session, user)
    if not p.totp_secret or not totp.verify(p.totp_secret, body.code):
        raise product_error(400, "bad_code", "That code isn't right. Check your authenticator app and try again.")
    p.totp_enabled = True
    for m in (await session.scalars(select(ProductMembershipModel).where(ProductMembershipModel.user_id == user.id))).all():
        await audit.record(session, m.workspace_id, user.id, "2fa.enabled")
    await session.commit()
    return {"enabled": True}


@router.post("/2fa/disable")
async def two_fa_disable(body: CodeBody, base=Depends(get_user_only)):
    session, user = base
    p = await _profile(session, user)
    if not p.totp_enabled or not totp.verify(p.totp_secret or "", body.code):
        raise product_error(400, "bad_code", "That code isn't right. Check your authenticator app and try again.")
    p.totp_enabled, p.totp_secret = False, None
    for m in (await session.scalars(select(ProductMembershipModel).where(ProductMembershipModel.user_id == user.id))).all():
        await audit.record(session, m.workspace_id, user.id, "2fa.disabled")
    await session.commit()
    return {"enabled": False}


# ---- sub-accounts ----------------------------------------------------------------------

class SubBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)


@router.get("/sub-accounts")
async def sub_accounts(ctx: Ctx = Depends(get_ctx)):
    rows = (await ctx.session.scalars(select(ProductWorkspaceModel).where(ProductWorkspaceModel.parent_workspace_id == ctx.workspace.id).order_by(ProductWorkspaceModel.id))).all()
    return [{"id": w.public_id, "name": w.name} for w in rows]


@router.post("/sub-accounts", status_code=201)
async def new_sub_account(body: SubBody, ctx: Ctx = Depends(require(Perm.WORKSPACE_CREATE_CHILD))):
    ws = await create_workspace(ctx.session, ctx.user, body.name.strip(), parent_id=ctx.workspace.id)
    await audit.record(ctx.session, ctx.workspace.id, ctx.user.id, "sub_account.created", ws.public_id, {"name": ws.name})
    await ctx.session.commit()
    return {"id": ws.public_id, "name": ws.name}
