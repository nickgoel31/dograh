"""Tables owned by the product layer. Separate from ``models.py`` on purpose."""

from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    Float,
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
    # True when an existing organization was brought over as the Live side (its billing and models are left as they were).
    adopted = Column(Boolean, nullable=False, default=False)
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


class ProductAgentModel(Base):
    """Product metadata for one agent. The conversation graph lives in the platform.

    Editing always happens on the test workflow; "Go live" copies the published
    version into the live organization (created on first go-live).
    """

    __tablename__ = "product_agents"

    id = Column(Integer, primary_key=True)
    public_id = Column(String(32), unique=True, nullable=False, index=True)
    workspace_id = Column(
        Integer, ForeignKey("product_workspaces.id", ondelete="CASCADE"), nullable=False
    )
    name = Column(String(120), nullable=False)
    emoji = Column(String(16), nullable=False, default="🤖")
    color = Column(String(16), nullable=False, default="#6356f1")
    role = Column(String(120), nullable=False, default="")
    tone = Column(String(24), nullable=False, default="Friendly")
    business = Column(String(160), nullable=False, default="")
    what_you_do = Column(String(2000), nullable=False, default="")
    brain = Column(String(16), nullable=False, default="balanced")
    voice_id = Column(String(64), nullable=True)
    # "simple": prompt is compiled from the fields above. "custom": user-written.
    prompt_mode = Column(String(8), nullable=False, default="simple")
    style = Column(JSON, nullable=True)  # "human feel" choices, see api/product/style.py
    status = Column(String(8), nullable=False, default="draft")  # draft|live|paused
    test_workflow_id = Column(Integer, nullable=False)
    live_workflow_id = Column(Integer, nullable=True)
    # Bumped on every change; used as the ETag for conflict detection.
    version = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime(timezone=True), default=_now)
    updated_at = Column(DateTime(timezone=True), default=_now, onupdate=_now)

    __table_args__ = (Index("ix_product_agents_workspace", "workspace_id"),)


class ProductVoiceFavoriteModel(Base):
    __tablename__ = "product_voice_favorites"

    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    voice_id = Column(String(32), primary_key=True)
    created_at = Column(DateTime(timezone=True), default=_now)


class ProductUserProfileModel(Base):
    __tablename__ = "product_user_profiles"

    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    display_name = Column(String(120), nullable=True)
    totp_secret = Column(String(64), nullable=True)
    totp_enabled = Column(Boolean, nullable=False, default=False)
    email_verified_at = Column(DateTime(timezone=True), nullable=True)


class ProductBillingSettingsModel(Base):
    __tablename__ = "product_billing_settings"

    workspace_id = Column(Integer, ForeignKey("product_workspaces.id", ondelete="CASCADE"), primary_key=True)
    spend_limit = Column(Float, nullable=True)  # monthly, in the billing currency
    auto_topup_enabled = Column(Boolean, nullable=False, default=False)
    auto_topup_threshold = Column(Float, nullable=True)
    auto_topup_amount = Column(Float, nullable=True)
    billing_name = Column(String(160), nullable=True)
    billing_gstin = Column(String(20), nullable=True)
    billing_state = Column(String(2), nullable=True)  # GST state code, e.g. "29"
    billing_address = Column(String(400), nullable=True)
    first_grant_done = Column(Boolean, nullable=False, default=False)
    human_cost_per_min = Column(Float, nullable=True)  # what a person would cost per minute, for the 'money saved' estimate


class ProductPaymentModel(Base):
    __tablename__ = "product_payments"

    id = Column(Integer, primary_key=True)
    workspace_id = Column(Integer, ForeignKey("product_workspaces.id", ondelete="CASCADE"), nullable=False)
    provider = Column(String(16), nullable=False)
    order_id = Column(String(64), unique=True, nullable=False)
    payment_id = Column(String(64), nullable=True)
    amount = Column(Float, nullable=False)
    currency = Column(String(8), nullable=False)
    status = Column(String(8), nullable=False, default="created")  # created | paid
    created_at = Column(DateTime(timezone=True), default=_now)

    __table_args__ = (Index("ix_product_payments_workspace", "workspace_id"),)


class ProductInvoiceModel(Base):
    """One immutable invoice per workspace per month."""

    __tablename__ = "product_invoices"

    id = Column(Integer, primary_key=True)
    workspace_id = Column(Integer, ForeignKey("product_workspaces.id", ondelete="CASCADE"), nullable=False)
    period = Column(String(7), nullable=False)  # YYYY-MM
    number = Column(String(32), unique=True, nullable=True)
    minutes = Column(Float, nullable=False)
    taxable = Column(Float, nullable=False)
    tax = Column(JSON, nullable=False)  # {"rate":18,"cgst":..,"sgst":..,"igst":..}
    total = Column(Float, nullable=False)
    currency = Column(String(8), nullable=False)
    bill_to = Column(JSON, nullable=False)  # snapshot of the billing details at issue time
    issued_at = Column(DateTime(timezone=True), default=_now)

    __table_args__ = (UniqueConstraint("workspace_id", "period", name="uq_product_invoice_period"),)


class ProductNotificationModel(Base):
    __tablename__ = "product_notifications"

    id = Column(Integer, primary_key=True)
    workspace_id = Column(Integer, ForeignKey("product_workspaces.id", ondelete="CASCADE"), nullable=False)
    kind = Column(String(24), nullable=False)
    title = Column(String(160), nullable=False)
    body = Column(String(400), nullable=True)
    link = Column(String(200), nullable=True)
    dedupe_key = Column(String(80), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now)
    read_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("ix_product_notifications_ws", "workspace_id", "id"),
        UniqueConstraint("workspace_id", "dedupe_key", name="uq_product_notification_dedupe"),
    )


class ProductCampaignAuditModel(Base):
    """Who started what, with which consent. Append-only."""

    __tablename__ = "product_campaign_audit"

    id = Column(Integer, primary_key=True)
    workspace_id = Column(Integer, ForeignKey("product_workspaces.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    campaign_ref = Column(Integer, nullable=False)
    action = Column(String(16), nullable=False)
    at = Column(DateTime(timezone=True), default=_now)
    detail = Column(JSON, nullable=False, default=dict)

    __table_args__ = (Index("ix_product_campaign_audit_ws", "workspace_id", "campaign_ref"),)


class ProductTestCaseModel(Base):
    __tablename__ = "product_test_cases"

    id = Column(Integer, primary_key=True)
    workspace_id = Column(Integer, ForeignKey("product_workspaces.id", ondelete="CASCADE"), nullable=False)
    agent_id = Column(Integer, ForeignKey("product_agents.id", ondelete="CASCADE"), nullable=False)
    say = Column(String(500), nullable=False)
    expect = Column(String(500), nullable=False)
    must_call = Column(String(80), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now)

    __table_args__ = (Index("ix_product_test_cases_agent", "agent_id"),)


class ProductTestResultModel(Base):
    """Cached outcome of a test case against one version of an agent."""

    __tablename__ = "product_test_results"

    id = Column(Integer, primary_key=True)
    case_id = Column(Integer, ForeignKey("product_test_cases.id", ondelete="CASCADE"), nullable=False)
    agent_version = Column(Integer, nullable=False)
    passed = Column(Boolean, nullable=False)
    note = Column(String(300), nullable=True)
    reply = Column(String(1000), nullable=True)
    ran_at = Column(DateTime(timezone=True), default=_now)

    __table_args__ = (UniqueConstraint("case_id", "agent_version", name="uq_product_test_result"),)


class ProductSimRunModel(Base):
    __tablename__ = "product_sim_runs"

    id = Column(Integer, primary_key=True)
    workspace_id = Column(Integer, ForeignKey("product_workspaces.id", ondelete="CASCADE"), nullable=False)
    agent_id = Column(Integer, ForeignKey("product_agents.id", ondelete="CASCADE"), nullable=False)
    ab_test_id = Column(Integer, nullable=True)
    variant = Column(String(1), nullable=True)
    persona = Column(String(24), nullable=False)
    status = Column(String(8), nullable=False, default="running")  # running | done | failed
    score = Column(Integer, nullable=True)
    note = Column(String(300), nullable=True)
    transcript = Column(JSON, nullable=False, default=list)
    created_at = Column(DateTime(timezone=True), default=_now)

    __table_args__ = (Index("ix_product_sim_runs_agent", "agent_id", "id"), Index("ix_product_sim_runs_ws", "workspace_id"))


class ProductAbTestModel(Base):
    __tablename__ = "product_ab_tests"

    id = Column(Integer, primary_key=True)
    workspace_id = Column(Integer, ForeignKey("product_workspaces.id", ondelete="CASCADE"), nullable=False)
    agent_id = Column(Integer, ForeignKey("product_agents.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(120), nullable=False)
    prompt_a = Column(String(20000), nullable=False)
    prompt_b = Column(String(20000), nullable=False)
    workflow_a = Column(Integer, nullable=False)
    workflow_b = Column(Integer, nullable=False)
    runs_per_variant = Column(Integer, nullable=False)
    status = Column(String(8), nullable=False, default="running")
    result = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now)

    __table_args__ = (Index("ix_product_ab_tests_ws", "workspace_id"),)


class ProductInsightModel(Base):
    __tablename__ = "product_insights"

    id = Column(Integer, primary_key=True)
    workspace_id = Column(Integer, ForeignKey("product_workspaces.id", ondelete="CASCADE"), nullable=False)
    week = Column(String(8), nullable=False)  # YYYY-Www
    items = Column(JSON, nullable=False)
    created_at = Column(DateTime(timezone=True), default=_now)

    __table_args__ = (UniqueConstraint("workspace_id", "week", name="uq_product_insight_week"),)


class ProductApiKeyModel(Base):
    __tablename__ = "product_api_keys"

    id = Column(Integer, primary_key=True)
    workspace_id = Column(Integer, ForeignKey("product_workspaces.id", ondelete="CASCADE"), nullable=False)
    public_id = Column(String(32), unique=True, nullable=False)
    name = Column(String(80), nullable=False)
    environment = Column(String(4), nullable=False)  # test | live
    hint = Column(String(24), nullable=False)  # first and last characters, for recognising a key
    key_hash = Column(String(64), unique=True, nullable=False, index=True)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now)

    __table_args__ = (Index("ix_product_api_keys_ws", "workspace_id", "environment"),)


class ProductApiLogModel(Base):
    __tablename__ = "product_api_logs"

    id = Column(Integer, primary_key=True)
    workspace_id = Column(Integer, ForeignKey("product_workspaces.id", ondelete="CASCADE"), nullable=False)
    key_id = Column(Integer, ForeignKey("product_api_keys.id", ondelete="SET NULL"), nullable=True)
    method = Column(String(8), nullable=False)
    path = Column(String(200), nullable=False)
    status = Column(Integer, nullable=False)
    ms = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), default=_now)

    __table_args__ = (Index("ix_product_api_logs_ws", "workspace_id", "id"),)


class ProductWebhookModel(Base):
    __tablename__ = "product_webhooks"

    id = Column(Integer, primary_key=True)
    workspace_id = Column(Integer, ForeignKey("product_workspaces.id", ondelete="CASCADE"), nullable=False)
    public_id = Column(String(32), unique=True, nullable=False)
    environment = Column(String(4), nullable=False)
    url = Column(String(500), nullable=False)
    secret = Column(String(80), nullable=False)
    events = Column(JSON, nullable=False)
    active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=_now)

    __table_args__ = (Index("ix_product_webhooks_ws", "workspace_id", "environment"),)


class ProductDeliveryModel(Base):
    __tablename__ = "product_deliveries"

    id = Column(Integer, primary_key=True)
    webhook_id = Column(Integer, ForeignKey("product_webhooks.id", ondelete="CASCADE"), nullable=False)
    event = Column(String(40), nullable=False)
    dedupe_key = Column(String(80), nullable=True)  # one delivery per (webhook, key); manual sends have none
    payload = Column(JSON, nullable=False)
    status = Column(String(8), nullable=False, default="pending")  # pending | ok | failed
    attempts = Column(Integer, nullable=False, default=0)
    response_code = Column(Integer, nullable=True)
    error = Column(String(300), nullable=True)
    next_attempt_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now)

    __table_args__ = (
        UniqueConstraint("webhook_id", "dedupe_key", name="uq_product_delivery_key"),
        Index("ix_product_deliveries_wh", "webhook_id", "id"),
        Index("ix_product_deliveries_due", "status", "next_attempt_at"),
    )


class ProductAuditModel(Base):
    __tablename__ = "product_audit"

    id = Column(Integer, primary_key=True)
    workspace_id = Column(Integer, ForeignKey("product_workspaces.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action = Column(String(60), nullable=False)
    target = Column(String(120), nullable=True)
    detail = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now)

    __table_args__ = (Index("ix_product_audit_ws", "workspace_id", "id"),)


class ProductInviteModel(Base):
    __tablename__ = "product_invites"

    id = Column(Integer, primary_key=True)
    workspace_id = Column(Integer, ForeignKey("product_workspaces.id", ondelete="CASCADE"), nullable=False)
    public_id = Column(String(32), unique=True, nullable=False)
    email = Column(String(255), nullable=False)
    role = Column(String(16), nullable=False)
    token_hash = Column(String(64), unique=True, nullable=False)
    invited_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    accepted_at = Column(DateTime(timezone=True), nullable=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now)

    __table_args__ = (Index("ix_product_invites_ws", "workspace_id"),)


class ProductSettingsModel(Base):
    """Per-workspace privacy and embed settings."""

    __tablename__ = "product_settings"

    workspace_id = Column(Integer, ForeignKey("product_workspaces.id", ondelete="CASCADE"), primary_key=True)
    record_calls = Column(Boolean, nullable=False, default=True)
    consent_announcement = Column(String(300), nullable=True)
    redact_pii = Column(Boolean, nullable=False, default=False)
    retention_days = Column(Integer, nullable=True)
    widget_origins = Column(JSON, nullable=True)
    summary_emails = Column(JSON, nullable=True)  # who gets an emailed summary after every call
    brand_name = Column(String(60), nullable=True)
    brand_color = Column(String(9), nullable=True)
    logo_url = Column(String(500), nullable=True)
    sms_after_call = Column(String(300), nullable=True)  # text sent to the caller after each call; empty = off


class ProductSupportMessageModel(Base):
    __tablename__ = "product_support_messages"

    id = Column(Integer, primary_key=True)
    workspace_id = Column(Integer, ForeignKey("product_workspaces.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    subject = Column(String(160), nullable=False)
    body = Column(String(4000), nullable=False)
    created_at = Column(DateTime(timezone=True), default=_now)

    __table_args__ = (Index("ix_product_support_messages_ws", "workspace_id", "id"),)


class ProductAuthTokenModel(Base):
    """One-time links sent by email: password reset and email verification. Only a hash is stored."""

    __tablename__ = "product_auth_tokens"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    kind = Column(String(12), nullable=False)  # reset | verify
    token_hash = Column(String(64), unique=True, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    used_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now)

    __table_args__ = (Index("ix_product_auth_tokens_user", "user_id", "kind"),)


class ProductCallInsightModel(Base):
    """A one-line summary and mood score for a finished call, written once."""

    __tablename__ = "product_call_insights"

    run_id = Column(Integer, primary_key=True)
    workspace_id = Column(Integer, ForeignKey("product_workspaces.id", ondelete="CASCADE"), nullable=False)
    summary = Column(String(400), nullable=False)
    sentiment = Column(Integer, nullable=True)  # 1 (upset) .. 5 (delighted)
    created_at = Column(DateTime(timezone=True), default=_now)

    __table_args__ = (Index("ix_product_call_insights_ws", "workspace_id"),)


class ProductIntegrationModel(Base):
    """A connected outside service (so far Cal.com). Agents reach it through tools that carry only a secret address."""

    __tablename__ = "product_integrations"

    id = Column(Integer, primary_key=True)
    workspace_id = Column(Integer, ForeignKey("product_workspaces.id", ondelete="CASCADE"), nullable=False)
    kind = Column(String(16), nullable=False)
    token_hash = Column(String(64), unique=True, nullable=False)
    config = Column(JSON, nullable=False)
    created_at = Column(DateTime(timezone=True), default=_now)

    __table_args__ = (UniqueConstraint("workspace_id", "kind", name="uq_product_integration"),)


class ProductContactModel(Base):
    """Everyone the agents have talked to, one row per phone number."""

    __tablename__ = "product_contacts"

    id = Column(Integer, primary_key=True)
    workspace_id = Column(Integer, ForeignKey("product_workspaces.id", ondelete="CASCADE"), nullable=False)
    phone = Column(String(24), nullable=False)
    name = Column(String(120), nullable=True)
    notes = Column(String(2000), nullable=True)
    tags = Column(JSON, nullable=True)
    calls = Column(Integer, nullable=False, default=0)
    last_call_at = Column(DateTime(timezone=True), nullable=True)
    last_run_id = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), default=_now)

    __table_args__ = (UniqueConstraint("workspace_id", "phone", name="uq_product_contact"), Index("ix_product_contacts_ws", "workspace_id", "last_call_at"))


class ProductBlockModel(Base):
    """Numbers that must never be called (do-not-call list)."""

    __tablename__ = "product_blocklist"

    id = Column(Integer, primary_key=True)
    workspace_id = Column(Integer, ForeignKey("product_workspaces.id", ondelete="CASCADE"), nullable=False)
    phone = Column(String(24), nullable=False)
    reason = Column(String(20), nullable=False, default="added")  # added | imported | asked
    created_at = Column(DateTime(timezone=True), default=_now)

    __table_args__ = (UniqueConstraint("workspace_id", "phone", name="uq_product_block"),)
