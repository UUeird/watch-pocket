import { expect, test, type Page } from '@playwright/test';

const treemap = '[data-treemap]';
const brandCells = `${treemap} .canvas .brand`;

test.describe('Brands treemap', () => {
  const tiles = `${treemap} .canvas .tile`;
  // The brands counted across all the tiles of the overview.
  const tileTotal = async (page: Page) =>
    (await page.locator(`${tiles} .tile-badge`).allTextContents()).reduce((total, text) => total + Number(text), 0);

  test.beforeEach(async ({ page }) => {
    await page.goto('brands/');
  });

  test('starts with one box per nation, counting every brand', async ({ page }) => {
    const rows = await page.locator('#brands tr').count();
    await expect(page.locator(`${tiles}[data-zoom="Switzerland"]`)).toBeVisible();
    await expect(page.locator(brandCells)).toHaveCount(0);
    // Brands with no nation recorded are listed under the chart, not drawn as a box.
    await expect(page.locator(`${tiles}[data-zoom="unrecorded"]`)).toHaveCount(0);
    const footnote = page.locator(`${treemap} .unsized summary`, { hasText: 'no nation of origin recorded' });
    const unrecorded = Number((await footnote.textContent())!.split(' ')[0]);
    expect(unrecorded).toBeGreaterThan(0);
    // Tiny tiles have no room for their count, so the shown counts can fall short of the rest but never exceed them.
    const counted = await tileTotal(page);
    expect(counted).toBeGreaterThan((rows - unrecorded) * 0.9);
    expect(counted).toBeLessThanOrEqual(rows - unrecorded);
  });

  test('zooms into a box and back out', async ({ page }) => {
    await page.locator(`${tiles}[data-zoom="Switzerland"]`).click();
    await expect(page.locator(`${treemap} .crumb-current`)).toHaveText('Switzerland');
    expect(await page.locator(brandCells).count()).toBeGreaterThan(20);
    // Inside a box, brands can be sized by a figure that does not add up across boxes.
    await expect(page.locator(`${treemap} select[name="size"]`)).toHaveValue('age');
    await expect(page.locator(`${treemap} .unsized summary`)).toContainText('no figure for age');
    await page.getByRole('button', { name: /All by nation of origin/ }).click();
    await expect(page.locator(`${tiles}[data-zoom="Switzerland"]`)).toBeFocused();
  });

  test('follows the filters', async ({ page }) => {
    await page.locator('select[name="owner"]').selectOption('richemont');
    const rows = await page.locator('#brands tr:not([hidden])').count();
    await expect(page.locator(`${treemap} .note`)).toContainText('matching the filters');
    const unrecorded = page.locator(`${treemap} .unsized summary`, { hasText: 'no nation of origin recorded' });
    const unrecordedCount = (await unrecorded.count()) > 0 ? Number((await unrecorded.textContent())!.split(' ')[0]) : 0;
    expect((await tileTotal(page)) + unrecordedCount).toBe(rows);
  });

  test('regroups by owner', async ({ page }) => {
    await page.locator(`${treemap} select[name="grouping"]`).selectOption('owner');
    await expect(page.locator(`${tiles}[data-zoom="swatch-group"]`)).toBeVisible();
    // Brands with no owning group are listed under the chart, not drawn as a box.
    await expect(page.locator(`${tiles}[data-zoom="independent"]`)).toHaveCount(0);
    await expect(page.locator(`${treemap} .unsized summary`)).toContainText('with no owning group on record');
  });

  test('shading by nothing drops the key', async ({ page }) => {
    await expect(page.locator(`${treemap} .legend .swatch`).first()).toBeVisible();
    await page.locator(`${treemap} select[name="color"]`).selectOption('');
    await expect(page.locator(`${treemap} .legend .swatch`)).toHaveCount(0);
  });

  test('sizes the overview only by measures that add up', async ({ page }) => {
    await expect(page.locator(`${treemap} select[name="size"] option[value="age"]`)).toHaveJSProperty('disabled', true);
    await expect(page.locator(`${treemap} select[name="size"] option[value="brands"]`)).toHaveJSProperty('disabled', false);
  });
});

test.describe('Brands measure column', () => {
  test('sorts largest first', async ({ page }) => {
    await page.goto('brands/');
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
