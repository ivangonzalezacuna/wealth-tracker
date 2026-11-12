import { expect, test } from '@playwright/test';
import { chartBackup } from './fixtures/chartBackup';
import { ensureCardExpanded, gotoApp, openTab, preparePage, waitForSyncIdle } from './helpers';

test.beforeEach(async ({ page }) => {
  await preparePage(page);
  await gotoApp(page);
  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-backup');
  await page.setInputFiles('#backup-file-input', {
    name: 'synthetic.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(chartBackup())),
  });
  await page.locator('.js-confirm-ok').click();
  await expect(page.locator('.toast-text').last()).toContainText('Restore complete.');
  await page.getByRole('button', { name: 'Dismiss notification' }).click();
  await page.goto('/#log');
  await expect(page.locator('#app-sub')).toContainText('30 snapshots');
  await waitForSyncIdle(page);
});

test('below-viewport projections initialize on focus and survive navigation, theme and reload', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1365, height: 500 });
  await openTab(page, 'tab-networth');
  await expect(page.locator('#nw-planning')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#c-nw-forecast canvas')).toHaveCount(0);
  await page.locator('#nw-planning button').focus();
  await expect(page.locator('[data-planning-tab="forecast"]')).toBeFocused();
  await expect(page.locator('#c-nw-forecast canvas')).toHaveCount(1);
  await page.locator('[data-planning-tab="drawdown"]').click();
  await expect(page.locator('#c-nw-decumulation canvas')).toHaveCount(1);
  await openTab(page, 'tab-analytics');
  await openTab(page, 'tab-networth');
  await expect(page.locator('#c-nw-decumulation canvas')).toHaveCount(1);
  await page.locator('#btn-header-menu').click();
  await page.locator('[data-theme-choice="dark"]').click();
  await expect(page.locator('#c-nw-decumulation canvas')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('#app-sub')).toContainText('30 snapshots');
  await page.locator('#nw-planning').scrollIntoViewIfNeeded();
  await expect(page.locator('#c-nw-forecast canvas')).toHaveCount(1);
  const data = await page.evaluate(async () => {
    const db = await import('/src/db/index.ts');
    return { snaps: await db.loadSnapshots(), txs: await db.loadTransactions() };
  });
  expect(data.snaps).toHaveLength(30);
  expect(data.txs).toHaveLength(90);
});

test('an unchanged successful sync preserves current DOM and drafts, but changed data repaints', async ({
  page,
}) => {
  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-contributions');
  await page.locator('#sync-status').click();
  await waitForSyncIdle(page);
  await page.fill('#set-contrib-budget', '777');
  const amount = await page.locator('#set-contrib-budget').elementHandle();
  const request = page.waitForRequest((request) => request.url().includes('/drive/v3/files?'));
  await page.locator('#sync-status').click();
  await request;
  await waitForSyncIdle(page);
  expect(await amount!.evaluate((el) => el.isConnected)).toBe(true);
  await expect(page.locator('#set-contrib-budget')).toHaveValue('777');
  await expect(page.locator('#btn-save-contributions')).toHaveAttribute('data-dirty', 'true');
  await openTab(page, 'tab-networth');
  const kpis = await page.locator('#nw-kpis .kpi').first().elementHandle();
  const nextRequest = page.waitForRequest((request) => request.url().includes('/drive/v3/files?'));
  await page.locator('#sync-status').click();
  await nextRequest;
  await waitForSyncIdle(page);
  expect(await kpis!.evaluate((el) => el.isConnected)).toBe(true);
  await page.evaluate(async () => {
    const { loadSnapshots, upsertSnapshot } = await import('/src/db/index.ts');
    const latest = (await loadSnapshots()).at(-1)!;
    await upsertSnapshot({ ...latest, cash: Number(latest.cash) + 100 });
  });
  const changedRequest = page.waitForRequest((request) =>
    request.url().includes('/drive/v3/files?'),
  );
  await page.locator('#sync-status').click();
  await changedRequest;
  await waitForSyncIdle(page);
  expect(await kpis!.evaluate((el) => el.isConnected)).toBe(false);
  await expect(page.locator('#nw-kpis .kpi').first()).toContainText('15.150');
});

for (const width of [1365, 390]) {
  for (const [section, chartId] of [
    ['portfolio', 'c-port-donut'],
    ['analytics', 'c-an-growth'],
  ] as const) {
    test(`${section} retains same-size charts without resizing at ${width}px, but adapts after a hidden resize`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await openTab(page, `tab-${section}`);
      const host = page.locator(`#${chartId}`);
      await expect(host.locator('canvas')).toHaveCount(1);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await page.evaluate(async (id) => {
        const { getChart } = await import('/src/views/charts/registry.ts');
        const chart = getChart(id)!;
        const host = document.getElementById(id)!;
        const resize = chart.resize.bind(chart);
        host.dataset.resizeCalls = '0';
        chart.resize = (...args) => {
          host.dataset.resizeCalls = String(Number(host.dataset.resizeCalls) + 1);
          resize(...args);
        };
      }, chartId);
      const canvas = await host.locator('canvas').elementHandle();
      await openTab(page, 'tab-log');
      await openTab(page, `tab-${section}`);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await expect(host).toHaveAttribute('data-resize-calls', '0');
      expect(await canvas!.evaluate((el) => el.isConnected)).toBe(true);

      await openTab(page, 'tab-log');
      await page.setViewportSize({ width: width === 390 ? 800 : 450, height: 700 });
      await openTab(page, `tab-${section}`);
      await expect
        .poll(() =>
          page.evaluate(async (id) => {
            const { getChart } = await import('/src/views/charts/registry.ts');
            const chart = getChart(id)!;
            const host = document.getElementById(id)!;
            return (
              Number(host.dataset.resizeCalls) > 0 &&
              chart.getWidth() === host.clientWidth &&
              chart.getHeight() === host.clientHeight
            );
          }, chartId),
        )
        .toBe(true);
      expect(await canvas!.evaluate((el) => el.isConnected)).toBe(true);
    });
  }
}
