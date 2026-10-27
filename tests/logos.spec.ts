import { expect, test, type Page } from '@playwright/test';

// Logos follow one rule wherever a brand is shown (src/lib/logo.ts): the version that reads in its space, on white
// or the brand's own color. These check it on the Ownership Groups tiles.

const tile = (page: Page, brand: string) => page.locator(`.tile[href$="/brands/${brand}/"]`).first();

test.beforeEach(async ({ page }) => {
  await page.goto('ownership-groups/');
});

test('a logo whose name reads in a tile is shown whole', async ({ page }) => {
  await expect(tile(page, 'alpina').locator('img')).toHaveAttribute('src', /alpina\./);
});

test("a logo whose name is too small in a tile gives way to its symbol", async ({ page }) => {
  await expect(tile(page, 'louis-vuitton').locator('img')).toHaveAttribute('src', /louis-vuitton-logomark/);
});

test('logos sit on white unless the brand sets its own color', async ({ page }) => {
  await expect(tile(page, 'alpina').locator('.plate')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(tile(page, 'daniel-roth').locator('.plate')).toHaveCSS('background-color', 'rgb(0, 39, 75)');
});
