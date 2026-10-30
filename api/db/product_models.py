"""Tables owned by the product layer. Separate from ``models.py`` on purpose."""

from datetime import UTC, datetime

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)

from api.db.models import Base


def _now():
    return datetime.now(UTC)


class ProductWorkspaceModel(Base):
    """A customer workspace = one live and one test platform organization."""

    __tablename__ = "product_workspaces"

    id = Column(Integer, primary_key=True, index=True)
    public_id = Column(String(32), unique=True, nullable=False, index=True)
    name = Column(String(120), nullable=False)
    owner_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    live_org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, unique=True)
    test_org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, unique=True)
    # Agency / sub-account tree. Billing roll-up is a later phase.
    parent_workspace_id = Column(
        Integer, ForeignKey("product_workspaces.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(DateTime(timezone=True), default=_now)


class ProductMembershipModel(Base):
    __tablename__ = "product_memberships"

    id = Column(Integer, primary_key=True)
    workspace_id = Column(
        Integer, ForeignKey("product_workspaces.id", ondelete="CASCADE"), nullable=False
    )
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    role = Column(String(16), nullable=False)
    created_at = Column(DateTime(timezone=True), default=_now)

    __table_args__ = (
        UniqueConstraint("workspace_id", "user_id", name="uq_product_membership"),
        Index("ix_product_memberships_user", "user_id"),
    )


class ProductUserProfileModel(Base):
    __tablename__ = "product_user_profiles"

    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    display_name = Column(String(120), nullable=True)
