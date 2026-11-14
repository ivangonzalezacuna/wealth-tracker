import { expect, test } from '@playwright/test';
import { chartBackup } from './fixtures/chartBackup';
import { ensureCardExpanded, gotoApp, openTab, preparePage, waitForSyncIdle } from './helpers';

test.beforeEach(async ({ page }) => {
  await preparePage(page);
  await gotoApp(page);
  const backup = chartBackup();
  backup.data.accounts.push({
    id: 'secondary',
    label: 'Secondary investment account with a longer label',
    moneyType: 'investment',
    color: '#0F6E56',
  });
  for (let i = 0; i < 8; i++) {
    backup.data.accounts.push({
      id: `reserve${i}`,
      label: `${i % 2 ? 'Other' : 'Research'} reserve ${i}`,
      moneyType: `custom_type_${i}`,
    });
  }
  backup.data.snapshots.forEach((snap, index) => {
    snap.secondary = 500 + index * 10;
    snap[`position:secondary:${backup.data.holdings[0].isin}`] = 200 + index * 5;
    for (let i = 0; i < 8; i++) snap[`reserve${i}`] = 100 * (i + 1);
    snap.reserve7 = 0;
  });
  backup.data.holdings.push({
    ...backup.data.holdings[0],
    isin: 'IE00B3F81R35',
    shortName: 'CLOSED',
    name: 'Closed research fund',
    active: false,
    order: 2,
    targetPct: 0,
  });
  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-backup');
  await page.locator('#backup-file-input').setInputFiles({
    name: 'contextual-ui.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await page.locator('.js-confirm-ok').click();
  await expect(page.locator('.toast-text').last()).toContainText('Restore complete.');
  await waitForSyncIdle(page);
  await page.getByRole('button', { name: 'Dismiss notification' }).click();
});

test('quick filters count matching data and scroll without wrapping', async ({ page }) => {
  await page.goto('/#settings');
  await page.setViewportSize({ width: 320, height: 900 });
  const chips = page.locator('#acct-filter-toggle');
  await expect(chips).toBeVisible();
  const geometry = await chips.evaluate((group) => {
    const buttons = [...group.querySelectorAll('button')];
    return {
      overflow: group.scrollWidth > group.clientWidth,
      tops: buttons.map((button) => button.getBoundingClientRect().top),
    };
  });
  expect(geometry.overflow).toBe(true);
  expect(new Set(geometry.tops).size).toBe(1);
  await expect(chips).toHaveClass(/can-scroll-right/);
  await expect(chips).not.toHaveClass(/can-scroll-left/);
  await expect(chips).toHaveCSS('scrollbar-width', 'none');
  await chips.evaluate((el) => {
    el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
  });
  await expect(chips).toHaveClass(/can-scroll-left/);
  await expect(chips).toHaveClass(/can-scroll-right/);
  const last = chips.locator('button').last();
  await last.focus();
  const focusedBounds = await last.evaluate((button) => {
    const group = button.parentElement!;
    return {
      left: button.getBoundingClientRect().left >= group.getBoundingClientRect().left,
      right: button.getBoundingClientRect().right <= group.getBoundingClientRect().right + 1,
    };
  });
  expect(focusedBounds).toEqual({ left: true, right: true });
  await expect(chips).toHaveClass(/can-scroll-left/);
  await expect(chips).not.toHaveClass(/can-scroll-right/);
  await page.locator('#settings-acct-search').fill('Research');
  await expect(page.locator('[data-afilter="all"] .chip-count')).toHaveText('4');
  await expect(page.locator('#settings-accounts-tbl .js-edit-acct')).toHaveCount(4);
  await expect(page.locator('[data-afilter="investment"]')).toHaveCount(0);
  await page.locator('[data-afilter="custom_type_0"]').click();
  await page.locator('#settings-acct-search').fill('not found');
  await expect(
    page.locator('[data-afilter="custom_type_0"][aria-pressed="true"] .chip-count'),
  ).toHaveText('0');
  await expect(page.locator('[data-afilter="custom_type_2"]')).toHaveCount(0);

  await ensureCardExpanded(page, 'settings-card-holdings');
  await page.locator('#settings-hold-search').fill('ALPHA');
  await expect(page.locator('[data-hfilter="all"] .chip-count')).toHaveText('1');
  await expect(page.locator('[data-hfilter="closed"] .chip-count')).toHaveText('0');

  await page.goto('/#log');
  await page.locator('#tx-search').fill('dividend');
  await expect(page.locator('[data-tx-type=""] .chip-count')).toHaveText('30');
  await expect(page.locator('[data-tx-type="BUY"] .chip-count')).toHaveText('0');
  await expect(page.locator('#tx-filter-status')).toContainText('30 of 90');
  await page.goto('/#portfolio');
  await page.locator('#port-holdings-search').fill('ALPHA');
  await expect(page.locator('[data-hold-account=""] .chip-count')).toHaveText('1');
  await expect(page.locator('[data-hold-account="secondary"] .chip-count')).toHaveText('1');
  await page.locator('[data-hold-account="secondary"]').click();
  await page.locator('#port-holdings-search').fill('not found');
  await expect(
    page.locator('[data-hold-account="secondary"][aria-pressed="true"] .chip-count'),
  ).toHaveText('0');
  await expect(page.locator('[data-hold-account="broker"]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('saved month details align responsive accounts and historical ETF changes', async ({
  page,
}, testInfo) => {
  await page.goto('/#log/snapshots');
  const row = page.locator('#snaps-list .snap-row-compact:not(.th)').first();
  await row.focus();
  await row.press('Enter');
  const detail = page.locator('#snaps-list .snap-detail');
  await expect(row).toBeFocused();
  await expect(row).toHaveAttribute('aria-controls', (await detail.getAttribute('id')) ?? '');
  await expect(detail.locator('.snap-position-group')).toHaveCount(2);
  await expect(detail.locator('.snap-detail-head')).toHaveCount(0);
  await expect(detail.locator('.snap-account-grid')).not.toContainText('Other reserve 7');
  expect(
    await row.evaluate((el) => {
      const probe = document.createElement('div');
      probe.style.background = 'var(--brand-weak)';
      document.body.append(probe);
      const brand = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return getComputedStyle(el).backgroundColor === brand;
    }),
  ).toBe(false);
  await expect(detail).toHaveClass(/hold-detail/);
  await detail.locator('.snap-detail-positions > summary').press('Enter');
  await expect(detail.locator('.snap-detail-positions > summary')).toHaveText(
    'ETF positions · 3 · change vs May 2025',
  );
  const table = detail.locator('.snap-position-table');
  await expect(table).toBeVisible();
  await expect(table).toContainText('+110,00');
  await expect(table).toContainText('+3.45%');
  await expect(detail).toContainText('not investment returns');

  for (const theme of ['light', 'dark']) {
    if ((await page.locator('html').getAttribute('data-theme')) !== theme) {
      await page.locator('#btn-header-menu').click();
      await page.locator(`[data-theme-choice="${theme}"]`).click();
      await page.keyboard.press('Escape');
    }
    if (
      !(await detail
        .locator('.snap-detail-positions')
        .evaluate((el) => (el as HTMLDetailsElement).open))
    ) {
      await detail.locator('.snap-detail-positions > summary').press('Enter');
    }
    await expect(detail.locator('.snap-position-table')).toBeVisible();
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      const geometry = await detail.evaluate((panel) => {
        const grid = panel.querySelector('.snap-account-grid')!;
        const table = panel.querySelector('.snap-position-table')!;
        const rows = [
          ...table.querySelectorAll<HTMLTableRowElement>('tbody tr:not(.snap-position-group)'),
        ];
        return {
          width: panel.getBoundingClientRect().width,
          available: panel.parentElement!.getBoundingClientRect().width,
          columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
          valueRights: rows.map((tr) => Math.round(tr.cells[0].getBoundingClientRect().right)),
          rowHeights: rows.map((tr) => tr.getBoundingClientRect().height),
          tableFits: table.getBoundingClientRect().right <= panel.getBoundingClientRect().right + 1,
          pageOverflow: document.documentElement.scrollWidth > innerWidth,
          summaryHeight: grid.getBoundingClientRect().height,
        };
      });
      expect(geometry.pageOverflow).toBe(false);
      expect(geometry.width).toBeGreaterThan(geometry.available * 0.95);
      expect(geometry.columns).toBe(width === 1440 ? 3 : width === 768 ? 2 : 1);
      expect(geometry.tableFits).toBe(true);
      expect(new Set(geometry.valueRights).size).toBe(1);
      for (const height of geometry.rowHeights) expect(height).toBeLessThan(width > 360 ? 30 : 44);
      if (width < 768) expect(geometry.summaryHeight).toBeLessThan(320);
      await detail.screenshot({
        path: testInfo.outputPath(`approved-snapshot-${theme}-${width}.png`),
      });
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await row.focus();
  await row.press('Space');
  await expect(detail).toHaveCount(0);
  await row.press('Enter');
  await expect(detail).toBeVisible();
  await expect(row).toBeFocused();
});
