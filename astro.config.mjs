import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';

// The Docs pages are kept off the published site: they show in `astro dev`, and in a build only when DOCS=1 is set
// (as `npm run docs:media` does, to capture them). Any other build drops them, their media included, after it runs.
const showDocs = process.argv.includes('dev') || process.env.DOCS === '1';

// Served by GitHub Pages on the custom domain www.watchpocket.app, so the site sits at the root.
// Internal links still go through `href()` in src/lib/catalog.ts, which adds `base` if one is ever set again.
export default defineConfig({
  site: 'https://www.watchpocket.app',
  vite: { define: { 'import.meta.env.SHOW_DOCS': JSON.stringify(showDocs) } },
  integrations: [
    {
      name: 'leave-out-docs',
      hooks: {
        'astro:build:done': ({ dir }) => {
          if (!showDocs) rmSync(fileURLToPath(new URL('docs/', dir)), { recursive: true, force: true });
        },
      },
    },
  ],
});
