# FORK_MAP — what is actually in this fork

Method: static reading of the repo at `main` (`fc61782a`), the Alembic history, route decorators, DB models and a few service files. **Nothing was run** (no DB, no `/openapi.json` fetch, no tests). Where a request/response schema is not spelled out below, I did not read it yet; the authoritative source is the live OpenAPI spec at `GET /api/v1/openapi.json` (declared in `api/app.py`). Items marked **(unverified)** are inferences.

## 0. Things you should know before reading on

1. **The front-end path in your prompt is wrong in two ways.** `../dograh-frontend-demo` (sibling of this repo) is a *Next.js 16* demo with no mock layer, not Vocalis. The Vocalis demo is `F:\BUSINESS\TWJ LABS\AI VOICE AGENTS GCP\swarvoai` (package `vocalis-demo`, Vite + React 18). It also contains a copy of this prompt as `PROMPT_DOGRAH_INTEGRATION.md`.
2. **The Vocalis demo is much smaller than the prompt describes**: 14 page files of 38–159 lines each (~1,280 lines in `src/pages` + `src/mock`). `src/mock/api.ts` exposes only 12 functions (`calls, call, kpis, days, numbers, campaigns, knowledge, integrations, invoices, team, deliveries, reqLogs, voices`). Agents live in a Zustand store (`src/store/data.ts`), not behind `api`. Many features in §4 (wizard, A/B, compare drawer, etc.) may be thin or absent; I have not audited each page.
3. **The fork already has a multi-tenant, wallet and reseller model** that overlaps heavily with §4.1/4.12/4.14 (see §2.4, §7). The "one Dograh org per customer workspace" plan fits it well; building a *separate* `users/workspaces/memberships/wallets/usage_ledger` set would duplicate it.
4. The fork is **UI-coupled**: `ui/` is a Next.js 15 app with its own pages for most of these features. The new Vocalis front-end would replace it, not extend it.

## 1. Repo layout and local run

| Path | What |
|---|---|
| `api/` | FastAPI backend (`api/app.py`, routes under `/api/v1`), SQLAlchemy async, Alembic (`api/alembic`, 105 migrations), ARQ tasks (`api/tasks`), MCP server (`api/mcp_server`, mounted at `/api/v1/mcp`) |
| `api/services/pipecat` | voice pipeline glue; `pipecat/` is a **git submodule** (`dograh-hq/pipecat`) |
| `api/services/telephony` | provider registry + providers: `ari, cloudonix, plivo, telnyx, twilio, vobiz, vonage` |
| `api/services/workflow` | graph, node specs, engine, QA, text-chat runner, tools |
| `ui/` | Next.js 15 / React 19 dashboard (current product UI) |
| `sdk/{python,typescript}` | generated SDKs (`sdk/codegen`, `api/sdk_expose.py`) |
| `docs/` | Mintlify docs (incl. `developer/workflow-schema.mdx`, `developer/webhooks.mdx`) |
| `deploy/`, `nginx/`, `scripts/`, `remote_up.sh` | deployment |
| root strays | `find_heads.py, inspect_db.py, patch.txt, print_tree.py, protect_routes.py, test_*.py, dograh_pcm_cache/` — look like local scratch; not part of the product |

Run locally: `docker-compose-local.yaml` (services) + processes per `docs/contribution/setup.mdx` (not read in full). `docker-compose.yaml` = Postgres (`pgvector/pgvector:pg17`), Redis 7 (password), MinIO, optional nginx/coturn behind profiles `remote`/`local-turn`. Env files: `api/.env`, `api/.env.test`, `ui/.env` (per `AGENTS.md`).

## 2. Stack, auth, tenancy

### 2.1 Stack
Python 3.13, FastAPI 0.135, SQLAlchemy 2.0 async + asyncpg, Alembic 1.16 (+ `alembic-postgresql-enum`), Redis 5.3 + ARQ 0.26, MinIO/S3 (aioboto3, minio), pgvector, Twilio SDK, hubspot/google clients, Sentry, PostHog, Langfuse, fastmcp 3.2. UI: Next 15.5 / React 19 / Tailwind. App version 1.34.0.

### 2.2 Auth (`api/services/auth/depends.py`, `api/routes/auth.py`)
- `get_user` dependency accepts **`X-API-Key`** (takes precedence) or **`Authorization: Bearer <JWT>`**.
- `AUTH_PROVIDER=local` (default): email+password, bcrypt, self-signed JWT (`OSS_JWT_SECRET`, default literal `"change-me-in-production"`, 720h expiry). Otherwise Stack Auth (`stack_auth.py`).
- Endpoints: `POST /auth/signup`, `POST /auth/login`, `GET /auth/me`, `POST /auth/accept-invite`. Rate limiting via `api/utils/rate_limit`. **No** email verification, password reset, Google/OAuth login, magic link or 2FA found.
- API keys: table `api_keys` (org-scoped, `key_hash` unique, `key_prefix`, `is_active`, `last_used_at`); routes `GET/POST /user/api-keys`, `DELETE /user/api-keys/{id}`, `PUT .../reactivate`. Also "service keys" (`/user/service-keys*`, `schemas/service_key.py`) — purpose not yet read.
- Roles: `UserRole` = `super_admin | admin | client` (stored on `users.role`, **per user, not per membership**). `require_role([...])` guard exists. Invite roles allowed: `admin`, `client`.

### 2.3 Tenancy
- `organizations` is the tenant. `users` ↔ `organizations` many-to-many via `organization_users_association`; `users.selected_organization_id` is the active org. **Role is on the user, not on the membership** — a user is the same role in every org.
- Reseller tree: `organizations.parent_org_id`, `is_reseller`, `hide_model_details`, `wholesale_rate`, `max_child_orgs`, `model_profile_id`. `hide_model_details` redacts provider/model/cost info for non-owners (`services/reseller/redaction.py`, `models_hidden_var` set in `depends.py`). This is an existing "hide the platform" mechanism worth reusing.
- Superuser routes: impersonate, switch-org, create/patch/delete orgs, assign/remove users, wallet ops (`/superuser/*`).
- No `environment` (test/live) concept per org. `Environment` enum in `api/enums.py` is deployment env (local/production/test) only.

### 2.4 Billing already in the fork (minutes wallet, not money wallet)
- Tables `wallet_buckets` (prepaid minutes pools, expiry, idempotent `source_ref`) and `wallet_ledger` (append-only; entry types `usage|grant|topup|money_topup|adjustment|expiry|wholesale|transfer_in|transfer_out`; unique usage entry per run; idempotency key). Service: `api/services/billing/wallet_service.py` (932 lines). ARQ job `reconcile_wallets`.
- Org fields: `wallet_enabled, billing_currency (default INR), billing_rate, billing_pulse, allow_overdraft, monthly_carry_forward`, plus older `balance`, quota fields, `monthly_minutes_limit`.
- Routes: `GET /organizations/wallet`, `GET /organizations/wallet/ledger`, `POST/GET /organizations/billing-config`, `/organizations/usage/*` (current-period, runs, runs/report, daily-breakdown, mps-credits), reseller wallet grant/deduct/credit.
- **Missing vs §4.12**: payments (Razorpay/Stripe), auto top-up, spending limit/80% alert, invoices/GST, payment methods. Ledger stores minutes + money delta, **not per-component COGS** (that lives in `workflow_runs.cost_info`).

## 3. Public REST surface (all under `/api/v1`)

Auth column: `U` = `get_user` (JWT or API key), `A` = `require_role(admin)` (seen on some org routes), `P` = unauthenticated/token, `S` = superuser, `WS` = websocket. Request/response schemas are **not** transcribed here — see OpenAPI.

| Resource | Routes (method path) | Auth |
|---|---|---|
| Health | `GET /health` (status, version, deployment_mode, auth_provider, turn flags) | P |
| Auth | `POST /auth/signup, /auth/login, /auth/accept-invite`; `GET /auth/me`; `GET /user/auth/user` | P/U |
| Agents (workflows) | `GET /workflow/fetch`, `GET /workflow/fetch/{id}`, `GET /workflow/count`, `GET /workflow/summary`, `POST /workflow/create/definition`, `POST /workflow/create/template`, `PUT /workflow/{id}` (update), `POST /workflow/{id}/validate`, `POST /workflow/{id}/duplicate`, `PUT /workflow/{id}/status` (active/archived), `PUT /workflow/{id}/folder`, `GET /workflow/templates`, `POST /workflow/templates/duplicate`, ambient-noise upload-url | U |
| Versions | `GET /workflow/{id}/versions`, `POST /workflow/{id}/publish`, `POST /workflow/{id}/create-draft` | U |
| Folders | `GET/POST /folder/`, `PUT/DELETE /folder/{id}` | U |
| Runs | `POST /workflow/{id}/runs`, `GET /workflow/{id}/runs`, `GET /workflow/{id}/runs/{run_id}`, `GET /workflow/{id}/report` (CSV) | U |
| Text chat runs | `/workflow/.../text-chat*` (4 routes in `workflow_text_chat.py`, not read in detail) | U |
| Campaigns | `POST /campaign/create`, `GET /campaign/`, `GET/PATCH/DELETE /campaign/{id}`, `POST /{id}/start|pause|resume|redial`, `GET /{id}/runs|progress|source-download-url|report`, `POST /campaign/validate-source` | U |
| Telephony configs | `GET/POST /organizations/telephony-configs`, `GET/PUT/DELETE /organizations/telephony-configs/{id}`, `.../{id}/phone-numbers` (GET/POST), `.../phone-numbers/{pid}` (PUT/DELETE), `GET /organizations/telephony-providers/metadata`; legacy `GET/POST /organizations/telephony-config` | A |
| Telephony runtime | `POST /telephony/inbound/run`, `/inbound/fallback`, `/inbound/{workflow_id}` (deprecated), `/transfer-result/{id}`, provider webhooks (`telephony/providers/*/routes.py`), `WS /telephony/ws/...`, `WS /telephony/ws/ari` | P (signature-verified per provider) |
| API keys | `GET/POST /user/api-keys`, `DELETE`, `PUT .../reactivate` | U |
| Knowledge base | `/knowledge-base/*` — 9 routes: upload-url, process document, **URL sources + refresh**, patch, list, get, delete, search (see file) | U |
| Tools | `GET/POST /tools/`, `GET/PUT/DELETE /tools/{uuid}`, `POST /{uuid}/mcp/refresh`, `POST /{uuid}/unarchive` | U |
| Recordings (pre-recorded audio) | `/workflow-recordings/*` (6 routes) | U |
| Credentials | `GET/POST /credentials/`, `GET/PUT/DELETE /credentials/{uuid}` (webhook/HTTP auth types: none, api_key, bearer, basic, custom_header) | U |
| CRM credentials | `/crm-credentials` (HubSpot, Salesforce, Zoho, Google Sheets fetchers for campaign sources) | U |
| Model/provider config | `GET /user/configurations/defaults`, `GET/PUT /user/configurations/user`, `GET .../user/validate`, `GET /user/configurations/voices/{provider}` | U |
| Node types | `GET /node-types`, `GET /node-types/{name}` | U |
| Org | `GET /organizations/members`, `PATCH /members/{id}/role`, `DELETE /members/{id}`, `POST /invites`, `GET /campaign-defaults`, `GET/POST/DELETE /langfuse-credentials`, `/concurrency-status` | A |
| Usage/reports | `/organizations/usage/*`, `GET /organizations/reports/daily`, `/reports/workflows`, `/reports/daily/runs` | U |
| Media | `/s3/*` signed URL routes (3), `GET /public/download/workflow/{token}/{type}` | U/P |
| Embed / widget | `POST/GET/DELETE /workflow/{id}/embed-token`; `POST /public/embed/init`, `GET /public/embed/config/{token}`, `GET /public/embed/turn-credentials/{session}`; `WS /ws/public/signaling/{session_token}` | U / P (token + origin check) |
| Browser call (authed) | `WS /ws/signaling/{workflow_id}/{run_id}` (WebRTC signalling), `GET /turn/credentials` | U |
| Agent stream | `WS /agent-stream/{workflow_uuid}?provider=...` | **no auth beyond knowing the UUID** |
| API trigger | `POST /public/agent/{uuid}`, `/public/agent/test/{uuid}`, `/public/agent/workflow/{uuid}`, `/public/agent/test/workflow/{uuid}` | trigger UUID / API key |
| WhatsApp | `GET/POST /whatsapp/webhook/{org_id}`, `GET /whatsapp/logs`, `POST /whatsapp/logs/{id}/retry` | P/U |
| Reseller | `/reseller/*` (overview, model-profiles, clients CRUD, model-profile, wallet grant/deduct/credit/ledger, invite) | U (reseller) |
| Superuser | `/superuser/*` (~30 routes: orgs, users, wallet ops, model profiles, runs, impersonate) | S |
| MCP | `/api/v1/mcp` (Streamable HTTP, `X-API-Key`) | U |

Note `api/app.py` still declares title "Dograh API", server `https://app.dograh.com` and OpenAPI at `/api/v1/openapi.json`; `WS_BEARER_SUBPROTOCOL = "dograh.bearer"`; `MPS_API_URL=https://services.dograh.com` (managed model service). These are user-visible/leaky.

## 4. Workflow definition schema (as in `docs/developer/workflow-schema.mdx` and `services/workflow/dto.py`)

- Shape: `{ nodes: [{id, type, position:{x,y}, data}], edges: [{id, source, target, data:{label, condition, transition_speech}}] }` — React Flow-compatible.
- Node types (confirmed in `node_specs`): `startCall, agentNode, endCall, globalNode, trigger, webhook, qa`. Specs are served at `/node-types`; `workflow_definition` is validated by `POST /workflow/{id}/validate` and DTO checks (`services/workflow/dto.py`).
- Common `data`: `name, prompt, allow_interrupt, wait_for_user_response(+_timeout), detect_voicemail, delayed_start(+_duration), add_global_prompt`; agentNode adds `extraction_*`, `tool_uuids`, `document_uuids`.
- Edges carry the NL `condition` — there is **no yes/no branch node**; Vocalis "condition" must become an edge condition.
- Template variables: `{{...}}` over `initial_context` / `gathered_context` (`docs/voice-agent/template-variables.mdx`). Whether `{{caller_name}}`, `{{business_name}}`, `{{current_time}}`, `{{caller_phone}}` exist as built-ins is **unverified** — `initial_context` for inbound sets `caller_number`, `called_number`, `provider`, `direction` (see `agent_stream.py`); the Vocalis chips must be mapped to those.
- Transfer / end-call / DTMF / calculator are **tools** (`ToolCategory`: `http_api, end_call, transfer_call, calculator, native, integration, mcp`), referenced by `tool_uuids`, not node types. `transfer_call` is documented "Twilio only".
- Versioning: `workflow_definitions` rows with `status draft|published|archived`, `version_number`, `is_current`, per-version `workflow_configurations` and `template_context_variables`; `workflows.released_definition_id` points at live. Draft/publish/create-draft routes exist ⇒ **no separate `agent_versions` table needed**; a diff endpoint and "restore" (copy old version into new draft) are missing.
- Agent "status" in the fork is only `active|archived` (`WorkflowStatus`); no Live/Draft/Paused.
- Behaviour settings live in `workflow_configurations` (JSON). Exact keys for interruption/silence/max-duration/VAD: **not yet enumerated** — need a read of `schemas/workflow.py` + `pipecat_engine`.

## 5. Events and webhooks actually emitted
- Only **workflow `webhook` nodes**: executed by ARQ job `run_integrations_post_workflow_run` after a run completes (`tasks/run_integrations.py::_execute_webhook_node`). Payload = user's `payload_template` rendered over: `workflow_run_id, workflow_run_name, workflow_id, workflow_name, campaign_id, call_time, initial_context, gathered_context, cost_info, annotations, recording_url, transcript_url`. Auth via stored credential. Docs claim `retry_config`; **no HMAC signing, no delivery log, no resend, no event types** (`call.started`, `tool.failed`, `campaign.completed` don't exist).
- Other post-call hooks in the same job: QA nodes (`annotations`), Tuner export, integrations.
- Redis pub/sub channel `campaign_events`; no SSE/WebSocket feed to browsers found.
- ARQ jobs: `run_integrations_post_workflow_run, process_workflow_completion, upload_voicemail_audio_to_s3, sync_campaign_source, process_campaign_batch, process_knowledge_base_document|url, refresh_knowledge_base_url, refresh_due_knowledge_base_urls, check_auto_sync, reconcile_wallets, process_generic_batch`.

## 6. Browser/web calls
1. **Authenticated in-dashboard call**: `WS /ws/signaling/{workflow_id}/{run_id}` (WebRTC, SmallWebRTC mode `smallwebrtc`), after `POST /workflow/{id}/runs`; TURN creds from `GET /turn/credentials`.
2. **Embeddable widget**: owner creates an embed token (`POST /workflow/{id}/embed-token`; allowed domains + theme/position/colour/button text in token settings); the page calls `POST /public/embed/init {token, context_variables}` → `{session_token, workflow_run_id, config}`; then `WS /ws/public/signaling/{session_token}`; TURN via `/public/embed/turn-credentials/{session}`. `PublicEmbedCORSMiddleware` handles origin checks. A static widget script lives in `ui/public/embed`. So the "widget.js + origin-restricted token" requirement **largely exists**; wording/branding and per-agent token UX need work.
3. **Agent Stream** (`/agent-stream/{workflow_uuid}`): telephony-provider media socket; *not* a browser protocol; raw-audio branch returns 1011 "not yet implemented"; unauthenticated apart from the UUID (quota is checked).
4. Text-only runs: `workflow_text_chat` routes + `WorkflowRunMode.TEXTCHAT` — usable for the typed fallback and simulated callers.

## 7. What this fork changed vs upstream
`git merge-base HEAD upstream/main` = `2326a2f6`; **175 commits, 257 files, +32.9k/−12.4k lines** since. Main themes (from commit log + file diff):
- **Wallet/ledger + reseller + model profiles + client role** (`7e57bef9`; `billing/`, `reseller/`, `routes/reseller.py`, big `routes/superuser.py`, migrations `a7c1d2e3f4b5`, `b8d2e3f4a5c6`, `e10c410b021x`, `895f207e88ae`).
- Org management fields (name/slug/is_active), `users.role`, concurrency limits + generic `queued_runs`.
- Campaign **sources**: Google Sheets, HubSpot, Salesforce, Zoho, API endpoint, live source (`services/campaign/contact_fetchers`), `crm_credentials`.
- WhatsApp follow-up/webhook/logs.
- Knowledge base **URL sources with scheduled refresh** (latest commits), Inworld search feedback.
- TTS/STT: Sarvam bulbul v4-flash (222 voices), Inworld realtime, Smallest STT patch, sentence streamer, filler/human-volume processors.
- UI: dark-only redesign "to match dograh-frontend-demo", responsive sidebar, superadmin org switcher.
- Security fixes: `utils/safe_fetch.py` (SSRF), WS org scoping, telephony webhook signature URL fix.
Implications: the fork diverges a lot in `db/models.py`, `routes/organization.py`, `superuser.py`, `auth/depends.py`; a new product layer should avoid touching those. Remotes: `origin` = nickgoel31/dograh, `upstream` = dograh-hq/dograh (fetched today; local `upstream/main` is now current).

## 8. Gap list vs the Vocalis front-end (§4 of the brief)

Legend: ✅ exists · 🟡 exists, needs field/adaptation · ❌ missing

| § | Need | Status | Notes |
|---|---|---|---|
| 4.1 | Email/password sign-in | ✅ | local JWT; swap secret, cookie session is new |
| 4.1 | Google login, email verification, password reset, magic link, 2FA | ❌ | none found |
| 4.1 | Workspaces, membership roles | 🟡 | orgs + M2M exist; role is on user, needs per-membership role and Owner/Admin/Developer/Viewer |
| 4.1 | `GET /me` with workspaces/plan/flags | 🟡 | `/auth/me`, `/user/auth/user` exist, wrong shape |
| 4.1 | Notifications, global search, AI Helper | ❌ | |
| 4.1 | Test/Live environments | ❌ | recommend a **second org per workspace** (flagged `is_test`) — matches wallet, telephony, API-key and campaign scoping already keyed by `organization_id` |
| 4.2 | Home KPIs / chart | 🟡 | `/organizations/reports/daily`, `/usage/daily-breakdown` give runs/duration/cost; no success-rate, no "needs attention" |
| 4.3 | Agent CRUD, duplicate, templates | ✅ | `/workflow/*`, templates routes |
| 4.3 | Live/Draft/Paused status | ❌ | only active/archived; add product table |
| 4.3 | Versions, publish, restore | 🟡 | versions/publish/create-draft exist; diff and restore missing |
| 4.3 | Prompt compiler, "generate my agent" | ❌ | an LLM→definition path exists only as `a63fe152` "create from prompt" in UI (unread) |
| 4.3 | Readiness checklist | ❌ | |
| 4.3 | Behaviour sliders → settings | 🟡 | keys live in `workflow_configurations`; need enumeration |
| 4.3 | Optimistic-concurrency ETag | ❌ | |
| 4.4 | Telephony configs & numbers, assign inbound agent | ✅ | `inbound_workflow_id` on number |
| 4.4 | Search/buy numbers via provider API | ❌ | only register existing addresses |
| 4.4 | Business hours, fallback, reputation | ❌ | `inbound/fallback` route exists (purpose unread) |
| 4.4 | SIP/BYO credentials | 🟡 | ARI/Asterisk + Cloudonix present; wizard missing |
| 4.5 | Runs list/detail, recording/transcript URLs, cost split, usage | 🟡 | `usage_info/cost_info/gathered_context/logs` JSON on `workflow_runs`; list is per-workflow, **no cross-agent paginated/filtered/sorted search**, no env filter |
| 4.5 | Outcome mapping | 🟡 | `disposition_mapper.py` maps org-configured codes; product outcomes (booked…) need a table |
| 4.5 | Sentiment, summary, failure reason | 🟡 | QA node writes `annotations`; no built-in summary/sentiment job |
| 4.5 | Waveform peaks, per-turn latency | ❌ / unverified | |
| 4.5 | Signed audio URLs | ✅ | `/s3/*` |
| 4.6 | KB documents, chunking, embeddings, search | ✅ | pgvector; URL sources + refresh exist |
| 4.6 | Crawler (depth/robots), Q&A, text sources, gaps | 🟡/❌ | single-URL fetch only (verify); gaps job missing |
| 4.7 | HTTP/MCP tools, credentials, Google Calendar? | 🟡 | tools + credentials ✅; CRM creds for HubSpot/Salesforce/Zoho/Sheets exist for **campaign sources, not agent tools**; Calendar/Slack/Razorpay/Zapier tools missing; `services/integrations` is only a Tuner stub |
| 4.7 | Built-ins (end call, transfer, calculator) | ✅ | SMS/email/DTMF tools ❌ (`native` category reserved) |
| 4.7 | Tool test, SSRF guard | 🟡 | `utils/safe_fetch.py` exists |
| 4.8 | Voices catalogue | 🟡 | `GET /user/configurations/voices/{provider}` live-queries providers; no normalised table, sample clips or compare |
| 4.9 | Browser playground | ✅ | WebRTC signalling + text chat |
| 4.9 | Simulated callers, test cases, A/B | ❌ | `evals/` dir at repo root (unread) may help |
| 4.10 | Campaigns CRUD/start/pause/resume/progress/retry | ✅ | rich (sources, retry_config, rate limit, redial) |
| 4.10 | Compliance gate, DND, per-contact timezone window, audit | ❌ | `campaign-defaults` route may hold some hours config (unread) |
| 4.10 | `campaign.completed` webhook, live SSE | ❌ | |
| 4.11 | Analytics rollups, insights | ❌ | daily report only |
| 4.12 | Wallet, ledger, billing config | ✅/🟡 | minutes-based; money top-up entries exist |
| 4.12 | Razorpay/Stripe, auto top-up, limits, invoices, GST | ❌ | |
| 4.13 | Own `sk_test_/sk_live_` keys, rate limits, request logs | 🟡/❌ | key hashing exists, different format, no env split, no logging |
| 4.13 | Outbound webhooks: HMAC, retries, log, resend | ❌ | |
| 4.13 | Widget | 🟡 | see §6 |
| 4.13 | SDKs | 🟡 | `sdk/python`, `sdk/typescript` exist, upstream-branded |
| 4.14 | RBAC matrix | ❌ | 3 roles, route-level `require_role` |
| 4.14 | Audit log | ❌ | |
| 4.14 | Recording/PII/retention runtime controls | ❌ | |
| 4.14 | Sub-accounts/agency | ✅ | reseller parent/child orgs |
| 4.15 | Help content, status, support form | ❌ | `docs/` (Mintlify) can seed content; `/health` exists but is shallow |
| X | Branding | ❌ | "Dograh" in API title, OpenAPI servers, WS subprotocol, MPS URL, default org ids, docs, SDKs, `ui/` |
| X | Tenant isolation | 🟡 | most queries org-scoped; **`/agent-stream/{uuid}` and `get_workflow_by_uuid_unscoped` are unscoped by design** |

## 9. Risks / decisions I need from you (see summary in chat)
1. Product layer location: separate service vs `/v1/product/*` router in this app (recommend router namespace; low diff, shares DB and `get_user`).
2. Test/Live: second org per workspace (recommended) vs flag.
3. Reuse the fork's wallet/ledger (recommended) instead of a new one; extend it with money/COGS columns.
4. `OSS_JWT_SECRET` default is the literal placeholder and CORS is `*` when `DEPLOYMENT_MODE=oss` — must be set before any real deployment.
5. Confirm the front-end source is `swarvoai` and whether the page files really cover all 14 areas listed in the brief.

## 10. Not yet read (so not documented above)
Request/response schemas (use OpenAPI), `schemas/workflow.py` behaviour keys, `inbound/fallback` and `campaign-defaults` semantics, `service_keys` purpose, `evals/`, `mcp_server/tools`, `quota_service.py`, per-provider telephony capabilities, `docs/contribution/setup.mdx`, and any of `ui/`.
