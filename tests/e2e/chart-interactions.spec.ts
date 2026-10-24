import { expect, test, type Page } from '@playwright/test';
import { chartBackup } from './fixtures/chartBackup';
import { ensureCardExpanded, gotoApp, openTab, preparePage } from './helpers';

type Win = { start: number; end: number; startValue?: number; endValue?: number };

const monthStart = (month: string) =>
  Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, 1);

test.beforeEach(async ({ page }) => {
  await preparePage(page);
  await gotoApp(page);
  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-backup');
  await page.setInputFiles('#backup-file-input', {
    name: 'charts.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(chartBackup())),
  });
  await page.locator('.js-confirm-ok').click();
  await expect(page.locator('.toast-text').last()).toContainText('Restore complete.');
  await page.getByRole('button', { name: 'Dismiss notification' }).click();
});

async function showChart(page: Page, id: string) {
  const host = page.locator(`#${id}`);
  await host.scrollIntoViewIfNeeded();
  await expect(host.locator('canvas')).toHaveCount(1);
  return (await host.boundingBox())!;
}

async function zoomWindow(page: Page, id: string): Promise<Win | null> {
  return page.evaluate(async (chartId) => {
    const { getChart } = await import('/src/views/charts/index.ts');
    const dz = (getChart(chartId)?.getOption() as { dataZoom?: Win[] }).dataZoom?.[0];
    return dz
      ? { start: dz.start, end: dz.end, startValue: dz.startValue, endValue: dz.endValue }
      : null;
  }, id);
}

/** Ctrl + wheel over the plot zooms in (a plain wheel keeps scrolling the page). */
async function wheelZoom(page: Page, id: string) {
  const box = await showChart(page, id);
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.5);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -400);
  await page.keyboard.up('Control');
}

/** Click a toolbox icon by its title (icons are canvas paths tagged with `__title`). */
async function clickToolbox(page: Page, id: string, title: string) {
  const box = await showChart(page, id);
  const at = await page.evaluate(
    async ([chartId, name]) => {
      const { getChart } = await import('/src/views/charts/index.ts');
      type El = {
        __title?: string;
        transform?: number[];
        getBoundingRect(): {
          clone(): {
            applyTransform(m: number[]): void;
            x: number;
            y: number;
            width: number;
            height: number;
          };
        };
      };
      const zr = getChart(chartId as string)!.getZr() as unknown as {
        storage: { getDisplayList(update: boolean): El[] };
      };
      const icon = zr.storage.getDisplayList(true).find((el) => el.__title === name);
      if (!icon) return null;
      const r = icon.getBoundingRect().clone();
      if (icon.transform) r.applyTransform(icon.transform);
      return [r.x + r.width / 2, r.y + r.height / 2];
    },
    [id, title],
  );
  expect(at, `toolbox icon "${title}"`).not.toBeNull();
  await page.mouse.click(box.x + at![0], box.y + at![1]);
}

/** Page coordinates of the n-th point of the first series. */
async function pointAt(page: Page, id: string, dataIndex: number) {
  const box = await showChart(page, id);
  const local = await page.evaluate(
    async ([chartId, i]) => {
      const { getChart } = await import('/src/views/charts/index.ts');
      const chart = getChart(chartId as string)!;
      const opt = chart.getOption() as { series: { data: unknown[] }[] };
      const data = opt.series[0].data;
      const idx = (i as number) < 0 ? data.length + (i as number) : (i as number);
      const raw = data[idx] as unknown;
      if (Array.isArray(raw)) return chart.convertToPixel({ gridIndex: 0 }, raw) as number[];
      // Category bars: aim at the column just above the axis (stacked values may be 0 or objects).
      const [x, y] = chart.convertToPixel({ gridIndex: 0 }, [idx, 0]) as number[];
      return [x, y - 4];
    },
    [id, dataIndex],
  );
  return { x: box.x + local[0], y: box.y + local[1] };
}

test('history chart zoom, reset, legend, data table and expand', async ({ page }) => {
  await openTab(page, 'tab-networth');
  await showChart(page, 'c-nw-hist');
  // No range preset buttons: the full history is shown and zoom does the rest.
  expect((await zoomWindow(page, 'c-nw-hist'))?.start).toBe(0);
  expect((await zoomWindow(page, 'c-nw-hist'))?.end).toBe(100);

  await wheelZoom(page, 'c-nw-hist');
  await expect
    .poll(async () => (await zoomWindow(page, 'c-nw-hist'))?.startValue)
    .toBeGreaterThan(monthStart('2023-01'));

  await clickToolbox(page, 'c-nw-hist', 'Reset view');
  await expect.poll(async () => (await zoomWindow(page, 'c-nw-hist'))?.start).toBe(0);

  // HTML legend: real toggle buttons that wrap instead of paging.
  const legend = page.locator('#c-nw-hist .chart-legend');
  const total = legend.getByRole('button', { name: 'Total net worth' });
  await expect(total).toHaveAttribute('aria-pressed', 'true');
  await total.click();
  await expect(total).toHaveAttribute('aria-pressed', 'false');
  await total.click();
  await expect(total).toHaveAttribute('aria-pressed', 'true');

  await clickToolbox(page, 'c-nw-hist', 'Data table');
  const dialog = page.getByRole('dialog', { name: /data$/ });
  const table = page.locator('#c-nw-hist .chart-dataview-table');
  await expect(table).toBeVisible();
  await expect(dialog.locator('h4')).toHaveCount(0);
  await expect(table).toContainText('Jan 2023');
  await expect(table).toContainText('Jun 2025');
  await page.getByRole('button', { name: 'Close data table' }).click();
  await expect(table).toBeHidden();
  await clickToolbox(page, 'c-nw-hist', 'Data table');
  await expect(table).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(table).toBeHidden();

  await clickToolbox(page, 'c-nw-hist', 'Expand');
  const expanded = () =>
    page.evaluate(
      () =>
        !!document.fullscreenElement?.querySelector('#c-nw-hist') ||
        !!document.querySelector('.chart-expanded #c-nw-hist'),
    );
  await expect.poll(expanded).toBe(true);
  await clickToolbox(page, 'c-nw-hist', 'Exit full screen');
  await expect.poll(expanded).toBe(false);
});

test('analytics timeline charts share their zoom window', async ({ page }) => {
  await openTab(page, 'tab-analytics');
  const advanced = page.locator('#an-advanced');
  if ((await advanced.getAttribute('open')) === null) await advanced.locator('> summary').click();
  await showChart(page, 'c-an-drawdown');

  await wheelZoom(page, 'c-an-growth');
  await expect
    .poll(async () => (await zoomWindow(page, 'c-an-growth'))?.startValue)
    .toBeGreaterThan(monthStart('2023-01'));
  const growth = (await zoomWindow(page, 'c-an-growth'))!;
  await expect
    .poll(async () => (await zoomWindow(page, 'c-an-drawdown'))?.endValue)
    .toBe(growth.endValue);
  expect((await zoomWindow(page, 'c-an-drawdown'))?.startValue).toBe(growth.startValue);
});

test('clicking a history point opens that snapshot in the log', async ({ page }) => {
  await openTab(page, 'tab-networth');
  const pt = await pointAt(page, 'c-nw-hist', -2);
  await page.mouse.click(pt.x, pt.y);
  await expect(page.locator('#log-tab-snapshots')).toHaveAttribute('aria-selected', 'true');
  const row = page.locator('#snaps-list .snap-row-compact[data-date="2025-05"]');
  await expect(row).toHaveAttribute('aria-expanded', 'true');
  await expect(row).toBeInViewport();
});

test('clicking a drift bar opens that holding', async ({ page }) => {
  await openTab(page, 'tab-portfolio');
  const box = await showChart(page, 'c-port-drift');
  const target = await page.evaluate(async () => {
    const { getChart } = await import('/src/views/charts/index.ts');
    const chart = getChart('c-port-drift')!;
    const opt = chart.getOption() as { series: { data: { value: number }[] }[] };
    const v = opt.series[0].data[0].value;
    return chart.convertToPixel({ gridIndex: 0 }, [v / 2, 0]) as number[];
  });
  await page.mouse.click(box.x + target[0], box.y + target[1]);
  const row = page.locator('#port-table .hold-row[aria-expanded="true"]');
  await expect(row).toHaveCount(1);
  await expect(row).toBeInViewport();
});

test('clicking a contributions month filters the ledger to its purchases', async ({ page }) => {
  await openTab(page, 'tab-portfolio');
  await page.locator('#tab-contributions').click();
  const pt = await pointAt(page, 'c-dca-bar', -1);
  await page.mouse.click(pt.x, pt.y);
  await expect(page.locator('#log-tab-transactions')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#tx-search')).toHaveValue('2025-06');
  await expect(page.locator('#tx-filter-status')).toContainText('From chart');
  await expect(page.locator('#tx-ledger-list .tx-row:not(.th)')).toHaveCount(2);
});

test.describe('touch screens', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test('a tap only shows the tooltip; its button opens the snapshot', async ({ page }) => {
    await openTab(page, 'tab-networth');
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    const pt = await pointAt(page, 'c-nw-hist', -2);
    await page.touchscreen.tap(pt.x, pt.y);
    const open = page.locator('#c-nw-hist [data-chart-drill]');
    await expect(open).toBeVisible();
    await expect(page.locator('#log-tab-snapshots')).not.toHaveAttribute('aria-selected', 'true');
    await open.tap();
    await expect(page.locator('#log-tab-snapshots')).toHaveAttribute('aria-selected', 'true');
    await expect(
      page.locator('#snaps-list .snap-row-compact[data-date="2025-05"]'),
    ).toHaveAttribute('aria-expanded', 'true');
  });
});
