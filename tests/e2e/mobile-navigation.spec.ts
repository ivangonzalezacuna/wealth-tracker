import { expect, test, type Page } from '@playwright/test';
import { chartBackup } from './fixtures/chartBackup';
import { ensureCardExpanded, gotoApp, preparePage, waitForSyncIdle } from './helpers';

async function seed(page: Page) {
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
}

async function openPilot(page: Page, hash: string) {
  await page.goto(`/?mobile-ui=1#${hash}`);
  await expect(page.locator('#app-sub')).toContainText('30 snapshots');
  await waitForSyncIdle(page);
}

async function chooseSettings(page: Page, label: string) {
  await page.locator(`#settings-tab-${label.toLowerCase()}`).click();
}

async function wheel(page: Page, delta: number) {
  const size = page.viewportSize()!;
  await page.mouse.move(size.width - 3, Math.min(size.height / 2, 350));
  await page.mouse.wheel(0, delta);
  await page.waitForTimeout(180);
}

test.beforeEach(async ({ page }) => {
  await seed(page);
});

test('Settings shares visible section tabs and reselect returns to them without losing drafts', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPilot(page, 'settings/advanced');
  await expect(page.locator('.settings-tabs')).toBeVisible();
  await expect(page.locator('#settings-view-picker')).toHaveCount(0);
  await expect(page.locator('.settings-tabs')).toHaveCSS('position', 'static');
  await chooseSettings(page, 'Planning');
  await expect(page).toHaveURL(/#settings\/planning$/);
  await expect(page.locator('#settings-tab-planning')).toHaveAttribute('aria-selected', 'true');
  const card = page.locator('#settings-card-contributions');
  if (await card.evaluate((el) => el.classList.contains('collapsed')))
    await card.locator('.js-card-toggle').click();
  await page.locator('#set-contrib-budget').fill('765');
  await expect(page.locator('#btn-save-contributions')).toHaveAttribute('data-dirty', 'true');
  await page.evaluate(() => scrollTo(0, 0));
  await chooseSettings(page, 'Advanced');
  await chooseSettings(page, 'Planning');
  await expect(page.locator('#set-contrib-budget')).toHaveValue('765');
  await expect(page.locator('#btn-save-contributions')).toHaveAttribute('data-dirty', 'true');
  await page.locator('#set-contrib-budget').evaluate((el) => (el.dataset.testRetained = 'true'));
  await page.evaluate(() => scrollTo(0, 280));
  await page.waitForTimeout(200);
  await page.locator('#tab-settings').click();
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await expect(page.locator('#set-contrib-budget')).toHaveAttribute('data-test-retained', 'true');
  await expect(page.locator('#set-contrib-budget')).toHaveValue('765');
  await page.locator('#settings-tab-planning').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#settings-tab-advanced')).toBeFocused();
  await expect(page).toHaveURL(/#settings\/advanced$/);
  await page.screenshot({ path: info.outputPath('settings-segments.png'), scale: 'css' });
});

test('dock hides without reflow or jitter, returns upward and remains keyboard accessible', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPilot(page, 'networth');
  await expect(page.locator('#nw-kpis')).toBeVisible();
  await page.locator('#networth').evaluate((el) => (el.style.minHeight = '2400px'));
  await page.evaluate(() => scrollTo(0, 200));
  await page.waitForTimeout(350);
  await expect(page.locator('body')).not.toHaveClass(/mobile-nav-hidden/);
  await page.mouse.move(387, 350);
  await page.mouse.wheel(0, 48);
  await expect(page.locator('body')).toHaveClass(/mobile-nav-hidden/);
  await page.mouse.wheel(0, -10);
  await expect(page.locator('body')).not.toHaveClass(/mobile-nav-hidden/);
  await page.waitForTimeout(150);
  await wheel(page, 48);
  await expect(page.locator('body')).toHaveClass(/mobile-nav-hidden/);
  await page.waitForTimeout(300);
  // Measure both states in one task so async chart rendering cannot skew the comparison.
  const geometry = await page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>('.nav')!;
    nav.style.transition = 'none';
    const measure = () => ({
      height: document.documentElement.scrollHeight,
      kpiTop: document.getElementById('nw-kpis')!.getBoundingClientRect().top + scrollY,
      navTop: nav.getBoundingClientRect().top,
    });
    const hidden = measure();
    document.body.classList.remove('mobile-nav-hidden');
    const visible = measure();
    document.body.classList.add('mobile-nav-hidden');
    nav.style.transition = '';
    return { hidden, visible };
  });
  expect(geometry.hidden.height).toBe(geometry.visible.height);
  expect(geometry.hidden.kpiTop).toBeCloseTo(geometry.visible.kpiTop, 2);
  expect(geometry.hidden.navTop).toBeGreaterThanOrEqual(844);
  expect(geometry.visible.navTop).toBe(787);
  for (let i = 0; i < 4; i++) {
    await wheel(page, -3);
    await wheel(page, 3);
  }
  await expect(page.locator('body')).toHaveClass(/mobile-nav-hidden/);
  await wheel(page, -10);
  await expect(page.locator('body')).not.toHaveClass(/mobile-nav-hidden/);
  await wheel(page, 40);
  await expect(page.locator('body')).not.toHaveClass(/mobile-nav-hidden/);
  await wheel(page, 48);
  await expect(page.locator('body')).toHaveClass(/mobile-nav-hidden/);
  await page.locator('#tab-networth').focus();
  await expect(page.locator('body')).not.toHaveClass(/mobile-nav-hidden/);
  await page.locator('#tab-networth').evaluate((el) => el.blur());
  await wheel(page, -30);
  await wheel(page, 48);
  await expect(page.locator('body')).toHaveClass(/mobile-nav-hidden/);
  await page.keyboard.press('Tab');
  await expect(page.locator('body')).not.toHaveClass(/mobile-nav-hidden/);
  await page.locator('#tab-networth').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#tab-portfolio')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#portfolio$/);
  await page.locator('#tab-contributions').click();
  await expect(page).toHaveURL(/#portfolio\/contributions$/);
  await page.locator('#tab-log').click();
  await page.locator('#log-tab-snapshots').click();
  await expect(page).toHaveURL(/#log\/snapshots$/);
});

test('Chromium touch swipes hide and recover the dock', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP touch dispatch is Chromium-only');
  await page.setViewportSize({ width: 390, height: 844 });
  await openPilot(page, 'networth');
  await expect(page.locator('#nw-kpis')).toBeVisible();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await page.evaluate(() => scrollTo(0, 160));
  await page.waitForTimeout(350);
  async function swipe(start: number, end: number) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: 386, y: start }],
    });
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: 386, y: start + ((end - start) * i) / 8 }],
      });
      await page.waitForTimeout(50);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(350);
  }
  await swipe(650, 350);
  await expect(page.locator('body')).toHaveClass(/mobile-nav-hidden/);
  await swipe(350, 430);
  await expect(page.locator('body')).not.toHaveClass(/mobile-nav-hidden/);
  await cdp.detach();
});

test('warning dots never steal navigation and Holdings explains the warning in place', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPilot(page, 'networth');
  const portfolioDot = page.locator('#tab-portfolio .attn-dot');
  await expect(portfolioDot).toBeVisible();
  await page.locator('#tab-portfolio').hover({ position: { x: 8, y: 42 } });
  await expect(page.locator('.info-tip-pop')).toHaveCount(0);
  await portfolioDot.hover();
  await expect(page.locator('.info-tip-pop')).toBeVisible();
  await portfolioDot.click();
  await expect(page).toHaveURL(/#portfolio$/);
  await expect(page.locator('.info-tip-pop')).toHaveCount(0);
  await expect(page.locator('#holdings-attention')).toBeVisible();
  await expect(page.locator('#holdings-attention')).toContainText('allocation drift');
  await page.locator('#tab-contributions').click();
  await page.locator('#tab-holdings .attn-dot').click();
  await expect(page).toHaveURL(/#portfolio$/);
  await expect(page.locator('#tab-holdings')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#holdings-attention')).toBeVisible();
  await page.screenshot({ path: info.outputPath('holdings-warning.png'), scale: 'css' });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('#tab-networth').click();
  await portfolioDot.click();
  await expect(page.locator('#portfolio')).toHaveClass(/active/);
});

test('the dock returns at page end without changing height or clamping scroll', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPilot(page, 'log/snapshots');
  await expect(page.locator('#log-tab-snapshots')).toHaveAttribute('aria-selected', 'true');
  // A deterministic last-content marker avoids chart and ledger pagination variability.
  await page.locator('#log').evaluate((el) => {
    const end = document.createElement('div');
    end.id = 'test-page-end';
    end.style.height = '1600px';
    end.textContent = 'End-of-page layout check';
    el.append(end);
  });
  await page.evaluate(() => scrollTo(0, 200));
  await wheel(page, 48);
  await expect(page.locator('body')).toHaveClass(/mobile-nav-hidden/);
  const documentHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight - innerHeight - 200));
  await page.waitForTimeout(200);
  await expect(page.locator('body')).toHaveClass(/mobile-nav-hidden/);
  await wheel(page, 5000);
  await expect(page.locator('body')).not.toHaveClass(/mobile-nav-hidden/);
  await expect(page.locator('.nav')).toHaveCSS('transform', 'none');
  const bottom = await page.evaluate(() => ({
    height: document.documentElement.scrollHeight,
    y: scrollY,
    dockTop: document.querySelector('.nav')!.getBoundingClientRect().top,
    contentBottom: document.getElementById('test-page-end')!.getBoundingClientRect().bottom,
    padding: parseFloat(getComputedStyle(document.body).paddingBottom),
  }));
  expect(bottom.height).toBe(documentHeight);
  expect(bottom.y).toBe(documentHeight - 844);
  expect(bottom.padding).toBe(65);
  expect(bottom.dockTop - bottom.contentBottom).toBeGreaterThanOrEqual(8);
  expect(bottom.dockTop - bottom.contentBottom).toBeLessThan(9);
  for (let i = 0; i < 3; i++) {
    await wheel(page, -3);
    await wheel(page, 3);
    await expect(page.locator('body')).not.toHaveClass(/mobile-nav-hidden/);
    expect(await page.evaluate(() => scrollY)).toBe(bottom.y);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(documentHeight);
  }
  await page.screenshot({ path: info.outputPath('page-end.png'), scale: 'css' });
  await page.locator('#test-page-end').evaluate((el) => el.remove());
  for (const section of ['networth', 'portfolio', 'analytics', 'settings', 'log']) {
    await page.locator(`#tab-${section}`).click();
    await expect(
      page.locator(`#${section} .section-loading, #${section} .an-computing`),
    ).toHaveCount(0);
    await page.evaluate(async () => {
      scrollTo(0, document.documentElement.scrollHeight);
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    });
    await expect
      .poll(() =>
        page.evaluate(
          () => Math.max(0, document.documentElement.scrollHeight - innerHeight) - scrollY,
        ),
      )
      .toBe(0);
    await expect(page.locator('body')).not.toHaveClass(/mobile-nav-hidden/);
    await expect(page.locator('.nav')).toHaveCSS('transform', 'none');
    const end = await page.evaluate(() => ({
      height: document.documentElement.scrollHeight,
      y: scrollY,
      contentBottom: document.querySelector('.section.active')!.getBoundingClientRect().bottom,
      dockTop: document.querySelector('.nav')!.getBoundingClientRect().top,
    }));
    expect(end.dockTop - end.contentBottom).toBeGreaterThanOrEqual(7);
    if (end.y > 0)
      expect(end.dockTop - end.contentBottom, `${section} end clearance`).toBeLessThanOrEqual(24);
    await page.waitForTimeout(180);
    expect(await page.evaluate(() => scrollY)).toBe(end.y);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(end.height);
    await page.screenshot({ path: info.outputPath(`${section}-page-end.png`), scale: 'css' });
  }
});

test('phone widths fit, overlays clear the dock, and the pilot does not change desktop', async ({
  page,
}, info) => {
  await openPilot(page, 'networth');
  for (const width of [320, 375, 390, 430, 640]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator('.nav')).toHaveCSS('position', 'fixed');
    for (const section of ['networth', 'portfolio', 'analytics', 'settings', 'log']) {
      await page.locator(`#tab-${section}`).click();
      const sizes = await page.locator('.nav button').evaluateAll((els) =>
        els.map((el) => ({
          width: el.getBoundingClientRect().width,
          height: el.getBoundingClientRect().height,
        })),
      );
      expect(sizes.every((size) => size.width >= 44 && size.height >= 44)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
      if (['portfolio', 'settings', 'log'].includes(section)) {
        const selector =
          section === 'portfolio'
            ? '#portfolio-subnav'
            : section === 'log'
              ? '#log-subnav'
              : '.settings-tabs';
        await expect(page.locator(selector)).toBeVisible();
        await expect(page.locator(selector)).toHaveCSS('position', 'static');
        for (const button of await page.locator(`${selector} > button`).all())
          await expect(button).toHaveCSS('min-height', '36px');
      }
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#tab-networth').click();
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath('mobile-dock.png'), scale: 'css' });
  await page.evaluate(async () => {
    const { notify } = await import('/src/ui/toast.ts');
    notify('Mobile pilot layout check');
  });
  await expect(page.locator('.toast-text')).toContainText('Mobile pilot layout check');
  const toast = (await page.locator('.toast').boundingBox())!;
  const dock = (await page.locator('.nav').boundingBox())!;
  expect(toast.y + toast.height).toBeLessThanOrEqual(dock.y);
  await expect
    .poll(async () => {
      const box = (await page.locator('.toast').boundingBox())!;
      return box.y + box.height;
    })
    .toBeLessThanOrEqual(dock.y - 8);
  await page.getByRole('button', { name: 'Dismiss notification' }).click();
  await page.locator('#tab-log').click();
  await page.locator('#btn-add-snap').click();
  await expect(page.locator('.snap-dialog-overlay')).toBeVisible();
  await page.locator('.snap-dialog-overlay .dialog-fields').hover();
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(350);
  await expect(page.locator('body')).not.toHaveClass(/mobile-nav-hidden/);
  await page.keyboard.press('Escape');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.nav')).toHaveCSS('transition-duration', '0s');
  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(page.locator('.nav')).toHaveCSS('position', 'static');
  await page.locator('#tab-settings').click();
  await expect(page.locator('.settings-tabs')).toBeVisible();
  await expect(page.locator('#settings-view-picker')).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('.nav-icon').first()).toBeHidden();
  await page.goto('/#networth');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.nav')).toHaveCSS('position', 'static');
  await expect(page.locator('body')).not.toHaveClass(/mobile-ui-pilot/);
});
