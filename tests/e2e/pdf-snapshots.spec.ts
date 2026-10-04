import { expect, test, type Page, type Request } from '@playwright/test';
import { realisticStatementFixture, syntheticPdf } from './fixtures/pdfStatement';
import {
  addAccount,
  addSnapshot,
  ensureCardExpanded,
  formatUiMoney,
  gotoApp,
  openTab,
  preparePage,
  snapshotRow,
  waitForSyncIdle,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' }),
  );
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort());
});

async function settleSetupUpload(page: Page) {
  const response = await page.waitForResponse((response) =>
    response.url().startsWith('https://www.googleapis.com/upload/drive/v3/'),
  );
  await response.finished();
  await waitForSyncIdle(page);
}

function pdfFile(lines = realisticStatementFixture()) {
  return {
    name: 'SYNTHETIC-PRIVATE.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(syntheticPdf(lines)),
  };
}

const expectedHoldings = [
  ['DE0000000016', 234.56],
  ['DE0000000024', 100],
  ['DE0000000032', 150],
  ['DE0000000040', 175],
  ['DE0000000057', 200],
  ['DE0000000065', 125],
  ['DE0000000073', 250],
] as const;

async function expectExtractedBalances(page: Page) {
  const status = page.locator('#pdf-status');
  await expect(status).toContainText('Valuation date 2026-09-30');
  await expect(status).toContainText(`Cash ${formatUiMoney(100)}`);
  await expect(status).toContainText(`brokerage ${formatUiMoney(1234.56)}`);
  await expect(status).toContainText(`total ${formatUiMoney(1334.56)}`);
  for (const [isin, amount] of expectedHoldings) {
    await expect(page.locator('#pdf-unknown label').filter({ hasText: isin })).toHaveText(
      ` Exclude ${isin} (${formatUiMoney(amount)}) from ETF breakdown`,
    );
  }
}

async function setupAccounts(page: Page) {
  await preparePage(page);
  await gotoApp(page);
  await waitForSyncIdle(page);
  await addAccount(page, { label: 'PDF Broker', primary: true });
  await waitForSyncIdle(page);
  await addAccount(page, { label: 'Unrelated savings' });
  await waitForSyncIdle(page);
  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-accounts');
  await page.click('#btn-add-acct');
  await page.fill('#acctd-label', 'PDF Cash');
  await page.selectOption('#acctd-type', 'cash');
  await page.click('.js-acctd-submit');
  await page.click('#btn-save-accts');
  await expect(page.locator('#accts-msg')).toContainText('Saved');
  await waitForSyncIdle(page);
  await expect(page.locator('#settings-accounts-tbl')).toContainText('PDF Broker');
  await expect(page.locator('#settings-accounts-tbl')).toContainText('Unrelated savings');
  await expect(page.locator('#settings-accounts-tbl')).toContainText('PDF Cash');
  await settleSetupUpload(page);
  await openTab(page, 'tab-log');
  await waitForSyncIdle(page);
}

async function mapAccounts(page: Page) {
  await page.selectOption('#pdf-cash', { label: 'PDF Cash' });
  await page.selectOption('#pdf-investment', { label: 'PDF Broker' });
}

function expectLocalRequests(requests: Request[], origin: string) {
  for (const request of requests) {
    expect(new URL(request.url()).origin, request.url()).toBe(origin);
    expect(request.method(), request.url()).toBe('GET');
    expect(request.postData()).toBeNull();
    expect(decodeURIComponent(request.url())).not.toMatch(
      /SYNTHETIC-PRIVATE|ISIN|DE000000|30\.09\.2026|2026-09-30|1234[.,]56|1334[.,]56|234[.,]56/,
    );
  }
}

test('real PDF worker extracts seven positions and saves only after explicit review', async ({
  page,
}) => {
  const fixture = realisticStatementFixture();
  const valueHeader = fixture
    .find((line) => line.cells.some((cell) => cell.text === 'STK./NOMINALE'))!
    .cells.find((cell) => cell.text.startsWith('KURSWERT'))!;
  const positions = fixture.filter((line) => line.cells.some((cell) => cell.text.endsWith('Stk.')));
  expect(positions).toHaveLength(7);
  expect(
    positions.every((line) => line.cells[line.cells.length - 1].x < valueHeader.x),
    'right-aligned market values must begin left of their header, as in the screenshot layout',
  ).toBe(true);
  await setupAccounts(page);
  const requests: Request[] = [];
  const workers: string[] = [];
  page.on('request', (request) => requests.push(request));
  page.on('worker', (worker) => workers.push(worker.url()));
  const file = pdfFile(fixture);
  await page.click('#btn-pdf-snap');
  await page.setInputFiles('#pdf-file', file);
  await expectExtractedBalances(page);
  expect(workers.some((url) => url.includes('pdf.worker'))).toBe(true);
  expect(
    workers.every((url) => new URL(url, page.url()).origin === new URL(page.url()).origin),
  ).toBe(true);
  await mapAccounts(page);
  const exclusions = page.locator('#pdf-unknown input[type="checkbox"]');
  await expect(exclusions).toHaveCount(7);
  await page.click('#pdf-review');
  await expect(page.locator('#pdf-confirm')).toBeDisabled();
  await expect(page.locator('#pdf-preview')).toBeEmpty();
  for (let i = 0; i < 6; i++) await exclusions.nth(i).check();
  await page.click('#pdf-review');
  await expect(page.locator('#pdf-confirm')).toBeDisabled();
  await exclusions.nth(6).check();
  await page.click('#pdf-review');
  await expect(page.locator('#pdf-confirm')).toBeEnabled();
  await expect(page.locator('#pdf-preview')).toContainText('new partial snapshot');
  await expect(page.locator('#pdf-preview')).toContainText('PDF Cash: not recorded → 100 EUR');
  await expect(page.locator('#pdf-preview')).toContainText(
    'PDF Broker: not recorded → 1234.56 EUR',
  );
  await expect(page.locator('#pdf-preview')).not.toContainText('Unrelated savings');
  await expect(snapshotRow(page, '2026-09')).toHaveCount(0);
  expectLocalRequests(requests, new URL(page.url()).origin);
  await page.click('#pdf-cancel');
  await expect(snapshotRow(page, '2026-09')).toHaveCount(0);
  expectLocalRequests(requests, new URL(page.url()).origin);

  await page.click('#btn-pdf-snap');
  await page.setInputFiles('#pdf-file', file);
  await expectExtractedBalances(page);
  await mapAccounts(page);
  for (const checkbox of await exclusions.all()) await checkbox.check();
  await page.click('#pdf-review');
  expectLocalRequests(requests, new URL(page.url()).origin);
  await page.click('#pdf-confirm');
  await expect(page.locator('#snap-msg')).toContainText('Saved');
  await expect(snapshotRow(page, '2026-09')).toHaveCount(1);
  await expect(snapshotRow(page, '2026-09')).toContainText(formatUiMoney(1334.56));
  await waitForSyncIdle(page);

  await snapshotRow(page, '2026-09').click();
  await page.click('.snap-detail .js-edit-snap');
  await expect(page.locator('#snapd-date')).toHaveValue('2026-09');
  await expect(page.getByLabel(/^PDF Cash \([A-Z]{3}\)$/)).toHaveValue('100');
  await expect(page.getByLabel(/^PDF Broker \([A-Z]{3}\)$/)).toHaveValue('1234.56');
  await expect(page.getByLabel(/^Unrelated savings \([A-Z]{3}\)$/)).toHaveValue('');
  await page.keyboard.press('Escape');
});

test('same-month PDF confirmation preserves unrelated stored accounts and user notes', async ({
  page,
}) => {
  await setupAccounts(page);
  await addSnapshot(page, {
    month: '2026-09',
    note: 'Preserve this user note',
    accountValues: { 'PDF Cash': 11, 'PDF Broker': 22, 'Unrelated savings': 777 },
  });
  await waitForSyncIdle(page);
  await settleSetupUpload(page);
  const requests: Request[] = [];
  page.on('request', (request) => requests.push(request));
  await page.click('#btn-pdf-snap');
  await page.setInputFiles('#pdf-file', pdfFile());
  await expectExtractedBalances(page);
  await mapAccounts(page);
  for (const checkbox of await page.locator('#pdf-unknown input').all()) {
    await checkbox.check();
  }
  await page.click('#pdf-review');
  await expect(page.locator('#pdf-preview')).toContainText('merge into existing month');
  await expect(page.locator('#pdf-preview')).toContainText('PDF Cash: 11 → 100 EUR');
  await expect(page.locator('#pdf-preview')).toContainText('PDF Broker: 22 → 1234.56 EUR');
  await expect(page.locator('#pdf-preview')).toContainText(
    'Unrelated savings: 777 → 777 (unchanged) EUR',
  );
  expectLocalRequests(requests, new URL(page.url()).origin);
  await page.click('#pdf-confirm');
  await expect(page.locator('#snap-msg')).toContainText('Saved');
  await expect(snapshotRow(page, '2026-09')).toHaveCount(1);
  await expect(snapshotRow(page, '2026-09')).toContainText(formatUiMoney(2111.56));
  await snapshotRow(page, '2026-09').click();
  await expect(page.locator('.snap-detail')).toContainText('Preserve this user note');
  await page.click('.snap-detail .js-edit-snap');
  await expect(page.getByLabel(/^Unrelated savings \([A-Z]{3}\)$/)).toHaveValue('777');
  await expect(page.getByLabel(/^PDF Cash \([A-Z]{3}\)$/)).toHaveValue('100');
  await expect(page.getByLabel(/^PDF Broker \([A-Z]{3}\)$/)).toHaveValue('1234.56');
  await expect(page.locator('#snapd-notes')).toHaveValue('Preserve this user note');
  await page.keyboard.press('Escape');
});

test('invalid PDF bytes display a safe file code and allow a fresh file selection', async ({
  page,
}) => {
  await preparePage(page);
  await gotoApp(page);
  await openTab(page, 'tab-log');
  await waitForSyncIdle(page);
  await settleSetupUpload(page);
  await page.click('#btn-pdf-snap');
  const privateContent = 'PRIVATE-CONTENT-SENTINEL not a PDF';
  await page.setInputFiles('#pdf-file', {
    name: 'PRIVATE-FILENAME-SENTINEL.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(privateContent),
  });
  await expect(page.locator('#pdf-status')).toContainText('[file]');
  await expect(page.locator('#pdf-status')).not.toContainText('PRIVATE-');
  await expect(page.locator('#pdf-status')).not.toContainText('InvalidPDFException');
  await expect(page.locator('#pdf-review')).toBeDisabled();
  await expect(page.locator('#pdf-confirm')).toBeDisabled();
  await expect(page.locator('#pdf-preview')).toBeEmpty();
  await page.setInputFiles('#pdf-file', pdfFile());
  await expect(page.locator('#pdf-status')).toContainText('Valuation date 2026-09-30');
  await expect(page.locator('#pdf-review')).toBeEnabled();
  await expect(page.locator('#pdf-confirm')).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.click('#btn-add-snap');
  await expect(page.locator('.snap-dialog-overlay')).toBeVisible();
  await page.keyboard.press('Escape');
});

test('corrupt summaries, dates, missing positions and truncated statements fail safely and recover', async ({
  page,
}) => {
  await preparePage(page);
  await gotoApp(page);
  await openTab(page, 'tab-log');
  await waitForSyncIdle(page);
  await settleSetupUpload(page);
  await page.click('#btn-pdf-snap');
  const summary = realisticStatementFixture();
  const total = summary.find((line) => line.cells.some((cell) => cell.text === 'GESAMT'))!;
  total.cells[total.cells.length - 1].text = '1.334,57 EUR';
  const date = realisticStatementFixture().map((line) => ({
    ...line,
    cells: line.cells.map((cell) => ({
      ...cell,
      text: cell.text.replaceAll('30.09.2026', '31.11.2026'),
    })),
  }));
  const incomplete = realisticStatementFixture().filter(
    (line) => !line.cells.some((cell) => cell.text.includes('ISIN: DE0000000073')),
  );
  const truncated = realisticStatementFixture().filter((line) => line.page === 1);
  const pages = realisticStatementFixture().map((line) => ({
    ...line,
    cells: line.cells.map((cell) => ({
      ...cell,
      text: cell.text.replace('Seite 2 von 2', 'Seite 2 von 3'),
    })),
  }));
  const cash = realisticStatementFixture();
  const cashBalance = cash.find((line) => line.cells.some((cell) => cell.text === 'Cashkonto'))!;
  cashBalance.cells[cashBalance.cells.length - 1].text = '100,01 EUR';
  const cases = [
    { code: 'summary', file: pdfFile(summary) },
    { code: 'date', file: pdfFile(date) },
    { code: 'positions', file: pdfFile(incomplete) },
    { code: 'pages', file: pdfFile(truncated) },
    { code: 'pages', file: pdfFile(pages) },
    { code: 'cash', file: pdfFile(cash) },
    {
      code: 'loading',
      file: {
        name: 'PRIVATE-FILENAME-SENTINEL.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.7\nPRIVATE-CONTENT-SENTINEL\n%%EOF'),
      },
    },
    {
      code: 'file',
      file: {
        name: 'empty.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.alloc(0),
      },
    },
  ];
  const requests: Request[] = [];
  page.on('request', (request) => requests.push(request));
  for (const { code, file } of cases) {
    await page.setInputFiles('#pdf-file', file);
    await expect(page.locator('#pdf-status'), code).toContainText(`[${code}]`);
    await expect(page.locator('#pdf-status')).not.toContainText('PRIVATE-');
    await expect(page.locator('#pdf-status')).not.toContainText('Synthetic Person');
    await expect(page.locator('#pdf-status')).not.toContainText('Example Street');
    await expect(page.locator('#pdf-status')).not.toContainText('1.334,57');
    await expect(page.locator('#pdf-status')).not.toContainText(
      /InvalidPDFException|FormatError|TypeError|Error:|at .*\.m?js/,
    );
    await expect(page.locator('#pdf-review')).toBeDisabled();
    await expect(page.locator('#pdf-confirm')).toBeDisabled();
    await expect(page.locator('#pdf-preview')).toBeEmpty();
    await expect(page.locator('#pdf-unknown')).toBeEmpty();
    await expect(snapshotRow(page, '2026-09')).toHaveCount(0);
    await page.setInputFiles('#pdf-file', pdfFile());
    await expectExtractedBalances(page);
    await expect(page.locator('#pdf-review')).toBeEnabled();
    await expect(page.locator('#pdf-confirm')).toBeDisabled();
  }
  expectLocalRequests(requests, new URL(page.url()).origin);
  await page.click('#pdf-cancel');
  await expect(snapshotRow(page, '2026-09')).toHaveCount(0);
});
