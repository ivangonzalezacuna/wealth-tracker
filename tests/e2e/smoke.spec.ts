import { expect, test } from '@playwright/test';
import path from 'node:path';

const CSV_FIXTURE = path.resolve(
  '/home/runner/work/wealth-tracker/wealth-tracker/tests/e2e/fixtures/trade-republic-sample.csv',
);

function previousMonthValue(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function installLocalAuthBootstrap(page: import('@playwright/test').Page): Promise<void> {
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
}

async function mockGoogleApis(page: import('@playwright/test').Page): Promise<void> {
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

test.beforeEach(async ({ page }) => {
  await installLocalAuthBootstrap(page);
  await mockGoogleApis(page);
});

test('app loads and core tabs are visible', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#tab-networth')).toBeVisible();
  await expect(page.locator('#tab-portfolio')).toBeVisible();
  await expect(page.locator('#tab-analytics')).toBeVisible();
  await expect(page.locator('#tab-settings')).toBeVisible();
  await expect(page.locator('#tab-log')).toBeVisible();
});

test('monthly snapshot flow saves and surfaces success state', async ({ page }) => {
  await page.goto('/');
  await page.click('#tab-log');
  await page.click('#btn-add-snap');
  await page.fill('#snapd-date', previousMonthValue());
  await page.click('.js-snapd-submit');
  await expect(page.locator('#snap-msg')).toContainText('Saved');
});

test('analytics tab renders after adding a snapshot', async ({ page }) => {
  await page.goto('/');
  await page.click('#tab-log');
  await page.click('#btn-add-snap');
  await page.fill('#snapd-date', previousMonthValue());
  await page.click('.js-snapd-submit');
  await expect(page.locator('#snap-msg')).toContainText('Saved');
  await page.click('#tab-analytics');
  await expect(page.locator('#an-content')).toBeVisible();
});

test('csv import flow parses and confirms import', async ({ page }) => {
  await page.goto('/');
  await page.click('#tab-log');
  await page.setInputFiles('#csv-file-input', CSV_FIXTURE);
  await expect(page.locator('#btn-confirm-import')).toBeVisible();
  await page.click('#btn-confirm-import');
  await expect(page.locator('#import-msg')).toContainText('Imported');
});
