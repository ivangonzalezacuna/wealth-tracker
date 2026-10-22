import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { ensureCardExpanded, gotoApp, openTab, preparePage, waitForSyncIdle } from '../e2e/helpers';
import { reviewBackup, type ReviewState } from './fixture';

async function seed(page: Page, state: ReviewState = 'complete') {
  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-backup');
  await page.setInputFiles('#backup-file-input', {
    name: 'synthetic-ui-review.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(reviewBackup(state))),
  });
  await page.locator('.js-confirm-ok').click();
  await expect(page.locator('.toast-text').last()).toContainText('Restore complete.');
  await page.getByRole('button', { name: 'Dismiss notification' }).click();
  await openTab(page, 'tab-networth');
  await expect(page.locator('#nw-content')).toBeVisible();
}

async function capture(page: Page, info: TestInfo, name: string, root: string) {
  await page.mouse.move(0, 0);
  await page.locator(root).scrollIntoViewIfNeeded();
  // Chart.js canvas animations are not disabled by Playwright's CSS animation option.
  await page.waitForTimeout(1100);
  await page.screenshot({
    path: info.outputPath(`${name}.png`),
    fullPage: true,
    animations: 'disabled',
  });
  await info.attach(name, { path: info.outputPath(`${name}.png`), contentType: 'image/png' });
  const metrics = await page.locator(root).evaluate((el) => {
    const visible = (selector: string) =>
      [...el.querySelectorAll<HTMLElement>(selector)].filter(
        (node) => node.getClientRects().length,
      );
    return {
      viewport: { width: innerWidth, height: innerHeight },
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      height: el.getBoundingClientRect().height,
      outOfBounds: [...el.querySelectorAll<HTMLElement>('*')]
        .filter((node) => {
          if (!node.getClientRects().length) return false;
          for (let p = node.parentElement; p && p !== el; p = p.parentElement) {
            if (getComputedStyle(p).overflowX !== 'visible') return false;
          }
          const box = node.getBoundingClientRect();
          return box.right > document.documentElement.clientWidth + 1 || box.left < -1;
        })
        .map((node) => `${node.tagName.toLowerCase()}#${node.id}.${[...node.classList].join('.')}`)
        .slice(0, 10),
      controls: visible('button, input, select, summary').map((node) => ({
        text: node.textContent?.trim().slice(0, 70) || node.getAttribute('aria-label') || node.id,
        width: node.getBoundingClientRect().width,
        height: node.getBoundingClientRect().height,
      })),
      clipped: visible('.row-label, .row-val, .kpi-val, .card-title, [role="cell"]')
        .filter((node) => node.scrollWidth > node.clientWidth + 1)
        .map((node) => ({
          text: node.textContent?.trim(),
          width: node.clientWidth,
          scroll: node.scrollWidth,
        })),
    };
  });
  await info.attach(`${name}-layout`, {
    body: JSON.stringify(metrics, null, 2),
    contentType: 'application/json',
  });
  expect
    .soft(metrics.pageOverflow, `${name}: document must not scroll sideways`)
    .toBeLessThanOrEqual(1);
  expect.soft(metrics.outOfBounds, `${name}: elements must stay inside the viewport`).toEqual([]);
}

test.beforeEach(async ({ page }, info) => {
  await preparePage(page);
  await page.clock.install({ time: new Date('2026-05-15T12:00:00Z') });
  await page.addInitScript(
    (theme) => localStorage.setItem('wt-theme', theme),
    String(info.project.metadata.theme),
  );
  await gotoApp(page);
});

test('empty states and navigation calls to action', async ({ page }, info) => {
  await expect(page.locator('#nw-empty')).toBeVisible();
  await capture(page, info, 'empty-networth', '#networth');
  await page.locator('#nw-empty [data-goto="log"]').click();
  await expect(page.locator('#log')).toHaveClass(/active/);
  await openTab(page, 'tab-portfolio');
  for (const view of ['holdings', 'contributions', 'dividends']) {
    await page.locator(`#tab-${view}`).click();
    await expect(page.locator(`#subview-${view} .empty-state`)).toBeVisible();
    await capture(page, info, `empty-${view}`, '#portfolio');
  }
  await page.locator('#div-empty [data-goto="log"]').click();
  await expect(page.locator('#log')).toHaveClass(/active/);
});

test('net worth history, goals, scenarios and all drawdown strategies', async ({ page }, info) => {
  await seed(page);
  await expect(page.locator('#nw-kpis .kpi-val').first()).toContainText('100.700');
  await capture(page, info, 'networth-overview', '#networth');
  for (const [range, count] of [
    ['12', 12],
    ['36', 36],
    ['all', 40],
  ] as const) {
    await page.locator(`#nw-range-toggle [data-range="${range}"]`).click();
    await expect(page.locator('#c-nw-hist-table-wrap tbody tr')).toHaveCount(Math.min(count, 25));
  }
  const historyTable = page.locator('#c-nw-hist-table-wrap');
  await historyTable.locator('.chart-data-table-toggle').click();
  await expect(historyTable.locator('table')).toBeVisible();
  await historyTable.locator('.chart-data-table-next').click();
  await expect(historyTable.locator('tbody tr')).toHaveCount(15);
  await capture(page, info, 'networth-history-table', '#networth');
  await historyTable.locator('.chart-data-table-toggle').click();
  const legend = page.locator('#nw-chart-legend [role="button"]').first();
  await legend.click();
  await expect(legend).toHaveAttribute('aria-pressed', 'true');
  await legend.click();
  const tip = page.locator('#nw-kpis .info-tip').first();
  await tip.scrollIntoViewIfNeeded();
  await tip.focus();
  await expect(page.locator('.info-tip-pop')).toBeVisible();
  await tip.blur();
  await page.locator('#nw-goal-tabs button').nth(1).click();
  await expect(page.locator('#nw-goal-tabs button').nth(1)).toHaveClass(/active/);
  await expect(page.locator('#nw-goal-panel')).toContainText('200.000');
  await page.locator('#nw-goal-tabs button').first().click();
  await page.locator('#nw-forecast-inflation').fill('2.5');
  await page.locator('#nw-forecast-inflation').press('Tab');
  for (const range of ['60', '120', '240', '360', '480', '600']) {
    await page.locator(`#nw-forecast-range-toggle [data-range="${range}"]`).click();
    await expect(page.locator(`#nw-forecast-range-toggle [data-range="${range}"]`)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  }
  await page.locator('#nw-scenario-toggle').click();
  await expect(page.locator('.forecast-scenario-card')).toBeVisible();
  for (const scenario of ['optimistic', 'pessimistic']) {
    for (const [field, value] of [
      ['ret', '3'],
      ['contrib', '100'],
    ]) {
      const input = page.locator(`#nw-scn-${scenario}-${field}`);
      await input.fill(value);
      await input.press('Tab');
      await expect(input).toHaveValue(value);
    }
  }
  await capture(page, info, 'networth-scenarios', '#nw-planning');
  await page.locator('#nw-scenario-toggle').click();
  await expect(page.locator('.forecast-scenario-card')).toBeHidden();
  await page.locator('[data-planning-tab="drawdown"]').click();
  await page.locator('#dd-retirement-date').fill('2040-06');
  await page.locator('#dd-retirement-date').press('Tab');
  for (const strategy of ['fixed', 'four-pct', 'pct']) {
    await page.locator(`[data-dd-strategy="${strategy}"]`).click();
    await page.locator('#dd-withdrawal').fill(strategy === 'pct' ? '4' : '1000');
    await page.locator('#dd-withdrawal').press('Tab');
    await expect(page.locator('#c-nw-decumulation-table-wrap tbody tr').first()).toBeAttached();
    await capture(page, info, `drawdown-${strategy}`, '#nw-planning');
  }
  await page.locator('#dd-return').fill('3');
  await page.locator('#dd-return').press('Tab');
  await expect(page.locator('#dd-return-reset')).toBeVisible();
  await page.locator('#dd-return-reset').click();
  await expect(page.locator('#dd-return-reset')).toHaveCount(0);
  await waitForSyncIdle(page);
  await page.reload();
  await waitForSyncIdle(page);
  await expect(page.locator('#nw-forecast-inflation')).toHaveValue('2.5');
  await page.locator('[data-planning-tab="drawdown"]').click();
  await expect(page.locator('#dd-retirement-date')).toHaveValue('2040-06');
});

test('holdings filters, search, sorting, details and contribution rebalance', async ({
  page,
}, info) => {
  await seed(page);
  await openTab(page, 'tab-portfolio');
  await expect(page.locator('#port-table [data-etf-key]')).toHaveCount(10);
  await capture(page, info, 'holdings-overview', '#portfolio');
  await page.locator('#port-pagination .js-page-next').click();
  await expect(page.locator('#port-table [data-etf-key]')).toHaveCount(2);
  await page.locator('#port-pagination .js-page-prev').click();
  await page.locator('#port-filter-toggle [data-filter="closed"]').click();
  await expect(page.locator('#port-table [data-etf-key]')).toHaveCount(2);
  await page.locator('#port-filter-toggle [data-filter="all"]').click();
  await page.locator('#port-holdings-search').fill('IE00TEST0000');
  await expect(page.locator('#port-table [data-etf-key]')).toHaveCount(1);
  const row = page.locator('#port-table [data-etf-key]').first();
  await row.focus();
  await row.press('Enter');
  await expect(page.locator('.hold-detail')).toBeVisible();
  await capture(page, info, 'holding-detail', '#portfolio');
  await row.press('Space');
  await expect(page.locator('.hold-detail')).toBeHidden();
  await page.locator('#port-holdings-search').fill('no matching holding');
  await expect(page.locator('#port-table [data-etf-key]')).toHaveCount(0);
  await capture(page, info, 'holdings-no-match', '#portfolio');
  await page.locator('#port-holdings-search').fill('');
  await page.locator('#port-filter-toggle [data-filter="held"]').click();
  const sort = page.locator('#port-table-header [data-sort-key]').first();
  await sort.click();
  await expect(sort).toHaveAttribute('aria-sort', 'descending');
  await sort.click();
  await expect(sort).toHaveAttribute('aria-sort', 'ascending');
  const rebalance = page.locator('.rebalance-collapsible');
  if ((await rebalance.getAttribute('open')) === null) await rebalance.locator('summary').click();
  for (const months of ['1', '2', '3', '6', '12']) {
    await page.locator(`[data-rebalance-months="${months}"]`).click();
    await expect(page.locator(`[data-rebalance-months="${months}"]`)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  }
  for (const cadence of ['weekly', 'biweekly', 'monthly', 'quarterly']) {
    await page.locator(`[data-rebalance-interval="${cadence}"]`).click();
    await expect(page.locator(`[data-rebalance-interval="${cadence}"]`)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  }
  await capture(page, info, 'rebalance', '#port-drift');
  await waitForSyncIdle(page);
  await page.reload();
  await waitForSyncIdle(page);
  await openTab(page, 'tab-portfolio');
  await expect(page.locator('[data-rebalance-interval="quarterly"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('contributions and income ranges, year filters, pagination and annual details', async ({
  page,
}, info) => {
  await seed(page);
  await openTab(page, 'tab-portfolio');
  await page.locator('#tab-contributions').click();
  await expect(page.locator('#dca-content')).toBeVisible();
  await capture(page, info, 'contributions', '#portfolio');
  for (const range of ['12', '36', 'all']) {
    await page.locator(`#dca-range-toggle [data-range="${range}"]`).click();
    await expect(page.locator(`#dca-range-toggle [data-range="${range}"]`)).toHaveClass(/active/);
  }
  await page.locator('#dca-pagination .js-page-next').click();
  await expect(page.locator('#dca-pagination .page-info')).toHaveText('2 / 4');
  await page.locator('#dca-year-filter').selectOption('2025');
  await expect(page.locator('#dca-table .tbl-row:not(.th)')).toHaveCount(13);
  for (const range of ['60', '120', '240', '360']) {
    await page.locator(`#dca-forecast-range-toggle [data-range="${range}"]`).click();
    await expect(page.locator(`#dca-forecast-range-toggle [data-range="${range}"]`)).toHaveClass(
      /active/,
    );
  }
  await page.locator('#tab-dividends').focus();
  await page.locator('#tab-dividends').press('Enter');
  await expect(page.locator('#div-content')).toBeVisible();
  await capture(page, info, 'dividends', '#portfolio');
  for (const prefix of ['div', 'int']) {
    await page.locator(`#${prefix}-pagination .js-page-next`).click();
    await expect(page.locator(`#${prefix}-pagination .page-info`)).toContainText('2 /');
    await page.locator(`#${prefix}-year-filter`).selectOption('2025');
    await expect(page.locator(`#${prefix}-year-filter`)).toHaveValue('2025');
  }
  const annual = page.locator('[data-annual-year]').first();
  await annual.focus();
  await annual.press('Enter');
  await expect(annual).toHaveAttribute('aria-expanded', 'true');
  await capture(page, info, 'income-annual-detail', '#portfolio');
});

test('single snapshot and missing or partial market valuations remain explicit', async ({
  page,
}, info) => {
  for (const state of ['single', 'partial', 'cost'] as const) {
    await seed(page, state);
    await capture(page, info, `networth-${state}`, '#networth');
    await openTab(page, 'tab-portfolio');
    if (state !== 'single') {
      await expect(page.locator('#port-drift')).toContainText(
        'purchase cost, not current market value',
      );
      await expect(page.locator('.rebalance-collapsible')).toHaveCount(0);
    }
    await capture(page, info, `holdings-${state}`, '#portfolio');
  }
});

test('everyday portfolio and Log and Settings design references', async ({ page }, info) => {
  await seed(page, 'everyday');
  await capture(page, info, 'everyday-networth', '#networth');
  await openTab(page, 'tab-portfolio');
  await capture(page, info, 'everyday-holdings', '#portfolio');
  for (const view of ['contributions', 'dividends']) {
    await page.locator(`#tab-${view}`).click();
    await capture(page, info, `everyday-${view}`, '#portfolio');
  }
  await openTab(page, 'tab-log');
  await capture(page, info, 'reference-log', '#log');
  await openTab(page, 'tab-settings');
  await page.locator('[data-settings-view="portfolio"]').click();
  await ensureCardExpanded(page, 'settings-card-accounts');
  await capture(page, info, 'reference-settings', '#settings');
});
