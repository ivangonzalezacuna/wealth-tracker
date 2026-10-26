import { expect, test, type Page } from '@playwright/test';
import {
  addSnapshot,
  gotoApp,
  monthOffsetValue,
  openTab,
  preparePage,
  snapshotRow,
} from './helpers';

// Changes that never reach Google Drive must stay on the device and be visible
// in the header chip, whatever the reason the push did not happen.

/** A browser that signed in before but has no token: Google can't be reached. */
async function prepareNotConnected(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('ggranted', '1'));
  await page.route('https://accounts.google.com/**', (route) =>
    route.fulfill({ status: 200, body: '', contentType: 'application/javascript' }),
  );
  await page.route('https://www.googleapis.com/**', (route) =>
    route.fulfill({ status: 401, body: '{}', contentType: 'application/json' }),
  );
}

const chip = (page: Page) => page.locator('#sync-status');

test.describe('unsynced changes', () => {
  test('stay on the device and keep showing "Not synced" across reloads', async ({ page }) => {
    await prepareNotConnected(page);
    await gotoApp(page);
    const month = monthOffsetValue(-1);
    await addSnapshot(page, { month, note: 'Never pushed' });

    await expect(chip(page)).toContainText('Not synced');
    await expect(chip(page)).toHaveAttribute('data-action', 'sync');

    await page.reload();
    await expect(chip(page)).toContainText('Not synced');
    await openTab(page, 'tab-log');
    await expect(snapshotRow(page, month)).toHaveCount(1);
  });

  test('a failing Drive upload while signed in shows "Sync failed", not "Synced"', async ({
    page,
  }) => {
    await preparePage(page);
    await page.route('https://www.googleapis.com/upload/**', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: '{"error":{"message":"Backend Error"}}',
      }),
    );
    await gotoApp(page);
    await addSnapshot(page, { month: monthOffsetValue(-1), note: 'Upload fails' });

    // Debounced push (5 s) plus Drive retries.
    await expect(chip(page)).toContainText('Sync failed', { timeout: 20_000 });
    await expect(chip(page)).toHaveAttribute('title', /not in Google Drive yet/);
    await expect(chip(page)).toHaveAttribute('data-action', 'sync');

    // Next boot: the pending push fails again and must not report "Synced".
    await page.reload();
    await expect(chip(page)).toContainText('Sync failed', { timeout: 20_000 });
  });

  test('going offline keeps saying the changes are not synced', async ({ page, context }) => {
    await prepareNotConnected(page);
    await gotoApp(page);
    await addSnapshot(page, { month: monthOffsetValue(-1), note: 'Offline pending' });
    await expect(chip(page)).toContainText('Not synced');

    await context.setOffline(true);
    await expect(chip(page)).toContainText('Offline · not synced');
    await context.setOffline(false);
  });

  test('signing out asks first and can be cancelled', async ({ page }) => {
    await prepareNotConnected(page);
    await gotoApp(page);
    await addSnapshot(page, { month: monthOffsetValue(-1), note: 'Before sign-out' });
    await expect(chip(page)).toContainText('Not synced');

    await page.click('#btn-header-menu');
    await page.click('#btn-signout');
    const dialog = page.getByRole('alertdialog', { name: 'Sign out with unsynced changes?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('ggranted'))).toBe('1');
  });
});
