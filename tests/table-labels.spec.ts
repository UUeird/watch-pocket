import { expect, test, type Page } from '@playwright/test';

// A table too wide for the window scrolls sideways, so its column labels are slid down to stay under the site header
// rather than stuck there (see the script in src/layouts/Base.astro). These check the slide on the built site.

const geometry = (page: Page) =>
  page.evaluate(() => {
    const table = document.querySelector<HTMLTableElement>('.table-wrap table')!;
    return {
      fits: table.closest('.table-wrap')!.classList.contains('fits'),
      header: document.querySelector('header')!.getBoundingClientRect().bottom,
      table: table.getBoundingClientRect().top,
      tableBottom: table.getBoundingClientRect().bottom,
      labels: table.tHead!.rows[0].cells[1].getBoundingClientRect().top,
      labelsHeight: table.tHead!.offsetHeight,
    };
  });

const scrollTo = async (page: Page, y: (g: Awaited<ReturnType<typeof geometry>>) => number) => {
  const g = await geometry(page);
  await page.evaluate((top) => window.scrollTo(0, top), (await page.evaluate(() => scrollY)) + y(g));
  // Let a frame pass so a scroll listener has run where the browser drives the slide by script.
  await page.evaluate(() => new Promise(requestAnimationFrame));
};

test.describe('Column labels of a wide table', () => {
  test.use({ viewport: { width: 700, height: 600 } });

  test.beforeEach(async ({ page }) => {
    await page.goto('brands/rolex/cosmograph-daytona/cosmograph-daytona/');
    expect((await geometry(page)).fits).toBe(false);
  });

  test('sit at the top of the table until it reaches the header', async ({ page }) => {
    const g = await geometry(page);
    expect(Math.abs(g.labels - g.table)).toBeLessThan(2);
  });

  test('stay under the header while the table scrolls past it', async ({ page }) => {
    await scrollTo(page, (g) => g.table - g.header + 200);
    const g = await geometry(page);
    expect(g.table).toBeLessThan(g.header);
    expect(Math.abs(g.labels - g.header)).toBeLessThan(2);
  });

  test('go back to the top of the table when scrolled back up', async ({ page }) => {
    await scrollTo(page, (g) => g.table - g.header + 200);
    await scrollTo(page, (g) => g.table - g.header - 100);
    const g = await geometry(page);
    expect(Math.abs(g.labels - g.table)).toBeLessThan(2);
  });

  test('stop at the bottom of the table', async ({ page }) => {
    await scrollTo(page, (g) => g.tableBottom - g.header + 50);
    const g = await geometry(page);
    expect(g.labels + g.labelsHeight).toBeLessThanOrEqual(g.tableBottom + 2);
  });
});
