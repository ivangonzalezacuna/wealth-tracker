import fs from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { ensureCardExpanded, gotoApp, preparePage, waitForSyncIdle, expectToast } from './helpers';

test.beforeEach(async ({ page }) => {
  await preparePage(page);
  await gotoApp(page);
});

test('property register persists, backs up and restores without creating financial data', async ({
  page,
}, testInfo) => {
  await expect(page.locator('#nw-properties')).toBeHidden();
  await page.click('#tab-settings');
  await ensureCardExpanded(page, 'settings-card-properties');
  await page.click('#btn-add-property');
  await expect(page.locator('#property-mortgage')).toHaveValue('unknown');
  await page.fill('#property-name', 'Shared home');
  await page.fill('#property-value', '420000');
  await page.fill('#property-share', '50');
  await page.selectOption('#property-mortgage', 'known');
  await page.fill('#property-debt', '140000');
  await expect(page.locator('#property-preview')).toContainText('70.000');
  await page.click('.js-property-save');
  await expect(page.locator('.property-dialog-overlay')).toHaveCount(0);
  await expect(page.locator('#settings-card-properties')).toContainText('Shared home');
  await waitForSyncIdle(page);
  await page.reload();
  await page.click('#tab-networth');
  await expect(page.locator('#nw-properties')).toBeVisible();
  await expect(page.locator('#nw-content')).toBeHidden();
  await expect(page.locator('#nw-empty')).toBeVisible();
  await page.locator('#nw-properties summary').click();
  await expect(page.locator('#nw-properties')).toContainText('70.000');
  await page.locator('#nw-properties a').click();
  await ensureCardExpanded(page, 'settings-card-properties');
  await page.getByRole('button', { name: 'Edit Shared home', exact: true }).click();
  await page.fill('#property-debt', '130000');
  await page.click('.js-property-save');
  await expect(page.locator('.property-dialog-overlay')).toHaveCount(0);
  await expect(page.locator('#settings-card-properties')).toContainText('80.000');

  await ensureCardExpanded(page, 'settings-card-backup');
  const downloadPromise = page.waitForEvent('download');
  await page.click('#btn-export-backup');
  const download = await downloadPromise;
  const backupPath = testInfo.outputPath('properties-backup.json');
  await download.saveAs(backupPath);
  const backup = JSON.parse(await fs.readFile(backupPath, 'utf8'));
  expect(backup.data.accounts).toEqual([]);
  expect(backup.data.snapshots).toEqual([]);
  expect(backup.data.transactions).toEqual([]);
  expect(JSON.parse(backup.data.settings.property_register).properties[0].debt).toBe(130000);
  await ensureCardExpanded(page, 'settings-card-properties');
  await page.getByRole('button', { name: 'Remove Shared home', exact: true }).click();
  await page.click('.js-confirm-ok');
  await expect(page.locator('#settings-card-properties')).toContainText('No properties yet');
  await page.click('#tab-networth');
  await expect(page.locator('#nw-properties')).toBeHidden();
  await page.click('#tab-settings');
  await ensureCardExpanded(page, 'settings-card-backup');
  await page.setInputFiles('#backup-file-input', backupPath);
  await page.click('.js-confirm-ok');
  await expectToast(page, 'backup-msg', 'Restore complete.');
  await page.click('#tab-networth');
  await expect(page.locator('#nw-properties')).toBeVisible();
  await page.locator('#nw-properties summary').click();
  await expect(page.locator('#nw-properties')).toContainText('80.000');
});

test('property dialog and summary fit a phone and allow unknown debt', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('#tab-settings');
  await ensureCardExpanded(page, 'settings-card-properties');
  await page.click('#btn-add-property');
  await page.fill('#property-name', 'Inherited home');
  await page.fill('#property-value', '360000');
  await page.fill('#property-share', '33.333333333333336');
  await page.selectOption('#property-use', 'Inherited property');
  await expect(page.locator('#property-preview')).toContainText('Not calculated yet');
  expect(
    await page
      .locator('.property-dialog-overlay .dialog-card')
      .evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  await page.click('.js-property-save');
  await expect(page.locator('.property-dialog-overlay')).toHaveCount(0);
  await page.click('#tab-networth');
  await page.locator('#nw-properties summary').click();
  await expect(page.locator('#nw-properties')).toContainText('Mortgage details missing');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
