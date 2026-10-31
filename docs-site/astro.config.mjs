import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightOpenAPI, { openAPISidebarGroups } from 'starlight-openapi';
import starlightImageZoom from 'starlight-image-zoom';
import mermaid from 'astro-mermaid';

import { copyFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// starlight-openapi mis-reads folders whose path contains a space, so read the spec from a space-free copy.
const specSrc = fileURLToPath(new URL('./src/data/openapi.json', import.meta.url));
let spec = './src/data/openapi.json';
if (specSrc.includes(' ')) {
  const dir = join(tmpdir(), 'swarvo-docs-spec');
  mkdirSync(dir, { recursive: true });
  spec = join(dir, 'openapi.json');
  copyFileSync(specSrc, spec);
}

const SITE = process.env.DOCS_SITE_URL || 'https://docs.swarvoai.com';

export default defineConfig({
  site: SITE,
  integrations: [
    mermaid({ theme: 'neutral', autoTheme: true }),
    starlight({
      title: 'Swarvo AI Docs',
      description: 'Voice agents that answer every call. Guides, reference and API for Swarvo AI.',
      logo: { src: './src/assets/logo.svg', alt: 'Swarvo AI' },
      favicon: '/favicon.svg',
      customCss: ['./src/styles/custom.css'],
      head: [
        { tag: 'link', attrs: { rel: 'preconnect', href: 'https://fonts.googleapis.com' } },
        { tag: 'link', attrs: { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap' } },
      ],
      editLink: { baseUrl: 'https://github.com/OWNER/REPO/edit/main/docs-site/' },
      lastUpdated: true,
      pagination: true,
      social: [],
      plugins: [
        starlightImageZoom(),
        starlightOpenAPI([{ base: 'api-reference', label: 'Product API reference', schema: spec, sidebar: { operations: { badges: true }, tagGroups: false } }]),
      ],
      sidebar: [
        { label: 'Start here', collapsed: false, items: [{ autogenerate: { directory: 'start' } }] },
        { label: 'Agents', collapsed: true, items: [{ autogenerate: { directory: 'agents' } }] },
        { label: 'Phone numbers', collapsed: true, items: [{ autogenerate: { directory: 'numbers' } }] },
        { label: 'Conversations and insights', collapsed: true, items: [{ autogenerate: { directory: 'conversations' } }] },
        { label: 'Integrations', collapsed: true, items: [{ autogenerate: { directory: 'integrations' } }] },
        { label: 'Billing and money', collapsed: true, items: [{ autogenerate: { directory: 'billing' } }] },
        { label: 'Team, security, branding', collapsed: true, items: [{ autogenerate: { directory: 'team' } }] },
        { label: 'Developers', collapsed: true, items: [{ autogenerate: { directory: 'developers' } }] },
        ...openAPISidebarGroups,
        { label: 'Operators (self-hosting)', collapsed: true, items: [{ autogenerate: { directory: 'operators' } }] },
        { label: 'Help', collapsed: true, items: [{ autogenerate: { directory: 'help' } }] },
      ],
    }),
  ],
});
