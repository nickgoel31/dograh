import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightSidebarTopics from 'starlight-sidebar-topics';
import starlightImageZoom from 'starlight-image-zoom';
import mermaid from 'astro-mermaid';

const SITE = process.env.DOCS_SITE_URL || 'https://docs.swarvoai.com';

export default defineConfig({
  site: SITE,
  redirects: { '/': '/start/what-is-swarvo/' },
  integrations: [
    mermaid({ theme: 'neutral', autoTheme: true }),
    starlight({
      title: 'Swarvo AI Docs',
      description: 'Voice agents that answer every call. Guides, reference and API for Swarvo AI.',
      logo: { src: './src/assets/logo.svg', alt: 'Swarvo AI' },
      favicon: '/favicon.svg',
      components: { PageTitle: './src/components/PageTitle.astro' },
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
        starlightSidebarTopics([
          {
            label: 'Swarvo app',
            link: '/start/what-is-swarvo/',
            icon: 'laptop',
            items: [
              { label: 'Start here', items: [{ autogenerate: { directory: 'start' } }] },
              { label: 'Agents', collapsed: true, items: [{ autogenerate: { directory: 'agents' } }] },
              { label: 'Phone numbers', collapsed: true, items: [{ autogenerate: { directory: 'numbers' } }] },
              { label: 'Conversations and insights', collapsed: true, items: [{ autogenerate: { directory: 'conversations' } }] },
              { label: 'Integrations', collapsed: true, items: [{ autogenerate: { directory: 'integrations' } }] },
              { label: 'Billing and money', collapsed: true, items: [{ autogenerate: { directory: 'billing' } }] },
              { label: 'Team, security, branding', collapsed: true, items: [{ autogenerate: { directory: 'team' } }] },
              { label: 'Developers', collapsed: true, items: [{ autogenerate: { directory: 'developers' } }] },
              { label: 'Operators (self-hosting)', collapsed: true, items: [{ autogenerate: { directory: 'operators' } }] },
              { label: 'Help', collapsed: true, items: [{ autogenerate: { directory: 'help' } }] },
              { label: 'Changelog', link: '/changelog/' },
            ],
          },
          {
            label: 'Swarvo API reference',
            link: '/swarvo-api/overview/',
            icon: 'seti:json',
            items: [{ label: 'Swarvo TTS 3', items: [{ autogenerate: { directory: 'swarvo-api' } }] }],
          },
        ]),
      ],
    }),
  ],
});
