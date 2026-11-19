# Swarvo AI documentation site

Astro Starlight, static output, offline search (Pagefind), light and dark mode. Node 20 or newer.

```bash
cd docs-site
npm ci
npm run dev        # http://localhost:4321
npm run build      # regenerates data pages, checks facts against the code, builds dist/
npm run preview
npm run lint       # front matter (title, description under 160 characters) and wording rules
npm run check:links   # run after build: every internal link, image and anchor in dist/
npm run check:facts   # docs versus code (templates, roles, prices, connectors, carriers, env vars, limits)
npm run spell
```

## How the content is organised
- Hand-written pages: `src/content/docs/<section>/<page>.mdx`. Front matter: `title`, `description` (under 160 characters), `sidebar.order`, `audience` (`everyone`, `owner`, `admin`, `developer`, `operator`), `readingTime`.
- **Generated pages** (start with a GENERATED comment; edit `scripts/gen-pages.mjs`, not the page): agent templates, roles and permissions, volume pricing, bring your own number, the ten integration pages and the integrations table, environment variables, changelog.
- Facts come from the product code: `python scripts/extract_facts.py` writes `src/data/facts.json` (run from the repo root as `python docs-site/scripts/extract_facts.py`, or `npm run gen` from here when your Python can import `api.product`).
- API reference: `src/data/openapi.json`, rendered by starlight-openapi under `/api-reference/`.

## Add a page
Create an `.mdx` file in the right section folder with the front matter above. Links are absolute from the site root, for example `/agents/voice/`. Run `npm run build && npm run check:links`.

## Refresh screenshots
```bash
cd vocalis-web && VITE_USE_MOCKS=true npx vite --port 5180    # demo mode, sample data only
cd docs-site && npx playwright install chromium && npm run screens
```
Images land in `src/assets/screens/`. Use `<Shot name="agents" alt="..." caption="..." />` in a page.

## API reference
The **Swarvo API reference** section (`src/content/docs/swarvo-api/`) documents Swarvo TTS 3 by hand, from `api/product/swarvo_tts_router.py`. The sidebar switcher between *Swarvo app* and *Swarvo API reference* comes from `starlight-sidebar-topics` in `astro.config.mjs`. The generated product OpenAPI reference was removed from the site; `scripts/export_openapi_full.py` is kept in case it is wanted again.

## Deploy (operator)
The site is plain static files. Run `npm run build` and serve the `dist/` folder from any static host or from your existing nginx under `docs.swarvoai.com` (compare `deploy/templates/nginx.remote.conf.template`, which serves the app). You need a DNS record and certificate for the new name. Set `DOCS_SITE_URL` when building if the address differs, and replace the placeholder edit-link address `https://github.com/OWNER/REPO/...` in `astro.config.mjs`. No Docker files are included.

## Notes
- The OpenAPI plugin cannot read files from folders whose path contains a space, so `astro.config.mjs` copies the spec to a temporary folder when it has to.
- Only `Contact support` and `Status and security` contain operator placeholders.
