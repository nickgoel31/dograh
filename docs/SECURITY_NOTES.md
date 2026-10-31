# Security notes — product layer

Scope: `api/product/` and `vocalis-web/`. The platform underneath keeps its own security model. Nothing here has had an outside review or penetration test.

## What is protected, and how

| Asset | Threat | Control | Where |
|---|---|---|---|
| One customer's data seen by another | Guessing ids, wrong workspace header | Every query filters by the caller's workspace and the Test/Live organization. Workspaces the caller isn't in answer "not found". Public ids are opaque and tamper-evident (HMAC-tagged). | `deps.py`, `ids.py`, `test_tenant_isolation.py` |
| Actions beyond a person's role | Viewer calling write endpoints | Role matrix checked on the server for every route (`require(Perm)`). A test walks owner/admin/developer/viewer across the sensitive endpoints. | `roles.py`, `test_platform.py` |
| Stolen session | XSS, CSRF | httpOnly cookie, `SameSite`, `Secure` in production; browser sockets check `Origin`. | `router.py`, `calls_router.py` |
| Password guessing | Credential stuffing | Per-IP and per-email limits; same answer for unknown email and wrong password; optional authenticator-app 2FA. | `router.py`, `totp.py` |
| API keys leaked from our database | Database read | Only a SHA-256 hash is stored; the key is shown once; revocable; Test and Live are separate. | `developers.py` |
| Webhooks used to reach internal services (SSRF) | Pointing a webhook at `10.x`, `localhost`, metadata addresses | https only; private, loopback and link-local addresses refused at creation and again after name lookup at send time; redirects not followed. | `developers.py` |
| Forged webhooks | Someone posts to the customer's endpoint | HMAC-SHA256 signature over `time.body` with a per-webhook secret (shown once). | `developers.py` |
| Test mode reaching real people | Mistaken calls | Test calls only run in the browser on the Test organization; campaigns and purchases are Live-only. | `calls_router.py`, `campaigns_router.py` |
| Runaway spend | Loops, abuse | Monthly spend limit pauses inbound calls politely; wallet balance is the platform's. | `billing.py`, `hours.py` |
| Personal data in transcripts | Over-retention, wide access | Optional masking, optional hiding of recordings, retention purge, consent announcement. | `privacy.py` |
| Unsigned audio links | Sharing recordings | Links are signed and short-lived by the platform's storage layer. | `conversations_router.py` |
| Invites used by the wrong person | Forwarded link | Single-use, 7 days, only accepted by the invited email. | `team_router.py` |

## Known gaps and accepted risks

- **Website widget origin check is soft.** The embedding site address comes from the visitor's browser. Anyone scripting requests can claim any allowed site. Widget calls are billed to the Live balance; keep a spend limit set.
- **No email delivery.** Invite links and support messages rely on people passing them on; there is no reset-password flow in the new UI.
- **2FA has no recovery codes.** Someone who loses their authenticator needs an operator to clear `totp_enabled` in `product_user_profiles`.
- **Rate limiting is Redis-backed per key / IP; behind a proxy, `X-Forwarded-For` is trusted** as the platform does. Make sure the proxy overwrites it.
- **Webhook secrets are stored in plain text** (needed to sign). Protect database backups accordingly. API keys, in contrast, are hashed.
- **Recording capture** is controlled by the platform, not by the "show recordings" switch; stored transcripts are only changed by the retention job.
- **Audit log is append-only by convention**, not by database permission.
- **Background work runs inside the API process** (practice calls, A/B tests). A restart loses unfinished runs.
- **No dependency or container scanning** is wired in for `vocalis-web`; run `npm audit` before releases.
- **Not run against Postgres, real providers or real calls.** Row-level behaviour (unique constraints under concurrency, for example two simultaneous webhook scans) is unverified.

## Before going to production

1. Set a strong `OSS_JWT_SECRET` (32+ bytes) — the development one triggers warnings.
2. Serve the web app and API over https; leave `PRODUCT_COOKIE_SECURE` on; list exact origins in `PRODUCT_ALLOWED_ORIGINS`.
3. Set `PRODUCT_OPS_SECRET` and schedule the tick (see RUNBOOK).
4. Never set `PRODUCT_ALLOW_PRIVATE_WEBHOOKS` outside development.
5. Run `python scripts/check_branding.py --api` and the full test suite.
