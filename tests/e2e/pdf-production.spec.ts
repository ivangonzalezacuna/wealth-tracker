import { expect, test, type Request } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { realisticStatementFixture, syntheticPdf } from './fixtures/pdfStatement';
import { gotoApp, openTab, preparePage, waitForSyncIdle } from './helpers';

test('built PDF worker runs under the deployed CSP and its asset is precached', async ({
  context,
  page,
}) => {
  const dist = path.resolve('dist');
  const netlify = await readFile('netlify.toml', 'utf8');
  const headerSection = netlify.split('[headers.values]')[1];
  expect(headerSection).toBeTruthy();
  const headers = Object.fromEntries(
    [...headerSection.matchAll(/^\s+([\w-]+)\s*=\s*"([^"]+)"$/gm)].map((match) => [
      match[1],
      match[2],
    ]),
  );
  expect(headers['Content-Security-Policy']).toContain("worker-src 'self'");
  const assets = await readdir(path.join(dist, 'assets'));
  const workerAsset = assets.find((asset) => /^pdf\.worker.*\.(m?js)$/.test(asset));
  const parserAsset = assets.find((asset) => /^pdf-[\w-]+\.js$/.test(asset));
  expect(workerAsset, 'build must emit a local PDF worker asset').toBeTruthy();
  expect(parserAsset, 'build must emit a local PDF parser asset').toBeTruthy();
  const sw = await readFile(path.join(dist, 'sw.js'), 'utf8');
  expect(sw, 'offline precache must include the emitted PDF worker').toContain(workerAsset!);
  expect(sw, 'offline precache must include the emitted PDF parser').toContain(parserAsset!);

  await preparePage(page);
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' }),
  );
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort());
  const violations: string[] = [];
  await page.addInitScript(() => {
    (window as Window & { pdfCspViolations: string[] }).pdfCspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      (window as Window & { pdfCspViolations: string[] }).pdfCspViolations.push(
        `${event.violatedDirective}: ${event.blockedURI}`,
      );
    });
  });
  const mime: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.wasm': 'application/wasm',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
  };
  await context.route('http://127.0.0.1:4173/**', async (route) => {
    const url = new URL(route.request().url());
    const relative =
      url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const filename = path.resolve(dist, relative);
    if (!filename.startsWith(dist + path.sep)) {
      await route.fulfill({ status: 403, body: '' });
      return;
    }
    try {
      await route.fulfill({
        status: 200,
        headers,
        contentType: mime[path.extname(filename)] || 'application/octet-stream',
        body: await readFile(filename),
      });
    } catch {
      await route.fulfill({ status: 404, body: '' });
    }
  });
  const workers: string[] = [];
  page.on('worker', (worker) => workers.push(worker.url()));
  const documentResponse = page.waitForResponse(
    (response) =>
      response.request().isNavigationRequest() && response.url() === 'http://127.0.0.1:4173/',
  );
  await gotoApp(page);
  expect((await documentResponse).headers()['content-security-policy']).toBe(
    headers['Content-Security-Policy'],
  );
  await openTab(page, 'tab-log');
  await waitForSyncIdle(page);
  const setupUpload = await page.waitForResponse((response) =>
    response.url().startsWith('https://www.googleapis.com/upload/drive/v3/'),
  );
  await setupUpload.finished();
  await waitForSyncIdle(page);
  const requests: Request[] = [];
  page.on('request', (request) => requests.push(request));
  await page.click('#btn-pdf-snap');
  await page.setInputFiles('#pdf-file', {
    name: 'SYNTHETIC-PRIVATE.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(syntheticPdf(realisticStatementFixture())),
  });
  await expect(page.locator('#pdf-status')).toContainText('Valuation date 2026-09-30');
  await expect(page.locator('#pdf-unknown input')).toHaveCount(7);
  expect(
    workers.some((url) => new URL(url, page.url()).pathname === `/assets/${workerAsset}`),
  ).toBe(true);
  for (const request of requests) {
    expect(new URL(request.url()).origin).toBe(new URL(page.url()).origin);
    expect(request.method()).toBe('GET');
    expect(request.postData()).toBeNull();
    expect(request.url()).not.toMatch(/SYNTHETIC-PRIVATE|DE000000|2026-09-30|1234\.56/);
  }
  violations.push(
    ...(await page.evaluate(
      () => (window as Window & { pdfCspViolations: string[] }).pdfCspViolations,
    )),
  );
  expect(violations).toEqual([]);
  await page.click('#pdf-cancel');
});
