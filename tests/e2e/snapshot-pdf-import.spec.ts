import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
  FAKE_ISINS,
  FAKE_VALUES,
  syntheticPdf,
  syntheticStatementLines,
  syntheticLargeStatementLines,
} from '../fixtures/snapshot-import/synthetic';
import {
  addAccount,
  ensureCardExpanded,
  gotoApp,
  openTab,
  preparePage,
  snapshotRow,
  waitForSyncIdle,
  expectToast,
} from './helpers';

async function openImport(page: Page) {
  await openTab(page, 'tab-log');
  await waitForSyncIdle(page);
  await page.click('#btn-add-snap');
  await page.fill('#snapd-date', '2024-01');
}

async function upload(page: Page, lines = syntheticStatementLines()) {
  await page.setInputFiles('#snapd-pdf-file', {
    name: 'fictional-July.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await syntheticPdf(lines)),
  });
  await expect(page.locator('.snap-pdf-source')).toContainText('2024-01-31');
}

async function mapCombined(page: Page) {
  await page.selectOption('#snapd-pdf-mode', 'combined');
  await page.getByRole('button', { name: 'Save mapping and fill draft' }).click();
  await expect(page.locator('.snap-pdf-status')).toContainText('filled automatically');
}

test.beforeEach(async ({ page }) => {
  await preparePage(page);
  await gotoApp(page);
  await addAccount(page, { label: 'Fictional Broker', primary: true });
});

test('actual PDF worker imports fake valuations through review, preserves them after reload, and excludes raw content from backup', async ({
  page,
}, testInfo) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (!request.url().includes('googleapis.com')) requests.push(request.url());
  });
  await openImport(page);
  await upload(page);
  await expect(page.locator('.snap-pdf-source')).toContainText('2024-01-31');
  await mapCombined(page);
  const accountId = await page.locator('[data-account-key]').getAttribute('data-account-key');
  await expect(page.getByLabel('Breakdown coverage')).toHaveValue('0');
  await expect(page.getByLabel('Fictional Broker (EUR)')).toHaveValue('3707.62');
  await expect(page.locator('.snap-etf-extra')).toHaveCount(7);
  await expect(page.locator('#snap-msg')).not.toContainText('Saved');
  await page.click('.js-snapd-submit');
  await expect(page.locator('.snapd-review')).toBeVisible();
  for (const isin of FAKE_ISINS) await expect(page.locator('.snapd-review')).toContainText(isin);
  await page.click('.js-snapd-back');
  await page.click('.js-snapd-submit');
  await page.click('.js-snapd-submit');
  await expect(page.locator('#snap-msg')).toContainText('Saved');
  await waitForSyncIdle(page);
  await page.reload();
  await openTab(page, 'tab-log');
  await waitForSyncIdle(page);
  await snapshotRow(page, '2024-01').click();
  await page.click('.snap-detail .js-edit-snap');
  await expect(page.getByLabel('Fictional Broker (EUR)')).toHaveValue('3707.62');
  for (let i = 0; i < FAKE_ISINS.length; i++) {
    await expect(page.locator(`[data-etf-isin="${FAKE_ISINS[i]}"]`)).toHaveValue(
      String(FAKE_VALUES[i]),
    );
    await expect(page.locator(`[data-etf-isin="${FAKE_ISINS[i]}"]`)).toHaveAttribute(
      'data-position-account',
      accountId!,
    );
  }
  await page.click('.js-snapd-cancel');
  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-backup');
  const downloadPromise = page.waitForEvent('download');
  await page.click('#btn-export-backup');
  const backup = await downloadPromise;
  const path = testInfo.outputPath('fake-backup.json');
  await backup.saveAs(path);
  const raw = await readFile(path, 'utf8');
  const exported = JSON.parse(raw);
  expect(exported.data.snapshots[0]).toMatchObject({
    date: '2024-01',
    notes: '',
    [`position:${accountId}:${FAKE_ISINS[0]}`]: 101.11,
    [`position_coverage:${accountId}`]: 0,
  });
  expect(Object.keys(exported.data.snapshots[0]).some((key) => key.startsWith('etf_'))).toBe(false);
  expect(exported.data.settings.etf_valuation_schema).toBe('account-v1');
  for (const forbidden of [
    'fictional-July.pdf',
    'Fictional fund',
    'VERMÖGENSÜBERSICHT',
    'pdfCurrency',
    'pdfDate',
    '2024-01-31',
    '%PDF-',
  ])
    expect(raw).not.toContain(forbidden);
  expect(exported.data.transactions).toEqual([]);
  expect(exported.data.holdings).toEqual([]);
  expect(
    JSON.parse(exported.data.settings.snapshot_import_mappings).mappings['trade-republic:valuation']
      .mode,
  ).toBe('combined');
  expect(requests.some((url) => /pdf\.worker.*\.(mjs|js)/.test(url))).toBe(true);
  const origin = new URL(page.url()).origin;
  const expectedExternal = new Set([
    'https://accounts.google.com',
    'https://fonts.googleapis.com',
    'https://fonts.gstatic.com',
  ]);
  expect(
    requests.filter(
      (url) => new URL(url).origin !== origin && !expectedExternal.has(new URL(url).origin),
    ),
  ).toEqual([]);
});

test('blocks wrong months and unverified English, while keeping manual entry usable', async ({
  page,
}) => {
  await openImport(page);
  await page.fill('#snapd-date', '2024-02');
  await upload(page);
  await expect(page.locator('.snap-pdf-error')).toContainText('does not match');
  await expect(page.locator('.snap-pdf-setup')).toBeHidden();
  await expect(page.getByLabel('Fictional Broker (EUR)')).toHaveValue('');
  await page.getByRole('button', { name: 'Cancel import', exact: true }).click();
  const unsupported = syntheticStatementLines();
  unsupported[0][1] = 'UNVERIFIED ENGLISH TITLE';
  await page.setInputFiles('#snapd-pdf-file', {
    name: 'fake-English.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await syntheticPdf(unsupported)),
  });
  await expect(page.locator('.snap-pdf-error')).toContainText('Unsupported statement');
  await page.getByLabel('Fictional Broker (EUR)').fill('1000');
  await page.click('.js-snapd-submit');
  await expect(page.locator('.snapd-review')).toBeVisible();
});

test('keeps imported review after a busy save and retries without losing the draft', async ({
  page,
}, testInfo) => {
  await openImport(page);
  await upload(page);
  await mapCombined(page);
  await page.click('.js-snapd-submit');
  await expect(page.locator('.snapd-review')).toBeVisible();
  await waitForSyncIdle(page);
  await page.evaluate(async () => {
    const lockModule = `${location.origin}/src/sync/lock.ts`;
    const { setBusy } = await import(/* @vite-ignore */ lockModule);
    setBusy(true);
  });
  try {
    await page.click('.js-snapd-submit');
    await expect(page.locator('#snapd-save-err')).toBeVisible();
    await expect(page.locator('#snapd-save-err')).toContainText('Your draft is kept');
    await expect(page.locator('#snapd-save-err')).toBeFocused();
    await expect(page.locator('#snap-msg')).toContainText('sync or save is in progress');
    await expect(page.locator('.snapd-review')).toBeVisible();
    await expect(snapshotRow(page, '2024-01')).toHaveCount(0);
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 844 });
        expect(
          await page.locator('.snap-dialog-card').evaluate((card) => ({
            overflow: card.scrollWidth > card.clientWidth,
            errorFits:
              card.querySelector('#snapd-save-err')!.getBoundingClientRect().right <=
              card.getBoundingClientRect().right,
            actionsFit:
              card.querySelector('.dialog-actions')!.getBoundingClientRect().bottom <= innerHeight,
          })),
        ).toEqual({ overflow: false, errorFits: true, actionsFit: true });
        await page.screenshot({
          path: testInfo.outputPath(`save-retry-${colorScheme}-${width}.png`),
        });
      }
    }
  } finally {
    await page.evaluate(async () => {
      const lockModule = `${location.origin}/src/sync/lock.ts`;
      const { setBusy } = await import(/* @vite-ignore */ lockModule);
      setBusy(false);
    });
  }
  await page.click('.js-snapd-back');
  await expect(page.getByLabel('Fictional Broker (EUR)')).toHaveValue('3707.62');
  await expect(page.locator('.snap-etf-extra')).toHaveCount(7);
  await expect(page.locator('[data-pdf-currency]').first()).toHaveAttribute(
    'data-pdf-currency',
    'EUR',
  );
  await page.click('.js-snapd-submit');
  await page.click('.js-snapd-submit');
  await expect(page.locator('.snap-dialog-overlay')).toHaveCount(0);
  await expect(snapshotRow(page, '2024-01')).toBeVisible();
  await expect(page.locator('#snap-msg')).toContainText('Saved');
});

test('automatically replaces values, remembers mapping across dialogs, and supports Undo on mobile', async ({
  page,
}) => {
  await openImport(page);
  await page.getByLabel('Fictional Broker (EUR)').fill('9999');
  await upload(page);
  await mapCombined(page);
  await expect(page.getByLabel('Fictional Broker (EUR)')).toHaveValue('3707.62');
  await expect(page.locator('[data-pdf-select]')).toHaveCount(0);
  await page.click('.js-snapd-cancel');
  await openImport(page);
  await upload(page);
  await expect(page.locator('.snap-pdf-status')).toContainText('filled automatically');
  await expect(page.locator('.snap-pdf-setup')).toBeHidden();
  await upload(page);
  await expect(page.locator('.snap-pdf-status')).toContainText('filled automatically');
  await expect(page.locator('.snap-etf-extra')).toHaveCount(7);
  await expect(page.locator('[data-position-account]')).toHaveCount(7);
  await expect(page.getByLabel('Breakdown coverage')).toHaveValue('0');
  await page.setViewportSize({ width: 320, height: 844 });
  expect(
    await page.locator('.dialog-fields').evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await page.click('.snap-pdf-undo');
  await expect(page.locator('.snap-pdf-status')).toContainText('Import undone');
  await page.click('.js-snapd-cancel');
  await expect(snapshotRow(page, '2024-01')).toHaveCount(0);
});

test('maps separate securities and cash accounts without counting cash twice', async ({ page }) => {
  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-accounts');
  await page.click('#btn-add-acct');
  await page.fill('#acctd-label', 'Fictional Cash');
  await page.selectOption('#acctd-type', 'cash');
  await page.click('.js-acctd-submit');
  await page.click('#btn-save-accts');
  await expectToast(page, 'accts-msg', 'Accounts saved');
  await openImport(page);
  await upload(page);
  const cash = await page.locator('#snapd-pdf-cash option').last().getAttribute('value');
  await page.selectOption('#snapd-pdf-mode', 'split');
  await page.selectOption('#snapd-pdf-cash', cash!);
  await page.getByRole('button', { name: 'Save mapping and fill draft' }).click();
  await expect(page.getByLabel('Fictional Broker (EUR)')).toHaveValue('2831.08');
  await expect(page.getByLabel('Fictional Cash (EUR)')).toHaveValue('876.54');
  await page.click('.js-snapd-submit');
  await expect(page.locator('.snapd-review')).toBeVisible();
  await expect(page.locator('.snapd-review')).toContainText('recorded ETFs / remainder');
  await expect(page.locator('.snapd-review')).toContainText('Partial');
  await page.click('.js-snapd-submit');
  await expect(page.locator('#snap-msg')).toContainText('Saved');
});

test('fills 200 positions without approvals and keeps final review bounded and searchable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await openImport(page);
  await upload(page, syntheticLargeStatementLines());
  await mapCombined(page);
  await expect(page.locator('.snap-etf-extra')).toHaveCount(200);
  await expect(page.locator('[data-pdf-select]')).toHaveCount(0);
  await page.click('.js-snapd-submit');
  await expect(page.locator('.snapd-review')).toBeVisible();
  await expect(page.locator('[aria-label="ETF values"] > dl > div')).toHaveCount(10);
  await expect(page.locator('.snapd-review-more')).not.toHaveAttribute('open');
  await page.locator('.snapd-review-more summary').click();
  await page.getByLabel('Find remaining positions').fill('Invented large fund 200');
  await expect(page.locator('.snapd-review-more [data-review-search]:visible')).toHaveCount(1);
  expect(
    await page.locator('.snapd-review').evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
});

test('Settings can change and reset mapping without keeping a snapshot', async ({ page }) => {
  await openImport(page);
  await upload(page);
  await mapCombined(page);
  await page.click('.js-snapd-cancel');
  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-integrations');
  await page.selectOption('#settings-statement-mode', 'positions');
  await page.click('#btn-save-statement-mapping');
  await expectToast(page, 'statement-mapping-msg', 'Mapping saved.');
  await waitForSyncIdle(page);
  await openImport(page);
  await page.getByLabel('Fictional Broker (EUR)').fill('9999');
  await upload(page);
  await expect(page.locator('.snap-pdf-status')).toContainText('filled automatically');
  await expect(page.getByLabel('Fictional Broker (EUR)')).toHaveValue('9999');
  await page.click('.js-snapd-cancel');
  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-integrations');
  await page.click('#btn-reset-statement-mapping');
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Reset mapping', exact: true })
    .click();
  await expectToast(page, 'statement-mapping-msg', 'Mapping reset.');
  await waitForSyncIdle(page);
  await openImport(page);
  await upload(page);
  await expect(page.locator('.snap-pdf-setup')).toBeVisible();
  await expect(page.getByLabel('Fictional Broker (EUR)')).toHaveValue('');
});

test('PDF chooser and mapping work by keyboard in narrow light and dark layouts', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.emulateMedia({ colorScheme: 'light' });
  await openImport(page);
  await page.bringToFront();
  const button = page.getByRole('button', { name: 'Choose statement PDF', exact: true });
  await button.focus();
  await expect(button).toBeFocused();
  const chooserEvent = page.waitForEvent('filechooser');
  await button.press('Enter');
  const chooser = await chooserEvent;
  await chooser.setFiles({
    name: 'invented.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await syntheticPdf()),
  });
  await expect(page.locator('.snap-pdf-setup')).toBeVisible();
  await page.locator('#snapd-pdf-mode').focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Save mapping and fill draft' })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('mapping-light-320.png') });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: testInfo.outputPath('mapping-dark-320.png') });
  await page.keyboard.press('Enter');
  await expect(page.locator('.snap-pdf-status')).toContainText('filled automatically');
  expect(
    await page.locator('.dialog-fields').evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await page.click('.js-snapd-submit');
  await expect(page.locator('.snapd-review')).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('review-dark-320.png') });
  await page.click('.js-snapd-back');
  await expect(page.locator('#snapd-date')).toBeFocused();
});
