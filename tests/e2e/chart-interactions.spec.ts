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

/** Click an in-chart range preset button (canvas graphic) by index. */
async function clickPreset(page: Page, id: string, index: number) {
  const x = await page.evaluate(
    async ([chartId, i]) => {
      const { getChart } = await import('/src/views/charts/index.ts');
      const opt = getChart(chartId as string)!.getOption() as {
        graphic: Array<{ elements: Array<{ id?: string; x?: number }> }>;
      };
      return opt.graphic[0].elements.filter((e) => e.id?.startsWith('preset-'))[i as number].x ?? 0;
    },
    [id, index],
  );
  const box = await showChart(page, id);
  await page.mouse.click(box.x + x + 12, box.y + 11);
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

test('history chart range presets, reset, data table and expand', async ({ page }) => {
  await openTab(page, 'tab-networth');
  await showChart(page, 'c-nw-hist');

  await clickPreset(page, 'c-nw-hist', 0);
  await expect
    .poll(async () => (await zoomWindow(page, 'c-nw-hist'))?.startValue)
    .toBe(monthStart('2024-07'));

  await clickToolbox(page, 'c-nw-hist', 'Reset view');
  await expect.poll(async () => (await zoomWindow(page, 'c-nw-hist'))?.start).toBe(0);

  await clickToolbox(page, 'c-nw-hist', 'Data table');
  const table = page.locator('#c-nw-hist .chart-dataview-table');
  await expect(table).toBeVisible();
  await expect(table).toContainText('Jan 2023');
  await expect(table).toContainText('Jun 2025');
  await page.locator('#c-nw-hist').getByText('Close').click();
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

  await clickPreset(page, 'c-an-growth', 0);
  await expect
    .poll(async () => (await zoomWindow(page, 'c-an-drawdown'))?.startValue)
    .toBe(monthStart('2024-07'));
  expect((await zoomWindow(page, 'c-an-growth'))?.startValue).toBe(monthStart('2024-07'));
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

test('clicking a contributions month filters the ledger to its purchases', async ({ page }) => {
  await openTab(page, 'tab-portfolio');
  await page.locator('#tab-contributions').click();
  const pt = await pointAt(page, 'c-dca-bar', -1);
  await page.mouse.click(pt.x, pt.y);
  await expect(page.locator('#log-tab-transactions')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#tx-search')).toHaveValue('2025-06');
  await expect(page.locator('#tx-type-filter')).toHaveValue('BUY');
  await expect(page.locator('#tx-ledger-list .tx-row:not(.th)')).toHaveCount(2);
});
