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
    panel: '#port-table',
  },
  {
    name: 'snapshots',
    hash: '#log/snapshots',
    row: '#snaps-list .snap-row-compact:not(.th)',
    detail: '#snaps-list .snap-detail',
    panel: '#balance-card',
  },
  {
    name: 'by-year',
    hash: '#portfolio/dividends',
    row: '#div-annual-table [data-annual-year]',
    detail: '#div-annual-table .annual-detail',
    panel: '#div-annual-table',
  },
];

for (const table of tables) {
  test(`${table.name} uses the shared disclosure at every viewport and theme`, async ({
    page,
  }, testInfo) => {
    await page.goto(`/${table.hash}`);
    const row = page.locator(table.row).first();
    const icon = row.locator('svg.row-expand-chevron');
    const detail = page.locator(table.detail);

    for (const theme of ['light', 'dark']) {
      if ((await page.locator('html').getAttribute('data-theme')) !== theme) {
        await page.locator('#btn-header-menu').click();
        await page.locator(`[data-theme-choice="${theme}"]`).click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await page.keyboard.press('Escape');
      }
      for (const width of [1440, 768, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        await expect(row).toBeVisible();
        if ((await row.getAttribute('aria-expanded')) === 'true') await row.click();
        await expect(row).toHaveAttribute('aria-expanded', 'false');
        await expect(icon).toBeVisible();
        await expect(icon).toHaveCount(1);
        await expect(icon).toHaveAttribute('aria-hidden', 'true');
        await expect(icon).toHaveAttribute('focusable', 'false');
        await expect(icon).not.toHaveAttribute('tabindex');
        await expect(icon).toHaveCSS('width', '12px');
        await expect(icon).toHaveCSS('height', '12px');
        await expect(icon).toHaveCSS('pointer-events', 'none');
        await expect(icon).toHaveCSS('transform', /^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
        await expect(row.locator('button .row-expand-chevron')).toHaveCount(0);

        await row.focus();
        await row.press('Enter');
        await expect(row).toBeFocused();
        await expect(row).toHaveAttribute('aria-expanded', 'true');
        await expect(icon).toHaveCSS('transform', 'matrix(0, 1, -1, 0, 0, 0)');
        await expect(detail).toBeVisible();
        await row.screenshot({
          path: testInfo.outputPath(`${table.name}-${theme}-${width}-open.png`),
        });
        if (width !== 768) {
          await page.locator(table.panel).screenshot({
            path: testInfo.outputPath(`${table.name}-${theme}-${width}-details.png`),
          });
        }

        await row.press('Space');
        await expect(row).toHaveAttribute('aria-expanded', 'false');
        await expect(detail).toHaveCount(0);
        await row.click();
        await expect(row).toHaveAttribute('aria-expanded', 'true');
        await expect(detail).toBeVisible();
        await row.click();
        await expect(row).toHaveAttribute('aria-expanded', 'false');
        await row.screenshot({
          path: testInfo.outputPath(`${table.name}-${theme}-${width}-closed.png`),
        });
      }
    }

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(icon).toHaveCSS('transition-duration', '0s');
  });
}

test('transaction, import and snapshot ETF disclosures keep their keyboard behavior', async ({
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
  await checkToggle(
    page.locator('#tx-ledger-list .tx-row:not(.th)').first(),
    page.locator('#tx-ledger-list .tx-detail'),
  );
  await page.locator('#log-tab-snapshots').click();
  await page.locator('#btn-add-snap').click();
  const toggle = page.locator('.snap-etf-toggle').first();
  const panel = page.locator(`#${await toggle.getAttribute('aria-controls')}`);
  await checkToggle(toggle, panel);
  await page.locator('.js-snapd-cancel').click();
});
