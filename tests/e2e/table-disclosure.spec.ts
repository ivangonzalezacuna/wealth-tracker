import { test, expect, type Locator } from '@playwright/test';
import { chartBackup } from './fixtures/chartBackup';
import { preparePage, gotoApp, openTab, ensureCardExpanded, waitForSyncIdle } from './helpers';

test.beforeEach(async ({ page }) => {
  await preparePage(page);
  await gotoApp(page);
  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-backup');
  await page.locator('#backup-file-input').setInputFiles({
    name: 'disclosure-fixture.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(chartBackup())),
  });
  await page.locator('.js-confirm-ok').click();
  await expect(page.locator('.toast-text').last()).toContainText('Restore complete.');
  await waitForSyncIdle(page);
  await page.getByRole('button', { name: 'Dismiss notification' }).click();
});

const tables = [
  {
    name: 'holdings',
    hash: '#portfolio',
    row: '#port-table .hold-row:not(.th)',
    detail: '#port-table .hold-detail',
  },
  {
    name: 'snapshots',
    hash: '#log/snapshots',
    row: '#snaps-list .snap-row-compact:not(.th)',
    detail: '#snaps-list .snap-detail',
  },
  {
    name: 'transactions',
    hash: '#log',
    row: '#tx-ledger-list .tx-row:not(.th)',
    detail: '#tx-ledger-list .tx-detail',
  },
  {
    name: 'by-year',
    hash: '#portfolio/dividends',
    row: '#div-annual-table [data-annual-year]',
    detail: '#div-annual-table .annual-detail',
  },
];

for (const table of tables) {
  test(`${table.name} rows expand by click and keyboard without a chevron`, async ({ page }) => {
    await page.goto(`/${table.hash}`);
    const row = page.locator(table.row).first();
    const detail = page.locator(table.detail);
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(row).toBeVisible();
      if ((await row.getAttribute('aria-expanded')) === 'true')
        await row.click({ position: { x: 12, y: 12 } });
      await expect(row).toHaveAttribute('aria-expanded', 'false');
      await expect(row.locator('.row-expand-chevron')).toHaveCount(0);
      await row.focus();
      await row.press('Enter');
      await expect(row).toBeFocused();
      await expect(row).toHaveAttribute('aria-expanded', 'true');
      await expect(detail).toBeVisible();
      await row.press('Space');
      await expect(row).toHaveAttribute('aria-expanded', 'false');
      await expect(detail).toHaveCount(0);
      await row.click({ position: { x: 12, y: 12 } });
      await expect(detail).toBeVisible();
      await row.click({ position: { x: 12, y: 12 } });
      await expect(row).toHaveAttribute('aria-expanded', 'false');
    }
  });
}

test('ledger summary, import and snapshot ETF toggles keep their chevron and keyboard behavior', async ({
  page,
}) => {
  async function checkToggle(control: Locator, panel: Locator): Promise<void> {
    const icon = control.locator('svg.row-expand-chevron');
    await expect(icon).toBeVisible();
    await expect(icon).toHaveAttribute('aria-hidden', 'true');
    if ((await control.getAttribute('aria-expanded')) === 'true') await control.click();
    await expect(panel).not.toBeVisible();
    await control.press('Enter');
    await expect(control).toHaveAttribute('aria-expanded', 'true');
    await expect(icon).toHaveCSS('transform', 'matrix(0, 1, -1, 0, 0, 0)');
    await expect(panel).toBeVisible();
    await control.press('Space');
    await expect(control).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).not.toBeVisible();
  }

  await page.goto('/#log');
  await checkToggle(page.locator('#btn-ledger-summary'), page.locator('#tx-ledger-summary'));
  await checkToggle(page.locator('#btn-toggle-import'), page.locator('#csv-import-panel'));
  await page.locator('#log-tab-snapshots').click();
  await page.locator('#btn-add-snap').click();
  const toggle = page.locator('.snap-etf-toggle').first();
  const panel = page.locator(`#${await toggle.getAttribute('aria-controls')}`);
  await checkToggle(toggle, panel);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(toggle.locator('svg.row-expand-chevron')).toHaveCSS('transition-duration', '0s');
  await page.locator('.js-snapd-cancel').click();
});
