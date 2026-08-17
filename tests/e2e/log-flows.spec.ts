import { expect, test } from '@playwright/test';
import {
  addAccount,
  addManualTransaction,
  addSnapshot,
  dayOffsetValue,
  formatUiDay,
  formatUiMoney,
  formatUiMonth,
  gotoApp,
  monthOffsetValue,
  openTab,
  preparePage,
  snapshotRow,
  txRow,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await preparePage(page);
});

test('snapshot create, edit, delete, and bulk delete flows keep log data consistent', async ({
  page,
}) => {
  const firstMonth = monthOffsetValue(-3);
  const secondMonth = monthOffsetValue(-2);
  const thirdMonth = monthOffsetValue(-1);

  await gotoApp(page);
  await addAccount(page, {
    label: 'Core Broker',
    institution: 'Trade Republic',
    annualReturnPct: 7,
    primary: true,
  });

  await addSnapshot(page, {
    month: firstMonth,
    note: 'Initial funding round',
    accountValues: { 'Core Broker': 1000 },
  });
  await expect(snapshotRow(page, firstMonth)).toContainText(formatUiMoney(1000));

  await snapshotRow(page, firstMonth).click();
  await expect(page.locator('.snap-detail')).toContainText('Initial funding round');
  await page.click('.snap-detail .js-edit-snap');
  await page.fill('#snapd-notes', 'Initial funding round updated');
  await page.getByLabel('Core Broker (€)').fill('1500');
  await page.click('.js-snapd-submit');
  await expect(page.locator('#snap-msg')).toContainText('Saved');
  await expect(snapshotRow(page, firstMonth)).toContainText(formatUiMoney(1500));

  await addSnapshot(page, {
    month: secondMonth,
    note: 'Second month',
    accountValues: { 'Core Broker': 2000 },
  });
  await addSnapshot(page, {
    month: thirdMonth,
    note: 'Third month',
    accountValues: { 'Core Broker': 2500 },
  });

  await page.click('#btn-start-del-snaps');
  await expect(page.locator('#btn-add-snap')).toBeDisabled();
  await page.getByLabel(`Select ${formatUiMonth(secondMonth)}`).check();
  await page.getByLabel(`Select ${formatUiMonth(thirdMonth)}`).check();
  await page.click('#btn-del-snaps');
  await page.click('.js-confirm-ok');
  await expect(page.locator('#snap-msg')).toContainText('2 snapshots deleted.');
  await expect(snapshotRow(page, secondMonth)).toHaveCount(0);
  await expect(snapshotRow(page, thirdMonth)).toHaveCount(0);

  const snapDeleteButton = page.locator('.snap-detail .js-del-snap');
  if ((await snapDeleteButton.count()) === 0) {
    await snapshotRow(page, firstMonth).click();
  }
  await expect(snapDeleteButton).toBeVisible();
  await snapDeleteButton.click();
  await page.click('.js-confirm-ok');
  await expect(page.locator('#snap-msg')).toContainText('Snapshot deleted.');
  await expect(snapshotRow(page, firstMonth)).toHaveCount(0);
});

test('transaction create, edit, delete, and bulk delete flows update the ledger', async ({
  page,
}) => {
  const firstDate = dayOffsetValue(-20);
  const secondDate = dayOffsetValue(-10);
  const thirdDate = dayOffsetValue(-5);

  await gotoApp(page);

  await addManualTransaction(page, {
    date: firstDate,
    amount: '12.5',
    tax: '-2.5',
    note: 'First interest payment',
  });
  await expect(page.locator('#tx-msg')).toContainText('Transaction added.');
  await expect(txRow(page, formatUiDay(firstDate))).toContainText(formatUiMoney(12.5));

  await txRow(page, formatUiDay(firstDate)).locator('.tx-actions-desktop .js-edit-tx').click();
  await page.fill('#txd-amount', '15');
  await page.fill('#txd-note', 'Updated interest payment');
  await page.click('.js-txd-submit');
  await expect(page.locator('#tx-msg')).toContainText('Transaction updated.');
  await expect(txRow(page, formatUiDay(firstDate))).toContainText(formatUiMoney(15));

  await addManualTransaction(page, { date: secondDate, amount: '20', note: 'Second payment' });
  await addManualTransaction(page, { date: thirdDate, amount: '25', note: 'Third payment' });

  await page.click('#btn-start-del-txs');
  await expect(page.locator('#btn-add-tx')).toBeHidden();
  await txRow(page, formatUiDay(secondDate)).locator('.tx-actions-desktop .js-tx-select').check();
  await txRow(page, formatUiDay(thirdDate)).locator('.tx-actions-desktop .js-tx-select').check();
  await page.click('#btn-del-txs');
  await page.click('.js-confirm-ok');
  await expect(page.locator('#tx-msg')).toContainText('2 transactions deleted.');
  await expect(txRow(page, formatUiDay(secondDate))).toHaveCount(0);
  await expect(txRow(page, formatUiDay(thirdDate))).toHaveCount(0);

  await txRow(page, formatUiDay(firstDate)).locator('.tx-actions-desktop .js-del-tx').click();
  await page.click('.js-confirm-ok');
  await expect(page.locator('#tx-msg')).toContainText('Transaction deleted.');
  await openTab(page, 'tab-log');
  await expect(page.locator('#tx-ledger-list')).toContainText('No transactions yet.');
});
