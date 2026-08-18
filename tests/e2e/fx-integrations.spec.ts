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

test('FX integrations card exposes status and user-triggered actions', async ({ page }) => {
  await gotoApp(page);
  await addAccount(page, {
    label: 'USD Cash',
    institution: 'Wise',
    annualReturnPct: 3,
    currency: 'USD',
  });

  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-integrations');

  await page.click('#btn-fx-refresh-status');
  await expect(page.locator('#fx-int-msg')).toContainText('Status refreshed.');
  await expect(page.locator('#fx-status-cache-entries')).not.toHaveText('-');

  await page.click('#btn-fx-warm-cache');
  await expect(page.locator('#fx-int-msg')).toContainText('month-end FX rates');

  await page.click('#btn-fx-clear-cache');
  await page.click('.js-confirm-ok');
  await expect(page.locator('#fx-int-msg')).toContainText('FX cache cleared.');
});
