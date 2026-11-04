import { expect, test } from '@playwright/test';

test('a missing page says so and links back home', async ({ page }) => {
  const response = await page.goto('brands/no-such-brand/deeper/');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
  await page.getByRole('link', { name: 'Back to the home page' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('Page not found');
});
