import { defineConfig, devices } from '@playwright/test';
import astroConfig from './astro.config.mjs';

const port = 4322;
// Where the built site is served, including the base path if astro.config.mjs sets one. Ends with a slash.
const siteUrl = `http://localhost:${port}${(astroConfig.base ?? '').replace(/\/$/, '')}/`;

// The tests run against the built site, so run `npm run build` first.
export default defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  // Trailing slash matters: tests navigate to paths relative to the site's base, e.g. `references/`.
  use: { baseURL: siteUrl },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `node scripts/serve-dist.mjs ${port}`,
    url: siteUrl,
    reuseExistingServer: false,
  },
});
