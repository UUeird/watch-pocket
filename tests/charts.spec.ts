import { expect, test } from '@playwright/test';

const crumbs = '#crumbs';
const cells = '.columns .cell';

test.describe('Chart', () => {
  test('opens on brands and their lines', async ({ page }) => {
    await page.goto('chart/');
    await expect(page.locator('.columns .colhead')).toHaveText(['Brand', 'Line']);
    await expect(page.locator('#lvfrom')).toHaveValue('1');
    await expect(page.locator('#lvto')).toHaveValue('2');
    await expect(page.locator(cells, { hasText: 'Seiko' }).first()).toBeVisible();
    await expect(page.locator(cells, { hasText: 'Prospex' }).first()).toBeVisible();
    await expect(page).not.toHaveURL(/levels=/);
  });

  test('shows owners and their brands, in columns, with logos', async ({ page }) => {
    await page.goto('chart/?levels=owner-brand');
    await expect(page.locator('.columns .colhead')).toHaveText(['Owner', 'Brand']);
    await expect(page.locator(cells, { hasText: 'Swatch Group' }).first()).toBeVisible();
    expect(await page.locator(`${cells} .plate img`).count()).toBeGreaterThan(10);
    // Independent brands are folded behind one row, each its own owner when opened.
    const fold = page.locator('.columns .more[data-toggle]');
    await expect(fold).toContainText('independent brands · show');
    await fold.click();
    await expect(page.locator('.columns .more[data-toggle]')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator(cells, { hasText: 'Independent' }).first()).toBeVisible();
  });

  test('filters by country, and keeps owners as context', async ({ page }) => {
    await page.goto('chart/?levels=owner-brand');
    await page.locator('summary#csum').click();
    await page.locator('#presets button', { hasText: 'Japan' }).click();
    await expect(page).toHaveURL(/[?&]c=Japan/);
    await expect(page.locator('#status')).toContainText('Japan');
    await expect(page.locator(cells, { hasText: 'Seiko Group' }).first()).toBeVisible();
    await expect(page.locator(cells, { hasText: 'Swatch Group' })).toHaveCount(0);
    // Citizen owns brands from other countries too, so it says how many of them are shown.
    await expect(page.locator(cells, { hasText: 'Citizen Watch' }).first()).toContainText(/\d+ of \d+ brands/);
  });

  test('shows the levels asked for, and steps back from an empty one', async ({ page }) => {
    await page.goto('chart/?c=Japan&levels=owner-brand');
    await page.locator('#lvto').selectOption('2');
    await expect(page.locator('.columns .colhead')).toHaveText(['Owner', 'Brand', 'Line']);
    await expect(page).toHaveURL(/levels=owner-line/);
    // No Swedish brand has lines recorded yet, so asked for lines, the chart stops at brands.
    await page.goto('chart/?c=Sweden&levels=owner-line');
    await expect(page.locator('#status')).toContainText('so the chart stops at brands');
    await expect(page.locator('#lvto option[value="2"]')).toHaveJSProperty('disabled', true);
  });

  test('zooms in with a click, and Back zooms out', async ({ page }) => {
    await page.goto('chart/?levels=owner-brand');
    await page.locator(cells, { hasText: 'Swatch Group' }).first().click();
    await expect(page).toHaveURL(/focus=g:swatch-group/);
    await expect(page.locator(crumbs)).toContainText('Swatch Group');
    await page.goBack();
    await expect(page).not.toHaveURL(/focus=/);
    await expect(page.locator(`${crumbs} .here`)).toHaveText('All');
  });

  test('opens a line at the deepest level shown into its models', async ({ page }) => {
    await page.goto('chart/');
    await page.locator(cells, { hasText: 'Prospex' }).first().click();
    await expect(page.locator(`${crumbs} .here`)).toHaveText('Prospex');
    await expect(page.locator('.columns .colhead')).toContainText(['Model']);
    await expect(page).toHaveURL(/levels=brand-model/);
    await page.goBack();
    await expect(page.locator(`${crumbs} .here`)).toHaveText('All');
    await expect(page.locator('#lvto')).toHaveValue('2');
  });

  test('opens a line in the outline onto its models', async ({ page }) => {
    await page.goto('chart/?view=outline&q=Prospex');
    const line = page.locator('.outline .row', { hasText: 'Prospex' }).first();
    await expect(line).toHaveAttribute('aria-expanded', 'false');
    await line.click();
    await expect(page.locator('.outline .row', { hasText: 'Model' }).first()).toBeVisible();
    await expect(page).toHaveURL(/levels=brand-model/);
  });

  test('keeps the item zoomed into when the grouping and levels change', async ({ page }) => {
    await page.goto('chart/?levels=owner-model&focus=b:omega');
    await expect(page.locator(`${crumbs} .here`)).toHaveText('Omega');
    await page.locator('#groupby').selectOption('country');
    await expect(page.locator(crumbs)).toContainText('Switzerland');
    await expect(page.locator(`${crumbs} .here`)).toHaveText('Omega');
    await page.locator('#lvfrom').selectOption('2');
    await expect(page.locator(`${crumbs} .here`)).toHaveText('Omega');
    await expect(page).toHaveURL(/focus=b:omega/);
  });

  test('restores every control from the link, and drops what it does not know', async ({ page }) => {
    await page.goto('chart/?c=Switzerland&cby=owner&seg=luxury&by=segment&levels=brand-line&sort=age&view=outline&sort2=x&indep=hide');
    await expect(page.locator('#groupby')).toHaveValue('segment');
    await expect(page.locator('#sort')).toHaveValue('age');
    await expect(page.locator('#indep')).toHaveValue('hide');
    await expect(page.locator('#lvfrom')).toHaveValue('1');
    await expect(page.locator('#lvto')).toHaveValue('2');
    await expect(page.locator('#views [aria-pressed="true"]')).toHaveText('Outline');
    await expect(page.locator('#status')).toContainText("Switzerland");
    await expect(page.locator('#status')).toContainText('Luxury');
    await page.goto('chart/?sort=biggest&levels=nowhere');
    await expect(page.locator('#status')).toContainText('sort=biggest');
    await expect(page.locator('#status')).toContainText('levels=nowhere');
    await expect(page.locator('#sort')).toHaveValue('models');
  });

  test('sorts by most models, ties broken by references', async ({ page }) => {
    // Most models is the default, so the link needs no sort.
    await page.goto('chart/?levels=brand');
    await expect(page.locator('#sort')).toHaveValue('models');
    const byModels = await page.locator(`${cells} .nm`).allTextContents();
    // Richard Mille has many models recorded but few references, so it ranks higher here than under Most references.
    await page.locator('#sort').selectOption('count');
    expect(byModels.indexOf('Richard Mille')).toBeGreaterThanOrEqual(0);
    await expect
      .poll(async () => (await page.locator(`${cells} .nm`).allTextContents()).indexOf('Richard Mille'))
      .toBeGreaterThan(byModels.indexOf('Richard Mille'));
  });

  test('finds a reference typed with spaces and zooms to its model', async ({ page }) => {
    await page.goto('chart/');
    await page.locator('#q').fill('126610 ln');
    await expect(page.locator('#results')).toContainText('126610LN');
    await page.locator('#q').press('Enter');
    await expect(page.locator(`${crumbs} .here`)).toHaveText('Submariner Date');
    await expect(page.locator('#info h2')).toHaveText('126610LN');
    await expect(page.locator('#info a', { hasText: 'Open page' })).toHaveAttribute('href', /\/brands\/rolex\/submariner\/submariner-date\/126610ln\//);
  });

  test('moves between boxes with the arrow keys and zooms with Enter', async ({ page }) => {
    await page.goto('chart/?c=Japan&levels=owner-brand');
    const first = page.locator(`${cells}[tabindex="0"]`);
    await expect(first).toHaveCount(1);
    await first.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator(`${cells}:focus`)).toHaveClass(/lv-brand/);
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator(`${cells}:focus`)).toHaveClass(/lv-owner/);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/focus=g:/);
    await page.keyboard.press('Escape');
    await expect(page).not.toHaveURL(/focus=/);
  });

  test('leaves out the "not catalogued" marks on the published site', async ({ page }) => {
    await page.goto('chart/?levels=owner-line');
    await expect(page.locator('.columns .cell').first()).toBeVisible();
    await expect(page.locator('.columns .gap')).toHaveCount(0);
    await expect(page.locator('#legend')).not.toContainText('Not catalogued');
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('opens as an outline that fits the screen', async ({ page }) => {
      await page.goto('chart/');
      await expect(page.locator('#views [aria-pressed="true"]')).toHaveText('Outline');
      await expect(page.locator('.outline .row').first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    });
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
});

test.describe('Timeline', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('timeline/');
  });

  test('groups brands under their current owner, each purchase marked', async ({ page }) => {
    const lvmh = page.locator('section.owner[aria-label="LVMH"]');
    const zenith = lvmh.locator('li.row', { hasText: 'Zenith' });
    const band = zenith.locator('.band');
    await expect(band).toContainText('LVMH');
    await expect(band).toHaveAttribute('href', /\/ownership-groups\/lvmh\//);
    await expect(zenith.locator('.buy')).toHaveCount(0);
    // The group's own row marks every purchase, linked to the brand bought.
    const bought = lvmh.locator('.head .buy');
    expect(await bought.count()).toBeGreaterThan(2);
    await expect(bought.first()).toHaveAttribute('href', /\/brands\//);
    await expect(page.locator('section.owner').last()).toHaveAttribute('aria-label', 'Independent');
  });

  test('stacks part-owners held at the same time', async ({ page }) => {
    const kenissi = page.locator('li.row[data-id="kenissi"]').first();
    const [first, second] = await kenissi.locator('.band').all();
    const a = (await first.boundingBox())!;
    const b = (await second.boundingBox())!;
    expect(a.y + a.height).toBeLessThanOrEqual(b.y + 1);
  });

  test('filters hide owners with no matching brands, and the years shown are remembered', async ({ page }) => {
    await page.getByPlaceholder('Search brands').fill('zenith');
    await expect(page.locator('section.owner[aria-label="LVMH"]')).toBeVisible();
    await expect(page.locator('section.owner[aria-label="Swatch Group"]')).toBeHidden();
    await page.getByRole('button', { name: 'Since 1950' }).click();
    await page.reload();
    await expect(page.locator('[data-timeline]')).toHaveAttribute('data-scale', 'recent');
  });
});

test.describe('Control', () => {
  test("a brand shows who controls it, its own or its owner's", async ({ page }) => {
    await page.goto('brands/patek-philippe/');
    await expect(page.locator('.facts')).toContainText('Family-owned');
    await page.goto('brands/omega/');
    await expect(page.locator('.facts')).toContainText('Publicly traded, through Swatch Group');
  });

  test('the brands list filters by control', async ({ page }) => {
    await page.goto('brands/');
    await page.locator('select[name="control"]').selectOption('family');
    await expect(page.locator('#brands tr[data-id="patek-philippe"]')).toBeVisible();
    await expect(page.locator('#brands tr[data-id="omega"]')).toBeHidden();
  });
});

test.describe('Tiles', () => {
  test('a brand shows its lines as tiles, each labeled and linked', async ({ page }) => {
    await page.goto('brands/richard-mille/');
    const tiles = page.getByRole('list', { name: 'Product lines' }).locator('li');
    expect(await tiles.count()).toBeGreaterThan(10);
    await expect(tiles.first().locator('strong')).toBeVisible();
    await expect(tiles.first().locator('a')).toHaveAttribute('href', /\/brands\/richard-mille\//);
  });

  test("a line of one model steps through that model's references", async ({ page }) => {
    await page.goto('brands/rolex/');
    const daytona = page.getByRole('list', { name: 'Product lines' }).locator('a[href$="/cosmograph-daytona/"]');
    await expect(daytona).toHaveAttribute('data-cycle', '');
    expect(await daytona.locator('.frame img').count()).toBeGreaterThan(1);
  });

  test("a reference with no photo of its own borrows the model's, marked as such", async ({ page }) => {
    await page.goto('brands/rolex/submariner/submariner-date/');
    const tiles = page.getByRole('list', { name: 'References' }).locator('li');
    await expect(tiles.filter({ hasText: '126610LN' })).toBeVisible();
    await expect(tiles.filter({ hasText: '126610LN' }).locator('.general')).toHaveText('Model photo');
  });

  test("a reference with the maker's own image of it shows that instead", async ({ page }) => {
    await page.goto('brands/richard-mille/rm-65/rm-65-01/');
    const tiles = page.getByRole('list', { name: 'References' }).locator('li');
    await expect(tiles.filter({ hasText: 'RM65-01 CA' }).locator('.general')).toHaveCount(0);
    await expect(tiles.filter({ hasText: 'RM65-01 RG CA' }).locator('.general')).toHaveCount(1);
  });
});
