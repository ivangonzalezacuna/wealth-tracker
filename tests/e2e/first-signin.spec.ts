import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  addSnapshot,
  gotoApp,
  monthOffsetValue,
  openTab,
  preparePage,
  snapshotRow,
} from './helpers';

// A new browser (no local data) that signs in must load the data already in
// Drive, never report a conflict or overwrite Drive with its empty database.

const MONTH = monthOffsetValue(-1);

interface CloudFile {
  data: Buffer;
  modifiedTime: string;
}

/** Save a snapshot on "device A" and return the file it uploads, as Drive stores it. */
async function cloudDbWithSnapshot(browser: Browser): Promise<CloudFile> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await preparePage(page);
  let uploaded: CloudFile | null = null;
  await page.route('https://www.googleapis.com/upload/**', async (route) => {
    const body = route.request().postDataBuffer()!;
    const start = body.indexOf('SQLite format 3');
    const end = body.lastIndexOf(Buffer.from('\r\n--'));
    const modifiedTime = new Date().toISOString();
    uploaded = { data: body.subarray(start, end > start ? end : body.length), modifiedTime };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'file-e2e', modifiedTime }),
    });
  });
  await gotoApp(page);
  await addSnapshot(page, { month: MONTH, note: 'From Drive' });
  await expect.poll(() => uploaded, { timeout: 20_000 }).not.toBeNull();
  await ctx.close();
  return uploaded!;
}

/** Fake GIS. Like the real popup, closing it hands focus back to the page. */
async function fakeGoogleSignIn(page: Page): Promise<void> {
  await page.route('https://accounts.google.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `window.google = { accounts: { oauth2: {
        initTokenClient: (cfg) => { const c = { callback: cfg.callback,
          requestAccessToken: () => setTimeout(() => {
            c.callback({ access_token: 'e2e-token', expires_in: 3600 });
            window.dispatchEvent(new Event('focus'));
          }) };
          return c; },
        revoke: (_t, cb) => cb && cb() } } };`,
    }),
  );
}

/** Drive holding `cloud` with real-ish latency; records every upload. */
async function driveWith(page: Page, cloud: CloudFile): Promise<string[]> {
  const uploads: string[] = [];
  await page.route('https://www.googleapis.com/**', async (route) => {
    const url = route.request().url();
    // Listing the Drive file is the slowest call, as it often is for real.
    const isList = url.includes('/drive/v3/files?');
    await new Promise((r) => setTimeout(r, isList ? 1000 : 100));
    if (url.includes('/upload/')) {
      uploads.push(url);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'file-e2e', modifiedTime: new Date().toISOString() }),
      });
    }
    if (url.includes('alt=media')) {
      return route.fulfill({ status: 200, contentType: 'application/x-sqlite3', body: cloud.data });
    }
    if (url.includes('/about')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user: { emailAddress: 'me@example.com' } }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        files: [{ id: 'file-e2e', name: 'wealth-tracker.db', modifiedTime: cloud.modifiedTime }],
      }),
    });
  });
  return uploads;
}

test.describe('first sign-in on a new browser', () => {
  let cloudDb: CloudFile;
  test.beforeAll(async ({ browser }) => {
    cloudDb = await cloudDbWithSnapshot(browser);
  });

  test('loads the data from Drive without a conflict', async ({ page }) => {
    await fakeGoogleSignIn(page);
    const uploads = await driveWith(page, cloudDb);
    await page.goto('/');
    await page.click('#btn-signin-global');

    await openTab(page, 'tab-log');
    await expect(snapshotRow(page, MONTH)).toHaveCount(1, { timeout: 15_000 });
    await expect(page.locator('#sync-status')).toContainText('Synced');
    await expect(page.locator('#sync-status')).not.toContainText('Sync paused');
    expect(uploads).toEqual([]);
  });

  test('with a token already present, boot sync loads Drive without a conflict', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'gtoken',
        JSON.stringify({ access_token: 'e2e-token', expires_at: Date.now() + 3_600_000 }),
      );
      localStorage.setItem('ggranted', '1');
    });
    await fakeGoogleSignIn(page);
    const uploads = await driveWith(page, cloudDb);
    await gotoApp(page);

    await openTab(page, 'tab-log');
    await expect(snapshotRow(page, MONTH)).toHaveCount(1, { timeout: 15_000 });
    await expect(page.locator('#sync-status')).not.toContainText('Sync paused');
    expect(uploads).toEqual([]);
  });

  test('a browser set up before but with its local data wiped loads Drive on connect', async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem('ggranted', '1'));
    await fakeGoogleSignIn(page);
    const uploads = await driveWith(page, cloudDb);
    await gotoApp(page);
    await expect(page.locator('#sync-status')).toContainText('Not connected');

    await page.click('#sync-status');
    await openTab(page, 'tab-log');
    await expect(snapshotRow(page, MONTH)).toHaveCount(1, { timeout: 15_000 });
    await expect(page.locator('#sync-status')).toContainText('Synced');
    await expect(page.locator('.conflict-overlay')).toHaveCount(0);
    expect(uploads).toEqual([]);
  });

  test('a snapshot saved on that browser before connecting is kept alongside Drive', async ({
    page,
  }) => {
    const LOCAL_MONTH = monthOffsetValue(-2);
    await page.addInitScript(() => localStorage.setItem('ggranted', '1'));
    await fakeGoogleSignIn(page);
    const uploads = await driveWith(page, cloudDb);
    await gotoApp(page);
    await addSnapshot(page, { month: LOCAL_MONTH, note: 'Saved before connecting' });

    await openTab(page, 'tab-log');
    await expect(snapshotRow(page, MONTH)).toHaveCount(1, { timeout: 15_000 });
    await expect(snapshotRow(page, LOCAL_MONTH)).toHaveCount(1);
    await expect(page.locator('.conflict-overlay')).toHaveCount(0);
    await expect.poll(() => uploads.length, { timeout: 15_000 }).toBeGreaterThan(0);
  });
});
