import { expect, test } from '@playwright/test';

// The Docs pages and the captures they show. A missing file is caught by `npm run test:links`; this checks each one
// actually decodes, and that each recording can be played and scrubbed.
const pages = ['docs/', 'docs/charts/', 'docs/logos/'];

test('the site nav links to the Docs', async ({ page }) => {
  await page.goto('brands/');
  await page.getByRole('navigation').first().getByRole('link', { name: 'Docs' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Overview');
});

for (const path of pages) {
  test(`${path} shows every image and recording`, async ({ page }) => {
    await page.goto(path);
    for (const image of await page.locator('article img').all()) {
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
    }
    for (const video of await page.locator('article video').all()) {
      await video.scrollIntoViewIfNeeded();
      await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState >= 1 && element.duration > 1)).toBe(true);
      // Scrubbing needs an index to seek by; without one the browser can't jump into the middle.
      const seekable = await video.evaluate((element: HTMLVideoElement) => element.seekable.length > 0 && element.seekable.end(0) > 1);
      expect(seekable).toBe(true);
    }
  });
}
