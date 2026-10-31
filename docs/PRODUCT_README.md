# The product layer ("Swarvo AI")

A white-label voice-agent product built on this platform. The platform is not rewritten: a thin layer in `api/product/` talks to it through small seams, and a separate web app in `vocalis-web/` replaces the interface. The classic UI keeps working; people can switch between the two.

```
vocalis-web/   React app (Vite, TanStack Query, Zustand)         ← customers use this
api/product/   routes /api/v1/product/* and /api/v1/public/*       ← product rules live here
   gateway seams → platform workflows, knowledge, tools, campaigns, wallet, telephony, text agent, LLM
api/ (core)    unchanged apart from five small hooks (see FORK_MAP.md)
```

Brand name, price and currency are constants in one place (`vocalis-web/src/config/brand.ts`, `api/product/config.py`). `python scripts/check_branding.py --api` fails if the platform's own name appears in anything customers can see.

## Ideas that shape the code

- **Test and Live.** Each workspace is two platform organizations. Everything is built and tried in Test (free, browser-only); *Go live* copies the published agent to Live.
- **Plain words.** Technical terms are hidden unless Advanced is switched on. Errors are friendly and carry a stable `code`.
- **Honesty.** Anything that can't be measured or isn't built says so ("Not tracked yet", "Coming soon") instead of showing invented numbers.
- **Seams for testing.** Each outside dependency is a small interface with a real implementation and an in-memory fake, so the product rules are tested without Postgres, models or phone carriers.

## Try it in two minutes (no database needed)

```bash
python scripts/product_dev.py            # API on :8000, in-memory, calls/payments simulated
cd vocalis-web && npm ci && npm run dev  # app on :5174
```

Set `VITE_USE_MOCKS=true` for a fully offline demo with sample data. The dev server also seeds an old-style account (`old@example.com` / `old-password`) to try bringing an existing organization over.

## Tests

```bash
python -m pytest api/tests/product --noconftest     # 105 tests; needs DATABASE_URL, REDIS_URL, MINIO_PUBLIC_ENDPOINT set to any value
cd vocalis-web && npx vitest run && npx playwright test   # converter tests; one browser golden path
```

## Documents

| File | For |
|---|---|
| `FORK_MAP.md` | How the platform is organised and exactly what the layer touches |
| `PRODUCT_ASSUMPTIONS.md` | Decisions, limits and what is *not* built, phase by phase |
| `MODEL_SETUP.md` | Operator guide for voice/AI model profiles |
| `API.md` | Public API and webhooks |
| `RUNBOOK.md` | Install, environment, scheduled job, troubleshooting |
| `SECURITY_NOTES.md` | Threat model, controls, known gaps |

## Status

All nine phases are built. What has **not** been verified: Postgres migrations and constraints, real model/voice/phone providers, real payments, real calls. Model-driven features were tested with scripted stand-ins. Treat first real use as a pilot.
