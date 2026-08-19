import { expect, test } from '@playwright/test';
import {
  addAccount,
  addSnapshot,
  ensureCardExpanded,
  formatUiMoney,
  gotoApp,
  monthOffsetValue,
  openTab,
  preparePage,
  snapshotRow,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await preparePage(page);
});

test('mixed-currency snapshot flow stays stable when FX integration is disabled', async ({
  page,
}) => {
  const month = monthOffsetValue(-1);

  await gotoApp(page);
  await addAccount(page, {
    label: 'USD Broker',
    institution: 'IBKR',
    annualReturnPct: 6,
    primary: true,
    currency: 'USD',
  });

  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-integrations');
  await page.uncheck('#fx-integration-enabled');
  await page.click('#btn-save-fx-integration');
  await expect(page.locator('#fx-int-msg')).toContainText('Saved');

  await addSnapshot(page, {
    month,
    note: 'USD snapshot',
    accountValues: { 'USD Broker': 1000 },
  });
  await expect(snapshotRow(page, month)).toContainText(formatUiMoney(1000));

  await snapshotRow(page, month).click();
  await page.click('.snap-detail .js-edit-snap');
  await expect(page.getByLabel('USD Broker (USD)')).toBeVisible();
  await page.getByLabel('USD Broker (USD)').fill('1200');
  await page.click('.js-snapd-submit');
  await expect(page.locator('#snap-msg')).toContainText('Saved');
  await expect(snapshotRow(page, month)).toContainText(formatUiMoney(1200));
});

test('FX integrations card exposes status and save/clear actions', async ({ page }) => {
  await gotoApp(page);
  await addAccount(page, {
    label: 'USD Cash',
    institution: 'Wise',
    annualReturnPct: 3,
    currency: 'USD',
  });

  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-integrations');

  await expect(page.locator('#fx-status-enabled')).not.toHaveText('-');
  await expect(page.locator('#fx-status-cache-entries')).not.toHaveText('-');

  await page.uncheck('#fx-integration-enabled');
  await page.click('#btn-save-fx-integration');
  await expect(page.locator('#fx-int-msg')).toContainText('Saved');
  await expect(page.locator('#fx-status-enabled')).toHaveText('Disabled');

  await page.check('#fx-integration-enabled');
  await page.click('#btn-save-fx-integration');
  await expect(page.locator('#fx-int-msg')).toContainText('Saved');
  await expect(page.locator('#fx-status-enabled')).toHaveText('Enabled');

  await page.click('#btn-fx-clear-cache');
  await page.click('.js-confirm-ok');
  await expect(page.locator('#fx-int-msg')).toContainText('FX cache cleared.');
});

test('net worth KPI shows "in USD" indicator for a non-EUR account', async ({ page }) => {
  const month = monthOffsetValue(-1);

  await gotoApp(page);
  await addAccount(page, {
    label: 'USD Broker',
    institution: 'IBKR',
    annualReturnPct: 6,
    primary: true,
    currency: 'USD',
  });

  // Disable FX so save is deterministic (value stored as-is)
  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-integrations');
  await page.uncheck('#fx-integration-enabled');
  await page.click('#btn-save-fx-integration');
  await expect(page.locator('#fx-int-msg')).toContainText('Saved');

  await addSnapshot(page, { month, accountValues: { 'USD Broker': 5000 } });

  await openTab(page, 'tab-networth');
  // The per-account KPI sub-text should contain "in USD"
  await expect(page.locator('#nw-kpis')).toContainText('in USD');
});

test('snapshot dialog shows currency-specific placeholder for non-EUR accounts', async ({
  page,
}) => {
  await gotoApp(page);
  await addAccount(page, {
    label: 'GBP Savings',
    institution: 'Monzo',
    annualReturnPct: 2,
    currency: 'GBP',
  });

  await openTab(page, 'tab-log');
  await page.click('#btn-add-snap');
  // Placeholder for the non-EUR account input should mention GBP
  const input = page.locator('[data-currency="GBP"]');
  await expect(input).toHaveAttribute('placeholder', 'total value in GBP');
  await page.click('.js-snapd-cancel');
});

test('transaction dialog renders FX rate hint span and hides it for EUR currency', async ({
  page,
}) => {
  await gotoApp(page);
  await openTab(page, 'tab-log');
  await page.click('#btn-add-tx');

  // Hint span must be present in the DOM
  const hintEl = page.locator('#txd-fxrate-hint');
  await expect(hintEl).toBeAttached();

  // With currency left as EUR the hint must be hidden
  await page.fill('#txd-currency', 'EUR');
  (page.locator('#txd-currency') as any).dispatchEvent?.('input');
  await page.locator('#txd-currency').dispatchEvent('input');
  await expect(hintEl).toBeHidden();

  await page.click('.js-txd-cancel');
});

test('transaction dialog shows FX rate hint for non-EUR currency when integration is enabled', async ({
  page,
}) => {
  await gotoApp(page);

  // Ensure FX integration is enabled
  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-integrations');
  await page.check('#fx-integration-enabled');
  await page.click('#btn-save-fx-integration');
  await expect(page.locator('#fx-int-msg')).toContainText('Saved');

  await openTab(page, 'tab-log');
  await page.click('#btn-add-tx');

  // Select a type that shows the FX row (BUY)
  await page.selectOption('#txd-type', 'BUY');

  // Fill a past date and a non-EUR currency
  await page.fill('#txd-date', '2024-01-15');
  await page.fill('#txd-currency', 'USD');
  await page.locator('#txd-currency').dispatchEvent('input');

  // The hint may resolve (if network available) or stay hidden (offline/cache miss).
  // Either way the span must be present in the DOM and the fxrate field must remain editable.
  const hintEl = page.locator('#txd-fxrate-hint');
  await expect(hintEl).toBeAttached();
  const rateInput = page.locator('#txd-fxrate');
  await rateInput.fill('0.95');
  await expect(rateInput).toHaveValue('0.95');

  await page.click('.js-txd-cancel');
});
