import { expect, test } from '@playwright/test';
import {
  addAccount,
  ensureCardExpanded,
  gotoApp,
  importCsvFixture,
  preparePage,
  saveHoldings,
  setContributionsSettings,
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
  await expect(page.locator('#holds-msg')).toContainText('Added 1 holding');
  await saveHoldings(page);

  await ensureCardExpanded(page, 'settings-card-holdings');
  await expect(page.locator('#settings-holdings-tbl .js-edit-hold')).toHaveCount(1);
  await page.locator('#settings-holdings-tbl .js-edit-hold').first().click({ force: true });
  await page.fill('#holdd-short-name', 'EIMI2');
  await page.fill('#holdd-notes', 'Updated note');
  await page.click('.js-holdd-submit');
  await expect(page.locator('#settings-holdings-tbl')).toContainText('EIMI2');
  await saveHoldings(page);

  await page.locator('#settings-holdings-tbl .js-del-hold').first().click({ force: true });
  await page.click('.js-confirm-ok');
  await saveHoldings(page);
  await expect(page.locator('#settings-holdings-tbl')).not.toContainText('EIMI2');

  await setContributionsSettings(page, {
    amount: '1200',
    contributionInterval: 'quarterly',
    calibrationInterval: 'monthly',
  });

  await ensureCardExpanded(page, 'settings-card-calc-assumptions');
  await page.selectOption('#set-cost-basis-method', 'fifo');
  await page.click('#btn-save-cost-basis');
  await expect(page.locator('#costbasis-msg')).toContainText('Saved');
  await page.fill('#analytics-risk-free-rate', '3.25');
  await page.click('#btn-save-analytics');
  await expect(page.locator('#analytics-msg')).toContainText('Saved');

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
