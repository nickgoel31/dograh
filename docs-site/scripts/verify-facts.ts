// Cross-checks the docs against the product code. Exits 1 on any disagreement.
// Run `npm run gen` first so src/data/facts.json is fresh (it is regenerated from the code).
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const site = resolve(import.meta.dirname, '..');
const repo = resolve(site, '..');
const facts = JSON.parse(readFileSync(join(site, 'src/data/facts.json'), 'utf8'));
const page = (p: string) => readFileSync(join(site, 'src/content/docs', p), 'utf8');
const code = (p: string) => readFileSync(join(repo, p), 'utf8');
const fails: string[] = [];
const must = (ok: boolean, msg: string) => { if (!ok) fails.push(msg); };

// 1. Templates: all names in the docs, and the count stated.
const tpl = page('agents/templates.mdx');
for (const t of facts.templates) must(tpl.includes(t.name), `template missing from docs: ${t.name}`);
must(facts.templates.length === 13, `docs say 13 templates, code has ${facts.templates.length}`);

// 2. Roles and permissions.
const roles = page('team/roles-and-permissions.mdx');
for (const p of facts.perms) must(roles.includes('`' + p + '`'), `permission missing from docs: ${p}`);
for (const r of Object.keys(facts.roles)) must(new RegExp(r, 'i').test(roles), `role missing from docs: ${r}`);

// 3. Price slabs.
const price = page('billing/volume-pricing.mdx');
for (const s of facts.slabs) must(price.includes('₹' + s.rate.toFixed(2)), `price missing: ${s.rate}`);
must(page('conversations/cost-of-a-call.mdx').includes(`₹${facts.slabs[0].rate.toFixed(2)}`), 'cost-of-a-call example price differs from the first slab');

// 4. Connectors and carriers.
for (const c of facts.connectors) {
  const f = `integrations/${c.id.replace(/_/g, '-')}.mdx`;
  const ok = existsSync(join(site, 'src/content/docs', f));
  must(ok, `integration page missing: ${f}`);
  if (ok) for (const fld of c.fields) must(page(f).includes(fld.label.replace(/\{/g, '\\{').replace(/\}/g, '\\}')), `${c.id}: field not in docs: ${fld.label}`);
}
const byo = page('numbers/bring-your-own-number.mdx');
for (const c of facts.carriers) {
  must(byo.includes(c.name), `carrier missing: ${c.name}`);
  for (const f of c.fields) must(byo.includes(f.key), `${c.id}: field missing: ${f.key}`);
}

// 5. Environment variables: every name the code reads is documented, and every documented name exists.
const envDoc = page('operators/environment-variables.mdx');
const documented = new Set([...envDoc.matchAll(/^\| `([A-Z][A-Z0-9_]+)` \|/gm)].map((m) => m[1]));
for (const n of Object.keys(facts.env)) must(documented.has(n), `env var read by code but not documented: ${n}`);
for (const n of documented) must(n in facts.env, `env var documented but not found in code: ${n}`);

// 6. Constants quoted in hand-written pages.
const style = code('api/product/style.py');
const limits = page('agents/behavior-and-limits.mdx');
must(/0\.75 <= v <= 1\.75/.test(style) && page('agents/human-feel.mdx').includes('0.75 to 1.75'), 'speaking pace range differs');
must(/DEFAULT_MAX_MINUTES = 15/.test(style) && /1 <= v <= 60/.test(style) && limits.includes('1 to 60, default 15'), 'longest call differs');
must(/DEFAULT_SILENCE_SECONDS = 10/.test(style) && /5 <= v <= 60/.test(style) && limits.includes('5 to 60, default 10'), 'silence timeout differs');
must(/len\(v\) > 6/.test(style) && page('agents/languages.mdx').includes('up to 6 languages'), 'language limit differs');
const dev = code('api/product/developers.py');
const hooks = page('developers/webhooks.mdx');
must(/MAX_ATTEMPTS = 6/.test(dev) && /BACKOFF = \[60, 300, 1800, 7200, 43200\]/.test(dev), 'webhook retry schedule changed in code');
must(hooks.includes('1 minute, 5 minutes, 30 minutes, 2 hours and 12 hours'), 'webhook retry text differs');
for (const ev of ['call.started', 'call.ended', 'campaign.completed']) must(dev.includes(`"${ev}"`) && hooks.includes(ev), `webhook event: ${ev}`);
must(/MIN_TOPUP, MAX_TOPUP = 100\.0, 100000\.0/.test(code('api/product/billing_router.py')) && page('billing/adding-money.mdx').includes('₹100 to ₹1,00,000'), 'top-up limits differ');
must(code('docs/API.md').includes('120 requests per minute') && page('developers/public-api.mdx').includes('120 requests per minute'), 'API rate limit differs');
must(/"PRODUCT_MAX_CAMPAIGN_ROWS", "10000"/.test(code('api/product/campaigns.py')) && page('conversations/campaigns.mdx').includes('10,000 contacts'), 'campaign row limit differs');

if (fails.length) {
  console.error('FACT CHECK FAILED:\n- ' + fails.join('\n- '));
  process.exit(1);
}
console.log('facts verified: templates, roles, prices, connectors, carriers, env vars, limits');
