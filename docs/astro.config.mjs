// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
  integrations: [
    starlight({
      title: 'rpc.do',
      description: 'Lightweight RPC for Cloudflare Durable Objects',
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/dot-do/rpc.do' },
        { icon: 'x.com', label: 'Twitter', href: 'https://twitter.com/dotdo' },
      ],
      editLink: {
        baseUrl: 'https://github.com/dot-do/rpc.do/edit/main/docs/',
      },
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Introduction', slug: 'getting-started/introduction' },
            { label: 'Quick Start', slug: 'getting-started/quick-start' },
            { label: 'Installation', slug: 'getting-started/installation' },
          ],
        },
        {
          label: 'API Reference',
          items: [
            { label: 'RPC Client', slug: 'api/rpc-client' },
            { label: 'Transports', slug: 'api/transports' },
            { label: 'Middleware', slug: 'api/middleware' },
            { label: 'DO Client Features', slug: 'api/do-client' },
            { label: 'Error Handling', slug: 'api/errors' },
          ],
        },
        {
          label: 'CLI',
          items: [
            { label: 'Overview', slug: 'cli/overview' },
            { label: 'generate', slug: 'cli/generate' },
            { label: 'introspect', slug: 'cli/introspect' },
            { label: 'doctor', slug: 'cli/doctor' },
            { label: 'openapi', slug: 'cli/openapi' },
            { label: 'init', slug: 'cli/init' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Authentication', slug: 'guides/authentication' },
            { label: 'Error Handling', slug: 'guides/error-handling' },
            { label: 'Testing', slug: 'guides/testing' },
            { label: 'Server Setup', slug: 'guides/server-setup' },
          ],
        },
        {
          label: 'Migration',
          items: [
            { label: 'From tRPC', slug: 'migration/from-trpc' },
            { label: 'From gRPC', slug: 'migration/from-grpc' },
          ],
        },
      ],
      customCss: [
        './src/styles/custom.css',
      ],
    }),
  ],
});
