import { expect, test, type Page } from '@playwright/test';
import { openTab, waitForSyncIdle } from '../e2e/helpers';
import { capture, seed, useReviewPage } from './helpers';

useReviewPage();

async function openAnalytics(page: Page) {
  await openTab(page, 'tab-analytics');
  await expect(page.locator('#an-content')).toBeVisible();
}

async function openAdvanced(page: Page) {
  const advanced = page.locator('#an-advanced');
  if ((await advanced.getAttribute('open')) === null) await advanced.locator('> summary').click();
  await expect(advanced).toHaveAttribute('open', '');
}

async function cycleRanges(page: Page, toggle: string) {
  for (const range of ['12', '36', 'all']) {
    const button = page.locator(`#${toggle} [data-range="${range}"]`);
    await button.click();
    await expect(button).toHaveClass(/active/);
  }
}

test('empty analytics state and call to action', async ({ page }, info) => {
  await openTab(page, 'tab-analytics');
  await expect(page.locator('#an-empty')).toBeVisible();
  await capture(page, info, 'analytics-empty', '#analytics');
  await page.locator('#an-empty [data-goto="log"]').click();
  await expect(page.locator('#log')).toHaveClass(/active/);
});

test('overview KPIs, growth and flows charts, ranges, legends and data tables', async ({
  page,
}, info) => {
  await seed(page);
  await openAnalytics(page);
  await expect(page.locator('#an-kpis-l1 .kpi-val').first()).not.toHaveText('-');
  await capture(page, info, 'analytics-overview', '#analytics');
  const balance = page.locator('#an-balance-details');
  await expect(balance).not.toHaveAttribute('open');
  await balance.locator('summary').focus();
  await balance.locator('summary').press('Enter');
  await expect(page.locator('#an-kpis-l2')).toBeVisible();
  await capture(page, info, 'analytics-balance-details', '#analytics');
  await balance.locator('summary').press('Space');
  await expect(page.locator('#an-kpis-l2')).toBeHidden();

  await cycleRanges(page, 'an-growth-range-toggle');
  await cycleRanges(page, 'an-contrib-range-toggle');

  const legend = page.locator('#an-growth-legend [role="button"]').first();
  if (await legend.count()) {
    await legend.click();
    await expect(legend).toHaveAttribute('aria-pressed', 'true');
    await legend.click();
  }

  const tip = page.locator('#an-kpis-l1 .info-tip').first();
  await tip.scrollIntoViewIfNeeded();
  await tip.focus();
  await expect(page.locator('.info-tip-pop')).toBeVisible();
  await capture(page, info, 'analytics-kpi-tip', '#an-kpis-l1');
  await tip.blur();

  for (const wrap of ['#c-an-growth-table-wrap', '#c-an-contrib-table-wrap']) {
    const toggle = page.locator(`${wrap} .chart-data-table-toggle`);
    if (!(await toggle.count())) continue;
    await toggle.click();
    await expect(page.locator(`${wrap} table`)).toBeVisible();
  }
  await capture(page, info, 'analytics-chart-tables', '#analytics');
});

test('heatmap paging, annual returns and allocation toggles', async ({ page }, info) => {
  await seed(page);
  await openAnalytics(page);
  const heatmap = page.locator('#an-heatmap');
  await heatmap.scrollIntoViewIfNeeded();
  await capture(page, info, 'analytics-heatmap', '#an-level2');

  const pager = page.locator('#an-heatmap-pager');
  if (await pager.isVisible()) {
    const label = page.locator('#an-heatmap-page-label');
    const first = await label.textContent();
    await page.locator('#an-heatmap-prev').click();
    await expect(label).not.toHaveText(first || '');
    await capture(page, info, 'analytics-heatmap-older', '#an-level2');
    await page.locator('#an-heatmap-next').click();
    await expect(label).toHaveText(first || '');
  }
  await expect(page.locator('#an-annual-table')).not.toBeEmpty();

  for (const group of ['country', 'group', 'type', 'acct']) {
    const button = page.locator(`#an-alloc-acct-toggle-wrap [data-acct-group="${group}"]`);
    await expect(button).toBeVisible();
    await button.click();
    await expect(
      page.locator(`#an-alloc-acct-toggle-wrap [data-acct-group="${group}"]`),
    ).toHaveClass(/active/);
    if (group === 'country') await capture(page, info, 'analytics-alloc-country', '#an-level2');
  }
  const holdingAllocation = page.locator('#an-holding-allocation');
  await expect(holdingAllocation).not.toHaveAttribute('open');
  await holdingAllocation.locator('> summary').focus();
  await holdingAllocation.locator('> summary').press('Enter');
  await expect(holdingAllocation).toHaveAttribute('open', '');
  for (const dim of ['class', 'region']) {
    await expect(page.locator(`#an-alloc-${dim}-legend`)).not.toBeEmpty();
    const table = page.locator(`#c-an-alloc-${dim}-table-wrap`);
    await table.locator('.chart-data-table-toggle').click();
    await expect(table.locator('tbody tr').first()).toBeVisible();
    for (const mode of ['active', 'all']) {
      const button = page.locator(`[data-alloc-mode="${mode}"][data-alloc-dim="${dim}"]`);
      await expect(button).toBeVisible();
      await button.click();
      await expect(
        page.locator(`[data-alloc-mode="${mode}"][data-alloc-dim="${dim}"]`),
      ).toHaveClass(/active/);
    }
  }
  await capture(page, info, 'analytics-allocation', '#an-level2');
  await holdingAllocation.locator('> summary').click();
  await expect(holdingAllocation).not.toHaveAttribute('open');
});

test('advanced analytics, explainer, drawdown, rolling CAGR and income', async ({ page }, info) => {
  await seed(page);
  await openAnalytics(page);
  await capture(page, info, 'analytics-advanced-collapsed', '#an-advanced');
  await openAdvanced(page);
  await expect(page.locator('#an-kpis-risk .kpi-group-row').first()).toBeVisible();
  await expect(page.locator('#an-risk-metrics-note-card')).toBeHidden();
  await capture(page, info, 'analytics-advanced', '#an-advanced');
  for (const id of ['c-an-drawdown', 'c-an-rolling-cagr']) {
    await expect(page.locator(`#${id}`)).toBeVisible();
    const wrap = page.locator(`#${id}-table-wrap`);
    await wrap.locator('.chart-data-table-toggle').click();
    await expect(wrap.locator('tbody tr').first()).toBeVisible();
  }

  const explainer = page.locator('#an-metrics-explainer');
  if (await explainer.isVisible()) {
    await explainer.locator('> summary').click();
    await expect(explainer).toHaveAttribute('open', '');
    await capture(page, info, 'analytics-explainer', '#an-advanced');
    await explainer.locator('> summary').click();
  }

  if (await page.locator('#an-income').isVisible()) {
    await cycleRanges(page, 'an-income-range-toggle');
    const incomeTable = page.locator('#c-an-income-table-wrap .chart-data-table-toggle');
    if (await incomeTable.count()) {
      await incomeTable.click();
      await expect(page.locator('#c-an-income-table-wrap table')).toBeVisible();
    }
    await capture(page, info, 'analytics-income', '#an-income');
  }

  await waitForSyncIdle(page);
  await page.reload();
  await waitForSyncIdle(page);
  await openAnalytics(page);
  await capture(page, info, 'analytics-after-reload', '#analytics');
});

test('single snapshot and partial history keep locked metrics explicit', async ({ page }, info) => {
  for (const state of ['single', 'partial', 'cost'] as const) {
    await seed(page, state);
    await openAnalytics(page);
    await capture(page, info, `analytics-${state}`, '#analytics');
    await openAdvanced(page);
    if (state === 'single') {
      await expect(page.locator('#an-risk-metrics-note-card')).toBeVisible();
      await expect(page.locator('#an-kpis-risk')).toBeHidden();
    }
    await capture(page, info, `analytics-${state}-advanced`, '#an-advanced');
  }
});

test('everyday analytics overview and advanced', async ({ page }, info) => {
  await seed(page, 'everyday');
  await openAnalytics(page);
  const metrics = await capture(page, info, 'everyday-analytics', '#analytics');
  expect(metrics.clipped).toEqual([]);
  if (metrics.viewport.width === 320) expect(metrics.height).toBeLessThanOrEqual(2050);
  if (metrics.viewport.width === 390) expect(metrics.height).toBeLessThanOrEqual(2025);
  if (metrics.viewport.width >= 1280) expect(metrics.height).toBeLessThanOrEqual(2000);
  expect(metrics.controls.filter((control) => control.width < 24 || control.height < 24)).toEqual(
    [],
  );
  await openAdvanced(page);
  await capture(page, info, 'everyday-analytics-advanced', '#analytics');
});

test('gaps, no income and same-page data replacement preserve scope and fresh tables', async ({
  page,
}, info) => {
  await seed(page, 'gap');
  await openAnalytics(page);
  await openAdvanced(page);
  await expect(page.locator('#an-risk-metrics-note')).toContainText('gap period');
  await expect(page.locator('#an-kpis-risk')).toBeHidden();
  await capture(page, info, 'analytics-gap', '#analytics');
  await seed(page, 'no-income');
  await openAnalytics(page);
  await openAdvanced(page);
  await expect(page.locator('#an-income')).toBeHidden();
  await capture(page, info, 'analytics-no-income', '#analytics');
  await seed(page, 'everyday');
  await openAnalytics(page);
  await page.locator('#an-growth-range-toggle [data-range="12"]').click();
  await expect(page.locator('#c-an-growth-table-wrap')).toContainText('50.400');
  await expect(page.locator('#c-an-growth-table-wrap')).not.toContainText('100.700');
});
