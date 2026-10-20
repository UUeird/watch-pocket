import { test, type Page } from '@playwright/test';
import { glide, glideAndClick, record, still, viewport } from './capture';

// Captures for the Docs page on reading the charts (src/pages/docs/charts.astro). Each test writes the files named in
// it; the page refers to them by those names.

const chart = '[data-treemap]';

test.use({ viewport, colorScheme: 'light', deviceScaleFactor: 2 });

const settle = (page: Page) => page.waitForTimeout(600);

test('brands overview, zoomed box, and the note', async ({ page }) => {
  await page.goto('brands/');
  await settle(page);
  await still(page.locator(chart), 'brands-overview');

  await page.locator(`${chart} .tile[data-zoom="Switzerland"]`).click();
  await settle(page);
  await still(page.locator(`${chart} .frame`), 'brands-zoomed');

  await page.locator(`${chart} .unsized summary`).first().click();
  await still(page.locator(`${chart} .note`), 'brands-note');
  await still(page.locator(`${chart} .unsized`), 'brands-unsized');
});

test('ownership groups sized by revenue, as rectangles and circles', async ({ page }) => {
  await page.goto('ownership-groups/');
  await settle(page);
  await still(page.locator(`${chart} .controls`), 'controls');
  await page.locator(`${chart} select[name="size"]`).selectOption('annual-revenue');
  await settle(page);
  await still(page.locator(`${chart} .frame`), 'groups-revenue');

  await page.locator(`${chart} select[name="shape"]`).selectOption('circles');
  await settle(page);
  await still(page.locator(`${chart} .frame`), 'groups-revenue-circles');

  await page.locator(`${chart} select[name="size"]`).selectOption('brands');
  await settle(page);
  await still(page.locator(`${chart} .frame`), 'groups-circles');
});

test('recording: zooming into a box and back out', async ({ browser, baseURL }) => {
  await record(
    browser,
    'zoom',
    async (page, ready) => {
      await page.goto('brands/', { waitUntil: 'networkidle' });
      await page.locator(chart).scrollIntoViewIfNeeded();
      ready();
      await page.waitForTimeout(900);
      const switzerland = page.locator(`${chart} .tile[data-zoom="Switzerland"]`);
      await glide(page, switzerland);
      await page.waitForTimeout(900);
      await glideAndClick(page, switzerland);
      await page.waitForTimeout(1000);
      // A couple of brands, to show their tooltips.
      for (const name of ['Rolex', 'Omega']) {
        await glide(page, page.locator(`${chart} .brand`, { has: page.locator(`[aria-label^="${name},"]`) }).or(page.locator(`${chart} .brand[aria-label^="${name},"]`)).first());
        await page.waitForTimeout(1100);
      }
      await glideAndClick(page, page.locator(`${chart} [data-unzoom]`));
      await page.waitForTimeout(800);
    },
    baseURL,
  );
});

test('recording: changing what sizes the chart, then drawing it as circles', async ({ browser, baseURL }) => {
  await record(
    browser,
    'size-and-shape',
    async (page, ready) => {
      await page.goto('ownership-groups/', { waitUntil: 'networkidle' });
      ready();
      await page.waitForTimeout(900);
      const size = page.locator(`${chart} select[name="size"]`);
      await glide(page, size);
      await size.selectOption('annual-revenue');
      await page.waitForTimeout(1600);
      const shape = page.locator(`${chart} select[name="shape"]`);
      await glide(page, shape);
      await shape.selectOption('circles');
      await page.waitForTimeout(1600);
      await size.selectOption('brands');
      await glide(page, size);
      await page.waitForTimeout(1600);
    },
    baseURL,
  );
});

test('recording: the chart following the filters', async ({ browser, baseURL }) => {
  await record(
    browser,
    'follow-filters',
    async (page, ready) => {
      await page.goto('brands/', { waitUntil: 'networkidle' });
      ready();
      await page.waitForTimeout(900);
      const owner = page.locator('select[name="owner"]');
      await glide(page, owner);
      await owner.selectOption('richemont');
      await page.waitForTimeout(800);
      await glide(page, page.locator(chart));
      await page.waitForTimeout(1600);
      await glide(page, owner);
      await owner.selectOption('swatch-group');
      await page.waitForTimeout(800);
      await glide(page, page.locator(chart));
      await page.waitForTimeout(1600);
    },
    baseURL,
  );
});
