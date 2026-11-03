# Runbook — running the product layer

## What runs

- **API**: the platform's FastAPI app; the product routes are mounted under `/api/v1/product/*` and `/api/v1/public/*`.
- **Web app**: `vocalis-web/` (static files after `npm run build`). Serve it from any static host; proxy `/api` to the API or set `VITE_API_URL`.
- **Classic UI**: unchanged. The two UIs hand a signed-in person across with a one-time code (`VOCALIS_URL` on the classic UI, `VITE_CLASSIC_URL` on the new one).

## First install

1. Apply migrations: `./scripts/migrate.sh` (the product tables arrive in `d1e2f3a4b5c6` … `f9a0b1c2d3e4`; single linear head).
2. Create at least one **model profile** and map it: `PRODUCT_PROFILES='{"default":"<slug>"}'` (see `docs/MODEL_SETUP.md`). Without it, calls and practice runs say "calling isn't set up".
3. Build the web app: `cd vocalis-web && npm ci && npm run build` (`VITE_USE_MOCKS=false`).
4. Set the environment below, restart the API.
5. Bring existing customers over: they sign in to the new app and see "bring over your organization" (adopts in place, nothing is copied or lost).

## Environment

| Variable | Purpose |
|---|---|
| `PRODUCT_NAME` | Brand shown in emails-to-be, signatures and the widget |
| `PRODUCT_PROFILES` | JSON map `default/fast/balanced/smartest` → model profile slug |
| `PRODUCT_SESSION_COOKIE`, `PRODUCT_COOKIE_SECURE`, `PRODUCT_ALLOWED_ORIGINS` | Sessions and allowed browser origins (comma separated) |
| `PRODUCT_FREE_MINUTES` | Free minutes granted to a new workspace |
| `PRICE_PER_MIN`, `CURRENCY`, `PRODUCT_GST_RATE`, `PRODUCT_SELLER_NAME/GSTIN/ADDRESS/STATE`, `PRODUCT_INVOICE_SAC` | Pricing and invoices |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Online top-ups (off until set) |
| `PRODUCT_TWILIO_ACCOUNT_SID`, `PRODUCT_TWILIO_AUTH_TOKEN`, `PRODUCT_NUMBER_MONTHLY_LOCAL/TOLL_FREE` | Buying real numbers (off until set; sandbox numbers otherwise) |
| `PRODUCT_CALL_WINDOW`, `PRODUCT_MAX_CAMPAIGN_ROWS`, `HUMAN_COST_PER_MIN_DEFAULT` | Campaign and analytics defaults |
| `PRODUCT_NEW_UI_ORGS` | Which existing customers may use the new experience, by organization id: empty = nobody (default), `12,15` = those, `*` = everyone. Controls the switch link, the hand-off, bringing an org over, and sign-in on the new site for existing accounts. New accounts made on the new site are never held back. |
| `PRODUCT_OPS_SECRET` | Enables `POST /api/v1/product/ops/tick` |
| `PRODUCT_ALLOW_PRIVATE_WEBHOOKS` | Development only |
| Classic UI: `NEXT_PUBLIC_VOCALIS_ENABLED`, `VOCALIS_URL` | Show the "switch to new UI" item |

## Scheduled job (required)

Webhooks and data retention don't run by themselves. Call this every minute:

```bash
curl -fsS -X POST https://YOUR-API/api/v1/product/ops/tick -H "X-Ops-Secret: $PRODUCT_OPS_SECRET"
```

It returns `{"queued": n, "sent": n, "purged": n}`. If it stops, webhooks stop arriving; customers can press "Check for new events" meanwhile. Not scheduled either (not built): weekly insight generation, monthly invoices, low-balance checks — these run when the related page is opened.

## Health

- `GET /api/v1/product/help/status` — database, model profiles, payments, phone numbers (configuration checks, no outside probes).
- Webhook problems: Developers → Webhooks → Deliveries; a bell alert is raised when one gives up after 6 tries.

## Common problems

| Symptom | Likely cause | Fix |
|---|---|---|
| "Calling isn't enabled for your workspace" | No model profile / mapping | `docs/MODEL_SETUP.md`, restart |
| Test call closes at once, reason `origin_not_allowed` | Web origin missing | Add it to `PRODUCT_ALLOWED_ORIGINS` |
| Customer can't sign in after turning on 2FA | Lost authenticator | `update product_user_profiles set totp_enabled=false, totp_secret=null where user_id=…` |
| Webhook says "points inside a private network" | Intentional SSRF guard | Use a public https address |
| Top-up button missing | Razorpay not configured | Set the Razorpay variables |
| Widget says "website not allowed" | Site not in Settings → Privacy | Add `https://their-site` |

## Backups and removal

Product data lives in the `product_*` tables plus the platform tables it points to. Removing the product layer means dropping those tables (downgrade through `d1e2f3a4b5c6`) and the five small edits listed in `docs/FORK_MAP.md`; platform data is untouched.

## Release checklist

```bash
python scripts/check_branding.py --api
python -m pytest api/tests/product --noconftest          # with DATABASE_URL/REDIS_URL/MINIO_PUBLIC_ENDPOINT set to dummies
cd vocalis-web && npx tsc --noEmit && npm run build && npx vitest run && npx playwright test
```


## Docker install with the new app under /new/ (the Oracle VM layout)

**Quick way:** after the branch is on `main`, on the VM run `cd ~/dograh && git pull origin main && bash scripts/deploy_new_ui.sh` (does everything below, asks for confirmation first). Then `bash scripts/set_new_ui_customers.sh` lists customers and switches them on or off. The manual steps follow.

The new app is its own small container (`vocalis`, built from `vocalis-web/Dockerfile`). The existing nginx sends `https://YOUR-HOST/new/` to it and everything else exactly as before. No new DNS name or certificate is needed.

1. Merge `feat/product-layer` into the branch the VM pulls (`main`) and push.
2. On the VM, back up first:
   `sudo docker exec dograh-postgres-1 pg_dump -U postgres postgres > ~/backup-before-vocalis.sql`
   `sudo docker tag dograh-local/dograh-api:local dograh-local/dograh-api:before-vocalis`
3. Add to the VM's `.env` (compose passes them to the API): `PRODUCT_NEW_UI_ORGS=` (leave empty: nobody switched on yet), `PRODUCT_PROFILES=...`, `PRODUCT_ALLOWED_ORIGINS=https://YOUR-HOST`, `PRODUCT_OPS_SECRET=<long random>`, `VOCALIS_CLASSIC_URL=https://YOUR-HOST`.
4. Deploy in a quiet hour (restarting the API drops calls in progress; tables are created automatically when it starts):
   `./deploy.sh api` then `./deploy.sh vocalis` (the new app).
5. Make nginx pick up the new route: `sudo docker compose --profile remote up -d dograh-init nginx` then `sudo docker exec nginx_https nginx -s reload`.
6. Check `https://YOUR-HOST/new/` loads, the classic UI still works, and create a test account on the new app.
7. Switch a customer on: put their organization id in `PRODUCT_NEW_UI_ORGS`, `sudo docker compose --profile remote up -d api`. To show the "Switch to the new UI" link in the classic UI, rebuild it once with `NEXT_PUBLIC_VOCALIS_ENABLED=true` and set `VOCALIS_URL=https://YOUR-HOST/new` on the `ui` service (`./deploy.sh ui`); the link only appears for switched-on customers.
8. Add the every-minute `ops/tick` job (above).

To undo: set `PRODUCT_NEW_UI_ORGS` empty and restart the API; or `docker tag dograh-local/dograh-api:before-vocalis dograh-local/dograh-api:local` and bring the API up again.

## New app at the front door, classic app on its own address

`scripts/setup_old_ui_host.sh` puts the new app at `https://app.<domain>/` and the classic app at `https://old.<domain>/`
(one certificate covers both, so renewal keeps working). It sets `OLD_UI_HOST` in `.env`, which makes `dograh-init`
render `deploy/templates/nginx.remote.split.conf.template` instead of the single-address template. `/new/...` links
redirect to `/...`. Run it with `--undo` to go back to classic at `/` and the new app at `/new/`.
