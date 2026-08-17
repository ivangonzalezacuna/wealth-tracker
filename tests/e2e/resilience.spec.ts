import { expect, test } from '@playwright/test';
import {
  CSV_FIXTURE,
  gotoApp,
  openTab,
  preparePage,
  txRow,
  formatUiDay,
  dayOffsetValue,
  addManualTransaction,
  ensureCardExpanded,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await preparePage(page);
});

test('validation, cancellation, duplicate re-import, and sync-related recovery flows behave safely', async ({
  page,
  context,
}) => {
  await gotoApp(page);

  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-holdings');
  await page.click('#btn-add-hold');
  await page.click('.js-holdd-submit');
  await expect(page.locator('#holdd-isin-err')).toContainText('ISIN is required');
  await expect(page.locator('#holdd-short-name-err')).toContainText('Short name is required');
  await page.click('.js-holdd-cancel');
  await expect(page.locator('.hold-dialog-overlay')).toHaveCount(0);

  await openTab(page, 'tab-log');
  await page.setInputFiles('#csv-file-input', CSV_FIXTURE);
  await expect(page.locator('#btn-confirm-import')).toBeVisible();
  await page.click('#btn-cancel-import');
  await expect(page.locator('#import-msg')).toContainText('Import cancelled');

  await page.setInputFiles('#csv-file-input', []);
  await page.setInputFiles('#csv-file-input', CSV_FIXTURE);
  await expect(page.locator('#btn-confirm-import')).toBeVisible();
  await page.click('#btn-confirm-import');
  await expect(page.locator('#import-msg')).toContainText('Imported 1 row');
  const txRowsAfterFirstImport = await page.locator('#tx-ledger-list .tx-row').count();
  expect(txRowsAfterFirstImport).toBeGreaterThan(0);

  await page.setInputFiles('#csv-file-input', []);
  await page.setInputFiles('#csv-file-input', CSV_FIXTURE);
  await expect(page.locator('#btn-confirm-import')).toBeVisible();
  await page.click('#btn-confirm-import');
  await expect(page.locator('#import-msg')).toContainText('Imported 1 row');
  await expect(page.locator('#tx-ledger-list .tx-row')).toHaveCount(txRowsAfterFirstImport);

  const txDate = dayOffsetValue(-3);
  await addManualTransaction(page, { date: txDate, amount: '10', note: 'temporary tx' });
  await txRow(page, formatUiDay(txDate)).locator('.tx-actions-desktop .js-edit-tx').click();
  await page.fill('#txd-note', 'this should be cancelled');
  await page.click('.js-txd-cancel');
  await expect(txRow(page, formatUiDay(txDate))).toContainText('manual');
  await expect(txRow(page, formatUiDay(txDate))).not.toContainText('this should be cancelled');

  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-cache');
  await context.setOffline(true);
  await page.click('#btn-force-resync');
  await expect(page.locator('#resync-msg')).toContainText('Unavailable offline');
  await context.setOffline(false);
});
