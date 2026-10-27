import { expect, test, type Page } from '@playwright/test';

// A model's Compare references table leaves out a column none of its references has a value for.

const headers = async (page: Page) =>
  (await page.locator('.table-wrap thead th').allTextContents()).map((text) => text.trim()).filter(Boolean);

test('a column no reference has a value for is left out', async ({ page }) => {
  // Apple Watch Ultra records case colors but no movement or complications.
  await page.goto('brands/apple/apple-watch/apple-watch-ultra/');
  const shown = await headers(page);
  expect(shown).toContain('Case colors');
  expect(shown).not.toContain('Movement');
  expect(shown).not.toContain('Complications');
});

test('a column some reference has a value for is kept, with a cell in every row', async ({ page }) => {
  // The Air-King records a movement and complications ("Time only") but no case colors.
  await page.goto('brands/rolex/air-king/air-king/');
  const shown = await headers(page);
  expect(shown).toEqual(expect.arrayContaining(['Reference', 'Movement', 'Complications']));
  expect(shown).not.toContain('Case colors');
  const columns = await page.locator('.table-wrap thead th').count();
  for (const row of await page.locator('.table-wrap tbody tr').all()) await expect(row.locator('td')).toHaveCount(columns);
});
