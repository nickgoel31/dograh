# Prompt: build the Swarvo AI documentation site

Paste everything below this line into a new Claude Code session opened at the root of this repository
(`dograh/`, the folder that contains `api/`, `vocalis-web/` and `docs/`).

---

## 1. Your mission

Build a complete, production-quality **documentation website** for **Swarvo AI**, a white-label voice-agent product. Customers use it to create AI phone agents that answer and make calls, book appointments, qualify leads and more. The site must be good enough that a non-technical business owner can set up their first agent without help, and that a developer can integrate through the API without asking questions.

The product lives at `https://app.swarvoai.com` (new interface under `/new/`). The docs site will live at `https://docs.swarvoai.com`.

Work autonomously and finish the whole job. Do not stop to ask me questions unless something is truly impossible to decide from the repository. Where you must choose, choose the sensible default and mention it in your final report.

## 2. Source of truth: read the code, do not guess

The product is already built. **Every statement in the docs must be true of the code.** Before writing each page, read the relevant source. Never invent features, prices, limits, screens or endpoints. If something is unclear or looks unfinished, say so in the page ("not available yet") or leave it out, and list it in `docs-site/UNVERIFIED.md`.

Read these first:

- `docs/PRODUCT_README.md`, `docs/PRODUCT_ASSUMPTIONS.md`, `docs/API.md`, `docs/RUNBOOK.md`, `docs/SECURITY_NOTES.md` (existing notes written for operators and developers)
- `api/product/` (the whole product backend: routers named `*_router.py`, plus `pricing.py`, `connectors.py`, `payments.py`, `security.py`, `push.py`, `autotopup.py`, `practice.py`, `models_config.py`, `flows.py`, `templates.py`, `help_content.py`)
- `vocalis-web/src/` (the front end: `pages/`, `components/`, `layout/Shell.tsx`, `config/brand.ts`)
- `vocalis-web/openapi.json` (generated API description of the product endpoints)
- `api/tests/product/` (tests show intended behaviour and edge cases)
- `scripts/` (setup scripts the operator runs on the server)
- `api/product/help_content.py` already holds help articles written for the in-app Help page. Reuse and improve them; keep the two consistent.

The platform underneath is **Dograh** (open source voice AI). Customers must **never** see the name Dograh or its internals in the docs. Call everything Swarvo AI. Do not mention Pipecat, Dograh, Inworld model internals or other platform names unless a feature genuinely requires a customer to log into that third-party service (for example Twilio, Plivo, Razorpay, Cal.com), in which case name only that service.

## 3. Audiences (write for all four, clearly separated)

1. **Business owner / first-time user.** Not technical. Plain words, short sentences, screenshots, "what you will see" and "what to do". No jargon without a one-line explanation.
2. **Team admin.** Manages members, roles, billing, branding, security.
3. **Developer.** Uses API keys, the public API, webhooks, the website widget, the trigger API.
4. **Operator (the person hosting Swarvo AI on a server).** Deployment, environment variables, setup scripts, scheduled job, upgrades, backups. Keep this in a clearly marked section that customers can ignore.

## 4. Technology and project shape

- Create the site in a new folder **`docs-site/`** at the repo root. Do not modify `api/` or `vocalis-web/` except where this prompt says to.
- Use **Astro Starlight** (preferred) or **Docusaurus 3**. Requirements either way: static output, full-text search that works offline (Pagefind or built-in), dark and light mode, mobile responsive, sidebar with collapsible groups, "on this page" table of contents, previous/next links, "edit this page" link, copy buttons on code blocks, code tabs (curl / Python / JavaScript), callout blocks (note, tip, warning), image zoom, 404 page, sitemap, and an RSS/changelog page.
- TypeScript where code is needed. Node 20. Provide `npm run dev`, `npm run build`, `npm run preview`, `npm run lint`, `npm run check:links`.
- Add a `docs-site/Dockerfile` and `docs-site/nginx.conf` that serve the built site, plus a short deploy section in `docs-site/README.md` explaining how the operator adds it behind the existing nginx at `docs.swarvoai.com` (look at `deploy/templates/nginx.remote.conf.template` and `docker-compose.yaml` for how the app is served; add a `docs` service entry only as a documented example, do not break the current compose file).
- The **API reference** must be generated from `vocalis-web/openapi.json` at build time (use a plugin such as starlight-openapi, or a small script that writes MDX pages). Group endpoints by tag. Show every request and response field, error codes (the product returns `{detail: {code, message}}`), and a curl example for each. Re-generate with one command: `npm run gen:api`. Also write a small script that regenerates the OpenAPI file by running `python -m api.product.export_openapi vocalis-web/openapi.json`.

## 5. Brand and design

- Name: **Swarvo AI**. Short tagline: "Voice agents that answer every call."
- Look: clean, modern, premium. Deep emerald green accent (`hsl(162 84% 21%)` light mode, `hsl(160 62% 46%)` dark mode), slate neutrals, Inter for text and Plus Jakarta Sans for headings, soft rounded cards, thin borders, subtle gradients. It should feel like the app (see `vocalis-web/src/index.css` and `vocalis-web/tailwind.config.js` for the exact tokens).
- Use the real logo if `vocalis-web/public/logo.png` exists; otherwise a simple green microphone mark. Use line icons (lucide), never emoji.
- Landing page (`/`): hero with tagline and two buttons ("Get started", "API reference"), a row of cards for the four audiences, a "Popular guides" grid, a feature overview, and a "What's new" strip. Not a wall of text.
- Every page: clear title, one-sentence summary, estimated reading time for guides, last-updated date.
- Accessibility: AA contrast, keyboard navigation, alt text, no information carried by colour alone.

## 6. Screenshots

Capture real screenshots of the real interface:

1. Start the product in demo mode: `cd vocalis-web && VITE_USE_MOCKS=true npx vite --port 5180` (the app opens at `http://localhost:5180/`, routes like `/agents`, `/agents/a1`, `/billing`).
2. Use a headless browser (Playwright; install it inside `docs-site/` only) to capture light and dark versions at 1440x900 and a few mobile shots at 390x844. Save to `docs-site/src/assets/screens/` with descriptive names. Write a script `docs-site/scripts/capture-screens.ts` so they can be refreshed later.
3. Annotate with numbered markers where a step refers to a button (a small helper that overlays circles is fine).
4. Demo mode uses sample data, so never show real emails, keys or phone numbers. Blur or avoid anything that looks like a secret.
5. Every screenshot has alt text and a caption. If a screen cannot be captured in demo mode (for example billing with real payments), build a faithful static illustration instead and mark it "illustration".

## 7. Content map (create all of these; each is a full page, not a stub)

### Start here
- **What is Swarvo AI**: what it does, who it is for, a 60-second tour with 4 screenshots.
- **Quickstart (10 minutes)**: sign up, create an agent from a template, pick a voice, try a call in the browser, get a number, go live. One continuous tutorial with checkpoints.
- **Key concepts**: workspace, agent, call flow, Test and Live copies, wallet, minutes, template, knowledge, tool, connector, practice call.
- **Simple vs Advanced view**: what each shows and how to switch.
- **Glossary** (alphabetical, plain words).

### Agents
- **Create an agent** (templates: list all 13 from `api/product/templates.py` with what each is for; creating from scratch).
- **Personality** (name, business, what you do, tone; the Simple vs Advanced prompt editor; variables).
- **Voice** (choosing, previewing; the voice engines available; languages; how readiness is shown).
- **Brain** (the Fast / Balanced / Smartest levels and the exact-model picker; what each costs in speed and quality; read `models_config.py` and the Brain page).
- **Human feel** (pace, patience, turn-taking, steadiness, fillers, vocabulary; what each setting actually changes; read `style.py`).
- **Languages** and multilingual behaviour.
- **Knowledge** (website, PDF, text, Q&A; testing a question; **unanswered questions** report and how to close gaps).
- **Tools** (webhook tools, transfer to a human, what the agent sees; masking of secrets).
- **Call flow editor** (full guide): the Flow and Configuration views, full-height canvas, top-to-bottom flow, every step type (Start call, Ask a question, Do something, Yes/No check, Hand to a human, Close, Global rules, Send call data, API trigger, Call quality check), connecting steps, editing a connection's condition, Tidy up, Reset, Try a call (what it simulates and what it does not), keyboard shortcuts, common patterns (receptionist, booking, lead qualification, support triage) each with a diagram.
- **Behavior and limits** (call length, idle timeout, daily caps, quiet hours, voicemail).
- **Phone** (attaching numbers to an agent, opening hours, fallback number).
- **Test your agent** (practice calls in the browser, what they cost, the Try a call chat).
- **Versions and publishing** (draft vs live, Go live checklist, rolling back).
- **Hand over to a person** and **call me** features.
- **Website widget** (voice and chat), including how to embed, allowed websites, customising.

### Phone numbers
- **Buy a number** (countries, local vs toll-free, monthly rent).
- **Bring your own number**: Twilio, Plivo (we set the incoming-call address for you), and Vobiz, Telnyx, Vonage, Cloudonix, Asterisk (the customer sets the incoming-call address; show exactly which fields each carrier needs, from `api/product/numbers_router.py` `CARRIERS`). Include a troubleshooting list.
- **Call hours, fallback number, reputation** fields.
- **Caller ID and compliance notes** (India: DLT/TRAI basics only if the code or docs mention them; otherwise do not claim anything).

### Conversations and insights
- **Reading a call**: the list, filters, search inside transcripts, the detail page (who spoke when, how fast the agent replied, summary and mood, what we found out, where the money went, the recording player).
- **Cost of a call**: per-minute billing explained with worked examples.
- **Contacts and do-not-call**: how contacts are built, opting out, blocking.
- **Analytics and the weekly report**.
- **Alerts and emailed summaries**.
- **Campaigns**: uploading a CSV, pacing, retries, what happens to numbers on the do-not-call list.

### Integrations (one page each, with prerequisites, the exact fields, a step-by-step, what the agent can do, what gets sent after each call, and troubleshooting)
Google Calendar, Calendly, Cal.com, HubSpot, Salesforce, Zoho CRM, Shopify, Slack, WhatsApp, Google Sheets, Razorpay payment links, and "Any web address (Zapier, n8n)". Take field names and hints from `api/product/connectors.py` and `integrations_router.py`. Be honest about limits, for example Calendly booking needs a paid plan and WhatsApp needs an approved message template. Add an "Integrations at a glance" table.

### Billing and money
- **How billing works**: wallet, free minutes, per-minute billing **rounded up** (a 61-second call is 2 minutes; a call that never connects is free), practice calls charged at the same rate, phone number rent billed separately.
- **Volume pricing table** (price per minute by minutes used in a month; the rate applies at the moment of each call): up to 1,000 min ₹6.75; up to 5,000 ₹6.00; up to 15,000 ₹5.50; up to 25,000 ₹5.00; up to 37,500 ₹4.60; up to 50,000 ₹4.20; up to 75,000 ₹3.80; up to 100,000 ₹3.40; above that, contact sales. Verify against `api/product/pricing.py` and say the operator can change it.
- **Adding money** (Razorpay), **low balance and auto top-up** (we email a one-tap payment link; nothing is charged until the customer pays), **invoices (GST) and receipts**, **spend limit**, **where the money goes** (phone, voice, speech-to-text, AI brain split).
- **Billing FAQ** (refunds, failed payments, what happens at zero balance).

### Team, security and branding
- **Roles and permissions** (owner, admin, developer, viewer): a full matrix generated from `api/product/roles.py`.
- **Invite teammates**, accept an invite, remove a member.
- **Two-step sign-in**, **allowed networks (IP allow-list)** with the lock-out protection, **company sign-in with Google** (what it does and does not do), **audit log**.
- **Privacy**: recording on/off, consent announcement, PII redaction, retention, clearing old data.
- **White-label branding** (name, colour, logo; sub-accounts and their usage).
- **Testing vs live data and tenant isolation**: explain in plain words how each workspace's data is kept separate. Do not overclaim; read `docs/SECURITY_NOTES.md` and use its wording.

### Developers
- **Authentication and API keys** (creating, scopes, rotating, revoking).
- **Public API** (`/api/v1/public/*`): every endpoint with examples in curl, Python (requests) and JavaScript (fetch); starting an outbound call; listing calls; fetching a transcript; rate limits; errors; idempotency; pagination.
- **Webhooks**: events, payload examples, signature verification with code in Python and Node, retries, replay, testing with a local tunnel.
- **API trigger node**: starting calls from your own software.
- **Website widget SDK**: embed snippet, options, events, security (allowed origins).
- **Product API reference** (generated).
- **Changelog and versioning policy** (propose a sensible policy).

### Operators (self-hosting)
- **Architecture overview** (one diagram: browser, nginx, product API, call engine, Postgres, Redis, storage, carriers, voice and AI providers) in Mermaid.
- **Requirements** and **first install** (use `docker-compose.yaml`, `deploy/`, `scripts/deploy_new_ui.sh` as the real procedure).
- **Environment variables**: a complete table of every `PRODUCT_*`, `GOOGLE_*`, `RAZORPAY_*`, SMTP and related variable the code reads (find them with a repository search; for each: purpose, example, required or optional, which feature breaks without it).
- **Setup scripts** (`setup_voices.sh`, `setup_numbers.sh`, `setup_email.sh`, `setup_logins_payments.sh`, `setup_google_account.sh`, `set_new_ui_customers.sh`): what each asks, in what order, and how to check the result.
- **The scheduled job** (`POST /api/v1/product/ops/tick` every minute with the ops secret): exactly what it does (webhooks, alerts, summaries, contacts, texts, weekly reports, practice charges, rate sync, pushes to connected apps, top-up links) and how to confirm it is running.
- **Rolling out the new interface to customers** (`PRODUCT_NEW_UI_ORGS`, per-organization switch, the old interface stays).
- **Upgrades, backups and restore, logs, health checks, scaling**.
- **Troubleshooting runbook** (symptom, likely cause, fix) built from `docs/RUNBOOK.md` and real failure messages in the code.

### Help
- **FAQ** (at least 40 questions across all areas).
- **Troubleshooting for customers** (agent does not answer, voice sounds wrong, call dropped, number not ringing, payment not credited, integration will not connect, Try a call fails).
- **Contact support** page with placeholders the operator can fill (email, hours).
- **Status and security disclosures** page (placeholder text, clearly marked).

## 8. Writing standards

- Plain words. Short sentences. Active voice. Explain a technical term once, then use it consistently.
- Task pages follow: **Goal, Before you start, Steps (numbered), What you should see, If something goes wrong, Next steps**.
- Reference pages are scannable: tables for fields, settings, errors and limits.
- Use real values from the code (limits, defaults, error messages, field names). Quote error messages exactly as the product shows them.
- Never write marketing fluff or claims you cannot support. No "AI-powered", "revolutionary" and similar.
- Never include real secrets, keys, tokens, customer data or the Inworld key or any key you find in chat history. Use obvious placeholders (`sk_live_xxx`).
- Prices are in Indian rupees (₹). Dates in the format `31 Oct 2026`.
- Each page has front matter: title, description (under 160 characters), sidebar order, audience tag.
- Cross-link generously. Add "Related" links at the bottom of each page.
- Add a **docs style guide** (`docs-site/CONTRIBUTING.md`) so future edits stay consistent.

## 9. Quality gates (you must run these and fix everything)

1. `npm run build` succeeds with zero warnings you can fix.
2. `npm run check:links` (internal links, anchors and images) reports zero broken links.
3. Spell-check pass (cspell or similar) with a custom dictionary for product terms.
4. A script `docs-site/scripts/verify-facts.ts` that cross-checks facts against code: the 13 template names, role names and permissions, price slabs, connector ids and field names, carrier ids and fields, environment variable names listed in the docs vs found in the repo. It fails the build if the docs and code disagree.
5. Lighthouse (or equivalent) accessibility and performance score of 90+ on the landing page and one long guide.
6. Open the built site in a real browser and verify: search works, dark mode works, the sidebar works on a 390px wide screen, code tabs and copy buttons work, screenshots load. Take final screenshots as proof.
7. Read three random pages end to end as a beginner would and fix anything confusing.

## 10. Deliverables

- `docs-site/` complete and runnable, with README (how to run, edit, add a page, refresh screenshots, regenerate the API reference, deploy).
- `docs-site/UNVERIFIED.md`: every claim you could not confirm from code, and every feature that looked unfinished.
- `docs-site/CHANGELOG.md` seeded with the product's milestones, taken from `git log` (read it: `git log --oneline`), written for customers, newest first.
- One git commit per major part with clear messages (do not push; I will review first).
- A final report to me with: what you built, page count, what you verified and how, what you could not verify, decisions you made for me, and the exact commands to run it locally and deploy it.

## 11. Working rules

- Be honest in all reports: say what is verified, what is not, and why.
- Keep token use sensible: read files in parts, search instead of reading whole folders, generate repeated pages from data (carriers, connectors, roles, error codes, environment variables, API endpoints) with scripts instead of writing each by hand.
- If you hit a decision that costs real money or touches production, stop and tell me instead of doing it.
- Do not change product behaviour. If you find a bug or a mismatch between the app and its help text while documenting, list it in `docs-site/UNVERIFIED.md` under "Bugs found" with file and line, and carry on.
- Never print or store secrets. Do not read `.env` files; use `.env.example` style information only.
