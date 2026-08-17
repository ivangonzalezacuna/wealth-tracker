import { expect, type Page } from '@playwright/test';
import path from 'node:path';

export const CSV_FIXTURE = path.resolve(
  '/home/runner/work/wealth-tracker/wealth-tracker/tests/e2e/fixtures/trade-republic-sample.csv',
);

export const INVALID_DATE_CSV_FIXTURE = path.resolve(
  '/home/runner/work/wealth-tracker/wealth-tracker/tests/e2e/fixtures/trade-republic-invalid-date.csv',
);

export function monthOffsetValue(offsetMonths: number): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + offsetMonths);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function dayOffsetValue(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export async function preparePage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      'gtoken',
      JSON.stringify({
        access_token: 'e2e-token',
        expires_at: Date.now() + 1000 * 60 * 60,
      }),
    );
    localStorage.setItem('ggranted', '1');
  });
  await page.route('https://accounts.google.com/**', async (route) => {
    await route.fulfill({
      status: 200,
      body: '',
      contentType: 'application/javascript',
    });
  });
  await page.route('https://www.googleapis.com/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/drive/v3/files?')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ files: [] }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'file-e2e',
        modifiedTime: '2026-01-01T00:00:00.000Z',
      }),
    });
  });
}

export async function gotoApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#tab-networth')).toBeVisible();
}

export async function openTab(page: Page, tabId: string): Promise<void> {
  await page.click(`#${tabId}`);
}

export async function ensureCardExpanded(page: Page, cardId: string): Promise<void> {
  const card = page.locator(`#${cardId}`);
  await expect(card).toBeVisible();
  const isCollapsed = await card.evaluate((el) => el.classList.contains('collapsed'));
  if (isCollapsed) {
    await card.locator('.js-card-toggle').click();
  }
}

export async function addAccount(
  page: Page,
  opts: {
    label: string;
    institution?: string;
    annualReturnPct?: number;
    primary?: boolean;
    locked?: boolean;
    lockedUntil?: string;
  },
): Promise<void> {
  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-accounts');
  await page.click('#btn-add-acct');
  await page.fill('#acctd-label', opts.label);
  await page.selectOption('#acctd-type', 'investment');
  if (opts.institution) await page.fill('#acctd-institution', opts.institution);
  if (opts.annualReturnPct != null) {
    await page.fill('#acctd-return', String(opts.annualReturnPct));
  }
  if (opts.primary) await page.check('#acctd-primary');
  if (opts.locked) {
    await page.check('#acctd-locked');
    if (opts.lockedUntil) await page.fill('#acctd-locked-until', opts.lockedUntil);
  }
  await page.click('.js-acctd-submit');
  await expect(page.locator('#settings-accounts-tbl')).toContainText(opts.label);
  await page.click('#btn-save-accts');
  await expect(page.locator('#accts-msg')).toContainText('Saved');
}

export async function addGoal(
  page: Page,
  opts: { label: string; targetNetWorth: string; targetDate?: string },
): Promise<void> {
  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-goal');
  await page.click('#btn-add-goal');
  await page.fill('#goald-label', opts.label);
  await page.fill('#goald-target', opts.targetNetWorth);
  if (opts.targetDate) await page.fill('#goald-date', opts.targetDate);
  await page.click('.js-goald-submit');
  await expect(page.locator('#settings-goals-tbl')).toContainText(opts.label);
  await page.click('#btn-save-goal');
  await expect(page.locator('#goal-msg')).toContainText('Saved');
}

export async function addSnapshot(
  page: Page,
  opts: { month: string; note?: string; accountValues?: Record<string, string | number> },
): Promise<void> {
  await openTab(page, 'tab-log');
  await page.click('#btn-add-snap');
  await page.fill('#snapd-date', opts.month);
  if (opts.note) await page.fill('#snapd-notes', opts.note);
  for (const [label, value] of Object.entries(opts.accountValues ?? {})) {
    await page.getByLabel(`${label} (€)`).fill(String(value));
  }
  await page.click('.js-snapd-submit');
  await expect(page.locator('#snap-msg')).toContainText('Saved');
}

export function snapshotRow(page: Page, month: string) {
  return page.locator(`.snap-row-compact[data-date="${month}"]`);
}

export async function addManualTransaction(
  page: Page,
  opts: { date: string; type?: string; amount: string; tax?: string; note?: string },
): Promise<void> {
  await openTab(page, 'tab-log');
  await page.click('#btn-add-tx');
  await page.fill('#txd-date', opts.date);
  await page.selectOption('#txd-type', opts.type ?? 'INTEREST');
  await page.fill('#txd-amount', opts.amount);
  if (opts.tax != null) await page.fill('#txd-tax', opts.tax);
  if (opts.note) await page.fill('#txd-note', opts.note);
  await page.click('.js-txd-submit');
  await expect(page.locator('#tx-msg')).toContainText('Transaction');
}

export function txRow(page: Page, text: string) {
  return page.locator('#tx-ledger-list .tx-row').filter({ hasText: text }).first();
}
