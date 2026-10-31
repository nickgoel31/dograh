// Checks every internal link, image and #anchor in dist/. Run after `npm run build`.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const files = [];
(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : p.endsWith('.html') && files.push(p); } })(dist);
const ids = new Map();
const getIds = (f) => { if (!ids.has(f)) ids.set(f, new Set([...readFileSync(f, 'utf8').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))); return ids.get(f); };
let bad = 0, checked = 0;
for (const f of files) {
  const html = readFileSync(f, 'utf8');
  for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    let u = m[1];
    if (/^(https?:|mailto:|tel:|data:|javascript:|\/\/)/.test(u) || u === '') continue;
    const [pathPart, hash] = u.split('#');
    let target = pathPart ? (pathPart.startsWith('/') ? join(dist, pathPart) : resolve(dirname(f), pathPart)) : f;
    target = decodeURIComponent(target);
    let file = target;
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    else if (!existsSync(file) && existsSync(file + '.html')) file += '.html';
    checked++;
    if (!existsSync(file)) { console.log(`BROKEN  ${f.replace(dist, '')}  ->  ${u}`); bad++; continue; }
    if (hash && file.endsWith('.html') && !getIds(file).has(decodeURIComponent(hash))) { console.log(`ANCHOR  ${f.replace(dist, '')}  ->  ${u}`); bad++; }
  }
}
console.log(`${checked} links checked, ${bad} problems`);
process.exit(bad ? 1 : 0);
