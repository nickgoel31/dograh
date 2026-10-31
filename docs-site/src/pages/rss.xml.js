// A small RSS feed built from CHANGELOG.md (one item per dated heading).
import { readFileSync } from 'node:fs';
export async function GET({ site }) {
  const md = readFileSync('CHANGELOG.md', 'utf8');
  const items = md.split(/^## /m).slice(1).map((blk) => {
    const [date, ...rest] = blk.split('\n');
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    return `<item><title>${esc('Swarvo AI update, ' + date.trim())}</title><link>${site}changelog/</link><guid isPermaLink="false">${esc(date.trim())}</guid><description>${esc(rest.join('\n').trim())}</description></item>`;
  });
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Swarvo AI changelog</title><link>${site}</link><description>What changed in Swarvo AI</description>${items.join('')}</channel></rss>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml' } });
}
