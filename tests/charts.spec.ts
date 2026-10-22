import { expect, test, type Page } from '@playwright/test';

const treemap = '[data-treemap]';
const brandCells = `${treemap} .canvas .brand`;

test.describe('Chart', () => {
  const tiles = `${treemap} .canvas .tile`;
  const select = (page: Page, name: string) => page.locator(`${treemap} select[name="${name}"]`);
  // The brands counted across all the tiles of the overview.
  const tileTotal = async (page: Page) =>
    (await page.locator(`${tiles} .tile-badge`).allTextContents()).reduce((total, text) => total + Number(text), 0);

  test.beforeEach(async ({ page }) => {
    await page.goto('chart/');
  });

  test('starts with brands as circles inside their owners, with logos', async ({ page }) => {
    await expect(page.locator(`${treemap} .bucket.round[data-zoom="swatch-group"]`)).toBeVisible();
    expect(await page.locator(`${brandCells}.round`).count()).toBeGreaterThan(50);
    expect(await page.locator(`${brandCells}.round img`).count()).toBeGreaterThan(20);
    await expect(page.locator(`${treemap} .bucket-name.logo`).first()).toBeVisible();
    // Brands with no owning group are listed under the chart, not drawn as a circle.
    await expect(page.locator(`${treemap} [data-zoom="independent"]`)).toHaveCount(0);
    await expect(page.locator(`${treemap} .unsized summary`)).toContainText('with no owning group on record');
  });

  test('zooms into a group and back out', async ({ page }) => {
    await page.locator(`${treemap} .bucket-name[data-zoom="swatch-group"]`).click();
    await expect(page.locator(`${treemap} .crumb-current`)).toHaveText('Swatch Group');
    expect(await page.locator(brandCells).count()).toBeGreaterThan(10);
    // Inside a group, brands can be sized by a figure that does not add up across groups.
    await expect(select(page, 'size')).toHaveValue('age');
    await page.getByRole('button', { name: /All by owner/ }).click();
    await expect(page.locator(`${treemap} button[data-zoom="swatch-group"]`)).toBeFocused();
  });

  test('follows the filters', async ({ page }) => {
    await page.locator('select[name="owner"]').selectOption('richemont');
    await expect(page.locator('[data-count]')).toContainText(' of ');
    const shown = Number((await page.locator('[data-count]').textContent())!.split(' ')[0]);
    await expect(page.locator(`${treemap} .note`)).toContainText('matching the filters');
    await expect(page.locator(brandCells)).toHaveCount(shown);
  });

  test('regroups by nation as rectangles and remembers the choice', async ({ page }) => {
    await select(page, 'grouping').selectOption('origin');
    await select(page, 'shape').selectOption('rects');
    await expect(page.locator(`${tiles}[data-zoom="Switzerland"]`)).toBeVisible();
    await expect(page.locator(brandCells)).toHaveCount(0);
    // Brands with no nation recorded are listed under the chart, not drawn as a box.
    await expect(page.locator(`${tiles}[data-zoom="unrecorded"]`)).toHaveCount(0);
    expect(await tileTotal(page)).toBeGreaterThan(100);
    await page.reload();
    await expect(select(page, 'shape')).toHaveValue('rects');
    await expect(select(page, 'grouping')).toHaveValue('origin');
  });

  test('sizes the overview only by measures that add up', async ({ page }) => {
    await expect(page.locator(`${treemap} select[name="size"] option[value="age"]`)).toHaveJSProperty('disabled', true);
    await expect(page.locator(`${treemap} select[name="size"] option[value="brands"]`)).toHaveJSProperty('disabled', false);
  });
});

test.describe('Lists', () => {
  test('brands and groups pages have no treemap', async ({ page }) => {
    for (const path of ['brands/', 'ownership-groups/']) {
      await page.goto(path);
      await expect(page.locator(treemap)).toHaveCount(0);
    }
  });
});

test.describe('Brands measure column', () => {
  test('sorts largest first', async ({ page }) => {
    await page.goto('brands/');
    await page.locator('.measure-select').selectOption('age');
    await page.getByRole('button', { name: 'Sort' }).click();
    const firstYear = parseInt(await page.locator('#brands tr').first().locator('td:nth-child(4)').textContent() ?? '');
    const secondYear = parseInt(await page.locator('#brands tr').nth(1).locator('td:nth-child(4)').textContent() ?? '');
    expect(firstYear).toBeLessThanOrEqual(secondYear);
    await expect(page.locator('#brands tr').first().locator('.measure .bar')).toBeVisible();
  });
});

test.describe('Ownership groups', () => {
  test('cards list the largest group first', async ({ page }) => {
    await page.goto('ownership-groups/');
    await expect(page.locator('.card').first()).toContainText('Swatch Group');
  });

  test('timeline links each purchase to its brand', async ({ page }) => {
    await page.goto('ownership-groups/');
    const dots = page.locator('.timeline .dot');
    expect(await dots.count()).toBeGreaterThan(20);
    await expect(dots.first()).toHaveAttribute('href', /\/brands\//);
  });
});
