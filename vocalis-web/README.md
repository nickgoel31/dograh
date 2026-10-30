# Vocalis — AI voice agent dashboard (front-end demo)

Front-end for the product. Runs against the product API, or on built-in sample data with `VITE_USE_MOCKS=true`.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build
```

Rename the product in one place: `src/config/brand.ts` (`BRAND`, `PRICE_PER_MIN`).

## Folder structure

```
src/
  config/brand.ts      brand name + price constants
  mock/                typed mock data (agents, calls, voices, misc) + api.ts (async, fake latency)
  store/               zustand: ui.ts (test/live, simple/advanced, theme), data.ts (agents, favorites)
  components/          ui.tsx (Radix-based primitives), shared.tsx (PageHeader, StatCard, EmptyState,
                       StatusBadge, SimpleAdvanced, HelpTooltip, WaveformPlayer, VoiceOrb, CopyButton,
                       CodeBlock, ConfirmDialog...), Playground.tsx (voice/typed practice call)
  layout/Shell.tsx     sidebar, top bar, Cmd/Ctrl+K palette, AI Helper, banners
  pages/               one file per area (Agents split into Agents + AgentDetail)
```

## Mocked

Everything. Agents (6), calls (40), numbers (5), campaigns (4), knowledge (8), voices (24),
integrations (12), invoices (6), team (5), webhooks and request logs. `src/mock/api.ts` returns
promises with random delays so it can be swapped for real fetch calls.
Test mode shows a smaller set of practice calls and zero spend.

## Real browser features

- Voice playground and voice previews use the Web Speech API (`SpeechRecognition`, `speechSynthesis`)
  when available, with typed chat as a fallback (Chrome/Edge/Safari recommended).

## Assumptions

- UI primitives are hand-written shadcn-style wrappers over Radix (no shadcn CLI).
- Currency is ₹; price is ₹6/min everywhere.
- Simple/Advanced, Test/Live, theme and sidebar state persist in localStorage.
- Demo-only: file downloads, PDF invoices, CSV export, SIP wizard and "Roll key" are simulated.
- The Home page has a "Demo: new user" switch to show the onboarding checklist.
