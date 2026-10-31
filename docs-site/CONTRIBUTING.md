# Docs style guide

- Say **Swarvo AI**. Never name the platform underneath. Name a third-party service only where a customer must log in to it (Twilio, Razorpay, Cal.com ...). `npm run lint` enforces this (operator pages may use real folder and container names).
- Plain words, short sentences, active voice. Explain a technical term once, then use it the same way everywhere.
- Task pages: Goal, Before you start, Steps (numbered), What you should see, If something goes wrong, Next steps.
- Reference pages use tables for fields, settings, errors and limits.
- Use real values from the code and quote product messages exactly. If you cannot confirm a claim in code, leave it out and add it to `UNVERIFIED.md`.
- No marketing words ("AI-powered", "revolutionary"). No real keys, tokens or customer data; use `sk_live_xxx` style placeholders.
- Prices in rupees (₹). Dates like `31 Oct 2026`.
- Every page has `title`, `description` (under 160 characters), `sidebar.order`, `audience`. Add Related links at the bottom.
- Screenshots come from demo mode only, have alt text and a caption, and are made with `npm run screens`.
- Numbers that the code defines (limits, prices, ids) belong in `scripts/gen-pages.mjs` or `scripts/verify-facts.ts`, so a change in code fails the build.
