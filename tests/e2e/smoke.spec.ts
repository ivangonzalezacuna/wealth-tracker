import { expect, test } from '@playwright/test';
import {
  CSV_FIXTURE,
  INVALID_DATE_CSV_FIXTURE,
  addSnapshot,
  gotoApp,
  monthOffsetValue,
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
  await openTab(page, 'tab-log');
  await page.setInputFiles('#csv-file-input', CSV_FIXTURE);
  await expect(page.locator('#btn-confirm-import')).toBeVisible();
  await expect(page.locator('text=rows parsed')).toBeVisible();
  await page.locator('[data-toggle-exclude="1"]').first().click();
  await expect(page.locator('#btn-confirm-import')).toContainText('Confirm import (1)');
  await page.click('#btn-confirm-import');
  await expect(page.locator('#import-msg')).toContainText('Imported');
});

test('csv import surfaces invalid-date recovery state', async ({ page }) => {
  await gotoApp(page);
  await openTab(page, 'tab-log');
  await page.setInputFiles('#csv-file-input', INVALID_DATE_CSV_FIXTURE);
  await expect(page.locator('#import-date-warn')).toContainText('skipped due to invalid date');
  await expect(page.locator('#btn-confirm-import')).toContainText('Confirm import (1)');
  await page.click('#btn-dismiss-date-warn');
  await expect(page.locator('#import-date-warn')).toHaveCount(0);
});
