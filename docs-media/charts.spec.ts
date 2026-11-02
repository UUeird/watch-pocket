import { test, type Page } from '@playwright/test';
import { glide, glideAndClick, record, still, viewport } from './capture';

// Captures for the Docs page on reading the chart (src/pages/docs/charts.astro). Each test writes the files named in
// it; the page refers to them by those names. Each view is opened by its link, since the chart keeps its state there.

test.use({ viewport, colorScheme: 'light', deviceScaleFactor: 2 });

const settle = (page: Page) => page.waitForTimeout(600);

test('the chart as it opens, and its controls', async ({ page }) => {
  await page.goto('chart/');
  await settle(page);
  await still(page.locator('.chart .bar'), 'controls');
  await still(page.locator('#viz'), 'chart-overview');
  await page.goto('chart/?levels=owner-brand');
  await settle(page);
  await still(page.locator('#viz'), 'chart-owners');
});

test('levels down to lines and to references', async ({ page }) => {
  await page.goto('chart/?c=Japan&levels=owner-line');
  await settle(page);
  await still(page.locator('#viz'), 'chart-levels');
  await page.goto('chart/?levels=line-ref&focus=b:rolex');
  await settle(page);
  await still(page.locator('#viz'), 'chart-references');
});

test('the outline', async ({ page }) => {
  await page.goto('chart/?view=outline');
  await settle(page);
  await still(page.locator('#viz'), 'chart-outline');
});

test('recording: zooming in and back out', async ({ browser, baseURL }) => {
  await record(
    browser,
    'zoom',
    async (page, ready) => {
      await page.goto('chart/?levels=owner-line&indep=hide', { waitUntil: 'networkidle' });
      await page.locator('#viz').scrollIntoViewIfNeeded();
      ready();
      await page.waitForTimeout(900);
      // Each box is scrolled into view before the pointer moves to it.
      const visit = async (target: ReturnType<Page['locator']>) => {
        await target.scrollIntoViewIfNeeded();
        await glideAndClick(page, target);
        await page.waitForTimeout(1400);
      };
      await visit(page.locator('.columns .cell', { hasText: 'Swatch Group' }).first());
      await visit(page.locator('.columns .cell', { hasText: 'Omega' }).first());
      await visit(page.locator('#crumbs button').first());
      await page.waitForTimeout(1000);
    },
    baseURL,
  );
});

test('recording: finding a reference', async ({ browser, baseURL }) => {
  await record(
    browser,
    'search',
    async (page, ready) => {
      await page.goto('chart/', { waitUntil: 'networkidle' });
      ready();
      await page.waitForTimeout(900);
      const search = page.locator('#q');
      await glide(page, search);
      await search.pressSequentially('126610 ln', { delay: 120 });
      await page.waitForTimeout(900);
      await glideAndClick(page, page.locator('#results button').first());
      await page.waitForTimeout(1800);
    },
    baseURL,
  );
});
