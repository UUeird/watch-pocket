import { expect, test } from '@playwright/test';

// A 1×1 white PNG, standing in for a brand's photo so the tests don't depend on its site.
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');

test.describe('Model photos', () => {
  test("shows the brand's own photo, credited, with a link to its page", async ({ page }) => {
    await page.route(/media\.richardmille\.com/, (route) => route.fulfill({ contentType: 'image/png', body: pixel }));
    await page.goto('brands/richard-mille/rm-67/rm-67-02/');
    const figure = page.locator('[data-official-photo]');
    await expect(figure.locator('img')).toHaveAttribute('alt', 'Richard Mille RM 67-02 Automatic Winding Extra Flat');
    await expect(figure.locator('figcaption')).toContainText('Image © Richard Mille');
    await expect(page.getByRole('link', { name: /See it on richardmille\.com/ })).toHaveAttribute('href', /richardmille\.com\/collections\//);
  });

  test("drops the brand's photo when it won't load, keeping the link", async ({ page }) => {
    await page.route(/media\.richardmille\.com/, (route) => route.abort());
    await page.goto('brands/richard-mille/rm-67/rm-67-02/');
    await expect(page.locator('[data-official-photo]')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /See it on richardmille\.com/ })).toBeVisible();
  });

  test('prefers a licensed photo of our own, with its credit', async ({ page }) => {
    await page.goto('brands/rolex/gmt-master-ii/gmt-master-ii/');
    await expect(page.locator('.model-photo figure img')).toBeVisible();
    await expect(page.locator('.model-photo figcaption')).toContainText('CC BY-SA');
    await expect(page.locator('[data-official-photo]')).toHaveCount(0);
  });
});
