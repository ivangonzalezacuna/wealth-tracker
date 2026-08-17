import { expect, test } from '@playwright/test';
import { addAccount, ensureCardExpanded, gotoApp, openTab, preparePage } from './helpers';

test.beforeEach(async ({ page }) => {
  await preparePage(page);
});

test('config history card records setting changes and is expandable', async ({ page }) => {
  await gotoApp(page);

  // Make a settings change that will be recorded
  await addAccount(page, {
    label: 'History Test Account',
    institution: 'TestBank',
    annualReturnPct: 5,
    primary: true,
  });

  // Navigate to config history
  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-config-history');

  // Should show at least one history entry
  await expect(page.locator('#settings-card-config-history .card-body')).not.toBeEmpty();
});
