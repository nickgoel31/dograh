// Front matter and wording checks for every page.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../src/content/docs');
const banned = [/dograh/i, /pipecat/i, /revolutionary/i, /AI-powered/i, /sk_live_[A-Za-z0-9]{12,}/];
let bad = 0;
let n = 0;
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!/\.mdx?$/.test(f)) continue;
    n++;
    const t = readFileSync(p, 'utf8');
    const fm = t.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
    const desc = fm.match(/^description:\s*(.*)$/m)?.[1]?.replace(/^"|"$/g, '') ?? '';
    const rel = p.replace(root, '');
    if (!/^title:/m.test(fm)) { console.log(`${rel}: no title`); bad++; }
    if (!desc || desc.length > 160) { console.log(`${rel}: description missing or over 160 characters (${desc.length})`); bad++; }
    // Operator pages may use real folder and container names that contain the platform name.
    const operatorPage = /^[\\/]operators[\\/]/.test(rel);
    for (const b of banned) {
      if (operatorPage && /dograh/.test(b.source)) continue;
      if (b.test(t.replace(/^---[\s\S]*?---/, ''))) { console.log(`${rel}: banned text ${b}`); bad++; }
    }
  }
})(root);
console.log(`${n} pages linted, ${bad} problems`);
process.exit(bad ? 1 : 0);
