import { defineConfig } from 'astro/config';

// Served by GitHub Pages at https://uueird.github.io/watch-pocket/, so every page lives under /watch-pocket/.
// Internal links go through `href()` in src/lib/catalog.ts, which adds this base.
export default defineConfig({
  site: 'https://uueird.github.io',
  base: '/watch-pocket',
});
