import { expect, test, type Page } from '@playwright/test';
import {
  ensureCardExpanded,
  expectToast,
  gotoApp,
  monthOffsetValue,
  openTab,
  preparePage,
  saveSettings,
  waitForSyncIdle,
} from './helpers';

const ISIN = 'IE00B4L5Y983';

function backup(legacy = false) {
  return {
    schemaVersion: legacy ? 4 : 5,
    app: 'wealth-tracker',
    exportedAt: new Date().toISOString(),
    data: {
      accounts: [
        { id: 'daily', label: 'Spain daily', moneyType: 'cash', country: 'Spain', order: 0 },
        {
          id: 'spain',
          label: 'Spain ETF',
          moneyType: 'investment',
          country: 'Spain',
          isPrimaryInvestment: true,
          order: 1,
        },
        { id: 'france', label: 'France ETF', moneyType: 'investment', country: 'France', order: 2 },
      ],
      holdings: [
        {
          isin: ISIN,
          name: 'World ETF',
          shortName: 'WORLD',
          color: '#123456',
          acc: true,
          active: true,
          targetPct: 100,
          assetClass: 'Equity',
          region: 'World',
          foldInto: '',
          order: 0,
        },
      ],
      settings: {
        monthly_contrib_budget: '500',
        ...(legacy ? {} : { etf_valuation_schema: 'account-v1' }),
      },
      snapshots: legacy
        ? [
            {
              date: monthOffsetValue(-1),
              daily: 200,
              spain: 400,
              france: 600,
              [`etf_${ISIN}`]: 1000,
            },
          ]
        : [
            {
              date: monthOffsetValue(-5),
              daily: 200,
              spain: 400,
              france: 600,
              [`position:spain:${ISIN}`]: 400,
              [`position:france:${ISIN}`]: 600,
            },
            {
              date: monthOffsetValue(-4),
              daily: 200,
              spain: 0,
              france: 1000,
              [`position:spain:${ISIN}`]: 0,
              [`position:france:${ISIN}`]: 1000,
            },
          ],
      transactions: [],
      importMeta: {},
      fxRates: [],
    },
  };
}

async function restore(page: Page, data: ReturnType<typeof backup>) {
  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-backup');
  await waitForSyncIdle(page);
  await page.setInputFiles('#backup-file-input', {
    name: 'lifecycle-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await page.click('.js-confirm-ok');
}

async function stageLifecycle(page: Page, mode: 'close' | 'reopen', month: string) {
  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-accounts');
  await waitForSyncIdle(page);
  await page.locator('.js-edit-acct[data-idx="1"]').click();
  await page.locator('#acctd-lifecycle > summary').click();
  await page.locator(`.js-acctd-lifecycle[data-mode="${mode}"]`).click();
  await page.fill('#lifecycle-month', month);
  if (mode === 'close') await page.selectOption('#lifecycle-primary', 'france');
  await page.check('#lifecycle-confirm');
  await page.locator('.lifecycle-dialog-overlay .js-submit').click();
  await saveSettings(page, 'accts', 'Accounts saved');
}

test.beforeEach(async ({ page }) => {
  await preparePage(page);
  await gotoApp(page);
});

test('Spain account closes and reopens with history; a shared ISIN stays one row', async ({
  page,
}) => {
  await restore(page, backup());
  await expectToast(page, 'backup-msg', 'Restore complete.');
  await stageLifecycle(page, 'close', monthOffsetValue(-4));
  await expect(page.locator('.settings-acct-row[data-idx="1"]')).toContainText('Closed');
  await expect(page.locator('.settings-acct-row[data-idx="0"]')).not.toContainText('Closed');
  await stageLifecycle(page, 'reopen', monthOffsetValue(-2));
  await page.reload();
  await gotoApp(page);

  await openTab(page, 'tab-log');
  await waitForSyncIdle(page);
  await page.click('#btn-add-snap');
  await page.fill('#snapd-date', monthOffsetValue(-1));
  await page.fill('#snapd-acc-daily', '200');
  await page.fill('#snapd-acc-spain', '300');
  await page.fill('#snapd-acc-france', '700');
  for (const [id, value] of [
    ['spain', '300'],
    ['france', '700'],
  ]) {
    const toggle = page.locator(`.snap-etf-toggle[data-acct-key="${id}"]`);
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    const position = page.locator(`[data-position-account="${id}"][data-etf-isin="${ISIN}"]`);
    if (!(await position.count())) {
      await page.fill(`#snapd-existing-${id}`, ISIN);
      await page.locator(`#snapd-existing-${id}`).press('Enter');
    }
    await expect(position).toBeVisible();
    await position.fill(value);
  }
  await page.click('.js-snapd-submit');
  await expect(page.locator('.snapd-review')).toContainText('Spain ETF');
  await expect(page.locator('.snapd-review')).toContainText('France ETF');
  await page.click('.js-snapd-submit');
  await expect(page.locator('#snap-msg')).toContainText('Saved');

  await openTab(page, 'tab-portfolio');
  const row = page.locator(`#port-table .hold-row[data-etf-key="${ISIN}"]`);
  await expect(row).toHaveCount(1);
  await expect(row.locator('.hold-account-count')).toHaveAttribute('aria-label', /2 accounts/);
  await expect(page.locator('.hold-filter-bar')).toHaveCount(0);
  await row.focus();
  await row.press('Enter');
  await expect(row).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.hold-detail-accounts')).not.toHaveAttribute('open', '');
  await page.locator('.hold-detail-accounts > summary').click();
  await expect(page.locator('.hold-detail')).toContainText('Spain ETF');
  await expect(page.locator('.hold-detail')).toContainText('France ETF');

  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          ),
        )
        .toBeLessThanOrEqual(1);
    }
  }

  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-backup');
  const downloadPromise = page.waitForEvent('download');
  await page.click('#btn-export-backup');
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  if (!stream) throw new Error('Backup download stream missing');
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const exported = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  expect(
    exported.data.accounts.find((a: { id: string }) => a.id === 'spain').closedPeriods,
  ).toEqual([{ closedFromMonth: monthOffsetValue(-4), reopenedFromMonth: monthOffsetValue(-2) }]);
  expect(
    exported.data.accounts.find((a: { id: string }) => a.id === 'france').isPrimaryInvestment,
  ).toBe(true);
  expect(exported.data.snapshots.at(-1)[`position:spain:${ISIN}`]).toBe(300);
  expect(exported.data.snapshots.at(-1)[`position:france:${ISIN}`]).toBe(700);
  await restore(page, exported);
  await expectToast(page, 'backup-msg', 'Restore complete.');
});

test('legacy backup is rejected before confirmation without replacing live history', async ({
  page,
}, info) => {
  await restore(page, backup());
  await expectToast(page, 'backup-msg', 'Restore complete.');
  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-backup');
  await waitForSyncIdle(page);
  await page.setInputFiles('#backup-file-input', {
    name: 'unsupported-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup(true))),
  });
  await expectToast(page, 'backup-msg', 'Legacy ETF valuations are no longer supported.');
  await expect(page.locator('.js-confirm-ok')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('unsupported-backup.png'), fullPage: true });
  await page.reload();
  await gotoApp(page);
  await openTab(page, 'tab-log');
  await expect(page.locator(`.snap-row-compact[data-date="${monthOffsetValue(-5)}"]`)).toHaveCount(
    1,
  );
  await expect(page.locator(`.snap-row-compact[data-date="${monthOffsetValue(-1)}"]`)).toHaveCount(
    0,
  );
});
