import { expect, test } from '@playwright/test';
import {
  addAccount,
  addManualTransaction,
  addSnapshot,
  dayOffsetValue,
  gotoApp,
  importCsvFixture,
  monthOffsetValue,
  openTab,
  preparePage,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await preparePage(page);
});

test('transaction type filter narrows displayed rows', async ({ page }) => {
  test.setTimeout(60_000);
  const date1 = dayOffsetValue(-10);
  const date2 = dayOffsetValue(-5);

  await gotoApp(page);
  await addManualTransaction(page, { date: date1, type: 'INTEREST', amount: '10', note: 'Int' });

  // For DIVIDEND, the dialog requires a security name
  await openTab(page, 'tab-log');
  await page.click('#btn-add-tx');
  await page.fill('#txd-date', date2);
  await page.selectOption('#txd-type', 'DIVIDEND');
  await page.fill('#txd-name', 'Test ETF');
  await page.fill('#txd-amount', '5');
  await page.click('.js-txd-submit');
  await expect(page.locator('#tx-msg')).toContainText('Transaction');

  // Switch away and back to ensure full list render with filter options
  await openTab(page, 'tab-networth');
  await openTab(page, 'tab-log');
  // Wait for type filter options to be populated
  await expect(page.locator('#tx-type-filter option[value="INTEREST"]')).toBeAttached();
  // Filter to INTEREST only
  await page.selectOption('#tx-type-filter', 'INTEREST');
  await expect(page.locator('#tx-ledger-list .tx-row:not(.th)')).toHaveCount(1);

  // Filter to DIVIDEND only
  await page.selectOption('#tx-type-filter', 'DIVIDEND');
  await expect(page.locator('#tx-ledger-list .tx-row:not(.th)')).toHaveCount(1);

  // Reset to all
  await page.selectOption('#tx-type-filter', '');
  await expect(page.locator('#tx-ledger-list .tx-row:not(.th)')).toHaveCount(2);
});

test('transaction search filters by type text', async ({ page }) => {
  await gotoApp(page);
  await addManualTransaction(page, { date: dayOffsetValue(-10), amount: '10', note: 'First' });

  // Switch away and back to ensure full list render
  await openTab(page, 'tab-networth');
  await openTab(page, 'tab-log');
  await expect(page.locator('#tx-ledger-list .tx-row:not(.th)')).toHaveCount(1);

  // Search by "interest" (type field, case-insensitive)
  await page.fill('#tx-search', 'interest');
  await expect(page.locator('#tx-ledger-list .tx-row:not(.th)')).toHaveCount(1);

  // Search for something that doesn't match
  await page.fill('#tx-search', 'nonexistent_xyz');
  await expect(page.locator('#tx-ledger-list .tx-row:not(.th)')).toHaveCount(0);

  // Clear filter restores rows
  await page.fill('#tx-search', '');
  await expect(page.locator('#tx-ledger-list .tx-row:not(.th)')).toHaveCount(1);
});

test('portfolio sub-view tabs switch correctly', async ({ page }) => {
  await gotoApp(page);
  await addAccount(page, {
    label: 'Broker',
    institution: 'TR',
    annualReturnPct: 7,
    primary: true,
  });
  await importCsvFixture(page);
  await addSnapshot(page, {
    month: monthOffsetValue(-1),
    note: 'Nav test',
    accountValues: { Broker: 100 },
  });

  await openTab(page, 'tab-portfolio');
  // Default: holdings
  await expect(page.locator('#subview-holdings')).toBeVisible();
  await expect(page.locator('#subview-contributions')).not.toBeVisible();

  // Switch to contributions
  await page.click('#tab-contributions');
  await expect(page.locator('#subview-contributions')).toBeVisible();
  await expect(page.locator('#subview-holdings')).not.toBeVisible();

  // Switch to dividends
  await page.click('#tab-dividends');
  await expect(page.locator('#subview-dividends')).toBeVisible();
  await expect(page.locator('#subview-contributions')).not.toBeVisible();

  // Back to holdings
  await page.click('#tab-holdings');
  await expect(page.locator('#subview-holdings')).toBeVisible();
});

test('net worth range toggles are interactive', async ({ page }) => {
  await gotoApp(page);
  await addAccount(page, {
    label: 'Broker',
    institution: 'TR',
    annualReturnPct: 7,
    primary: true,
  });
  await addSnapshot(page, {
    month: monthOffsetValue(-1),
    note: 'Range test',
    accountValues: { Broker: 1000 },
  });

  await openTab(page, 'tab-networth');
  await expect(page.locator('#nw-range-toggle')).toBeVisible();

  // Click 1Y button
  await page.locator('#nw-range-toggle [data-range="12"]').click();
  await expect(page.locator('#nw-range-toggle [data-range="12"]')).toHaveClass(/active/);

  // Click 3Y button
  await page.locator('#nw-range-toggle [data-range="36"]').click();
  await expect(page.locator('#nw-range-toggle [data-range="36"]')).toHaveClass(/active/);

  // Click All button
  await page.locator('#nw-range-toggle [data-range="all"]').click();
  await expect(page.locator('#nw-range-toggle [data-range="all"]')).toHaveClass(/active/);
});
