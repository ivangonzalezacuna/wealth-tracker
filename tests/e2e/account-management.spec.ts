import { expect, test } from '@playwright/test';
import { addAccount, ensureCardExpanded, gotoApp, openTab, preparePage } from './helpers';

test.beforeEach(async ({ page }) => {
  await preparePage(page);
});

test('account edit and delete flows update settings table', async ({ page }) => {
  await gotoApp(page);
  await addAccount(page, {
    label: 'Original Account',
    institution: 'Fidelity',
    annualReturnPct: 5,
    primary: true,
  });

  // Edit the account
  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-accounts');
  await page.locator('.js-edit-acct').first().click();
  await page.fill('#acctd-label', 'Renamed Account');
  await page.fill('#acctd-institution', 'Vanguard');
  await page.fill('#acctd-return', '8');
  await page.click('.js-acctd-submit');
  await expect(page.locator('#settings-accounts-tbl')).toContainText('Renamed Account');
  await page.click('#btn-save-accts');
  await expect(page.locator('#accts-msg')).toContainText('Saved');

  // Verify persistence after reload
  await page.reload();
  await gotoApp(page);
  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-accounts');
  await expect(page.locator('#settings-accounts-tbl')).toContainText('Renamed Account');
  await expect(page.locator('#settings-accounts-tbl')).toContainText('Vanguard');

  // Delete the account
  await page.locator('.js-del-acct').first().click();
  await page.click('.js-confirm-ok');
  await page.click('#btn-save-accts');
  await expect(page.locator('#accts-msg')).toContainText('Saved');
  await expect(page.locator('#settings-accounts-tbl')).not.toContainText('Renamed Account');
});

test('account dialog validation rejects empty label', async ({ page }) => {
  await gotoApp(page);
  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-accounts');
  await page.click('#btn-add-acct');
  // Submit without filling label
  await page.click('.js-acctd-submit');
  await expect(page.locator('#acctd-label-err')).not.toBeEmpty();
  // Cancel closes dialog
  await page.click('.js-acctd-cancel');
  await expect(page.locator('.acct-dialog-overlay')).toHaveCount(0);
});

test('multiple accounts appear in snapshot dialog with separate value inputs', async ({ page }) => {
  await gotoApp(page);
  await addAccount(page, {
    label: 'Account A',
    institution: 'Bank A',
    annualReturnPct: 3,
    primary: true,
  });
  await addAccount(page, {
    label: 'Account B',
    institution: 'Bank B',
    annualReturnPct: 4,
  });

  await openTab(page, 'tab-log');
  await page.click('#btn-add-snap');
  // Both account input fields should be present
  await expect(page.getByLabel(/^Account A \([A-Z]{3}\)$/)).toBeVisible();
  await expect(page.getByLabel(/^Account B \([A-Z]{3}\)$/)).toBeVisible();
  await page.click('.js-snapd-cancel');
});

test('locked account shows locked-until field', async ({ page }) => {
  await gotoApp(page);
  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-accounts');
  await page.click('#btn-add-acct');
  await page.fill('#acctd-label', 'Locked Pension');
  await page.selectOption('#acctd-type', 'investment');
  await page.check('#acctd-locked');
  await expect(page.locator('#acctd-locked-until')).toBeVisible();
  await page.fill('#acctd-locked-until', '2040');
  await page.click('.js-acctd-submit');
  await expect(page.locator('#settings-accounts-tbl')).toContainText('Locked Pension');
  await page.click('#btn-save-accts');
  await expect(page.locator('#accts-msg')).toContainText('Saved');
});

test('account country field saves and persists after reload', async ({ page }) => {
  await gotoApp(page);
  await addAccount(page, {
    label: 'German Broker',
    institution: 'DKB',
    annualReturnPct: 5,
    primary: true,
    country: 'Germany',
  });

  // Edit and verify country is pre-filled
  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-accounts');
  await page.locator('.js-edit-acct').first().click();
  await expect(page.locator('#acctd-country')).toHaveValue('Germany');
  await page.click('.js-acctd-cancel');

  // Verify persistence after reload
  await page.reload();
  await gotoApp(page);
  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-accounts');
  await page.locator('.js-edit-acct').first().click();
  await expect(page.locator('#acctd-country')).toHaveValue('Germany');
  await page.click('.js-acctd-cancel');
});

test('account group field saves and persists after reload', async ({ page }) => {
  await gotoApp(page);
  await addAccount(page, {
    label: 'Retirement Fund',
    institution: 'Vanguard',
    annualReturnPct: 7,
    primary: true,
    group: 'Retirement',
  });

  // Edit and verify group is pre-filled
  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-accounts');
  await page.locator('.js-edit-acct').first().click();
  await expect(page.locator('#acctd-group')).toHaveValue('Retirement');
  await page.click('.js-acctd-cancel');

  // Verify persistence after reload
  await page.reload();
  await gotoApp(page);
  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-accounts');
  await page.locator('.js-edit-acct').first().click();
  await expect(page.locator('#acctd-group')).toHaveValue('Retirement');
  await page.click('.js-acctd-cancel');
});
