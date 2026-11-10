import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import {
  addAccount,
  addManualTransaction,
  addSnapshot,
  gotoApp,
  openTab,
  openTransactionDialog,
  preparePage,
  waitForSyncIdle,
} from './helpers';

test.use({
  hasTouch: true,
  isMobile: async ({ browserName }, use) => {
    await use(browserName !== 'firefox');
  },
  viewport: { width: 390, height: 844 },
});
test.beforeEach(async ({ page }) => {
  await preparePage(page);
  await gotoApp(page);
});

const pointer = (target: Locator, type: string, x: number, y: number) =>
  target.dispatchEvent(type, {
    pointerType: 'touch',
    pointerId: 7,
    isPrimary: true,
    clientX: x,
    clientY: y,
    bubbles: true,
    cancelable: true,
    buttons: type === 'pointerup' ? 0 : 1,
  });
async function capture(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: info.outputPath(name + '.png') });
}
async function seedTransaction(page: Page) {
  await addManualTransaction(page, { date: '2026-01-15', amount: '12', note: 'Gesture example' });
  await waitForSyncIdle(page);
  const row = page.locator('.tx-row[data-txkey]').first();
  await row.scrollIntoViewIfNeeded();
  return row;
}

test('compact transaction rows keep readable metadata and a separate bulk selection column', async ({
  page,
}) => {
  const row = await seedTransaction(page);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(row.locator('.tx-row-badge')).toHaveCount(0);
    await expect(row.locator('.tx-row-title')).toContainText('Interest');
    await expect(row.getByRole('cell', { name: 'Interest', exact: true })).toBeVisible();
    await expect(row.locator('.tx-row-sub')).not.toContainText('Interest');
    await expect(row).toHaveCSS('min-height', '44px');
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(43.99);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );

    await page.locator('#btn-start-del-txs').click();
    const selection = row.locator('.tx-actions-mobile .js-tx-select');
    await expect(selection).toBeVisible();
    const checkbox = (await selection.boundingBox())!;
    const title = (await row.locator('.tx-row-title').boundingBox())!;
    expect(checkbox.x + checkbox.width).toBeLessThanOrEqual(title.x);
    await selection.check();
    await expect(selection).toBeChecked();
    await expect(row).toHaveAttribute('aria-expanded', 'false');
    await page.locator('#btn-start-del-txs').click();
    await expect(selection).toHaveCount(0);
  }
});

test('Back closes a dialog without changing the selected route, then closes the header menu', async ({
  page,
}) => {
  await openTab(page, 'tab-log');
  await openTransactionDialog(page);
  const url = page.url();
  await page.goBack();
  await expect(page.locator('.tx-dialog-overlay')).toHaveCount(0);
  await expect(page).toHaveURL(url);
  await page.locator('#btn-header-menu').click();
  await expect(page.locator('#header-menu')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#header-menu')).toBeHidden();
  await expect(page).toHaveURL(url);
});

test('a phone sheet follows a downward drag and dismisses through the normal path', async ({
  page,
}, info) => {
  await openTab(page, 'tab-log');
  await openTransactionDialog(page);
  const header = page.locator('.tx-dialog-overlay .dialog-header');
  const box = (await header.boundingBox())!;
  const x = 120,
    y = box.y + 10;
  await pointer(header, 'pointerdown', x, y);
  await pointer(header, 'pointermove', x, y + 100);
  await expect(page.locator('.tx-dialog-overlay .dialog-card')).toHaveCSS(
    'transform',
    'matrix(1, 0, 0, 1, 0, 100)',
  );
  await capture(page, info, 'sheet-mid-drag');
  await pointer(header, 'pointermove', x, y + 350);
  await pointer(header, 'pointerup', x, y + 350);
  await expect(page.locator('.tx-dialog-overlay')).toHaveCount(0);
});

test('long press opens compact actions and Back closes them without expanding the transaction', async ({
  page,
}, info) => {
  const row = await seedTransaction(page);
  const box = (await row.boundingBox())!;
  await pointer(row, 'pointerdown', 120, box.y + 20);
  await expect(page.getByRole('menu', { name: 'Row actions' })).toBeVisible();
  await pointer(row, 'pointerup', 120, box.y + 20);
  await expect(page.getByRole('menuitem', { name: 'Edit', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Delete', exact: true })).toBeVisible();
  await row.dispatchEvent('contextmenu', { pointerType: 'touch', bubbles: true, cancelable: true });
  await expect(page.locator('.gesture-menu')).toHaveCount(1);
  await capture(page, info, 'long-press-menu');
  await page.goBack();
  await expect(page.locator('.gesture-menu')).toHaveCount(0);
  await expect(row).toHaveAttribute('aria-expanded', 'false');
});

test('swipe reveals actions, tapping closes without expansion, Delete still confirms', async ({
  page,
}, info) => {
  const row = await seedTransaction(page);
  await row.click();
  await expect(page.locator('.tx-detail')).toBeVisible();
  await expect(page.locator('.tx-detail-actions')).toBeHidden();
  await row.click();
  const swipe = async () => {
    const box = (await row.boundingBox())!;
    await pointer(row, 'pointerdown', 250, box.y + 20);
    await pointer(row, 'pointermove', 105, box.y + 20);
    await pointer(row, 'pointerup', 105, box.y + 20);
  };
  await swipe();
  await expect(row.locator('.gesture-row-actions')).toBeVisible();
  await expect(row.locator(':scope > [data-ledger-label="Amount"]')).toHaveCSS(
    'transform',
    'matrix(1, 0, 0, 1, -128, 0)',
  );
  const amount = (await row.locator(':scope > [data-ledger-label="Amount"]').boundingBox())!;
  const edit = (await row
    .locator('.gesture-row-actions')
    .getByRole('button', { name: 'Edit' })
    .boundingBox())!;
  expect(amount.x + amount.width).toBeLessThan(edit.x);
  await capture(page, info, 'swipe-actions');
  await pointer(row, 'pointerdown', 150, amount.y + 10);
  await pointer(row, 'pointermove', 260, amount.y + 10);
  await pointer(row, 'pointerup', 260, amount.y + 10);
  await expect(row.locator('.gesture-row-actions')).toHaveCount(0);
  await expect(row).toHaveAttribute('aria-expanded', 'false');
  await swipe();
  await row.click({ position: { x: 30, y: 20 } });
  await expect(row.locator('.gesture-row-actions')).toHaveCount(0);
  await expect(row).toHaveAttribute('aria-expanded', 'false');
  await swipe();
  await row.locator('.gesture-row-actions').getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('.confirm-overlay')).toBeVisible();
  await page.goBack();
  await expect(page.locator('.confirm-overlay')).toHaveCount(0);
  await expect(row).toBeVisible();
});

test('snapshot rows support long press and swipe actions too', async ({ page }) => {
  await addSnapshot(page, { month: '2026-01' });
  await page.locator('#log-tab-snapshots').click();
  const row = page.locator('.snap-row-compact[data-date]').first();
  await row.scrollIntoViewIfNeeded();
  await row.click();
  await expect(page.locator('.snap-detail')).toBeVisible();
  await expect(page.locator('.snap-detail-actions')).toBeHidden();
  await row.click();
  const box = (await row.boundingBox())!;
  await pointer(row, 'pointerdown', 120, box.y + 15);
  await expect(page.locator('.gesture-menu')).toBeVisible();
  await pointer(row, 'pointerup', 120, box.y + 15);
  await page.keyboard.press('Escape');
  await expect(page.locator('.gesture-menu')).toHaveCount(0);
  await pointer(row, 'pointerdown', 250, box.y + 15);
  await pointer(row, 'pointermove', 100, box.y + 15);
  await pointer(row, 'pointerup', 100, box.y + 15);
  await row.locator('.gesture-row-actions').getByRole('button', { name: 'Edit' }).click();
  await expect(page.locator('.snap-dialog-overlay')).toBeVisible();
});

test('native touch arbitration keeps downward sheet drags and horizontal row swipes', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Native touch injection uses Chromium CDP');
  await openTab(page, 'tab-log');
  await openTransactionDialog(page);
  const session = await page.context().newCDPSession(page);
  const drag = async (x: number, y: number, dx: number, dy: number) => {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 8; step++) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + (dx * step) / 8, y: y + (dy * step) / 8 }],
      });
    }
  };
  const box = (await page.locator('.tx-dialog-overlay .dialog-header').boundingBox())!;
  await drag(120, box.y + 10, 0, 100);
  await expect(page.locator('.tx-dialog-overlay .dialog-card')).toHaveCSS(
    'transform',
    'matrix(1, 0, 0, 1, 0, 100)',
  );
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.keyboard.press('Escape');
  const row = await seedTransaction(page);
  const rowBox = (await row.boundingBox())!;
  await drag(260, rowBox.y + 15, -145, 0);
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(row.locator('.gesture-row-actions')).toBeVisible();
  await session.detach();
});

test('repeated overlay closes leave no extra Back stops', async ({ page }) => {
  const previous = page.url();
  await page.goto('/?gestures=history');
  await expect(page.locator('#tab-networth')).toBeVisible();
  await openTab(page, 'tab-log');
  for (let count = 0; count < 3; count++) {
    await openTransactionDialog(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('.tx-dialog-overlay')).toHaveCount(0);
  }
  await page.goBack();
  await expect(page).toHaveURL(previous);
});

test('a closing editor cannot steal focus from the next dialog', async ({ page }) => {
  await openTab(page, 'tab-log');
  await openTransactionDialog(page);
  await page.evaluate(() => {
    const back = history.back.bind(history);
    history.back = () => Object.assign(window, { resumeOverlayBack: back });
    document.querySelector<HTMLButtonElement>('.js-txd-cancel')!.click();
    document.getElementById('btn-add-snap')!.click();
  });
  const notes = page.locator('#snapd-notes');
  await notes.fill('Preserve the next dialog draft');
  await page.evaluate(async () => {
    (window as unknown as { resumeOverlayBack: () => void }).resumeOverlayBack();
    const path = '/src/ui/overlayHistory.ts';
    await (await import(path)).whenOverlayHistorySettled();
  });
  await expect(notes).toHaveValue('Preserve the next dialog draft');
  await expect(notes).toBeFocused();
});

test('sign-out waits for menu history before requesting a reload', async ({ page }) => {
  await waitForSyncIdle(page);
  await page.locator('#btn-header-menu').click();
  await page.evaluate(() => {
    const back = history.back.bind(history);
    history.back = () => Object.assign(window, { resumeOverlayBack: back });
  });
  await page.locator('#btn-signout').click();
  await expect.poll(() => page.evaluate(() => 'resumeOverlayBack' in window)).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('gtoken'))).not.toBeNull();
  await Promise.all([
    page.waitForEvent('load'),
    page.evaluate(() =>
      (window as unknown as { resumeOverlayBack: () => void }).resumeOverlayBack(),
    ),
  ]);
  await expect(page.locator('#tab-networth')).toBeVisible();
});

test('settings rows run Edit and Delete from swipe and long press', async ({ page }, info) => {
  await addAccount(page, { label: 'Swipe account' });
  const row = page.locator('#settings-accounts-tbl .settings-acct-row').first();
  await row.scrollIntoViewIfNeeded();
  let box = (await row.boundingBox())!;
  await pointer(row, 'pointerdown', 250, box.y + 15);
  await pointer(row, 'pointermove', 100, box.y + 15);
  await pointer(row, 'pointerup', 100, box.y + 15);
  await capture(page, info, 'settings-swipe');
  await row.locator('.gesture-row-actions').getByRole('button', { name: 'Edit' }).click();
  await expect(page.locator('.acct-dialog-overlay')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.acct-dialog-overlay')).toHaveCount(0);
  box = (await row.boundingBox())!;
  await pointer(row, 'pointerdown', 120, box.y + 15);
  await expect(page.locator('.gesture-menu')).toBeVisible();
  await pointer(row, 'pointerup', 120, box.y + 15);
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await expect(page.locator('#settings-accounts-tbl .settings-item-removed')).toContainText(
    'Swipe account',
  );
});

async function realTouch(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: string, x: number, y: number) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }],
    });
  const drag = async (x0: number, y0: number, x1: number, y1: number) => {
    await touch('touchStart', x0, y0);
    for (let i = 1; i <= 8; i++) {
      await touch('touchMove', x0 + ((x1 - x0) * i) / 8, y0 + ((y1 - y0) * i) / 8);
      await page.waitForTimeout(16);
    }
    await touch('touchEnd', x1, y1);
  };
  const tap = async (x: number, y: number) => {
    await touch('touchStart', x, y);
    await page.waitForTimeout(70);
    await touch('touchEnd', x, y);
  };
  return { drag, tap };
}

test('real touch: one tap runs a swipe action right after a fast swipe', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Needs CDP touch input');
  const { drag, tap } = await realTouch(page);
  await openTab(page, 'tab-log');
  const row = await seedTransaction(page);
  const box = (await row.boundingBox())!;
  const y = box.y + 20;
  await drag(box.x + box.width - 60, y, box.x + box.width - 260, y);
  await expect(row.locator('.gesture-row-actions')).toBeVisible();
  await tap(box.x + box.width - 96, y);
  await expect(page.locator('.tx-dialog-overlay')).toBeVisible();
});

test('real touch: a vertical drag starting on a row still scrolls the page', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Needs CDP touch input');
  const { drag } = await realTouch(page);
  await openTab(page, 'tab-log');
  const row = await seedTransaction(page);
  await page.setViewportSize({ width: 390, height: 360 });
  await row.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  const y = (await row.boundingBox())!.y + 20;
  await drag(200, y, 200, y - 150);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
});
