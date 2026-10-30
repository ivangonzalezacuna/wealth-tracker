import { expect, test, type Page } from '@playwright/test';
import {
  preparePage,
  gotoApp,
  waitForSyncIdle,
  ensureCardExpanded,
  openCsvImportPreview,
} from './helpers';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function setup(page: Page, contributionBudget?: { local: string; cloud: string }) {
  await preparePage(page);
  await gotoApp(page);
  await waitForSyncIdle(page);
  const cloudData = await page.evaluate(async (budget) => {
    const enginePath = '/src/sync/engine.ts';
    const connectionPath = '/src/db/connection.ts';
    const dbPath = '/src/db/index.ts';
    const db = await import(/* @vite-ignore */ dbPath);
    if (budget) await db.setSetting('monthly_contrib_budget', budget.cloud);
    const engine = await import(/* @vite-ignore */ enginePath);
    engine.cancelPendingUpload();
    if (!(await engine.pushToCloud())) throw new Error('Fixture sync failed');
    const { exportDb } = await import(/* @vite-ignore */ connectionPath);
    return Array.from(exportDb() as Uint8Array);
  }, contributionBudget);
  const server = {
    uploads: 0,
    downloads: 0,
    version: '2026-01-03T00:00:00.000Z',
    uploadFailure: false,
    deleted: false,
    checking: Promise.resolve(),
    uploading: Promise.resolve(),
    downloading: Promise.resolve(),
  };
  await page.route('https://www.googleapis.com/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/upload/drive/')) {
      server.uploads++;
      await server.uploading;
      if (server.uploadFailure) {
        await route.fulfill({ status: 400, body: 'Fictional upload failure' });
        return;
      }
      server.version = new Date().toISOString();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'conflict-fixture', modifiedTime: server.version }),
      });
    } else if (url.includes('alt=media')) {
      server.downloads++;
      await server.downloading;
      await route.fulfill({
        status: 200,
        contentType: 'application/x-sqlite3',
        body: Buffer.from(cloudData),
      });
    } else {
      await server.checking;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          files: server.deleted
            ? []
            : [
                {
                  id: 'conflict-fixture',
                  name: 'wealth-tracker.db',
                  modifiedTime: server.version,
                },
              ],
        }),
      });
    }
  });
  await page.evaluate(async (budget) => {
    const metaPath = '/src/db/repositories/meta.ts';
    const dbPath = '/src/db/index.ts';
    const meta = await import(/* @vite-ignore */ metaPath);
    const db = await import(/* @vite-ignore */ dbPath);
    if (budget) {
      await db.setSetting('monthly_contrib_budget', budget.local);
      const configPath = '/src/store/config.ts';
      const config = await import(/* @vite-ignore */ configPath);
      await config.loadConfig();
    }
    await db.upsertSnapshot({ date: '2024-01', notes: 'Fictional local-only snapshot' });
    await meta.setLastSyncTimestamp('2026-01-01T00:00:00.000Z');
    await meta.setDriveVersion('2026-01-01T00:00:00.000Z');
    await meta.setLastLocalChangeTimestamp('2026-01-02T00:00:00.000Z');
  }, contributionBudget);
  return server;
}

async function detectConflict(page: Page) {
  await page.evaluate(async () => {
    const enginePath = '/src/sync/engine.ts';
    const engine = await import(/* @vite-ignore */ enginePath);
    try {
      await engine.pullFromCloud();
    } catch (error) {
      if (!(error instanceof engine.SyncConflictError)) throw error;
    }
  });
  await expect(page.locator('.conflict-overlay')).toBeVisible();
}

async function snapshots(page: Page) {
  return page.evaluate(async () => {
    const dbPath = '/src/db/index.ts';
    const db = await import(/* @vite-ignore */ dbPath);
    return db.loadSnapshots();
  });
}

async function resolveWith(page: Page, choice: 'local' | 'cloud') {
  await page.click(`.js-conflict-keep-${choice}`);
  await page.click('.js-confirm-ok');
}

test('all dismissal routes preserve data and allow reopening; reload redetects the conflict', async ({
  page,
}) => {
  const server = await setup(page);
  const before = await snapshots(page);
  await page.click('#sync-status');
  await expect(page.locator('.conflict-overlay')).toBeVisible();
  for (const dismiss of ['cancel', 'escape', 'backdrop']) {
    if (dismiss === 'cancel') await page.click('.js-conflict-cancel');
    if (dismiss === 'escape') await page.keyboard.press('Escape');
    if (dismiss === 'backdrop')
      await page.locator('.conflict-overlay').click({ position: { x: 2, y: 2 } });
    await expect(page.locator('.conflict-overlay')).toHaveCount(0);
    await expect(page.locator('#sync-status')).toContainText('Sync paused');
    await expect(page.locator('#sync-status')).toHaveAttribute('data-action', 'resolve');
    expect(await snapshots(page)).toEqual(before);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
    await page.click('#sync-status');
    await expect(page.locator('.conflict-overlay')).toHaveCount(1);
  }
  await page.click('.js-conflict-cancel');
  await page.reload();
  await expect(page.locator('.conflict-overlay')).toBeVisible();
  expect(server.uploads).toBe(0);
  expect(server.downloads).toBe(0);
});

test('keep local explains checking and uploading until the operation really completes', async ({
  page,
}) => {
  const server = await setup(page);
  await detectConflict(page);
  const checking = deferred();
  const uploading = deferred();
  server.checking = checking.promise;
  server.uploading = uploading.promise;
  await resolveWith(page, 'local');
  await expect(page.locator('#sync-status')).toContainText('Checking Drive');
  await expect(page.locator('#sync-status')).toHaveAttribute('aria-busy', 'true');
  checking.resolve();
  await expect(page.locator('#sync-status')).toContainText('Uploading');
  await page.locator('#sync-status').dispatchEvent('click');
  await expect.poll(() => server.uploads).toBe(1);
  await expect(page.locator('.conflict-overlay')).toHaveCount(0);
  uploading.resolve();
  await expect(page.locator('#sync-status')).toContainText('Synced');
  await expect(page.locator('#sync-status')).toHaveAttribute('aria-busy', 'false');
  expect(
    (await snapshots(page)).some((row: { notes: string }) => row.notes.includes('local-only')),
  ).toBe(true);
  expect(server.downloads).toBe(0);
});

test('going offline during recovery stays offline after successful completion', async ({
  page,
}) => {
  const server = await setup(page);
  await detectConflict(page);
  const uploading = deferred();
  server.uploading = uploading.promise;
  await resolveWith(page, 'local');
  await expect(page.locator('#sync-status')).toContainText('Uploading');
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  uploading.resolve();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const lockPath = '/src/sync/lock.ts';
        const { isBusy } = await import(/* @vite-ignore */ lockPath);
        return isBusy();
      }),
    )
    .toBe(false);
  await expect(page.locator('#sync-status')).toContainText('Offline');
  await expect(page.locator('#sync-status')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#sync-status')).not.toHaveAttribute('data-action', /.+/);
});

test('keep cloud shows downloading and replaces local data only after confirmation', async ({
  page,
}) => {
  const server = await setup(page);
  await detectConflict(page);
  await page.click('.js-conflict-keep-cloud');
  await page.click('.js-confirm-cancel');
  await expect(page.locator('.conflict-overlay')).toBeVisible();
  expect(server.downloads).toBe(0);
  const downloading = deferred();
  server.downloading = downloading.promise;
  await resolveWith(page, 'cloud');
  await expect(page.locator('#sync-status')).toContainText('Downloading');
  expect((await snapshots(page)).length).toBe(1);
  downloading.resolve();
  await expect(page.locator('#sync-status')).toContainText('Synced');
  expect(await snapshots(page)).toEqual([]);
  expect(server.downloads).toBe(1);
  expect(server.uploads).toBe(0);
});

for (const view of ['active', 'inactive', 'unrelated draft'] as const) {
  test(`keeping cloud immediately refreshes saved Settings with ${view} view`, async ({ page }) => {
    const server = await setup(page, { local: '200', cloud: '205' });
    await page.click('#tab-settings');
    await ensureCardExpanded(page, 'settings-card-contributions');
    await expect(page.locator('#set-contrib-budget')).toHaveValue('200');
    await page.fill('#set-contrib-budget', '203');
    await page.click('#btn-save-contributions');
    await expect(page.locator('.toast-host')).toContainText('Contributions saved');
    await expect(page.locator('#btn-save-contributions')).toHaveAttribute('data-dirty', 'false');
    if (view === 'unrelated draft') {
      await ensureCardExpanded(page, 'settings-card-calc-assumptions');
      await page.fill('#analytics-risk-free-rate', '4.5');
    } else if (view === 'inactive') {
      await page.click('#tab-networth');
    }
    await detectConflict(page);
    await resolveWith(page, 'cloud');
    await expect(page.locator('#sync-status')).toContainText('Synced');
    if (view === 'inactive') await page.click('#tab-settings');
    await expect(page.locator('#set-contrib-budget')).toHaveValue('205');
    await expect(page.locator('#btn-save-contributions')).toHaveAttribute('data-dirty', 'false');
    expect(server.downloads).toBe(1);
    expect(server.uploads).toBe(0);
    if (view === 'unrelated draft') {
      await expect(page.locator('#analytics-risk-free-rate')).toHaveValue('4.5');
      await expect(page.locator('#btn-save-analytics')).toHaveAttribute('data-dirty', 'true');
      await page.click('#btn-save-analytics');
      await expect(page.locator('.toast-host')).toContainText('Analytics saved');
    }
    await page.reload();
    await ensureCardExpanded(page, 'settings-card-contributions');
    await expect(page.locator('#set-contrib-budget')).toHaveValue('205');
  });
}

test('failed uploads and missing cloud copies remain actionable conflicts', async ({ page }) => {
  const server = await setup(page);
  await detectConflict(page);
  server.uploadFailure = true;
  await resolveWith(page, 'local');
  await expect(page.locator('#sync-status')).toContainText('Sync failed');
  await expect(page.locator('#sync-status')).toHaveAttribute('data-action', 'resolve');
  expect((await snapshots(page)).length).toBe(1);
  await page.click('#sync-status');
  server.deleted = true;
  await resolveWith(page, 'cloud');
  await expect(page.locator('#sync-status')).toContainText('Sync failed');
  expect((await snapshots(page)).length).toBe(1);
  expect(server.downloads).toBe(0);
  server.deleted = false;
  server.uploadFailure = false;
  await page.click('#sync-status');
  await resolveWith(page, 'local');
  await expect(page.locator('#sync-status')).toContainText('Synced');
});

for (const choice of ['local', 'cloud'] as const) {
  test(`refresh failure after keeping ${choice} retries only the local cache`, async ({ page }) => {
    const server = await setup(page);
    await detectConflict(page);
    await page.evaluate(() => {
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        if (this.transaction.db.name === 'wealth-tracker-cache') {
          throw new DOMException('Fictional cache failure', 'QuotaExceededError');
        }
        return original.apply(this, args);
      };
      window.addEventListener(
        'restore-fixture-cache',
        () => {
          IDBObjectStore.prototype.put = original;
        },
        { once: true },
      );
    });
    await resolveWith(page, choice);
    await expect(page.locator('#sync-status')).toContainText('Sync failed');
    await expect(page.locator('#sync-status')).toHaveAttribute('data-action', 'refresh');
    await expect(page.locator('#sync-status')).toHaveAttribute(
      'title',
      /updating local data failed/,
    );
    const transfers = { uploads: server.uploads, downloads: server.downloads };
    await page.evaluate(() => window.dispatchEvent(new Event('restore-fixture-cache')));
    await page.click('#sync-status');
    await expect(page.locator('#sync-status')).toContainText('Synced');
    expect({ uploads: server.uploads, downloads: server.downloads }).toEqual(transfers);
  });
}

test('a blocked Settings save reopens recovery and preserves its draft through resolution', async ({
  page,
}) => {
  const server = await setup(page);
  await page.click('#tab-settings');
  await ensureCardExpanded(page, 'settings-card-contributions');
  await page.fill('#set-contrib-budget', '12345');
  await detectConflict(page);
  await page.click('.js-conflict-cancel');
  await page.click('#btn-save-contributions');
  await expect(page.locator('.conflict-overlay')).toBeVisible();
  await expect(page.locator('#set-contrib-budget')).toHaveValue('12345');
  await expect(page.locator('#btn-save-contributions')).toHaveAttribute('data-dirty', 'true');
  expect(server.uploads).toBe(0);
  await resolveWith(page, 'local');
  await expect(page.locator('#sync-status')).toContainText('Synced');
  await expect(page.locator('#set-contrib-budget')).toHaveValue('12345');
  await page.click('#btn-save-contributions');
  await expect(page.locator('.toast-host')).toContainText('Contributions saved');
  await expect(page.locator('#sync-status')).toContainText('Changes pending');
});

test('a blocked snapshot save and Escape keep the editing draft intact', async ({ page }) => {
  await setup(page);
  await page.click('#tab-log');
  await page.click('#btn-add-snap');
  await page.fill('#snapd-date', '2024-02');
  await page.fill('#snapd-notes', 'Unsaved fictional draft');
  await page.click('.js-snapd-submit');
  await expect(page.locator('.snapd-review')).toBeVisible();
  await detectConflict(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('.snap-dialog-overlay')).toBeVisible();
  await page.click('.js-snapd-submit');
  await expect(page.locator('.conflict-overlay')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.snapd-review')).toContainText('Unsaved fictional draft');
  expect((await snapshots(page)).length).toBe(1);
});

test('a blocked CSV confirmation preserves the preview and imports nothing', async ({ page }) => {
  await setup(page);
  await openCsvImportPreview(page);
  await detectConflict(page);
  await page.click('.js-conflict-cancel');
  await page.click('#btn-confirm-import');
  await expect(page.locator('.conflict-overlay')).toBeVisible();
  await expect(page.locator('#import-preview')).toBeVisible();
  const count = await page.evaluate(async () => {
    const dbPath = '/src/db/index.ts';
    return (await (await import(/* @vite-ignore */ dbPath)).loadTransactions()).length;
  });
  expect(count).toBe(0);
});

test('backup is available while paused, but restore is blocked without changing data', async ({
  page,
}) => {
  const server = await setup(page);
  await detectConflict(page);
  const before = await snapshots(page);
  const download = page.waitForEvent('download');
  await page.click('.js-conflict-backup');
  await download;
  await expect(page.locator('.conflict-overlay')).toBeVisible();
  expect(server.uploads).toBe(0);
  await page.click('.js-conflict-cancel');
  const result = await page.evaluate(() =>
    window.__restoreFromBackup!(
      new File(['{}'], 'fictional-backup.json', { type: 'application/json' }),
    ),
  );
  expect(result).toBe('cancelled');
  await expect(page.locator('.conflict-overlay')).toBeVisible();
  expect(await snapshots(page)).toEqual(before);
  expect(server.uploads).toBe(0);
});

test('a blocked transaction submit keeps the editing draft underneath recovery', async ({
  page,
}) => {
  await setup(page);
  await page.click('#tab-log');
  await page.click('#btn-add-tx');
  await page.fill('#txd-date', '2024-01-03');
  await page.selectOption('#txd-type', 'INTEREST');
  await page.fill('#txd-amount', '12');
  await page.fill('#txd-note', 'Unsaved fictional interest');
  await detectConflict(page);
  await page.keyboard.press('Escape');
  await page.click('.js-txd-submit');
  await expect(page.locator('.conflict-overlay')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#txd-note')).toHaveValue('Unsaved fictional interest');
  const count = await page.evaluate(async () => {
    const dbPath = '/src/db/index.ts';
    return (await (await import(/* @vite-ignore */ dbPath)).loadTransactions()).length;
  });
  expect(count).toBe(0);
});

test('queued uploads show pending, detect conflict, and stay paused across focus and reconnect', async ({
  page,
}) => {
  const server = await setup(page);
  await page.clock.install();
  const checking = deferred();
  server.checking = checking.promise;
  await page.evaluate(async () => {
    const enginePath = '/src/sync/engine.ts';
    (await import(/* @vite-ignore */ enginePath)).scheduleUpload();
  });
  await expect(page.locator('#sync-status')).toContainText('Changes pending');
  await page.clock.fastForward(5_000);
  await expect(page.locator('#sync-status')).toContainText('Checking Drive');
  checking.resolve();
  await expect(page.locator('.conflict-overlay')).toBeVisible();
  await page.click('.js-conflict-cancel');
  await page.evaluate(() => {
    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('focus'));
  });
  await page.clock.fastForward(20_000);
  await expect(page.locator('.conflict-overlay')).toHaveCount(0);
  await expect(page.locator('#sync-status')).toContainText('Sync paused');
  expect(server.uploads).toBe(0);
  expect(server.downloads).toBe(0);
});

test('a successful CSV push clears its uploading chip when the import releases the lock', async ({
  page,
}) => {
  await preparePage(page);
  await gotoApp(page);
  await openCsvImportPreview(page);
  await page.click('#btn-confirm-import');
  await expect(page.locator('#import-msg')).toContainText('Imported 1 new transaction');
  await expect(page.locator('#sync-status')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#sync-status')).toContainText('Synced');
});

test('conflict recovery fits a narrow mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await detectConflict(page);
  await expect(page.getByRole('alertdialog', { name: 'Sync conflict' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.click('.js-conflict-cancel');
  await expect(page.locator('#sync-status')).toContainText('Sync paused');
});
