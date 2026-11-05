from pydantic import BaseModel, EmailStr, Field


class SignupBody(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(min_length=1, max_length=120)
    workspace_name: str | None = Field(default=None, max_length=120)


class LoginBody(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)
    code: str | None = Field(default=None, max_length=8)  # six-digit code, when two-step sign-in is on


class WorkspaceCreateBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class UserOut(BaseModel):
    id: str
    email: str | None
    name: str | None


class WorkspaceOut(BaseModel):
    id: str
    name: str
    role: str


class BrandingOut(BaseModel):
    name: str | None = None
    color: str | None = None
    logo: str | None = None


class MeOut(BaseModel):
    branding: BrandingOut | None = None
    user: UserOut
    workspaces: list[WorkspaceOut]
    current_workspace: WorkspaceOut
    environment: str
    permissions: list[str]
    plan: str
    feature_flags: dict[str, bool]
    brand: str
    is_admin: bool = False  # the platform owner: the app shows the Admin area


class SetupOut(BaseModel):
    """Signed in, but not in a workspace yet: the app shows the "bring over your organization or start fresh" screen."""

    setup_required: bool = True
    user: UserOut
