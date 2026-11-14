import { expect, test } from '@playwright/test';
import {
  ensureCardExpanded,
  gotoApp,
  openTab,
  openTransactionDialog,
  preparePage,
  waitForSyncIdle,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await preparePage(page);
});

test('snapshot dialog traps focus and closes on Escape', async ({ page }) => {
  await gotoApp(page);
  await openTab(page, 'tab-log');
  await waitForSyncIdle(page);
  await page.locator('#btn-add-snap').focus();
  await page.click('#btn-add-snap');

  const dialog = page.locator('.snap-dialog-overlay');
  await expect(dialog).toBeVisible();
  const first = dialog.locator('#snapd-date');
  const review = dialog.getByRole('button', { name: 'Review', exact: true });
  await review.focus();
  await page.keyboard.press('Tab');
  await expect(first).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(review).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('#btn-add-snap')).toBeFocused();
});

test('account dialog closes on Escape key', async ({ page }) => {
  await gotoApp(page);
  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-accounts');
  await page.click('#btn-add-acct');
  await expect(page.locator('.acct-dialog-overlay')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('.acct-dialog-overlay')).toHaveCount(0);
});

test('holding dialog closes on Escape key', async ({ page }) => {
  await gotoApp(page);
  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-holdings');
  await page.click('#btn-add-hold');
  await expect(page.locator('.hold-dialog-overlay')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('.hold-dialog-overlay')).toHaveCount(0);
});

test('goal dialog closes on Escape key', async ({ page }) => {
  await gotoApp(page);
  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-goal');
  await page.click('#btn-add-goal');
  await expect(page.locator('.goal-dialog-overlay')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('.goal-dialog-overlay')).toHaveCount(0);
});

test('transaction dialog closes on Escape key', async ({ page }) => {
  await gotoApp(page);
  await openTab(page, 'tab-log');
  await openTransactionDialog(page);
  await expect(page.locator('.tx-dialog-overlay')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('.tx-dialog-overlay')).toHaveCount(0);
});

test('main tabs use roving focus and update ARIA state on keyboard activation', async ({
  page,
}) => {
  await gotoApp(page);
  const nav = page.getByRole('tablist', { name: 'Main sections' });
  const networth = page.locator('#tab-networth');
  const portfolio = page.locator('#tab-portfolio');

  await networth.focus();
  await page.keyboard.press('ArrowRight');
  await expect(portfolio).toBeFocused();
  await expect(portfolio).toHaveAttribute('tabindex', '0');
  await expect(networth).toHaveAttribute('tabindex', '-1');
  await expect(networth).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(portfolio).toHaveAttribute('aria-selected', 'true');
  await expect(networth).toHaveAttribute('aria-selected', 'false');
  await expect(page.locator('#portfolio')).toBeVisible();
  await expect(nav.locator('[aria-selected="true"]')).toHaveCount(1);

  await portfolio.press('Enter');
  await expect(nav.locator('[aria-selected="true"]')).toHaveCount(1);
  await page.keyboard.press('End');
  await expect(page.locator('#tab-log')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(networth).toBeFocused();
});

test('portfolio sub-tabs keep ARIA selection and tab stops aligned', async ({ page }) => {
  await gotoApp(page);
  await openTab(page, 'tab-portfolio');
  const tabs = page.locator('#portfolio-subnav');
  for (const name of ['contributions', 'dividends', 'holdings']) {
    const tab = page.locator(`#tab-${name}`);
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(tab).toHaveAttribute('tabindex', '0');
    await expect(tabs.locator('[aria-selected="true"]')).toHaveCount(1);
    await expect(tabs.locator('[tabindex="0"]')).toHaveCount(1);
    await expect(page.locator(`#subview-${name}`)).toBeVisible();
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
  }
});
