import { expect, test } from '@playwright/test';
import {
  addAccount,
  ensureCardExpanded,
  gotoApp,
  importCsvFixture,
  openDialogOptional,
  preparePage,
  saveHoldings,
  setContributionsSettings,
  expectToast,
  saveSettings,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await preparePage(page);
});

test('holdings CRUD works and contribution/calculation settings persist', async ({ page }) => {
  await gotoApp(page);
  await addAccount(page, {
    label: 'Settings Broker',
    institution: 'IBKR',
    annualReturnPct: 6,
    primary: true,
  });
  await importCsvFixture(page);
  await page.click('#tab-settings');
  await ensureCardExpanded(page, 'settings-card-holdings');
  await page.click('#btn-autofill-holds');
  await expectToast(page, 'holds-msg', 'Added 1 holding');
  await saveHoldings(page);

  await ensureCardExpanded(page, 'settings-card-holdings');
  await expect(page.locator('#settings-holdings-tbl .js-edit-hold')).toHaveCount(1);
  await page.locator('#settings-holdings-tbl .js-edit-hold').first().click();
  await expect(page.locator('.hold-dialog-overlay')).toBeVisible();
  await page.fill('#holdd-short-name', 'EIMI2');
  await openDialogOptional(page, '.hold-dialog-overlay');
  await page.fill('#holdd-notes', 'Updated note');
  await page.click('.js-holdd-submit');
  await expect(page.locator('#settings-holdings-tbl')).toContainText('EIMI2');
  await saveHoldings(page);

  await page.locator('#settings-holdings-tbl .js-del-hold').first().click();
  await page.click('.js-confirm-ok');
  await expectToast(page, 'holds-msg', 'Holding removed');
  await expect(page.locator('#settings-holdings-tbl')).not.toContainText('EIMI2');

  await setContributionsSettings(page, {
    amount: '1200',
    contributionInterval: 'quarterly',
    calibrationInterval: 'monthly',
  });

  await ensureCardExpanded(page, 'settings-card-calc-assumptions');
  await page.selectOption('#set-cost-basis-method', 'fifo');
  await saveSettings(page, 'cost-basis', 'Cost-basis method saved');
  await page.fill('#analytics-risk-free-rate', '3.25');
  await saveSettings(page, 'analytics', 'Analytics saved');

  await page.reload();
  await gotoApp(page);
  await page.click('#tab-settings');
  await ensureCardExpanded(page, 'settings-card-contributions');
  await expect(page.locator('#set-contrib-budget')).toHaveValue('1200');
  await expect(page.locator('#set-contribution-interval')).toHaveValue('quarterly');
  await expect(page.locator('#set-calibration-interval')).toHaveValue('monthly');
  await ensureCardExpanded(page, 'settings-card-calc-assumptions');
  await expect(page.locator('#set-cost-basis-method')).toHaveValue('fifo');
  await expect(page.locator('#analytics-risk-free-rate')).toHaveValue('3.25');
});
