import { expect, test } from '@playwright/test';
import { syntheticPdf } from './fixtures/pdfStatement';
import {
  addAccount,
  ensureCardExpanded,
  gotoApp,
  openTab,
  preparePage,
  snapshotRow,
  waitForSyncIdle,
} from './helpers';

test('actual local PDF worker previews, cancels and confirms through the snapshot save path', async ({
  page,
}) => {
  await preparePage(page);
  await gotoApp(page);
  await addAccount(page, { label: 'PDF Broker', primary: true });
  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-accounts');
  await page.click('#btn-add-acct');
  await page.fill('#acctd-label', 'PDF Cash');
  await page.selectOption('#acctd-type', 'cash');
  await page.click('.js-acctd-submit');
  await page.click('#btn-save-accts');
  await expect(page.locator('#accts-msg')).toContainText('Saved');
  await openTab(page, 'tab-log');
  await waitForSyncIdle(page);
  await page.click('#btn-pdf-snap');
  const requests: string[] = [];
  const workers: string[] = [];
  page.on('worker', (worker) => workers.push(worker.url()));
  page.on('request', (request) => {
    requests.push(request.url() + (request.postData() || ''));
  });
  const file = {
    name: 'SYNTHETIC-PRIVATE.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(syntheticPdf()),
  };
  await page.setInputFiles('#pdf-file', file);
  await expect(page.locator('#pdf-status')).toContainText('Valuation date 2026-09-30');
  expect(workers.some((url) => url.includes('pdf.worker'))).toBe(true);
  expect(
    workers.every((url) => new URL(url, page.url()).origin === new URL(page.url()).origin),
  ).toBe(true);
  await page.selectOption('#pdf-cash', { label: 'PDF Cash' });
  await page.selectOption('#pdf-investment', { label: 'PDF Broker' });
  await page.click('#pdf-review');
  await expect(page.locator('#pdf-confirm')).toBeDisabled();
  await page.locator('#pdf-unknown input').check();
  await page.click('#pdf-review');
  await expect(page.locator('#pdf-confirm')).toBeEnabled();
  await expect(snapshotRow(page, '2026-09')).toHaveCount(0);
  expect(requests.some((r) => /SYNTHETIC-PRIVATE|DE0000000016|1334\.56|1234\.56/.test(r))).toBe(
    false,
  );
  expect(requests.some((r) => r.includes('frankfurter'))).toBe(false);
  await page.click('#pdf-cancel');
  await expect(snapshotRow(page, '2026-09')).toHaveCount(0);
  await page.click('#btn-pdf-snap');
  await page.setInputFiles('#pdf-file', file);
  await expect(page.locator('#pdf-status')).toContainText('Valuation date');
  await page.selectOption('#pdf-cash', { label: 'PDF Cash' });
  await page.selectOption('#pdf-investment', { label: 'PDF Broker' });
  await page.locator('#pdf-unknown input').check();
  await page.click('#pdf-review');
  await page.click('#pdf-confirm');
  await expect(page.locator('#snap-msg')).toContainText('Saved');
  await expect(snapshotRow(page, '2026-09')).toContainText('1.334,56');
  await waitForSyncIdle(page);
  await page.click('#btn-pdf-snap');
  await page.setInputFiles('#pdf-file', {
    name: 'bad.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('not a PDF'),
  });
  await expect(page.locator('#pdf-status')).toContainText('Unsupported or incomplete PDF');
  await expect(page.locator('#pdf-confirm')).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.click('#btn-add-snap');
  await expect(page.locator('.snap-dialog-overlay')).toBeVisible();
  await page.keyboard.press('Escape');
});
