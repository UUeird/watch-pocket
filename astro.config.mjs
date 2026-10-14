import { defineConfig } from 'astro/config';

// Served by GitHub Pages on the custom domain www.watchpocket.app, so the site sits at the root.
// Internal links still go through `href()` in src/lib/catalog.ts, which adds `base` if one is ever set again.
export default defineConfig({
  site: 'https://www.watchpocket.app',
});
