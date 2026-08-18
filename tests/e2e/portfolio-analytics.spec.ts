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

test('account allocation donut shows correct labels when switching to By country', async ({
  page,
}) => {
  const firstMonth = monthOffsetValue(-2);
  const secondMonth = monthOffsetValue(-1);

  await gotoApp(page);
  await addAccount(page, {
    label: 'German Account',
    institution: 'DKB',
    annualReturnPct: 5,
    primary: true,
    country: 'Germany',
  });
  await addAccount(page, {
    label: 'Irish Account',
    institution: 'DEGIRO',
    annualReturnPct: 6,
    country: 'Ireland',
  });
  // Two snapshots are required for the analytics allocation section to render
  await addSnapshot(page, {
    month: firstMonth,
    accountValues: { 'German Account': 7500, 'Irish Account': 1800 },
  });
  await addSnapshot(page, {
    month: secondMonth,
    accountValues: { 'German Account': 8000, 'Irish Account': 2000 },
  });

  await openTab(page, 'tab-analytics');
  await expect(page.locator('#an-content')).toBeVisible();

  // Default "By account" shows account names
  await expect(page.locator('#c-an-alloc-acct-table-wrap')).toContainText('German Account');

  // Switch to "By country" — table should show country names instead
  await page.locator('#an-alloc-acct-toggle-wrap [data-acct-group="country"]').click();
  await expect(page.locator('#c-an-alloc-acct-table-wrap')).toContainText('Germany');
  await expect(page.locator('#c-an-alloc-acct-table-wrap')).toContainText('Ireland');
  await expect(page.locator('#c-an-alloc-acct-table-wrap')).not.toContainText('German Account');
});

test('account allocation donut shows correct labels when switching to By group', async ({
  page,
}) => {
  const firstMonth = monthOffsetValue(-2);
  const secondMonth = monthOffsetValue(-1);

  await gotoApp(page);
  await addAccount(page, {
    label: 'Pension Fund',
    institution: 'Vanguard',
    annualReturnPct: 6,
    primary: true,
    group: 'Retirement',
  });
  await addAccount(page, {
    label: 'Trading Account',
    institution: 'IBKR',
    annualReturnPct: 8,
    group: 'Active',
  });
  // Two snapshots are required for the analytics allocation section to render
  await addSnapshot(page, {
    month: firstMonth,
    accountValues: { 'Pension Fund': 14000, 'Trading Account': 4500 },
  });
  await addSnapshot(page, {
    month: secondMonth,
    accountValues: { 'Pension Fund': 15000, 'Trading Account': 5000 },
  });

  await openTab(page, 'tab-analytics');
  await expect(page.locator('#an-content')).toBeVisible();

  // Switch to "By group" — table should show group names
  await page.locator('#an-alloc-acct-toggle-wrap [data-acct-group="group"]').click();
  await expect(page.locator('#c-an-alloc-acct-table-wrap')).toContainText('Retirement');
  await expect(page.locator('#c-an-alloc-acct-table-wrap')).toContainText('Active');
  await expect(page.locator('#c-an-alloc-acct-table-wrap')).not.toContainText('Pension Fund');
});
