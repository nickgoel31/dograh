// Captures real screenshots of the app running in demo mode (sample data only).
//   cd vocalis-web && VITE_USE_MOCKS=true npx vite --port 5180      (in one terminal)
//   npm run screens                                                  (in docs-site)
// Output: src/assets/screens/<name>-<light|dark>.png (1440x900) and <name>-mobile.png (390x844).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const BASE = process.env.APP_URL ?? 'http://localhost:5180';
const out = resolve(import.meta.dirname, '../src/assets/screens');
mkdirSync(out, { recursive: true });

// name, path, optional action to run before the shot
const pages: [string, string, ((p: import('playwright').Page) => Promise<void>)?][] = [
  ['home', '/'],
  ['agents', '/agents'],
  ['agent-detail', '/agents/a1'],
  ['conversations', '/conversations'],
  ['numbers', '/numbers'],
  ['knowledge', '/knowledge'],
  ['tools', '/tools'],
  ['voices', '/voices'],
  ['analytics', '/analytics'],
  ['campaigns', '/campaigns'],
  ['billing', '/billing'],
  ['developers', '/developers'],
  ['settings', '/settings'],
  ['help', '/help'],
];

const browser = await chromium.launch();
for (const scheme of ['light', 'dark'] as const) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
  const page = await ctx.newPage();
  for (const [name, path, act] of pages) {
    await page.goto(BASE + path, { waitUntil: 'networkidle' });
    // The app keeps its theme in memory and toggles a `dark` class on <html>.
    await page.evaluate((s) => document.documentElement.classList.toggle('dark', s === 'dark'), scheme);
    await page.waitForTimeout(600);
    if (act) await act(page);
    await page.screenshot({ path: join(out, `${name}-${scheme}.png`) });
    console.log('captured', name, scheme);
  }
  await ctx.close();
}
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
const mp = await mobile.newPage();
for (const [name, path] of [['home', '/'], ['agents', '/agents'], ['billing', '/billing']] as const) {
  await mp.goto(BASE + path, { waitUntil: 'networkidle' });
  await mp.waitForTimeout(600);
  await mp.screenshot({ path: join(out, `${name}-mobile.png`) });
  console.log('captured', name, 'mobile');
}
await browser.close();
