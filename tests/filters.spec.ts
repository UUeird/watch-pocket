import { expect, test, type Locator, type Page } from '@playwright/test';

const visibleRows = (page: Page, table: string) => page.locator(`#${table} tr:not([hidden])`);
const allRows = (page: Page, table: string) => page.locator(`#${table} tr`);
const filter = (page: Page, name: string) => page.locator(`select[name="${name}"]`);
const count = (page: Page) => page.locator('[data-count]');
const clear = (page: Page) => page.getByRole('button', { name: 'Clear filters' });

// Every visible row's cell in the given column, as text.
const column = async (rows: Locator, index: number) =>
  (await rows.locator(`td:nth-child(${index})`).allTextContents()).map((text) => text.trim());

test.describe('Brands filters', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('starts unfiltered', async ({ page }) => {
    const total = await allRows(page, 'brands').count();
    expect(total).toBeGreaterThan(100);
    await expect(visibleRows(page, 'brands')).toHaveCount(total);
    await expect(count(page)).toHaveText(`${total} brands`);
    await expect(clear(page)).toBeHidden();
  });

  test('search matches a product line as well as a brand name', async ({ page }) => {
    const total = await allRows(page, 'brands').count();
    await page.getByPlaceholder('Search brands and product lines').fill('G-Shock');
    await expect(visibleRows(page, 'brands')).toHaveCount(1);
    await expect(visibleRows(page, 'brands')).toContainText('Casio');
    await expect(count(page)).toHaveText(`1 of ${total} brands`);
    await expect(clear(page)).toBeVisible();
  });

  test('owner filter narrows the list and marks itself in use', async ({ page }) => {
    const total = await allRows(page, 'brands').count();
    await filter(page, 'owner').selectOption('richemont');
    await expect(filter(page, 'owner')).toHaveClass(/active/);
    const owners = await column(visibleRows(page, 'brands'), 2);
    expect(owners.length).toBeGreaterThan(0);
    expect(new Set(owners)).toEqual(new Set(['Richemont']));

    await filter(page, 'owner').selectOption('');
    await expect(filter(page, 'owner')).not.toHaveClass(/active/);
    await expect(visibleRows(page, 'brands')).toHaveCount(total);
  });

  test('filters combine', async ({ page }) => {
    await filter(page, 'origin').selectOption('Switzerland');
    await filter(page, 'segment').selectOption('haute');
    const rows = visibleRows(page, 'brands');
    expect(await rows.count()).toBeGreaterThan(0);
    expect(new Set(await column(rows, 3))).toEqual(new Set(['Switzerland']));
    expect(new Set(await column(rows, 5))).toEqual(new Set(['haute']));
  });

  test('a multi-value field matches any of its values', async ({ page }) => {
    await filter(page, 'tags').selectOption('smartwatch');
    const rows = visibleRows(page, 'brands');
    expect(await rows.count()).toBeGreaterThan(0);
    for (const type of await column(rows, 6)) expect(type).toContain('smartwatch');
  });

  test('clear filters resets everything', async ({ page }) => {
    const total = await allRows(page, 'brands').count();
    await page.getByPlaceholder('Search brands and product lines').fill('omega');
    await filter(page, 'segment').selectOption('luxury');
    await clear(page).click();
    await expect(visibleRows(page, 'brands')).toHaveCount(total);
    await expect(page.getByPlaceholder('Search brands and product lines')).toHaveValue('');
    await expect(filter(page, 'segment')).toHaveValue('');
    await expect(filter(page, 'segment')).not.toHaveClass(/active/);
    await expect(clear(page)).toBeHidden();
  });

  test('says so when nothing matches', async ({ page }) => {
    const empty = page.getByText('Nothing matches these filters.');
    await expect(empty).toBeHidden();
    await page.getByPlaceholder('Search brands and product lines').fill('zzzz-no-such-brand');
    await expect(visibleRows(page, 'brands')).toHaveCount(0);
    await expect(empty).toBeVisible();
  });
});

test.describe('References filters', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/references/');
  });

  test('search matches a model number', async ({ page }) => {
    await page.getByPlaceholder('Search reference and model numbers').fill('A2999');
    const rows = visibleRows(page, 'references');
    expect(await rows.count()).toBeGreaterThan(0);
    for (const reference of await column(rows, 1)) expect(reference).toContain('Series 10, 46 mm');
  });

  test('brand filter matches a whole brand name', async ({ page }) => {
    await filter(page, 'brand').selectOption('Rolex');
    const rows = visibleRows(page, 'references');
    expect(await rows.count()).toBeGreaterThan(0);
    expect(new Set(await column(rows, 2))).toEqual(new Set(['Rolex']));
  });

  test('metal filter matches a reference made of several metals', async ({ page }) => {
    await filter(page, 'metal').selectOption('yellow-gold');
    const metals = await column(visibleRows(page, 'references'), 6);
    expect(metals.length).toBeGreaterThan(0);
    for (const metal of metals) expect(metal).toContain('yellow gold');
    // The two-tone Submariner is steel and yellow gold, so it must be among them.
    expect(metals).toContain('steel, yellow gold');
  });
});
