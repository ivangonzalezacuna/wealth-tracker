import { expect, test } from '@playwright/test';
import { ensureCardExpanded, gotoApp, openTab, preparePage } from './helpers';
import { expectToast } from './helpers';

test.beforeEach(async ({ page }) => {
  await preparePage(page);
});

test('drift alert threshold saves and persists', async ({ page }) => {
  await gotoApp(page);
  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-portfolio-behavior');

  await page.fill('#alert-drift-threshold', '3.5');
  await page.click('#btn-save-alerts');
  await expectToast(page, 'alerts-msg', 'Alerts saved');

  // Reload and verify persistence
  await page.reload();
  await gotoApp(page);
  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-portfolio-behavior');
  await expect(page.locator('#alert-drift-threshold')).toHaveValue('3.5');
});

test('reinvestment rules CRUD works', async ({ page }) => {
  await gotoApp(page);
  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-portfolio-behavior');

  // Add a rule
  await page.click('#btn-add-rule');
  await expect(page.locator('#settings-rules-tbl .settings-rule-row')).toHaveCount(1);

  // Fill rule fields
  const ruleRow = page.locator('#settings-rules-tbl .settings-rule-row').first();
  await ruleRow.locator('input[data-field="label"]').fill('Dividends from IWDA');
  await ruleRow.locator('input[data-field="value"]').fill('Reinvest into EIMI');

  await page.click('#btn-save-rules');
  await expectToast(page, 'rules-msg', 'Rules saved');

  // Delete the rule (triggers confirm dialog)
  await ensureCardExpanded(page, 'settings-card-portfolio-behavior');
  await page.locator('.js-del-rule').first().click();
  await page.click('.js-confirm-ok');
  await expectToast(page, 'rules-msg', 'Rule removed');
});
