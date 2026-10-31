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

## Regenerate the API reference
```bash
npm run gen:api   # from the repo root's perspective: python docs-site/scripts/export_openapi_full.py
```
`scripts/export_openapi_full.py` builds an OpenAPI file with **every** product router (the shipped `export_openapi` leaves out developers, team, the public API and others). Run it from the repo root:

```bash
python docs-site/scripts/export_openapi_full.py
python -m api.product.export_openapi vocalis-web/openapi.json   # the app's own, smaller file
```

## Deploy (operator)
The site is static. Build the image from the repo root:

```bash
docker build -f docs-site/Dockerfile -t swarvo-docs .
```

Example service to add to your compose file (documented only; the shipped `docker-compose.yaml` is unchanged):

```yaml
  docs:
    image: swarvo-docs
    restart: unless-stopped
```

Example nginx server block for `docs.swarvoai.com` (compare `deploy/templates/nginx.remote.conf.template`, which serves the app and proxies `/new/`). You also need a DNS record and a certificate for the new name:

```nginx
server {
  listen 443 ssl;
  server_name docs.swarvoai.com;
  # ssl_certificate lines as for the app
  location / {
    set $docs_upstream http://docs:80;
    proxy_pass $docs_upstream;
  }
}
```

Set `DOCS_SITE_URL` when building if the address differs. Replace the placeholder edit-link address `https://github.com/OWNER/REPO/...` in `astro.config.mjs`.

## Notes
- The OpenAPI plugin cannot read files from folders whose path contains a space, so `astro.config.mjs` copies the spec to a temporary folder when it has to.
- Only `Contact support` and `Status and security` contain operator placeholders.
