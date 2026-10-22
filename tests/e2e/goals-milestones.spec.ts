import { expect, test } from '@playwright/test';
import {
  addAccount,
  addSnapshot,
  ensureCardExpanded,
  gotoApp,
  monthOffsetValue,
  openTab,
  preparePage,
  expectToast,
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
  await expectToast(page, 'goal-msg', 'Goals saved');

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
  await expectToast(page, 'goal-msg', 'Goals saved');

  // Edit the goal
  await ensureCardExpanded(page, 'settings-card-goal');
  await page.locator('.js-edit-goal').first().click();
  await page.fill('#goald-label', 'House Fund Updated');
  await page.fill('#goald-target', '60000');
  await page.click('.js-goald-submit');
  await expect(page.locator('#settings-goals-tbl')).toContainText('House Fund Updated');
  await page.click('#btn-save-goal');
  await expectToast(page, 'goal-msg', 'Goals saved');

  // Delete the goal: staged until Save goals
  await ensureCardExpanded(page, 'settings-card-goal');
  await page.locator('.js-del-goal').first().click();
  await expect(page.locator('#settings-goals-tbl .settings-item-removed')).toContainText(
    'House Fund Updated',
  );
  await page.click('#btn-save-goal');
  await expectToast(page, 'goal-msg', 'Goals saved');
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

test('deleting a goal is staged with undo and never saves other drafts', async ({ page }) => {
  await gotoApp(page);
  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-goal');
  for (const [label, target] of [
    ['Goal A', '10000'],
    ['Goal B', '20000'],
  ]) {
    await page.click('#btn-add-goal');
    await page.fill('#goald-label', label);
    await page.fill('#goald-target', target);
    await page.click('.js-goald-submit');
  }
  await page.click('#btn-save-goal');
  await expectToast(page, 'goal-msg', 'Goals saved');

  // Draft edit + draft add
  await page.locator('.js-edit-goal').nth(1).click();
  await page.fill('#goald-label', 'Goal B EDITED');
  await page.click('.js-goald-submit');
  await page.click('#btn-add-goal');
  await page.fill('#goald-label', 'Goal C NEW');
  await page.fill('#goald-target', '30000');
  await page.click('.js-goald-submit');

  const table = page.locator('#settings-goals-tbl');
  await expect(table.locator('.settings-item-edited')).toContainText('Goal B EDITED');
  await expect(table.locator('.settings-item-new')).toContainText('Goal C NEW');

  // Staged removal, then undo, then remove again
  await table.locator('.js-del-goal').first().click();
  await expect(page.locator('.js-confirm-ok')).toHaveCount(0);
  await expect(table.locator('.settings-item-removed')).toContainText('Goal A');
  await table.getByRole('button', { name: 'Undo remove goal Goal A' }).click();
  await expect(table.locator('.settings-item-removed')).toHaveCount(0);
  await table.locator('.js-del-goal').first().click();
  await expect(table.locator('.settings-item-removed')).toContainText('Goal A');

  // Nothing persisted without Save
  await page.reload();
  await gotoApp(page);
  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-goal');
  await expect(table).toContainText('Goal A');
  await expect(table).toContainText('Goal B');
  await expect(table).not.toContainText('EDITED');
  await expect(table).not.toContainText('Goal C NEW');

  // Stage again and Save commits only the removal
  await table.locator('.js-del-goal').first().click();
  await page.click('#btn-save-goal');
  await expectToast(page, 'goal-msg', 'Goals saved');
  await page.reload();
  await gotoApp(page);
  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-goal');
  await expect(table).not.toContainText('Goal A');
  await expect(table).toContainText('Goal B');
});
