"""Shared test helpers for the product layer (in-memory SQLite + a fake platform)."""

import itertools
from contextlib import asynccontextmanager
from copy import deepcopy

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from api.db import models, product_models
from api.product import (agents_router, analytics_router, billing_router, calls_router, campaigns_router, config, conversations_router, deps, gateway,
                         developers, developers_router, emailer, account_router, contacts_router, flowtry_router, google_auth, handoff_router, integrations_router, phonetest_router, help_router, home_router, import_router, knowledge_router, labs_router, llm_gateway, notifications, numbers_router, payments, public_api, team_router, tools_router, voices_router, widget_router)
from api.product import assistant_router, connectors_router, kyc_router
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
    models.ModelProfileModel.__table__,
    models.WorkflowModel.__table__,
    models.WorkflowRunModel.__table__,
    models.TelephonyConfigurationModel.__table__,
    models.TelephonyPhoneNumberModel.__table__,
    models.WalletLedgerModel.__table__,
    product_models.ProductBillingSettingsModel.__table__,
    product_models.ProductPaymentModel.__table__,
    product_models.ProductInvoiceModel.__table__,
    product_models.ProductNotificationModel.__table__,
    product_models.ProductCampaignAuditModel.__table__,
    product_models.ProductTestCaseModel.__table__,
    product_models.ProductTestResultModel.__table__,
    product_models.ProductSimRunModel.__table__,
    product_models.ProductAbTestModel.__table__,
    product_models.ProductInsightModel.__table__,
    product_models.ProductApiKeyModel.__table__,
    product_models.ProductApiLogModel.__table__,
    product_models.ProductWebhookModel.__table__,
    product_models.ProductDeliveryModel.__table__,
    product_models.ProductAuditModel.__table__,
    product_models.ProductInviteModel.__table__,
    product_models.ProductSettingsModel.__table__,
    product_models.ProductSupportMessageModel.__table__,
    product_models.ProductAuthTokenModel.__table__,
    product_models.ProductIntegrationModel.__table__,
    product_models.ProductContactModel.__table__,
    product_models.ProductPracticeChargeModel.__table__,
    product_models.ProductBlockModel.__table__,
    product_models.ProductCallInsightModel.__table__,
    product_models.ProductPushModel.__table__,
    product_models.ProductKycModel.__table__,
]


class FakeGateway:
    """In-memory stand-in for the platform workflow store, keyed by (org, id)."""

    def __init__(self):
        self._ids = itertools.count(1)
        self.published: dict[tuple[int, int], dict] = {}
        self.drafts: dict[tuple[int, int], dict] = {}
        self.names: dict[tuple[int, int], str] = {}
        self.overrides: dict[tuple[int, int], dict | None] = {}
        self.history: dict[tuple[int, int], list[dict]] = {}
        self.archived: set[tuple[int, int]] = set()
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
            self.history.setdefault(key, []).append(self.published[key])
            self.published[key] = self.drafts.pop(key)

    async def published_definition(self, org_id, agent_ref):
        return deepcopy(self.published.get((org_id, agent_ref)))

    async def working_definition(self, org_id, agent_ref):
        key = (org_id, agent_ref)
        return deepcopy(self.drafts.get(key) or self.published.get(key))


PROFILES = {
    "std": {
        "llm": {"provider": "openai", "api_key": "KEY-STD", "model": "std-llm"},
        "tts": {"provider": "sarvam", "api_key": "KEY-TTS", "model": "bulbul:v4-flash", "voice": "shubh_enhi_ads", "language": "hi-IN"},
        "stt": {"provider": "deepgram", "api_key": "KEY-STT", "model": "nova"},
    },
    "pro": {"llm": {"provider": "openai", "api_key": "KEY-PRO", "model": "pro-llm"}},
    "lite": {"llm": {"provider": "openai", "api_key": "KEY-LITE", "model": "lite-llm"}},
}
PRESET_MAP = '{"default": "std", "fast": "lite", "balanced": "std", "smartest": "pro"}'


class FakeKB:
    """Documents per organization, as the platform would hold them."""

    def __init__(self):
        self.docs: dict[int, list[dict]] = {}
        self._n = itertools.count(1)

    def _add(self, org, filename, **kw):
        n = next(self._n)
        self.docs.setdefault(org, []).append({"id": n, "document_uuid": f"uuid-{org}-{n}", "filename": filename, "file_size_bytes": 10,
                                              "mime_type": "text/plain", "processing_status": "completed", "source_url": None, **kw})

    async def list(self, org_id, user_id):
        return list(self.docs.get(org_id, []))

    async def add_url(self, org_id, user_id, url, refresh_hours):
        self._add(org_id, url.split("//")[-1], source_url=url, refresh_interval_hours=refresh_hours)

    async def add_text(self, org_id, user_id, filename, text):
        self._add(org_id, filename)

    async def file_upload(self, org_id, user_id, filename, mime):
        return {"upload_url": f"https://up/{org_id}", "document_uuid": f"d-{org_id}-{next(self._n)}", "s3_key": f"k/{org_id}/{filename}"}

    async def process_file(self, org_id, user_id, document_uuid, s3_key):
        self._add(org_id, s3_key.rsplit("/", 1)[-1], mime_type="application/pdf")

    async def delete(self, org_id, user_id, document_uuid):
        self.docs[org_id] = [d for d in self.docs.get(org_id, []) if d["document_uuid"] != document_uuid]

    async def search(self, org_id, user_id, query, document_uuids, limit):
        return [{"chunk_text": "We open at nine.", "filename": d["filename"], "similarity": 0.9, "document_uuid": d["document_uuid"]}
                for d in self.docs.get(org_id, []) if not document_uuids or d["document_uuid"] in document_uuids][:limit]


class FakeTools:
    def __init__(self):
        self.items: dict[int, list[dict]] = {}
        self._n = itertools.count(1)

    async def list(self, org_id, user_id):
        return list(self.items.get(org_id, []))

    async def create_http(self, org_id, user_id, spec):
        n = next(self._n)
        t = {"id": n, "uuid": f"tool-{org_id}-{n}", "name": spec["name"], "description": spec["description"],
             "definition": {"type": "http_api", "config": {"url": spec["url"], "method": spec["method"], "headers": spec["headers"], "parameters": spec["parameters"]}}}
        self.items.setdefault(org_id, []).append(t)
        return t

    async def create_transfer(self, org_id, user_id, spec):
        n = next(self._n)
        t = {"id": n, "uuid": f"tool-{org_id}-{n}", "name": spec["name"], "description": spec["description"],
             "definition": {"type": "transfer_call", "config": {"destination": spec["number"]}}}
        self.items.setdefault(org_id, []).append(t)
        return t

    async def archive(self, org_id, user_id, tool_uuid):
        self.items[org_id] = [t for t in self.items.get(org_id, []) if t["uuid"] != tool_uuid]


class FakeCampaigns:
    def __init__(self):
        self.items: list[dict] = []
        self.csv: dict[int, str] = {}

    async def create(self, org_id, user_id, name, workflow_id, csv_text, schedule, retry):
        c = {"ref": len(self.items) + 1, "name": name, "state": "created", "total": csv_text.count("\n") - 1, "workflow_id": workflow_id, "org": org_id}
        self.items.append(c)
        self.csv[c["ref"]] = csv_text
        return c

    async def list(self, org_id, user_id):
        return [c for c in self.items if c["org"] == org_id]

    async def act(self, org_id, user_id, ref, action):
        c = next(c for c in self.items if c["ref"] == ref and c["org"] == org_id)
        c["state"] = {"start": "running", "pause": "paused", "resume": "running"}[action]
        return {"ref": ref, "state": c["state"]}


class FakeMailer:
    enabled = True

    def __init__(self):
        self.sent: list[tuple[str, str, str]] = []

    async def send(self, to, subject, text, html=None):
        self.sent.append((to, subject, text))
        return True


class FakePhone:
    def __init__(self):
        self.calls: list[tuple[int, int, str]] = []

    async def start(self, org_id, user_id, workflow_id, phone):
        self.calls.append((org_id, workflow_id, phone))
        return "calling"


class FakeSender:
    """Records webhook sends; answers with whatever status is set."""

    def __init__(self):
        self.sent: list[tuple[str, dict, bytes]] = []
        self.code = 200

    async def __call__(self, url, headers, body):
        self.sent.append((url, headers, body))
        return self.code, (None if 200 <= self.code < 300 else f"Your server answered {self.code}.")


class FakeText:
    """A text agent that replies from a script and ends after a few turns. Records what it was asked."""

    def __init__(self):
        self.replies = ["Hello, how can I help?", "Sure, I can do that.", "Anything else?", "Goodbye!"]
        self.say_log: list[tuple[int, str]] = []
        self.tools: dict[str, list[str]] = {}
        self._run = itertools.count(1)
        self.n: dict[int, int] = {}
        self.by_workflow_replies: dict[int, list[str]] = {}

    def _next(self, run, wf):
        i = self.n.get(run, 0)
        self.n[run] = i + 1
        pool = self.by_workflow_replies.get(wf, self.replies)
        return pool[min(i, len(pool) - 1)], i + 1 >= len(pool)

    async def start(self, org_id, user_id, workflow_id):
        from api.product.llm_gateway import AgentReply

        run = next(self._run)
        text, _ = self._next(run, workflow_id)
        self.runs_wf = getattr(self, "runs_wf", {})
        self.runs_wf[run] = workflow_id
        return AgentReply(run, text)

    async def say(self, org_id, user_id, workflow_id, run_id, text):
        from api.product.llm_gateway import AgentReply

        self.say_log.append((workflow_id, text))
        reply, ended = self._next(run_id, workflow_id)
        return AgentReply(run_id, reply, ended, self.tools.get(text, []))


class FakeLLM:
    """Plays the caller, and answers judge prompts with whatever has been scripted."""

    def __init__(self):
        self.judge = '{"goal_reached":90,"politeness":90,"handled_difficulty":90,"no_made_up_facts":90,"note":"Went well."}'
        self.verdict = '{"pass": true, "note": "Looks right."}'
        self.rewrite = None
        self.insight = '{"summary": "Caller booked a table for two.", "sentiment": 4}'
        self.calls: list[str] = []

    async def complete(self, org_id, user_id, system, messages):
        self.calls.append(system[:30])
        if "Score the AGENT" in system:
            return self.judge
        if "strict, fair checker" in system:
            return self.verdict
        if "phone call transcript" in system:
            return self.insight
        if "Rewrite the sentence" in system:
            if self.rewrite is None:
                raise RuntimeError("no model")
            return self.rewrite(messages[0]["content"]) if callable(self.rewrite) else self.rewrite
        return "I need some help please." if len(messages) < 5 else "Thanks, goodbye"


class FakeWallet:
    def __init__(self):
        self.balance, self.minutes, self.keys = 0.0, 0.0, set()

    async def summary(self, org_id):
        return {"balance": self.balance, "minutes_available": self.minutes, "low_balance": self.balance < 10}

    async def credit(self, org_id, amount, description, key):
        if key not in self.keys:
            self.keys.add(key)
            self.balance += amount

    async def grant_minutes(self, org_id, minutes, description, key):
        if key not in self.keys:
            self.keys.add(key)
            self.minutes += minutes

    async def charge(self, org_id, minutes, rate, description, key):
        if key in self.keys:
            return 0.0
        self.keys.add(key)
        take = min(minutes, self.minutes)
        self.minutes -= take
        money = round((minutes - take) * rate, 4)
        self.balance -= money
        return money


@asynccontextmanager
async def make_client(monkeypatch, seed_profiles=True):
    engine = create_async_engine(
        "sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    async with engine.begin() as conn:
        for t in TABLES:
            t.indexes.clear()  # some core indexes use Postgres-only expressions
            for c in t.columns:
                c.server_default = None
        await conn.run_sync(lambda c: models.Base.metadata.create_all(c, tables=TABLES))
    Session = async_sessionmaker(engine, expire_on_commit=False)
    if seed_profiles:
        async with Session() as s:
            for slug, cfg in PROFILES.items():
                s.add(models.ModelProfileModel(slug=slug, display_name=slug, config=cfg, is_active=True))
            await s.commit()
        monkeypatch.setenv("PRODUCT_PROFILES", PRESET_MAP)
    else:
        monkeypatch.delenv("PRODUCT_PROFILES", raising=False)

    async def _session():
        async with Session() as s:
            yield s

    async def _no_limit(*a, **k):
        return None

    fake = FakeGateway()
    monkeypatch.setattr(product_router.rate_limit, "enforce", _no_limit)
    monkeypatch.setattr(config, "SESSION_COOKIE_SECURE", False)
    monkeypatch.setenv("PRODUCT_VOICE_ENGINES", "sarvam")  # tests of the new voice engines set their own
    monkeypatch.setenv("PRODUCT_NEW_UI_ORGS", "*")  # tests of the rollout rule set their own
    monkeypatch.setattr(public_api.rate_limit, "enforce", _no_limit)
    monkeypatch.setattr(phonetest_router.rate_limit, "enforce", _no_limit)
    app = FastAPI()
    app.include_router(product_router.router)
    app.include_router(agents_router.router)
    app.include_router(voices_router.router)
    app.include_router(calls_router.router)
    app.include_router(conversations_router.router)
    app.include_router(numbers_router.router)
    app.include_router(billing_router.router)
    app.include_router(developers_router.ops_router)
    app.include_router(integrations_router.hooks)
    app.include_router(connectors_router.hooks)
    app.include_router(connectors_router.router)
    app.include_router(assistant_router.router)
    app.include_router(kyc_router.router)
    app.include_router(kyc_router.ops_router)
    for r in (analytics_router, labs_router, handoff_router, import_router, campaigns_router, home_router, knowledge_router, notifications, tools_router,
              developers_router, help_router, public_api, team_router, widget_router, google_auth, account_router, phonetest_router, integrations_router, contacts_router, flowtry_router):
        app.include_router(r.router)
    kb, tl, cp = FakeKB(), FakeTools(), FakeCampaigns()
    app.dependency_overrides[knowledge_router.get_knowledge] = lambda: kb
    app.dependency_overrides[tools_router.get_tools] = lambda: tl
    app.dependency_overrides[campaigns_router.get_campaigns] = lambda: cp
    text, llm = FakeText(), FakeLLM()
    app.dependency_overrides[llm_gateway.get_text] = lambda: text
    app.dependency_overrides[llm_gateway.get_llm] = lambda: llm
    app.dependency_overrides[labs_router.get_session_factory] = lambda: Session
    app.dependency_overrides[deps.get_session] = _session
    app.dependency_overrides[gateway.get_gateway] = lambda: fake
    phone = FakePhone()
    app.dependency_overrides[phonetest_router.get_phone_call] = lambda: phone
    mailer = FakeMailer()
    app.dependency_overrides[emailer.get_mailer] = lambda: mailer
    sender = FakeSender()
    app.dependency_overrides[developers.get_sender] = lambda: sender
    wallet = FakeWallet()
    app.dependency_overrides[payments.get_wallet] = lambda: wallet
    c_wallet = wallet
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        c.session_factory = Session
        c.fake = fake
        c.wallet = c_wallet
        c.kb, c.tools, c.camps = kb, tl, cp
        c.text, c.llm = text, llm
        c.sender, c.mailer, c.phone = sender, mailer, phone
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


async def _set_model_overrides(self, org_id, agent_ref, overrides, settings=None):
    self.settings = getattr(self, "settings", {})
    self.settings[(org_id, agent_ref)] = settings
    if (org_id, agent_ref) not in self.published:
        raise LookupError("wrong org")
    self.overrides[(org_id, agent_ref)] = overrides


async def _list_versions(self, org_id, agent_ref):
    key = (org_id, agent_ref)
    if key not in self.published:
        raise LookupError("wrong org")
    out = [
        {"number": i + 1, "status": "archived", "created_at": None, "published_at": None, "definition": d}
        for i, d in enumerate(self.history.get(key, []))
    ]
    n = len(out)
    out.append({"number": n + 1, "status": "published", "created_at": None, "published_at": None, "definition": self.published[key]})
    if key in self.drafts:
        out.append({"number": n + 2, "status": "draft", "created_at": None, "published_at": None, "definition": self.drafts[key]})
    return list(reversed(out))


async def _list_agents(self, org_id):
    return [{"id": i, "name": self.names[(o, i)], "active": (o, i) not in self.archived, "definition": deepcopy(self.published[(o, i)])}
            for (o, i) in self.published if o == org_id]


FakeGateway.list_agents = _list_agents
FakeGateway.list_versions = _list_versions
FakeGateway.set_model_overrides = _set_model_overrides
FakeGateway.start_test_run = _start_test_run
FakeGateway.serve_signaling = _serve_signaling
