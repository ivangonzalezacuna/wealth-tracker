import { expect, test } from '@playwright/test';
import { gotoApp, openTab, preparePage } from './helpers';

test.beforeEach(async ({ page }) => {
  await preparePage(page);
});

test('net worth shows empty state when no snapshots exist', async ({ page }) => {
  await gotoApp(page);
  // Net worth tab is default — should show empty state
  await expect(page.locator('#nw-empty')).toBeVisible();
  await expect(page.locator('#nw-empty')).toContainText('No snapshots yet');
  await expect(page.locator('#nw-content')).not.toBeVisible();
});

test('portfolio shows empty state when no transactions exist', async ({ page }) => {
  await gotoApp(page);
  await openTab(page, 'tab-portfolio');
  await expect(page.locator('#port-empty')).toBeVisible();
  await expect(page.locator('#port-empty')).toContainText('No transaction data imported');
  await expect(page.locator('#port-content')).not.toBeVisible();
});

test('contributions sub-view shows empty state when no transactions exist', async ({ page }) => {
  await gotoApp(page);
  await openTab(page, 'tab-portfolio');
  await page.click('#tab-contributions');
  await expect(page.locator('#dca-empty')).toBeVisible();
  await expect(page.locator('#dca-empty')).toContainText('No transaction data imported');
});

test('dividends sub-view shows empty state when no transactions exist', async ({ page }) => {
  await gotoApp(page);
  await openTab(page, 'tab-portfolio');
  await page.click('#tab-dividends');
  await expect(page.locator('#div-empty')).toBeVisible();
  await expect(page.locator('#div-empty')).toContainText('No transaction data imported');
});

test('empty state "Add first snapshot" button navigates to log tab', async ({ page }) => {
  await gotoApp(page);
  await expect(page.locator('#nw-empty')).toBeVisible();
  await page.locator('#nw-empty [data-goto="log"]').click();
  // Log tab should now be active
  await expect(page.locator('#tab-log')).toHaveAttribute('aria-selected', 'true');
});

test('log tab shows empty ledger message when no transactions', async ({ page }) => {
  await gotoApp(page);
  await openTab(page, 'tab-log');
  await expect(page.locator('#tx-ledger-list')).toContainText('No transactions yet');
});
