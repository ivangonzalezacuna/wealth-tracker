import { expect, test } from '@playwright/test';
import {
  addAccount,
  addGoal,
  addSnapshot,
  gotoApp,
  monthOffsetValue,
  openTab,
  preparePage,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await preparePage(page);
});

test('settings-driven account and goal changes propagate into net worth planning', async ({
  page,
}) => {
  const snapshotMonth = monthOffsetValue(-1);

  await gotoApp(page);
  await addAccount(page, {
    label: 'Retirement Broker',
    institution: 'Interactive Brokers',
    annualReturnPct: 6.5,
    primary: true,
  });
  await addGoal(page, {
    label: 'FIRE',
    targetNetWorth: '20000',
    targetDate: '2035-12',
  });
  await addSnapshot(page, {
    month: snapshotMonth,
    note: 'Planning baseline',
    accountValues: { 'Retirement Broker': 10000 },
  });

  await openTab(page, 'tab-networth');
  await expect(page.locator('#nw-goal')).toContainText('FIRE');
  await expect(page.locator('#nw-goal')).toContainText('Current (liquid)10.000');
  await expect(page.locator('#nw-goal')).toContainText('50% complete');
  await expect(page.locator('#c-nw-forecast-table-wrap')).toBeVisible();
  await expect(page.locator('.forecast-scenario-card')).toBeHidden();

  await page.click('#nw-scenario-toggle');
  await expect(page.locator('.forecast-scenario-card')).toBeVisible();
  await expect(page.locator('.forecast-scenario-card')).toContainText('Optimistic');
  await expect(page.locator('.forecast-scenario-card')).toContainText('Pessimistic');
  await page.fill('#nw-scn-optimistic-ret', '3');
  await page.locator('#nw-scn-optimistic-ret').blur();
  await expect(page.locator('#nw-scn-optimistic-ret')).toHaveValue('3');
});
