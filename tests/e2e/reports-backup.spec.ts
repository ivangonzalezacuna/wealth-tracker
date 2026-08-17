import fs from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import {
  addAccount,
  addHolding,
  addSnapshot,
  ensureCardExpanded,
  gotoApp,
  importCsvFixture,
  monthOffsetValue,
  openTab,
  preparePage,
  saveHoldings,
  snapshotRow,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await preparePage(page);
});

test('annual report download and backup restore round-trip work', async ({ page }, testInfo) => {
  const month = monthOffsetValue(-1);

  await gotoApp(page);
  await addAccount(page, {
    label: 'Reporting Broker',
    institution: 'Trade Republic',
    annualReturnPct: 7,
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
    month,
    note: 'Report baseline',
    accountValues: { 'Reporting Broker': 1000 },
  });

  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-reports');
  await page.evaluate(() => {
    document.querySelector('#report-year-select')?.dispatchEvent(new Event('focus'));
  });
  await expect(page.locator('#report-year-select')).toBeEnabled();
  const reportDownloadPromise = page.waitForEvent('download');
  await page.click('#btn-download-report');
  const reportDownload = await reportDownloadPromise;
  const reportPath = testInfo.outputPath('annual-report.html');
  await reportDownload.saveAs(reportPath);
  const reportHtml = await fs.readFile(reportPath, 'utf-8');
  await expect(reportDownload.suggestedFilename()).toContain('wealth-tracker-report-');
  expect(reportHtml).toContain('Annual Portfolio Report');
  await expect(page.locator('#report-msg')).toContainText('downloaded');

  await ensureCardExpanded(page, 'settings-card-backup');
  const backupDownloadPromise = page.waitForEvent('download');
  await page.click('#btn-export-backup');
  const backupDownload = await backupDownloadPromise;
  const backupPath = testInfo.outputPath('backup.json');
  await backupDownload.saveAs(backupPath);
  await expect(page.locator('#backup-msg')).toContainText('Backup downloaded');

  await openTab(page, 'tab-log');
  await snapshotRow(page, month).click();
  await page.click('.snap-detail .js-del-snap');
  await page.click('.js-confirm-ok');
  await expect(snapshotRow(page, month)).toHaveCount(0);

  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-backup');
  await page.setInputFiles('#backup-file-input', backupPath);
  await page.click('.js-confirm-ok');
  await expect(page.locator('#backup-msg')).toContainText('Restore complete.');

  await openTab(page, 'tab-log');
  await expect(snapshotRow(page, month)).toHaveCount(1);
});
