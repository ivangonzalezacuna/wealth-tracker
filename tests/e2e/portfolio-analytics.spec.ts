import { expect, test } from '@playwright/test';
import {
  addAccount,
  addHolding,
  addSnapshot,
  formatUiMoney,
  gotoApp,
  importCsvFixture,
  monthOffsetValue,
  openTab,
  preparePage,
  saveHoldings,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await preparePage(page);
});

test('portfolio and analytics surfaces core data points from imported and snapshot data', async ({
  page,
}) => {
  const firstMonth = monthOffsetValue(-1);
  const secondMonth = monthOffsetValue(0);

  await gotoApp(page);
  await addAccount(page, {
    label: 'Primary Broker',
    institution: 'Trade Republic',
    annualReturnPct: 6.5,
    primary: true,
  });
  await addHolding(page, {
    isin: 'IE00B4L5Y983',
    shortName: 'IWDA',
    name: 'MSCI World ETF',
    targetPct: 100,
    ter: 0.2,
  });
  await saveHoldings(page);
  await importCsvFixture(page);
  await addSnapshot(page, {
    month: firstMonth,
    note: 'Post-buy snapshot',
    accountValues: { 'Primary Broker': 100 },
  });
  await addSnapshot(page, {
    month: secondMonth,
    note: 'Growth snapshot',
    accountValues: { 'Primary Broker': 120 },
  });

  await openTab(page, 'tab-portfolio');
  await expect(page.locator('#port-content')).toBeVisible();
  await expect(page.locator('#port-table')).toContainText('IWDA');
  await expect(page.locator('#port-table')).toContainText(formatUiMoney(100));
  await expect(page.locator('#port-kpis')).toContainText('Annual fee drag');
  await expect(page.locator('#c-port-donut-table-wrap')).toContainText('IWDA');

  await openTab(page, 'tab-analytics');
  await expect(page.locator('#an-content')).toBeVisible();
  await expect(page.locator('#an-kpis-l1')).toContainText('Total Return');
  await expect(page.locator('#an-kpis-l1')).toContainText(formatUiMoney(20));
  await expect(page.locator('#c-an-growth-table-wrap')).not.toBeEmpty();
});
