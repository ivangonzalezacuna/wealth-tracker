import { expect, test } from '@playwright/test';
import {
  addAccount,
  addGoal,
  addSnapshot,
  ensureCardExpanded,
  gotoApp,
  monthOffsetValue,
  openTab,
  preparePage,
  saveSettings,
  waitForSyncIdle,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await preparePage(page);
});

test('contributions save together with three database persists and survive reload', async ({
  page,
}) => {
  await gotoApp(page);
  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-contributions');
  await waitForSyncIdle(page);
  const previousHistoryId = await page.evaluate(async () => {
    const { loadConfigHistory } = await import('/src/db/index.ts');
    return (await loadConfigHistory())[0]?.id ?? 0;
  });
  const writes: string[] = [];
  page.on('console', (message) => {
    if (message.text() === 'contribution-test:sqlite-write') writes.push(message.text());
  });
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      this: IDBObjectStore,
      ...args: Parameters<typeof put>
    ) {
      if (this.transaction.db.name === 'wealth-tracker-sqlite' && args[1] === 'main.db') {
        console.info('contribution-test:sqlite-write');
      }
      return put.apply(this, args);
    };
  });
  await page.fill('#set-contrib-budget', '345');
  await page.selectOption('#set-contribution-interval', 'biweekly');
  await page.selectOption('#set-calibration-interval', 'weekly');
  await saveSettings(page, 'contributions', 'Contributions saved');
  await expect.poll(() => writes.length).toBe(3);
  const history = await page.evaluate(async () => {
    const { loadConfigHistory } = await import('/src/db/index.ts');
    return loadConfigHistory();
  });
  expect(history.filter((entry) => entry.id > previousHistoryId)).toEqual([
    expect.objectContaining({
      summary: 'updated monthly_contrib_budget, contribution_interval, calibration_interval',
    }),
  ]);
  await gotoApp(page);
  await openTab(page, 'tab-settings');
  await ensureCardExpanded(page, 'settings-card-contributions');
  await expect(page.locator('#set-contrib-budget')).toHaveValue('345');
  await expect(page.locator('#set-contribution-interval')).toHaveValue('biweekly');
  await expect(page.locator('#set-calibration-interval')).toHaveValue('weekly');
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
  await expect(page.locator('#nw-goal')).toContainText('Counted now10.000');
  await expect(page.locator('#nw-goal')).toContainText('50% complete');
  await page.locator('#nw-planning').scrollIntoViewIfNeeded();
  await expect(page.locator('#c-nw-forecast canvas')).toHaveCount(1);
  await expect(page.locator('.forecast-scenario-card')).toBeHidden();

  await page.click('#nw-scenario-toggle');
  await expect(page.locator('.forecast-scenario-card')).toBeVisible();
  await expect(page.locator('.forecast-scenario-card')).toContainText('Optimistic');
  await expect(page.locator('.forecast-scenario-card')).toContainText('Pessimistic');
  await page.fill('#nw-scn-optimistic-ret', '3');
  await page.locator('#nw-scn-optimistic-ret').blur();
  await expect(page.locator('#nw-scn-optimistic-ret')).toHaveValue('3');
});

test('forecast shows grouped summary when accounts belong to different groups', async ({
  page,
}) => {
  const snapshotMonth = monthOffsetValue(-1);

  await gotoApp(page);
  await addAccount(page, {
    label: 'ISA Account',
    institution: 'Hargreaves',
    annualReturnPct: 6,
    primary: true,
    group: 'Tax-Sheltered',
  });
  await addAccount(page, {
    label: 'GIA Account',
    institution: 'Hargreaves',
    annualReturnPct: 5,
    group: 'Taxable',
  });
  await addSnapshot(page, {
    month: snapshotMonth,
    accountValues: { 'ISA Account': 20000, 'GIA Account': 5000 },
  });

  await openTab(page, 'tab-networth');
  await page.locator('#nw-planning').scrollIntoViewIfNeeded();
  await expect(page.locator('#nw-fc-panel')).toContainText('Grouped forecast summary');
  await expect(page.locator('#nw-fc-panel')).toContainText('Tax-Sheltered');
  await expect(page.locator('#nw-fc-panel')).toContainText('Taxable');
});

test('retirement withdrawal keeps the Fixed amount after typing a % rate and reloading', async ({
  page,
}) => {
  await gotoApp(page);
  await addAccount(page, {
    label: 'Retirement Broker',
    institution: 'Interactive Brokers',
    annualReturnPct: 5,
    primary: true,
  });
  await addSnapshot(page, {
    month: monthOffsetValue(-1),
    accountValues: { 'Retirement Broker': 100000 },
  });
  await waitForSyncIdle(page);

  await openTab(page, 'tab-networth');
  await page.locator('#nw-planning').scrollIntoViewIfNeeded();
  await expect(page.locator('#c-nw-forecast canvas')).toHaveCount(1);
  await page.click('[data-planning-tab="drawdown"]');
  const suggested = await page.locator('#dd-withdrawal').inputValue();
  expect(Number(suggested)).toBeGreaterThan(100);

  await page.click('[data-dd-strategy="pct"]');
  // Switching strategy persists a setting asynchronously, which triggers a delayed re-render of
  // this card. A re-render that lands while the field is being edited discards the typed value,
  // so retry the type-and-commit until the committed value sticks.
  await expect
    .poll(async () => {
      await page.fill('#dd-withdrawal', '3.5');
      await page.locator('#dd-withdrawal').press('Enter');
      return page.locator('#dd-withdrawal').inputValue();
    })
    .toBe('3.5');
  await page.click('[data-dd-strategy="fixed"]');
  await expect(page.locator('#dd-withdrawal')).toHaveValue(suggested);
  // Ensure the typed % rate has persisted before reloading (the setting write is async).
  await waitForSyncIdle(page);

  await gotoApp(page);
  await openTab(page, 'tab-networth');
  await page.click('[data-planning-tab="drawdown"]');
  await expect(page.locator('[data-dd-strategy="fixed"]')).toHaveClass(/active/);
  await expect(page.locator('#dd-withdrawal')).toHaveValue(suggested);
  await page.click('[data-dd-strategy="pct"]');
  await expect(page.locator('#dd-withdrawal')).toHaveValue('3.5');
});
