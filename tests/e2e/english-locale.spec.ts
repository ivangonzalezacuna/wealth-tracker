import { expect, test } from '@playwright/test';
import {
  addManualTransaction,
  addSnapshot,
  formatUiMoney,
  gotoApp,
  preparePage,
  snapshotRow,
  txRow,
  waitForSyncIdle,
} from './helpers';

for (const locale of ['de-DE', 'es-ES']) {
  test.describe(`English application UI with ${locale} browser preferences`, () => {
    test.use({ locale });

    test('keeps English formatting and preserves native date/month values', async ({ page }) => {
      await preparePage(page);
      await gotoApp(page);
      expect(await page.evaluate(() => navigator.language)).toBe(locale);
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');

      const relativeDate = await page.evaluate(async () => {
        const { relativeTime } = await import('/src/ui/headerStatus.ts');
        const at = new Date(2024, 4, 10, 12).getTime();
        return relativeTime(at, at + 48 * 3_600_000);
      });
      expect(relativeDate).toBe('10 May');

      await addSnapshot(page, { month: '2024-05', note: 'Locale regression' });
      await expect(snapshotRow(page, '2024-05')).toContainText('May 2024');
      await snapshotRow(page, '2024-05').click();
      await waitForSyncIdle(page);
      await page.click('.snap-detail .js-edit-snap');
      await expect(page.locator('#snapd-date')).toHaveValue('2024-05');
      await page.click('.js-snapd-cancel');

      await page.click('#log-tab-transactions');
      await addManualTransaction(page, {
        date: '2024-05-10',
        amount: '1234.50',
        note: 'Locale regression',
      });
      const row = txRow(page, '10 May 2024');
      await expect(row).toContainText('10 May 2024');
      await expect(row).toContainText(formatUiMoney(1234.5));
      await waitForSyncIdle(page);
      await row.locator('.tx-actions-desktop .js-edit-tx').click();
      await expect(page.locator('#txd-date')).toHaveValue('2024-05-10');
      await page.click('.js-txd-cancel');
      await page.reload();
      await page.click('#log-tab-snapshots');
      await expect(snapshotRow(page, '2024-05')).toContainText('May 2024');
      await page.click('#log-tab-transactions');
      await expect(txRow(page, '10 May 2024')).toContainText(formatUiMoney(1234.5));
    });
  });
}
