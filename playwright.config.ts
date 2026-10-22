import { defineConfig, devices } from '@playwright/test';
import astroConfig from './astro.config.mjs';

// TEST_PORT moves it where another server already holds 4322.
const port = Number(process.env.TEST_PORT ?? 4322);
// Where the built site is served, including the base path if astro.config.mjs sets one. Ends with a slash.
const siteUrl = `http://localhost:${port}${(astroConfig.base ?? '').replace(/\/$/, '')}/`;

// The tests run against the built site, so run `npm run build` first.
// Two projects: `chromium` is the test suite; `docs-media` drives the site to capture the screenshots and
// recordings the Docs pages show, into public/docs/media/ (`npm run docs:media`). Neither runs the other's files.
export default defineConfig({
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  // Trailing slash matters: tests navigate to paths relative to the site's base, e.g. `references/`.
  use: { baseURL: siteUrl },
  projects: [
    { name: 'chromium', testDir: 'tests', use: { ...devices['Desktop Chrome'] } },
    { name: 'docs-media', testDir: 'docs-media', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `node scripts/serve-dist.mjs ${port}`,
    url: siteUrl,
    reuseExistingServer: false,
  },
});
