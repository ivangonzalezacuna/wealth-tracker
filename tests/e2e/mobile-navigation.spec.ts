import { expect, test, type Page } from '@playwright/test';
import { chartBackup } from './fixtures/chartBackup';
import { ensureCardExpanded, gotoApp, preparePage, waitForSyncIdle } from './helpers';

async function openPhone(page: Page, hash: string) {
  await page.goto(`/#${hash}`);
  await expect(page.locator('#app-sub')).toContainText('30 snapshots');
  await waitForSyncIdle(page);
  const section = hash.split('/')[0];
  await expect(page.locator(`#${section} .section-loading, #${section} .an-computing`)).toHaveCount(
    0,
  );
}

async function wheel(page: Page, delta: number) {
  await page.mouse.move(387, 350);
  await page.mouse.wheel(0, delta);
  await page.waitForTimeout(180);
}

const body = (page: Page) => page.locator('body');
const HIDDEN = /mobile-nav-hidden/;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await preparePage(page);
  await gotoApp(page);
  await page.locator('#tab-settings').click();
  await ensureCardExpanded(page, 'settings-card-backup');
  await page.locator('#backup-file-input').setInputFiles({
    name: 'mobile-demo.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(chartBackup())),
  });
  await page.locator('.js-confirm-ok').click();
  await expect(page.locator('.toast-text').last()).toContainText('Restore complete.');
  await page.getByRole('button', { name: 'Dismiss notification' }).last().click();
  await waitForSyncIdle(page);
});

test('dock hides on long pages without reflow and returns upward, on focus and at the end', async ({
  page,
}) => {
  // Pages with less than a screen left below never hide the dock, so it cannot flash.
  for (const hash of ['networth', 'log/snapshots', 'settings/general']) {
    await openPhone(page, hash);
    await page.evaluate(() => scrollTo(0, 0));
    await wheel(page, 120);
    await expect(body(page), hash).not.toHaveClass(HIDDEN);
  }

  await openPhone(page, 'analytics');
  await page.evaluate(() => scrollTo(0, 0));
  await wheel(page, 120);
  await expect(body(page)).toHaveClass(HIDDEN);
  const heights = await page.evaluate(() => {
    const before = document.documentElement.scrollHeight;
    document.body.classList.remove('mobile-nav-hidden');
    const after = document.documentElement.scrollHeight;
    document.body.classList.add('mobile-nav-hidden');
    return [before, after];
  });
  expect(heights[0]).toBe(heights[1]);
  for (let i = 0; i < 3; i++) {
    await wheel(page, -3);
    await wheel(page, 3);
  }
  await expect(body(page)).toHaveClass(HIDDEN);
  await wheel(page, -10);
  await expect(body(page)).not.toHaveClass(HIDDEN);
  await wheel(page, 48);
  await expect(body(page)).toHaveClass(HIDDEN);
  await page.keyboard.press('Tab');
  await expect(body(page)).not.toHaveClass(HIDDEN);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await wheel(page, 200);
  await expect(body(page)).toHaveClass(HIDDEN);

  // URL bars change only the height mid-scroll; that must not reveal the dock.
  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForTimeout(150);
  await expect(body(page)).toHaveClass(HIDDEN);
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight - innerHeight - 120));
  await page.waitForTimeout(150);
  await expect(body(page)).toHaveClass(HIDDEN);
  // A collapsing URL bar can expose the reserved dock space without any scroll event.
  await page.setViewportSize({ width: 390, height: 880 });
  await expect(body(page)).not.toHaveClass(HIDDEN);
  await expect(page.locator('.nav')).toHaveCSS('transform', 'none');

  await page.setViewportSize({ width: 390, height: 844 });
  await wheel(page, 5000);
  const gap = await page.evaluate(
    () =>
      document.querySelector('.nav')!.getBoundingClientRect().top -
      document.querySelector('.section.active')!.getBoundingClientRect().bottom,
  );
  expect(gap).toBeGreaterThanOrEqual(7);
  expect(gap).toBeLessThanOrEqual(24);
});

test('phone widths fit compact sub-tabs, the snapshot action and toasts above the dock', async ({
  page,
}) => {
  await openPhone(page, 'networth');
  const subnavs = {
    portfolio: '#portfolio-subnav',
    log: '#log-subnav',
    settings: '.settings-tabs',
  };
  for (const width of [320, 390, 640]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator('.nav')).toHaveCSS('position', 'fixed');
    for (const section of ['networth', 'portfolio', 'analytics', 'settings', 'log']) {
      await page.locator(`#tab-${section}`).click();
      const sizes = await page
        .locator('.nav button')
        .evaluateAll((els) => els.map((el) => el.getBoundingClientRect()));
      expect(sizes.every((size) => size.width >= 44 && size.height >= 44)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
      const selector = subnavs[section as keyof typeof subnavs];
      if (!selector) continue;
      const heights = await page
        .locator(`${selector} > button`)
        .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
      expect(Math.max(...heights)).toBeLessThanOrEqual(24);
      expect((await page.locator(selector).boundingBox())!.height).toBeLessThanOrEqual(30);
    }
    const action = page.getByRole('button', { name: 'Add monthly snapshot' });
    const [tabs, box] = await Promise.all([
      page.locator('#log-subnav').boundingBox(),
      action.boundingBox(),
    ]);
    expect(Math.abs(tabs!.y + tabs!.height / 2 - (box!.y + box!.height / 2))).toBeLessThan(2);
    if (width < 360) expect(Math.abs(box!.width - box!.height)).toBeLessThan(2);
    else await expect(action).toHaveText('Snapshot', { useInnerText: true });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(async () => {
    const { notify } = await import('/src/ui/toast.ts');
    notify('Mobile layout check');
  });
  const dock = (await page.locator('.nav').boundingBox())!;
  await expect
    .poll(async () => {
      const box = (await page.locator('.toast').boundingBox())!;
      return box.y + box.height;
    })
    .toBeLessThanOrEqual(dock.y - 8);
  await page.getByRole('button', { name: 'Dismiss notification' }).click();
  await page.locator('#btn-add-snap').click();
  await page.locator('.snap-dialog-overlay .dialog-fields').hover();
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(350);
  await expect(body(page)).not.toHaveClass(HIDDEN);
  await page.keyboard.press('Escape');

  const viewportMeta = () =>
    page.evaluate(() => document.querySelector<HTMLMetaElement>('meta[name="viewport"]')!.content);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('.nav')).toHaveCSS('position', 'relative');
  await expect(page.locator('.nav-icon').first()).toBeHidden();
  await expect(page.locator('#btn-add-snap')).toHaveText('Add monthly snapshot', {
    useInnerText: true,
  });
  await expect.poll(viewportMeta).not.toContain('viewport-fit');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(viewportMeta).toContain('viewport-fit=cover');
});

test('warning dots never steal navigation and Holdings explains the warning in place', async ({
  page,
}) => {
  await openPhone(page, 'networth');
  const portfolioDot = page.locator('#tab-portfolio .attn-dot');
  await page.locator('#tab-portfolio').hover({ position: { x: 8, y: 42 } });
  await expect(page.locator('.info-tip-pop')).toHaveCount(0);
  await portfolioDot.hover();
  await expect(page.locator('.info-tip-pop')).toBeVisible();
  await portfolioDot.click();
  await expect(page).toHaveURL(/#portfolio$/);
  await expect(page.locator('#holdings-attention')).toContainText('allocation drift');
  await page.locator('#tab-contributions').click();
  await page.locator('#tab-holdings .attn-dot').click();
  await expect(page.locator('#tab-holdings')).toHaveAttribute('aria-selected', 'true');
});

test('tab icons share one square frame and active highlights slide between tabs', async ({
  page,
  browserName,
}) => {
  await openPhone(page, 'portfolio');
  const boxes = await page
    .locator('.nav-icon')
    .evaluateAll((els) =>
      els
        .map((el) => (el as SVGGraphicsElement).getBBox())
        .map((b) => [b.x, b.y, b.width, b.height]),
    );
  for (const box of boxes) expect(box).toEqual([4, 4, 16, 16]);
  if (browserName === 'chromium')
    expect(
      await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('-webkit-tap-highlight-color'),
      ),
    ).toBe('rgba(0, 0, 0, 0)');
  const indicator = (selector: string) =>
    page.locator(selector).evaluate((el) => {
      const active = el.querySelector<HTMLElement>(':scope > [aria-selected="true"]')!;
      return {
        x: el.style.getPropertyValue('--tab-x'),
        activeX: `${active.offsetLeft}px`,
        transition: getComputedStyle(el, '::before').transitionDuration,
      };
    });
  await expect(page.locator('.nav')).toHaveClass(/tab-indicator-animate/);
  const before = await indicator('#portfolio-subnav');
  expect(before.x).toBe(before.activeX);
  expect(before.transition).toContain('0.22s');
  await page.locator('#tab-dividends').click();
  await expect
    .poll(async () => {
      const state = await indicator('#portfolio-subnav');
      return state.x === state.activeX && state.x !== before.x;
    })
    .toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect((await indicator('#portfolio-subnav')).transition).toBe('0s');
});

test('Settings sub-tabs keep drafts and reselecting returns to the top', async ({ page }) => {
  await openPhone(page, 'settings/planning');
  const card = page.locator('#settings-card-contributions');
  if (await card.evaluate((el) => el.classList.contains('collapsed')))
    await card.locator('.js-card-toggle').click();
  await page.locator('#set-contrib-budget').fill('765');
  await page.locator('#settings-tab-advanced').click();
  await page.locator('#settings-tab-planning').click();
  await expect(page.locator('#set-contrib-budget')).toHaveValue('765');
  await page.evaluate(() => scrollTo(0, 280));
  await page.waitForTimeout(200);
  await page.locator('#tab-settings').click();
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await expect(page.locator('#set-contrib-budget')).toHaveValue('765');
  await page.locator('#settings-tab-planning').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#settings-tab-advanced')).toBeFocused();
  await expect(page).toHaveURL(/#settings\/advanced$/);
});
