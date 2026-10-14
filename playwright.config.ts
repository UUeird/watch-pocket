import { defineConfig, devices } from '@playwright/test';

const port = 4322;

// The tests run against the built site, so run `npm run build` first.
export default defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  // Trailing slash matters: tests navigate to paths relative to the site's base, e.g. `references/`.
  use: { baseURL: `http://localhost:${port}/watch-pocket/` },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `node scripts/serve-dist.mjs ${port}`,
    url: `http://localhost:${port}/watch-pocket/`,
    reuseExistingServer: false,
  },
});
