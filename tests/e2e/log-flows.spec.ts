import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { FAKE_ISINS } from '../fixtures/snapshot-import/synthetic';
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
  waitForSyncIdle,
} from './helpers';

async function openOtherEtfs(page: Page) {
  const details = page.locator('.snap-etf-other');
  if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open)))
    await details.locator('summary').click();
}

async function addManualEtfs(page: Page, isins: string[], value: string) {
  await openOtherEtfs(page);
  for (const isin of isins) {
    await page.click('.js-snapd-extra');
    const row = page.locator('.snap-etf-extra').last();
    await row.getByLabel('Other ETF ISIN').fill(isin);
    await row.getByLabel('Other ETF value').fill(value);
  }
}

async function reviewAndSaveSnapshot(page: Page) {
  await page.click('.js-snapd-submit');
  await expect(page.locator('.snapd-review')).toBeVisible();
  await page.click('.js-snapd-submit');
  await expect(page.locator('#snap-msg')).toContainText('Saved');
}

async function captureSnapshotList(
  page: Page,
  testInfo: TestInfo,
  state: string,
  beforeCapture?: () => Promise<void>,
) {
  for (const theme of ['light', 'dark'] as const) {
    await page.locator('#btn-header-menu').click();
    await page.locator(`[data-theme-choice="${theme}"]`).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.keyboard.press('Escape');
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await beforeCapture?.();
      const card = page.locator('#balance-card');
      expect(
        await card.evaluate((element) => {
          const fits = (el: Element) => {
            const bounds = el.getBoundingClientRect();
            return Array.from(el.children).every((child) => {
              const rect = child.getBoundingClientRect();
              return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1;
            });
          };
          return (
            element.scrollWidth <= element.clientWidth &&
            Array.from(element.querySelectorAll('.snap-row-selectable, #snap-bulk-actions')).every(
              fits,
            )
          );
        }),
      ).toBe(true);
      await card.screenshot({
        path: testInfo.outputPath(`snapshot-list-${state}-${theme}-${width}.png`),
      });
    }
  }
}

test.beforeEach(async ({ page }) => {
  await preparePage(page);
});

test('draft and review distinguish copied, modified and missing valuations', async ({
  page,
}, testInfo) => {
  await gotoApp(page);
  await addAccount(page, { label: 'Fictional marker account', primary: true });
  await openTab(page, 'tab-log');
  await page.click('#btn-add-snap');
  await page.fill('#snapd-date', '2024-01');
  await page.getByLabel('Fictional marker account (EUR)').fill('1000');
  await expect(page.getByLabel('Add existing ETF')).toHaveAttribute('role', 'combobox');
  await expect(page.locator('[data-position-account]')).toHaveCount(0);
  await addManualEtfs(page, FAKE_ISINS.slice(0, 2), '100');
  await reviewAndSaveSnapshot(page);
  await waitForSyncIdle(page);
  await page.click('#btn-add-snap');
  await page.fill('#snapd-date', '2024-02');
  await openOtherEtfs(page);
  const account = page.locator('.snap-dialog-account > .dialog-field .snap-field-status');
  await expect(account).toHaveText('Copied');
  const rows = page.locator('.snap-etf-extra');
  await expect(rows.nth(0).locator('.snap-field-status')).toHaveText('Copied');
  await rows.nth(0).getByLabel('Other ETF value').fill('120');
  await expect(rows.nth(0).locator('.snap-field-status')).toHaveText('Modified');
  await rows.nth(1).getByLabel('Other ETF value').fill('');
  await expect(rows.nth(1).locator('.snap-field-status')).toHaveText('Missing');
  const valueInput = rows.nth(1).getByLabel('Other ETF value');
  await valueInput.hover();
  await expect(valueInput).toHaveCSS('outline-style', 'none');
  await valueInput.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(valueInput).toBeFocused();
  await expect(valueInput).toHaveCSS('outline-style', 'none');
  await expect(valueInput).toHaveCSS('box-shadow', 'none');
  expect(
    await valueInput.evaluate(
      (input) =>
        getComputedStyle(input).borderTopColor !==
        getComputedStyle(input.parentElement!.querySelector('[data-extra-isin]')!).borderTopColor,
    ),
  ).toBe(true);
  await expect(page.locator('.snapd-status-legend')).toHaveCount(0);
  await expect(rows.nth(0).getByLabel('Other ETF value')).toHaveAttribute('title', /Modified:/);
  await expect(rows.nth(1).getByLabel('Other ETF value')).toHaveCSS('border-left-width', '2px');
  expect(
    await rows
      .nth(0)
      .locator('.snap-field-status')
      .evaluate((el) => getComputedStyle(el).position),
  ).toBe('absolute');
  await page.setViewportSize({ width: 320, height: 844 });
  expect(
    await page.locator('.dialog-fields').evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  for (const [name, width, height] of [
    ['mobile', 390, 1000],
    ['laptop', 1440, 1000],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: testInfo.outputPath(`field-labels-${name}-draft.png`) });
  }
  await page.click('.js-snapd-submit');
  await expect(page.locator('.snapd-review [data-field-status="copied"]')).toHaveCount(1);
  await expect(page.locator('.snapd-review [data-field-status="modified"]')).toHaveCount(1);
  await expect(page.locator('.snapd-review')).toContainText('will be omitted');
  await expect(page.locator('.snapd-review .snap-field-status').first()).toHaveCSS('width', '5px');
  for (const [name, width, height] of [
    ['mobile', 390, 1000],
    ['laptop', 1440, 1000],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: testInfo.outputPath(`field-labels-${name}-review.png`) });
  }
  await page.click('.js-snapd-back');
  await rows.nth(0).getByLabel('Other ETF value').fill('100.00');
  await expect(rows.nth(0).locator('.snap-field-status')).toHaveText('Copied');
});

test('snapshot review uses compact aligned rows on mobile and desktop', async ({ page }) => {
  await gotoApp(page);
  await addAccount(page, {
    label: 'Primary investment account with a long label',
    institution: 'Trade Republic',
    primary: true,
  });
  await openTab(page, 'tab-log');
  await page.click('#btn-add-snap');
  await page.getByLabel(/^Primary investment account with a long label \(/).fill('19845.48');
  await expect(page.locator('[data-position-account]')).toHaveCount(0);
  await addManualEtfs(page, ['IE00BYX2JD69', 'IE00B4L5Y983', 'IE00BDBRDM35'], '1314.96');
  await expect(page.getByLabel('Add existing ETF')).toHaveAttribute('role', 'combobox');
  await expect(page.getByRole('button', { name: 'Add ETF', exact: true })).toBeVisible();
  await page.getByLabel('Breakdown coverage').selectOption('1');
  await expect(page.getByLabel('Breakdown coverage')).toHaveValue('1');
  for (const width of [390, 320, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.locator('.dialog-fields').evaluate((element) => ({
        overflow: element.scrollWidth > element.clientWidth,
        rowsFit: Array.from(element.querySelectorAll('.snap-etf-extra')).every((row) => {
          const bounds = row.getBoundingClientRect();
          return Array.from(row.children)
            .filter((child) => !child.classList.contains('sr-only'))
            .every((child) => {
              const rect = child.getBoundingClientRect();
              return rect.left >= bounds.left && rect.right <= bounds.right + 1;
            });
        }),
      })),
    ).toEqual({ overflow: false, rowsFit: true });
  }
  await page.click('.js-snapd-submit');
  const review = page.locator('.snapd-review');
  await expect(review).toBeVisible();
  await expect(page.locator('.dialog-header')).toBeHidden();
  for (const width of [390, 320, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    const layout = await review.evaluate((element) => {
      const rows = Array.from(element.querySelectorAll('.snapd-review-values > div'));
      return {
        fontSize: getComputedStyle(element).fontSize,
        titleSize: getComputedStyle(element.querySelector('.dialog-title')!).fontSize,
        overflow: element.scrollWidth > element.clientWidth,
        rowsAligned: rows.every((row) => {
          const label = row.querySelector('dt')!.getBoundingClientRect();
          const value = row.querySelector('dd')!.getBoundingClientRect();
          return label.right <= value.left && value.top < label.bottom;
        }),
        repeatedCurrency: rows.some((row) => row.querySelector('dd')!.textContent?.includes('EUR')),
      };
    });
    expect(layout).toEqual({
      fontSize: '12px',
      titleSize: '15px',
      overflow: false,
      rowsAligned: true,
      repeatedCurrency: false,
    });
  }
  await page.getByRole('button', { name: 'Back to edit' }).click();
  await expect(page.locator('.dialog-header')).toBeVisible();
  await expect(page.getByLabel(/^Primary investment account with a long label \(/)).toHaveValue(
    '19845.48',
  );
});

test('untracked ETF keys can be renamed and removed after saving without returning on Back', async ({
  page,
}) => {
  const month = monthOffsetValue(-2);
  const nextMonth = monthOffsetValue(-1);
  await gotoApp(page);
  await addAccount(page, { label: 'Manual Broker', institution: 'Trade Republic', primary: true });
  await openTab(page, 'tab-log');
  await waitForSyncIdle(page);
  await page.click('#btn-add-snap');
  await page.fill('#snapd-date', month);
  await page.getByLabel('Manual Broker (EUR)').fill('1000');
  await expect(page.locator('[data-position-account]')).toHaveCount(0);
  await addManualEtfs(page, ['IE0000000001', 'IE0000000002'], '100');
  await reviewAndSaveSnapshot(page);

  await waitForSyncIdle(page);
  await page.click('#btn-add-snap');
  await page.fill('#snapd-date', nextMonth);
  await expect(page.locator('.dialog-fields')).not.toContainText('Copied from');
  await page.click('.js-snapd-submit');
  await expect(page.locator('.snapd-review')).toContainText(`Copied from ${month}`);
  await page.click('.js-snapd-back');
  await openOtherEtfs(page);
  await page
    .locator('.snap-etf-extra')
    .first()
    .getByRole('button', { name: 'Remove other ETF' })
    .click();
  const remaining = page.locator('.snap-etf-extra');
  await expect(remaining.getByLabel('Other ETF ISIN')).toBeFocused();
  await expect(page.locator('.snap-etf-recon-alloc')).toContainText(formatUiMoney(100));
  await remaining.getByLabel('Other ETF ISIN').fill('IE0000000003');
  await remaining.getByLabel('Other ETF value').fill('0');
  await page.click('.js-snapd-submit');
  await expect(page.locator('.snapd-review')).not.toContainText('Copied from');
  await expect(page.locator('.snapd-review')).not.toContainText('IE0000000001');
  await expect(page.locator('.snapd-review')).not.toContainText('IE0000000002');
  await page.click('.js-snapd-back');
  await expect(page.locator('.snap-etf-extra')).toHaveCount(1);
  await reviewAndSaveSnapshot(page);

  await snapshotRow(page, nextMonth).click();
  await waitForSyncIdle(page);
  await page.click('.snap-detail .js-edit-snap');
  await openOtherEtfs(page);
  await expect(page.locator('.snap-etf-extra')).toHaveCount(1);
  await expect(page.getByLabel('Other ETF ISIN')).toHaveValue('IE0000000003');
  await page.getByRole('button', { name: 'Remove other ETF' }).click();
  await expect(page.getByRole('button', { name: 'Add ETF', exact: true })).toBeFocused();
  await page.click('.js-snapd-submit');
  await expect(page.locator('.snapd-review')).toContainText('replace');
  await expect(page.locator('.snapd-review')).not.toContainText('Copied from');
  await page.click('.js-snapd-submit');
  await expect(page.locator('#snap-msg')).toContainText('Saved');
  await waitForSyncIdle(page);
  await page.click('.snap-detail .js-edit-snap');
  await expect(page.locator('.snap-etf-extra')).toHaveCount(0);
  await page.click('.js-snapd-cancel');
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
  await page.getByLabel(/^Core Broker \([A-Z]{3}\)$/).fill('1500');
  await reviewAndSaveSnapshot(page);
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

test('deleting the last filtered snapshot clears stale status but preserves search', async ({
  page,
}, testInfo) => {
  const month = monthOffsetValue(-1);
  await gotoApp(page);
  await addAccount(page, { label: 'Last snapshot account', primary: true });
  await addSnapshot(page, {
    month,
    note: 'Final filtered snapshot',
    accountValues: { 'Last snapshot account': 1000 },
  });
  await page.locator('#snap-search').fill('No matching snapshot note');
  await expect(page.locator('#snaps-list .tbl-empty-state')).toContainText('No matching snapshots');
  await expect(page.locator('#snap-filter-status')).toContainText('0 of 1 snapshots');
  await captureSnapshotList(page, testInfo, 'filtered-empty');
  await page.locator('#snap-search').fill('Final filtered');
  await expect(page.locator('#snap-filter-status')).toContainText('1 of 1 snapshots');
  await snapshotRow(page, month).click();
  await waitForSyncIdle(page);
  await page.locator('.snap-detail .js-del-snap').click();
  await page.locator('.js-confirm-ok').click();
  await expect(page.locator('#snap-msg')).toContainText('Snapshot deleted.');
  await expect(page.locator('#snaps-list .tbl-empty-state')).toContainText('No snapshots yet');
  await expect(page.locator('#snap-search')).toHaveValue('Final filtered');
  await expect(page.locator('#snap-filter-status')).toBeHidden();
  await expect(page.locator('#snap-filter-status')).toBeEmpty();
  await expect(page.locator('.snap-detail')).toHaveCount(0);
  await expect(page.locator('#snap-pagination')).toBeEmpty();
  await captureSnapshotList(page, testInfo, 'empty');
});

test('snapshot expanded relationships survive sorting and fit narrow selection with long labels', async ({
  page,
}, testInfo) => {
  const firstMonth = monthOffsetValue(-2);
  const secondMonth = monthOffsetValue(-1);
  const label = 'LongInvestmentAccountLabelWithoutSpacesForSnapshotDetailWrapping';
  const note = 'LongSnapshotNoteWithoutSpacesForCheckingDetailPanelWrappingAtNarrowWidths';
  await gotoApp(page);
  await addAccount(page, { label, primary: true });
  await addAccount(page, { label: 'Snapshot savings' });
  await addSnapshot(page, {
    month: firstMonth,
    note,
    accountValues: { [label]: 2500, 'Snapshot savings': 7500 },
  });
  await addSnapshot(page, {
    month: secondMonth,
    note,
    accountValues: { [label]: 8000, 'Snapshot savings': 2000 },
  });
  await page.locator('#snap-search').fill('LongSnapshotNote');
  const first = snapshotRow(page, firstMonth);
  const second = snapshotRow(page, secondMonth);
  await expect(first).not.toHaveAttribute('aria-controls');
  await first.click();
  const rowId = await first.getAttribute('id');
  const panelId = await first.getAttribute('aria-controls');
  expect(rowId).toBeTruthy();
  expect(panelId).toBeTruthy();
  const panel = page.locator('.snap-detail');
  await expect(panel).toHaveAttribute('id', panelId!);
  await expect(panel).toHaveAttribute('aria-labelledby', rowId!);
  await expect(panel).toHaveAttribute('role', 'region');
  await expect(panel.locator('.snap-detail-share')).toHaveText(['75%', '25%']);
  await expect(panel.locator('.snap-detail-account .hold-detail-label')).toHaveText([
    'Snapshot savings',
    label,
  ]);
  await expect(first.locator('.snap-seg').first()).toHaveAttribute('title', /^Snapshot savings:/);
  await expect(page.locator('#snap-legend')).toHaveCount(0);
  await expect(panel.locator('.snap-detail-account .hold-dot')).toHaveCount(2);
  await expect(first.locator('.snap-segbar')).toHaveCSS('height', '6px');
  await expect(first.locator('.snap-segbar')).toHaveAttribute('title', /75%.*25%/);
  await expect(first.locator('.snap-seg').last()).toHaveCSS('min-width', '0px');
  await page.locator('#snap-table-header').getByRole('columnheader', { name: /Month/ }).click();
  await expect(first).toHaveAttribute('aria-expanded', 'true');
  await expect(first).toHaveAttribute('aria-controls', panelId!);
  await expect(panel).toHaveAttribute('id', panelId!);
  await expect(panel).toHaveAttribute('aria-labelledby', rowId!);

  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(panel).toContainText(label);
    await expect(panel).toContainText(note);
    expect(
      await panel.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const row = element.previousElementSibling!.getBoundingClientRect();
        return {
          fits: element.scrollWidth <= element.clientWidth,
          inline: bounds.top >= row.bottom - 1,
          side: bounds.left >= row.right,
        };
      }),
    ).toEqual({ fits: true, inline: width < 1024, side: width >= 1024 });
  }
  await captureSnapshotList(page, testInfo, 'expanded-long-labels');

  await second.click();
  await expect(first).toHaveAttribute('aria-expanded', 'false');
  await expect(first).not.toHaveAttribute('aria-controls');
  await expect(panel).toHaveAttribute('id', (await second.getAttribute('aria-controls'))!);
  await second.click();
  await expect(second).not.toHaveAttribute('aria-controls');
  await expect(panel).toHaveCount(0);

  await page.setViewportSize({ width: 320, height: 844 });
  await page.locator('#btn-start-del-snaps').click();
  await page.locator('#btn-snap-select-all').click();
  await expect(page.locator('#btn-del-snaps')).toHaveText('Delete (2)');
  await expect(page.locator('.js-snap-select:checked')).toHaveCount(2);
  await captureSnapshotList(page, testInfo, 'selection', async () => {
    const select = page.locator('#btn-start-del-snaps');
    if ((await select.getAttribute('aria-pressed')) !== 'true') await select.click();
    await page.locator('#btn-snap-select-all').click();
    await expect(page.locator('#btn-del-snaps')).toHaveText('Delete (2)');
    await expect(page.locator('.js-snap-select:checked')).toHaveCount(2);
  });
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
