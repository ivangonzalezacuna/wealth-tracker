import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { ensureCardExpanded, gotoApp, openTab, preparePage } from '../e2e/helpers';
import { reviewBackup, type ReviewState } from './fixture';

export type LayoutMetrics = {
  viewport: { width: number; height: number };
  pageOverflow: number;
  height: number;
  outOfBounds: string[];
  controls: { text: string; width: number; height: number }[];
  clipped: { text: string | undefined; width: number; scroll: number }[];
};

/** Fixed clock, saved theme and a fresh app for every review test. */
export function useReviewPage() {
  test.beforeEach(async ({ page }, info) => {
    await preparePage(page);
    await page.clock.install({ time: new Date('2026-05-15T12:00:00Z') });
    await page.addInitScript(
      (theme) => localStorage.setItem('wt-theme', theme),
      String(info.project.metadata.theme),
    );
    await gotoApp(page);
  });
}

export async function seed(page: Page, state: ReviewState = 'complete') {
  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-backup');
  await page.setInputFiles('#backup-file-input', {
    name: 'synthetic-ui-review.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(reviewBackup(state))),
  });
  await page.locator('.js-confirm-ok').click();
  await expect(page.locator('.toast-text').last()).toContainText('Restore complete.');
  await page.getByRole('button', { name: 'Dismiss notification' }).click();
  await openTab(page, 'tab-networth');
  await expect(page.locator('#nw-content')).toBeVisible();
}

export async function capture(
  page: Page,
  info: TestInfo,
  name: string,
  root: string,
): Promise<LayoutMetrics> {
  await page.mouse.move(0, 0);
  await page.locator(root).scrollIntoViewIfNeeded();
  // Advance animation frames explicitly: wall-clock waits can capture partial canvases under load.
  await page.clock.runFor(1200);
  await page.screenshot({
    path: info.outputPath(`${name}.png`),
    fullPage: true,
    animations: 'disabled',
  });
  await info.attach(name, { path: info.outputPath(`${name}.png`), contentType: 'image/png' });
  const metrics = await page.locator(root).evaluate((el) => {
    const visible = (selector: string) =>
      [...el.querySelectorAll<HTMLElement>(selector)].filter(
        (node) => node.getClientRects().length,
      );
    return {
      viewport: { width: innerWidth, height: innerHeight },
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      height: el.getBoundingClientRect().height,
      outOfBounds: [...el.querySelectorAll<HTMLElement>('*')]
        .filter((node) => {
          if (!node.getClientRects().length) return false;
          for (let p = node.parentElement; p && p !== el; p = p.parentElement) {
            if (getComputedStyle(p).overflowX !== 'visible') return false;
          }
          const box = node.getBoundingClientRect();
          return box.right > document.documentElement.clientWidth + 1 || box.left < -1;
        })
        .map((node) => `${node.tagName.toLowerCase()}#${node.id}.${[...node.classList].join('.')}`)
        .slice(0, 10),
      controls: visible('button, input, select, summary').map((node) => ({
        text: node.textContent?.trim().slice(0, 70) || node.getAttribute('aria-label') || node.id,
        width: node.getBoundingClientRect().width,
        height: node.getBoundingClientRect().height,
      })),
      clipped: visible('.row-label, .row-val, .kpi-val, .card-title, [role="cell"]')
        .filter((node) => node.scrollWidth > node.clientWidth + 1)
        .map((node) => ({
          text: node.textContent?.trim(),
          width: node.clientWidth,
          scroll: node.scrollWidth,
        })),
    };
  });
  await info.attach(`${name}-layout`, {
    body: JSON.stringify(metrics, null, 2),
    contentType: 'application/json',
  });
  expect
    .soft(metrics.pageOverflow, `${name}: document must not scroll sideways`)
    .toBeLessThanOrEqual(1);
  expect.soft(metrics.outOfBounds, `${name}: elements must stay inside the viewport`).toEqual([]);
  return metrics;
}
