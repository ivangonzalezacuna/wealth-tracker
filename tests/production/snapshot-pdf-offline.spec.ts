import { expect, test } from '@playwright/test';
import { syntheticPdf } from '../fixtures/snapshot-import/synthetic';
import { addAccount, gotoApp, openTab, preparePage, waitForSyncIdle } from '../e2e/helpers';

test('production CSP permits the local PDF worker and installed PWA imports offline', async ({
  page,
  context,
}) => {
  await preparePage(page);
  const violations: string[] = [];
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      console.error(`CSP violation: ${event.violatedDirective}`);
    });
  });
  page.on('console', (message) => {
    if (message.text().startsWith('CSP violation:')) violations.push(message.text());
  });
  await gotoApp(page);
  await addAccount(page, { label: 'Offline Fictional Broker', primary: true });
  await waitForSyncIdle(page);
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    if (!registration.active) throw new Error('No active service worker.');
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const cachesList = await caches.keys();
        for (const name of cachesList) {
          const cache = await caches.open(name);
          const urls = (await cache.keys()).map((request) => request.url);
          if (
            urls.some((url) => /pdf\.worker.*\.mjs/.test(url)) &&
            urls.some((url) => /sql-wasm.*\.wasm/.test(url))
          )
            return true;
        }
        return false;
      }),
    )
    .toBe(true);
  // Firefox request interception bypasses service workers, even for unrelated routes.
  await page.unrouteAll();
  await context.setOffline(true);
  await page.reload();
  await openTab(page, 'tab-log');
  await page.click('#btn-add-snap');
  await page.fill('#snapd-date', '2024-01');
  await page.setInputFiles('#snapd-pdf-file', {
    name: 'offline-fictional.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await syntheticPdf()),
  });
  await expect(page.locator('.snap-pdf-status')).toContainText('7 ETF positions recognized');
  await page.selectOption('#snapd-pdf-mode', 'combined');
  await page.getByRole('button', { name: 'Save mapping and fill draft' }).click();
  await expect(page.locator('.snap-pdf-status')).toContainText('filled automatically');
  await page.click('.js-snapd-submit');
  await expect(page.locator('.snapd-review')).toContainText('ETF breakdown');
  await page.click('.js-snapd-submit');
  await expect(page.locator('#snap-msg')).toContainText('Saved locally');
  expect(violations).toEqual([]);
});
