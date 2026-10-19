import { expect, test } from '@playwright/test';

const treemap = '[data-treemap]';
const brandCells = `${treemap} .canvas .brand`;

test.describe('Brands treemap', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('./');
  });

  test('starts with every brand, one cell each', async ({ page }) => {
    const rows = await page.locator('#brands tr').count();
    await expect(page.locator(brandCells)).toHaveCount(rows);
  });

  test('follows the filters', async ({ page }) => {
    await page.locator('select[name="owner"]').selectOption('richemont');
    const rows = await page.locator('#brands tr:not([hidden])').count();
    await expect(page.locator(brandCells)).toHaveCount(rows);
    await expect(page.locator(`${treemap} .note`)).toContainText('matching the filters');
  });

  test('regroups by owner', async ({ page }) => {
    await page.locator(`${treemap} select[name="grouping"]`).selectOption('owner');
    await expect(page.locator(`${treemap} .bucket-name`, { hasText: 'Swatch Group' })).toBeVisible();
    await expect(page.locator(`${treemap} .bucket-name`, { hasText: 'Independent' })).toBeVisible();
  });

  test('shading by nothing drops the key', async ({ page }) => {
    await expect(page.locator(`${treemap} .legend .swatch`).first()).toBeVisible();
    await page.locator(`${treemap} select[name="color"]`).selectOption('');
    await expect(page.locator(`${treemap} .legend .swatch`)).toHaveCount(0);
  });

  test('offers only measures that add up as sizes', async ({ page }) => {
    const sizes = await page.locator(`${treemap} select[name="size"] option`).allTextContents();
    expect(sizes.some((size) => size.startsWith('Age'))).toBe(false);
    const shades = await page.locator(`${treemap} select[name="color"] option`).allTextContents();
    expect(shades.some((shade) => shade.startsWith('Age'))).toBe(true);
  });
});

test.describe('Brands measure column', () => {
  test('sorts largest first', async ({ page }) => {
    await page.goto('./');
    await page.locator('.measure-select').selectOption('age');
    await page.getByRole('button', { name: 'Sort' }).click();
    const firstYear = Number(await page.locator('#brands tr').first().locator('td:nth-child(4)').textContent());
    const secondYear = Number(await page.locator('#brands tr').nth(1).locator('td:nth-child(4)').textContent());
    expect(firstYear).toBeLessThanOrEqual(secondYear);
    await expect(page.locator('#brands tr').first().locator('.measure .bar')).toBeVisible();
  });
});

test.describe('Ownership groups', () => {
  test('cards follow the treemap order', async ({ page }) => {
    await page.goto('ownership-groups/');
    await expect(page.locator('.card').first()).toContainText('Swatch Group');
    await expect(page.locator('[data-order-note]')).toContainText('number of brands');
  });

  test('timeline links each purchase to its brand', async ({ page }) => {
    await page.goto('ownership-groups/');
    const dots = page.locator('.timeline .dot');
    expect(await dots.count()).toBeGreaterThan(20);
    await expect(dots.first()).toHaveAttribute('href', /\/brands\//);
  });
});
