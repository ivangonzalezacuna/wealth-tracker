import { expect, test } from '@playwright/test';
import {
  addAccount,
  addSnapshot,
  ensureCardExpanded,
  gotoApp,
  monthOffsetValue,
  openTab,
  preparePage,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await preparePage(page);
});

test('goal with milestones renders progress and milestone markers on net worth', async ({
  page,
}) => {
  await gotoApp(page);
  await addAccount(page, {
    label: 'Main Broker',
    institution: 'IBKR',
    annualReturnPct: 7,
    primary: true,
  });
  await addSnapshot(page, {
    month: monthOffsetValue(-1),
    note: 'Baseline',
    accountValues: { 'Main Broker': 5000 },
  });

  // Add a goal with milestones
  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-goal');
  await page.click('#btn-add-goal');
  await page.fill('#goald-label', 'Retirement');
  await page.fill('#goald-target', '100000');

  // Add a milestone
  await page.click('.js-ms-add');
  await page.locator('.ms-amount').first().fill('25000');
  await page.locator('.ms-label').first().fill('Quarter way');

  // Add second milestone
  await page.click('.js-ms-add');
  await page.locator('.ms-amount').nth(1).fill('50000');
  await page.locator('.ms-label').nth(1).fill('Half way');

  await page.click('.js-goald-submit');
  await expect(page.locator('#settings-goals-tbl')).toContainText('Retirement');
  await page.click('#btn-save-goal');
  await expect(page.locator('#goal-msg')).toContainText('Saved');

  // Verify goal renders on net worth tab with milestone info
  await openTab(page, 'tab-networth');
  await expect(page.locator('#nw-goal')).toContainText('Retirement');
  await expect(page.locator('#nw-goal')).toContainText('5% complete');
});

test('goal edit and delete flows work correctly', async ({ page }) => {
  await gotoApp(page);
  await addAccount(page, {
    label: 'Broker A',
    institution: 'TR',
    annualReturnPct: 6,
    primary: true,
  });

  // Add a goal
  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-goal');
  await page.click('#btn-add-goal');
  await page.fill('#goald-label', 'House Fund');
  await page.fill('#goald-target', '50000');
  await page.click('.js-goald-submit');
  await page.click('#btn-save-goal');
  await expect(page.locator('#goal-msg')).toContainText('Saved');

  // Edit the goal
  await ensureCardExpanded(page, 'settings-card-goal');
  await page.locator('.js-edit-goal').first().click();
  await page.fill('#goald-label', 'House Fund Updated');
  await page.fill('#goald-target', '60000');
  await page.click('.js-goald-submit');
  await expect(page.locator('#settings-goals-tbl')).toContainText('House Fund Updated');
  await page.click('#btn-save-goal');
  await expect(page.locator('#goal-msg')).toContainText('Saved');

  // Delete the goal
  await ensureCardExpanded(page, 'settings-card-goal');
  await page.locator('.js-del-goal').first().click();
  await page.click('.js-confirm-ok');
  await expect(page.locator('#settings-goals-tbl')).not.toContainText('House Fund Updated');
});

test('milestone removal within goal dialog works', async ({ page }) => {
  await gotoApp(page);

  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-goal');
  await page.click('#btn-add-goal');
  await page.fill('#goald-label', 'Test Goal');
  await page.fill('#goald-target', '10000');

  // Add two milestones
  await page.click('.js-ms-add');
  await page.locator('.ms-amount').first().fill('3000');
  await page.click('.js-ms-add');
  await page.locator('.ms-amount').nth(1).fill('6000');
  await expect(page.locator('.goal-milestone-row')).toHaveCount(2);

  // Remove first milestone
  await page
    .locator('.goal-milestone-row')
    .first()
    .locator('[aria-label*="Remove milestone"]')
    .click();
  await expect(page.locator('.goal-milestone-row')).toHaveCount(1);

  // Cancel - nothing is saved
  await page.click('.js-goald-cancel');
  await expect(page.locator('.goal-dialog-overlay')).toHaveCount(0);
});
