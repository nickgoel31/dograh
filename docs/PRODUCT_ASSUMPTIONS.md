# Product assumptions and decisions

Decisions taken for the white-label product (brand: `PRODUCT_NAME`, default "Vocalis"). Update this file whenever one changes.

## Architecture (decided in Phase 2)
- **Product API lives inside the existing FastAPI app** as a router namespace: `/api/v1/product/*` (code in `api/product/`, tables in `api/db/product_models.py`). Why: shares the DB, auth helpers and workers with the minimum diff against upstream. Core files touched: `api/routes/main.py` (one include) and `api/alembic/env.py` (one import).
  - Note the prefix is `/api/v1/product`, not `/v1/product`, because the app mounts every router under `/api/v1`.
- **One workspace = two platform organizations** (live + test), stored in `product_workspaces.live_org_id/test_org_id`. Every core query for a request must use `ctx.org_id`, which resolves from the `X-Environment` header. Why: wallet, telephony, API keys, campaigns and runs are already keyed by `organization_id`, so Test/Live isolation needs no new column on core tables.
- **Roles are per membership** (`product_memberships.role`: owner/admin/developer/viewer), separate from the core `users.role`. The core role is left at `admin` for product users so existing platform code keeps working.
- **Sessions**: httpOnly cookie (`PRODUCT_SESSION_COOKIE`) carrying the existing JWT format, or `Authorization: Bearer`. Cookie is `Secure` unless `PRODUCT_COOKIE_SECURE=false` (needed for local HTTP dev).
- **Default environment is `test`** when the client sends no `X-Environment`, so nothing is billed or dialled by accident.
- **Public ids**: workspaces use `ws_…`; users `usr_…` (hash of the internal id). Internal integer ids are never returned.
- **Typed contract**: `python -m api.product.export_openapi vocalis-web/openapi.json` writes a product-only spec; `npx openapi-typescript openapi.json -o src/lib/api/schema.d.ts` regenerates the TS types.

## Front-end
- Source: `swarvoai/` (Vite + React 18), copied to `vocalis-web/` (original left untouched).
- `VITE_USE_MOCKS=true` serves the built-in sample data with no backend. With it `false` (default), sign-in is required and workspaces/Test-Live are real.
- **Only sign-in, workspaces and Test/Live are real so far.** Every other page still reads sample data via `src/lib/api/index.ts` until its module is built (Phase 3 onward). Sample data is therefore visible in real mode — do not treat it as the customer's data.

## Not done yet / open
- Email verification, password reset, Google sign-in, 2FA (none exist in the fork).
- New users get **no model/voice provider configuration**: the fork's signup provisions one via a managed external service; the product layer deliberately does not. Phase 3 must define server-side model presets per workspace.
- `OSS_JWT_SECRET` default is a placeholder; set a long random value before any deployment (tests currently warn about a 23-byte key).
- Rate limiting reuses the core limiter (Redis, degrades to per-process).
- Core tables are still created through the fork's normal migrations; the new migration `d1e2f3a4b5c6` has **not** been run against Postgres (see verification notes in the Phase 2 report).

## Agents (Phase 3, part 1)
- **Editing happens on the test workflow; "Go live" copies the published version into the live org** (created on first go-live, updated in place afterwards). `product_agents` holds both workflow ids plus emoji/colour/tone/business, status (`draft|live|paused`) and an integer `version` used as the ETag (`If-Match` header → friendly 409 `edited_elsewhere`).
- **Simple vs custom prompt**: simple agents recompile their prompt from fields via `api/product/prompt.py` (versioned, deterministic); writing a prompt switches the agent to custom and later field edits no longer overwrite it.
- **No LLM "generate my agent" yet.** The wizard creates from one of 8 data templates (`api/product/templates.py`) plus the user's description. LLM generation needs a server-side model config the product layer does not have yet.
- **Readiness** currently checks only: prompt present (blocker), business name (warn), voice chosen (warn). Knowledge, test-call and phone-number checks are added when those modules exist; the Publish tab still shows the demo's local checklist beside the real server check.
- **Pause/resume is a status flag only** for now; it does not yet stop inbound routing or campaigns (needs Phone Numbers/Campaigns, later phases).
- **Not yet real in the agent screen**: voice list (still demo voices), Call Flow editor (not saved; converter not written), Knowledge/Tools/Behavior/Phone/Test tabs, versions list, per-agent call stats (return 0).
- The core is reached through one seam, `api/product/gateway.py`. `CoreGateway` matches the core's real method signatures (checked) and the graph it generates passes the core's own DTO + graph validation (checked), but it has **not** been exercised against a real database.

## Voices and test calls (Phase 3, part 2)
- **Voice catalogue** (`api/product/voices.py`): adapters normalise provider voices. Today only the 222 `bulbul:v4-flash` voices are exposed. The provider's ids encode name, language and style, so those are filled in; **gender, age and accent are `null`** because the source data has none and guessing would be inventing facts. Add curated metadata (or another adapter) to fill them; the UI hides empty fields. Provider names are aliased (`Engine A`) and routing data never leaves the server. Favourites are per user (`product_voice_favorites`).
- **No voice samples yet.** Play buttons are disabled in real mode ("coming soon"); generating clips needs a provider key and object storage. Compare drawer plays nothing for the same reason.
- **Model setup is implemented; see `docs/MODEL_SETUP.md`.** Workspace orgs point at an operator-created default model profile; Brain presets and chosen voices become per-agent `model_overrides` copied from profiles (`api/product/models_config.py`). Without a default profile, agents show a "calls not set up" blocker and cannot go live or place test calls.
- **Quota check**: by reading `check_dograh_quota`, the external managed-service credit check only runs when a profile uses the platform's own managed provider. Profiles with the operator's own provider keys avoid it. The wallet admission check passes for organizations with the wallet disabled (the default for product orgs).
- **Test calls** (`WS /api/v1/product/agents/{id}/call`): cookie auth, origin check, workspace + role (developer or above), then a run is created in the **test** org against the draft graph and the platform's signalling takes over. Rejections accept the socket first and close with a reason code, because a socket closed before accept reaches browsers as a bare HTTP 403. In dev behind the Vite proxy set `PRODUCT_ALLOWED_ORIGINS=http://localhost:5174` (the proxy rewrites Host).
- **"Free" is by construction, not yet measured**: test orgs have the wallet off. Needs checking against a real run.
- **Typed-chat fallback and the Call Flow converter** are not built; the demo chat is hidden in real mode.
