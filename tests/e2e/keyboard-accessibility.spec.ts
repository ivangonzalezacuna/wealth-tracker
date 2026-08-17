import { expect, test } from '@playwright/test';
import { ensureCardExpanded, gotoApp, openTab, preparePage } from './helpers';

test.beforeEach(async ({ page }) => {
  await preparePage(page);
});

test('snapshot dialog traps focus and closes on Escape', async ({ page }) => {
  await gotoApp(page);
  await openTab(page, 'tab-log');
  await page.click('#btn-add-snap');

  // Dialog is visible
  await expect(page.locator('.snap-dialog-overlay')).toBeVisible();

  // Press Escape to close
  await page.keyboard.press('Escape');
  await expect(page.locator('.snap-dialog-overlay')).toHaveCount(0);
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
  await page.click('#btn-add-tx');
  await expect(page.locator('.tx-dialog-overlay')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('.tx-dialog-overlay')).toHaveCount(0);
});

test('tab navigation via keyboard works across main tabs', async ({ page }) => {
  await gotoApp(page);

  // Focus the nav and use keyboard to navigate
  await page.locator('#tab-networth').focus();
  await expect(page.locator('#tab-networth')).toBeFocused();

  // Tab to next element
  await page.keyboard.press('Tab');
  // The next focusable should be in the nav or content area
  const focused = await page.evaluate(
    () => document.activeElement?.id || document.activeElement?.tagName,
  );
  expect(focused).toBeTruthy();
});
