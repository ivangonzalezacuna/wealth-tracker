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
  expectToast,
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
  await page.locator('[data-settings-view="advanced"]').click();
  const reports = page.locator('#settings-heading-reports');
  if ((await reports.getAttribute('aria-expanded')) !== 'true') await reports.press('Enter');
  await expect(page.locator('#report-year-select')).toBeEnabled();
  const reportDownloadPromise = page.waitForEvent('download');
  await page.click('#btn-download-report');
  const reportDownload = await reportDownloadPromise;
  const reportPath = testInfo.outputPath('annual-report.html');
  await reportDownload.saveAs(reportPath);
  const reportHtml = await fs.readFile(reportPath, 'utf-8');
  await expect(reportDownload.suggestedFilename()).toContain('wealth-tracker-report-');
  expect(reportHtml).toContain('Annual Portfolio Report');
  await expectToast(page, 'report-msg', 'downloaded');
  const report = await page.context().newPage();
  await report.setContent(reportHtml);
  for (const width of [320, 390, 768, 1280]) {
    await report.setViewportSize({ width, height: 900 });
    expect(
      await report.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await expect(report.locator('.report-table-scroll').first()).toHaveAttribute('tabindex', '0');
    if (width < 600) {
      await expect(report.locator('.report-table-hint').first()).toBeVisible();
      expect(
        await report
          .getByRole('region', { name: 'Holdings table', exact: true })
          .evaluate((el) => el.scrollWidth > el.clientWidth),
      ).toBe(true);
    }
  }
  await report.emulateMedia({ media: 'print' });
  await expect(report.locator('.report-table-scroll').first()).toHaveCSS('overflow-x', 'visible');
  await expect(report.locator('.report-table-hint').first()).toBeHidden();
  await report.close();

  await ensureCardExpanded(page, 'settings-card-backup');
  const backupDownloadPromise = page.waitForEvent('download');
  await page.click('#btn-export-backup');
  const backupDownload = await backupDownloadPromise;
  const backupPath = testInfo.outputPath('backup.json');
  await backupDownload.saveAs(backupPath);
  await expectToast(page, 'backup-msg', 'Backup downloaded.');

  await openTab(page, 'tab-log');
  await snapshotRow(page, month).click();
  await page.click('.snap-detail .js-del-snap');
  await page.click('.js-confirm-ok');
  await expect(snapshotRow(page, month)).toHaveCount(0);

  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-backup');
  await page.setInputFiles('#backup-file-input', backupPath);
  await page.click('.js-confirm-ok');
  await expectToast(page, 'backup-msg', 'Restore complete.');

  await openTab(page, 'tab-log');
  await expect(snapshotRow(page, month)).toHaveCount(1);
});
