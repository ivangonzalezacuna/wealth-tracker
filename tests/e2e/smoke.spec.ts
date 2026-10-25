import { expect, test } from '@playwright/test';
import {
  CSV_FIXTURE,
  INVALID_DATE_CSV_FIXTURE,
  addSnapshot,
  gotoApp,
  monthOffsetValue,
  openCsvImportPreview,
  openTab,
  preparePage,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await preparePage(page);
});

test('app loads and core tabs are visible', async ({ page }) => {
  await gotoApp(page);
  await expect(page.locator('#tab-networth')).toBeVisible();
  await expect(page.locator('#tab-portfolio')).toBeVisible();
  await expect(page.locator('#tab-analytics')).toBeVisible();
  await expect(page.locator('#tab-settings')).toBeVisible();
  await expect(page.locator('#tab-log')).toBeVisible();
});

test('monthly snapshot flow saves and surfaces success state', async ({ page }) => {
  await gotoApp(page);
  await addSnapshot(page, { month: monthOffsetValue(-1), note: 'Smoke snapshot' });
  await expect(page.locator('#snap-msg')).toContainText('Saved');
});

test('analytics tab renders after adding a snapshot', async ({ page }) => {
  await gotoApp(page);
  await addSnapshot(page, { month: monthOffsetValue(-1), note: 'Analytics smoke snapshot' });
  await openTab(page, 'tab-analytics');
  await expect(page.locator('#an-content')).toBeVisible();
});

test('csv import flow supports preview exclusion before confirm', async ({ page }) => {
  await gotoApp(page);
  await openCsvImportPreview(page, CSV_FIXTURE);
  await expect(page.locator('#import-preview-meta')).toContainText('1 new');
  await expect(page.locator('#tx-ledger-card')).toBeHidden();
  const include = page.locator('#import-preview-list .js-import-include').first();
  await include.uncheck();
  await expect(page.locator('#btn-confirm-import')).toBeDisabled();
  await include.check();
  await expect(page.locator('#btn-confirm-import')).toHaveText('Import 1 transaction');
  await page.click('#btn-confirm-import');
  await expect(page.locator('#import-msg')).toContainText('Imported 1 new transaction');
  await expect(page.locator('#import-preview')).toBeHidden();
  await expect(page.locator('#tx-ledger-card')).toBeVisible();
});

test('csv import surfaces invalid-date recovery state', async ({ page }) => {
  await gotoApp(page);
  await openCsvImportPreview(page, INVALID_DATE_CSV_FIXTURE);
  await expect(page.locator('#import-date-warn')).toContainText('unreadable date');
  await expect(page.locator('#btn-confirm-import')).toHaveText('Import 1 transaction');
  await page.click('#btn-dismiss-date-warn');
  await expect(page.locator('#import-date-warn')).toHaveCount(0);
});
