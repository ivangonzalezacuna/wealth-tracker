import { expect, test, type Page, type TestInfo } from '@playwright/test';
import {
  ensureCardExpanded,
  expectToast,
  gotoApp,
  monthOffsetValue,
  openTab,
  openAccountStatus,
  preparePage,
  saveSettings,
  waitForSyncIdle,
} from './helpers';

const ISIN = 'IE00B4L5Y983';
const dialogButtonStyles = new WeakMap<Page, Record<string, string>[]>();

for (const theme of ['light', 'dark']) {
  for (const width of [390, 1280]) {
    test(`total-only history remains Not reviewed: ${theme} ${width}px`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await preparePage(page);
      await gotoApp(page);
      await waitForSyncIdle(page);
      await page.evaluate(async (isin) => {
        const modulePath = '/src/db/index.ts';
        const db: typeof import('../../src/db') = await import(/* @vite-ignore */ modulePath);
        await db.restoreAllData({
          accounts: [
            {
              id: 'broker',
              label: 'Historical broker',
              moneyType: 'investment',
              isPrimaryInvestment: true,
            },
          ],
          holdings: [],
          settings: {},
          transactions: [],
          snapshots: Array.from({ length: 20 }, (_, i) => ({
            date: `${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`,
            broker: 1500,
            ...(i >= 10 ? { [`etf_${isin}`]: 1000 } : {}),
            notes: 'Historical statement',
          })),
        });
      }, ISIN);
      await page.reload();
      await gotoApp(page);
      await page.locator('#btn-header-menu').click();
      await page.locator(`[data-theme-choice="${theme}"]`).click();
      await page.keyboard.press('Escape');
      await openTab(page, 'tab-settings');
      await ensureCardExpanded(page, 'settings-card-accounts');
      await waitForSyncIdle(page);
      await page.click('#btn-migrate-valuations');
      await expect(page.locator('[data-entry]')).toHaveCount(0);
      await expect(page.locator('[data-account-check="0"]')).toContainText(
        'No ETF breakdown recorded; Not reviewed is valid',
      );
      await expect(page.locator('.migration-reconcile-warning')).toHaveCount(0);
      await expect(page.locator('[data-coverage-review="0"]')).toHaveValue('');
      await capture(page, info, 'migration-total-only', '.valuation-migration-overlay');
      await page.fill('#migration-month', '2024-11');
      await page.locator('#migration-month').press('Tab');
      await expect(page.locator('[data-entry="0"]')).toHaveValue('1000');
      await expect(page.locator('[data-coverage-review="10"]')).toHaveValue('');
      await expect(page.locator('#migration-month-editor')).toContainText('Saved 1.000,00');
      await expect(page.locator('#migration-month-editor')).toContainText(
        'Prefilled for Historical broker',
      );
      await capture(page, info, 'migration-saved-prefill', '.valuation-migration-overlay');
      await page.fill('#migration-month', '2024-01');
      await page.locator('#migration-month').press('Tab');
      await page.getByText('Bulk actions', { exact: true }).click();
      await page.locator('.js-rule').click();
      await page.fill('#migration-from', '2024-11');
      await page.selectOption('#migration-coverage-state', '1');
      await page.locator('.js-coverage-rule').click();
      await page.getByText('Bulk actions', { exact: true }).click();
      await expect(page.locator('[data-coverage-review="0"]')).toHaveValue('');
      await page.locator('.js-review').click();
      await expect(page.locator('#migration-error')).toBeEmpty();
      await expect(page.locator('#migration-preview')).toContainText('Not reviewed');
      await page.check('#migration-confirm');
      await page.locator('.js-submit').click();
      await expectToast(page, 'valuation-migration-msg', 'Account-linked ETF values enabled');
      await waitForSyncIdle(page);
      await page.reload();
      await gotoApp(page);
      expect(
        await page.evaluate(async () => {
          const modulePath = '/src/db/index.ts';
          const db: typeof import('../../src/db') = await import(/* @vite-ignore */ modulePath);
          const history = await db.loadSnapshots();
          return { count: history.length, first: history[0], last: history[19] };
        }),
      ).toEqual({
        count: 20,
        first: { date: '2024-01', broker: 1500, notes: 'Historical statement' },
        last: {
          date: '2025-08',
          broker: 1500,
          [`position:broker:${ISIN}`]: 1000,
          'position_coverage:broker': 1,
          notes: 'Historical statement',
        },
      });
    });
  }
}

for (const width of [390, 1280]) {
  test(`long migration history stays bounded and retains cents: ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await preparePage(page);
    await gotoApp(page);
    await waitForSyncIdle(page);
    await page.evaluate(async (isin) => {
      const modulePath = '/src/db/index.ts';
      const db: typeof import('../../src/db') = await import(/* @vite-ignore */ modulePath);
      await db.restoreAllData({
        accounts: [
          {
            id: 'spain',
            label: 'Spain investment',
            moneyType: 'investment',
            isPrimaryInvestment: true,
          },
          { id: 'france', label: 'France investment', moneyType: 'investment' },
        ],
        holdings: [],
        settings: {},
        transactions: [],
        snapshots: Array.from({ length: 240 }, (_, i) => ({
          date: `${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`,
          spain: 4000.12,
          france: 20000.67,
          [`etf_${isin}`]: 10000.46,
          notes: 'Original history',
        })),
      });
    }, ISIN);
    await page.reload();
    await gotoApp(page);
    await openTab(page, 'tab-settings');
    await ensureCardExpanded(page, 'settings-card-accounts');
    await waitForSyncIdle(page);
    await page.click('#btn-migrate-valuations');
    await expect(page.locator('#migration-progress')).toHaveText(
      'Month 1 of 240 · 240 months unassigned',
    );
    await expect(page.locator('[data-entry]')).toHaveCount(2);
    await expect(page.locator('[data-coverage-review]')).toHaveCount(2);
    await expect(page.locator('#migration-from')).toHaveAttribute('type', 'month');
    await page.getByText('Bulk actions', { exact: true }).click();
    await page.fill('#migration-from', '2005-01');
    await page.fill('#migration-to', '2006-12');
    await capture(page, info, 'long-history-month-range', '.valuation-migration-overlay');
    await page.locator('.js-all-months').click();
    await expect(page.locator('#migration-from')).toHaveValue('');
    await expect(page.locator('#migration-to')).toHaveValue('');
    await page.selectOption('#migration-account', 'france');
    await page.locator('.js-rule').click();
    await page.selectOption('#migration-coverage-state', '1');
    await page.locator('.js-coverage-rule').click();
    await expect(page.locator('#migration-progress')).toContainText('0 months unassigned');
    await page.fill('[data-entry="0"][data-account="spain"]', '4000.12');
    await page.fill('[data-entry="0"][data-account="france"]', '6000.34');
    await page.selectOption('[data-coverage-review="0"]', '1');
    await page.locator('.js-month-next').click();
    await expect(page.locator('#migration-month')).toHaveValue('2000-02');
    await page.locator('.js-month-prev').click();
    await expect(page.locator('[data-entry="0"][data-account="spain"]')).toHaveValue('4000.12');
    await expect(page.locator('[data-coverage-review="0"]')).toHaveValue('1');
    await page.getByText('Bulk actions', { exact: true }).click();
    await capture(page, info, 'long-history-unified-review', '.valuation-migration-overlay');
    await page.locator('.js-review').click();
    await expect(page.locator('#migration-preview')).toContainText(
      'All 240 month/ISIN totals conserved',
    );
    await expect(page.locator('#migration-preview')).toContainText('Before 10.000,46');
    await expect(page.locator('#migration-preview')).toContainText('After 10.000,46');
    await expect(page.locator('#migration-preview')).toContainText('4.000,12');
    await expect(page.locator('#migration-preview .migration-preview-row')).toHaveCount(3);
    await page.locator('#migration-preview').scrollIntoViewIfNeeded();
    await capture(page, info, 'long-history-before-after-cents', '.valuation-migration-overlay');
    await page.fill('#migration-month', '2010-06');
    await page.locator('#migration-month').press('Tab');
    await expect(page.locator('#migration-progress')).toContainText('Month 126 of 240');
    await expect(page.locator('#migration-preview')).toContainText('Showing 2010-06');
    await expect(page.locator('#migration-confirm')).toBeEnabled();
    await page.check('#migration-confirm');
    await page.locator('.js-submit').click();
    await expectToast(page, 'valuation-migration-msg', 'Account-linked ETF values enabled');
    await waitForSyncIdle(page);
    await page.reload();
    await gotoApp(page);
    await waitForSyncIdle(page);
    expect(
      await page.evaluate(async () => {
        const modulePath = '/src/db/index.ts';
        const db: typeof import('../../src/db') = await import(/* @vite-ignore */ modulePath);
        const snapshots = await db.loadSnapshots();
        return {
          count: snapshots.length,
          first: snapshots[0],
          last: snapshots[snapshots.length - 1],
        };
      }),
    ).toMatchObject({
      count: 240,
      first: {
        'position:spain:IE00B4L5Y983': 4000.12,
        'position:france:IE00B4L5Y983': 6000.34,
        'position_coverage:spain': 1,
        'position_coverage:france': 1,
        notes: 'Original history',
      },
      last: { 'position:france:IE00B4L5Y983': 10000.46, 'position_coverage:france': 1 },
    });
  });
}

async function capture(page: Page, info: TestInfo, name: string, selector?: string) {
  for (const dismiss of await page.getByRole('button', { name: 'Dismiss notification' }).all())
    await dismiss.click();
  const target = selector ? page.locator(selector) : page.locator('#app');
  await expect(target).toBeVisible();
  await page.mouse.move(0, 0);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
    )
    .toBe(true);
  if (selector?.includes('overlay')) {
    const card = target.locator('.dialog-card');
    const actions = target.locator('.dialog-actions');
    await expect(card).toHaveCSS('max-width', selector.includes('snap-dialog') ? '720px' : '640px');
    await expect(target.locator('.dialog-fields')).toHaveCSS('overflow-y', 'auto');
    await expect(actions).toBeInViewport();
    const referenceButtons = dialogButtonStyles.get(page);
    if (selector.includes('valuation-migration') && referenceButtons)
      await expect(actions.locator('.btn-primary:visible')).toHaveCSS(
        'background-color',
        referenceButtons[referenceButtons.length - 1].background,
      );
    const footerStyles = await actions.locator('.btn:visible').evaluateAll((buttons) =>
      buttons.map((button) => {
        const style = getComputedStyle(button);
        return {
          padding: style.padding,
          radius: style.borderRadius,
          fontSize: style.fontSize,
          height: style.height,
          lineHeight: style.lineHeight,
          background: style.backgroundColor,
          color: style.color,
          border: style.border,
        };
      }),
    );
    if (name === 'existing-account-dialog-reference') dialogButtonStyles.set(page, footerStyles);
    if (selector.includes('valuation-migration')) {
      await expect(actions.locator('.btn-primary:visible')).toHaveCount(1);
      const bounds = await actions.boundingBox();
      expect(bounds!.height).toBeLessThan(35);
      const reference = dialogButtonStyles.get(page);
      if (reference) {
        expect(footerStyles[0]).toEqual(reference[0]);
        expect(footerStyles[footerStyles.length - 1]).toEqual(reference[reference.length - 1]);
      }
      for (const button of await target.locator('.btn:visible').all()) {
        const bounds = await button.boundingBox();
        expect(bounds!.height).toBeLessThan(35);
      }
      for (const arrow of await target.locator('.pagination-nav .btn').all()) {
        await expect(arrow).toHaveCSS('min-width', '28px');
        await expect(arrow).toHaveCSS('width', '28px');
      }
    }
    expect(await card.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true,
    );
    for (const button of await target.locator('.btn').all()) {
      await expect(button).toHaveCSS('font-size', '11px');
      const font = await button.evaluate((element) => getComputedStyle(element).fontFamily);
      expect(font).toBe(
        await page.locator('body').evaluate((element) => getComputedStyle(element).fontFamily),
      );
    }
    if (!selector.includes('snap-dialog'))
      for (const note of await target.locator('.note').all()) {
        await expect(note).toHaveCSS('font-size', '12px');
        await expect(note).toHaveCSS('font-style', 'normal');
      }
  }
  await target.screenshot({ path: info.outputPath(`${name}.png`), animations: 'disabled' });
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [390, 1280]) {
    test(`new account flows follow existing styling: ${theme} ${width}px`, async ({
      page,
    }, info) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height: 900 });
      await preparePage(page);
      await gotoApp(page);
      await waitForSyncIdle(page);
      await page.evaluate(
        async ({ isin, earlier, latest }) => {
          const modulePath = '/src/db/index.ts';
          const db: typeof import('../../src/db') = await import(/* @vite-ignore */ modulePath);
          await db.restoreAllData({
            accounts: [
              { id: 'daily', label: 'Spain daily', moneyType: 'cash', country: 'Spain' },
              {
                id: 'spain',
                label: 'Spain investment',
                moneyType: 'investment',
                country: 'Spain',
                isPrimaryInvestment: true,
              },
              {
                id: 'france',
                label: 'France investment',
                moneyType: 'investment',
                country: 'France',
              },
            ],
            holdings: [
              {
                isin,
                name: 'iShares Core MSCI World UCITS ETF',
                shortName: 'IWDA',
                color: '#185fa5',
                acc: true,
                active: true,
                targetPct: 100,
                assetClass: 'Equity',
                region: 'World',
                foldInto: '',
                order: 0,
              },
            ],
            settings: { monthly_contrib_budget: '500' },
            snapshots: [
              { date: earlier, daily: 200, spain: 400, france: 600, [`etf_${isin}`]: 1000 },
              { date: latest, daily: 200, spain: 0, france: 1000, [`etf_${isin}`]: 1000 },
            ],
            transactions: [],
          });
        },
        { isin: ISIN, earlier: monthOffsetValue(-4), latest: monthOffsetValue(-3) },
      );
      await page.reload();
      await gotoApp(page);
      await page.locator('#btn-header-menu').click();
      await page.locator(`[data-theme-choice="${theme}"]`).click();
      await page.keyboard.press('Escape');
      await openTab(page, 'tab-settings');
      await ensureCardExpanded(page, 'settings-card-accounts');
      await waitForSyncIdle(page);

      await page.locator('.js-edit-acct').first().click();
      await capture(page, info, 'existing-account-dialog-reference', '.acct-dialog-overlay');
      await page.locator('.js-acctd-cancel').click();
      await page.click('#btn-migrate-valuations');
      await capture(page, info, 'migration-assignment', '.valuation-migration-overlay');
      await expect(page.locator('#migration-month-editor')).toContainText('Saved ETF breakdown');
      await page.locator('.js-assign-month[data-account-id="france"]').click();
      await expect(page.locator('[data-entry="0"][data-account="france"]')).toHaveValue('1000');
      await expect(page.locator('[data-coverage-review="1"]')).toHaveValue('');
      await capture(page, info, 'migration-saved-reuse', '.valuation-migration-overlay');
      await page.getByText('Dates, splits and completeness', { exact: true }).click();
      await capture(page, info, 'migration-date-guidance', '.valuation-migration-overlay');
      await page.getByText('Dates, splits and completeness', { exact: true }).click();
      await page.locator('.valuation-migration-overlay .js-review').click();
      await expect(page.locator('#migration-error')).not.toBeEmpty();
      await expect(page.locator('#migration-error')).toBeFocused();
      await expect(page.locator('#migration-error')).toBeInViewport();
      await capture(page, info, 'migration-validation', '.valuation-migration-overlay');
      await page.fill('[data-entry="0"][data-account="spain"]', '400');
      await page.fill('[data-entry="0"][data-account="france"]', '590');
      await expect(page.locator('[data-total="0"]')).toContainText('10,00 € still missing');
      await expect(page.locator('[data-total="0"]')).toHaveClass(/migration-reconcile-error/);
      await page.locator('[data-total="0"]').scrollIntoViewIfNeeded();
      await capture(page, info, 'migration-shortfall', '.valuation-migration-overlay');
      await page.fill('[data-entry="0"][data-account="france"]', '610');
      await expect(page.locator('[data-total="0"]')).toContainText('10,00 € too high');
      await expect(page.locator('[data-account-check="2"]')).toHaveCount(0);
      await expect(page.locator('[data-account-check="1"]')).toContainText(
        'exceed the account balance by 10,00 €',
      );
      await page.locator('[data-account-check="1"]').scrollIntoViewIfNeeded();
      await capture(page, info, 'migration-excess', '.valuation-migration-overlay');
      await page.locator('.valuation-migration-overlay .js-review').click();
      await expect(page.locator('#migration-confirm')).toBeDisabled();
      await expect(page.locator('#migration-error')).not.toBeEmpty();
      for (const [entry, account, value] of [
        ['0', 'spain', '400'],
        ['0', 'france', '600'],
      ])
        await page.fill(`[data-entry="${entry}"][data-account="${account}"]`, value);
      await page.getByText('Bulk actions', { exact: true }).click();
      await page.fill('#migration-to', monthOffsetValue(-4));
      await page.selectOption('#migration-coverage-state', '1');
      await page.locator('.js-coverage-rule').click();
      await expect(page.locator('#migration-coverage-status')).toContainText('1 account/months');
      await page.getByText('Bulk actions', { exact: true }).click();
      await page.selectOption('[data-coverage-review="1"]', '0');
      await page.locator('[data-coverage-review="0"]').scrollIntoViewIfNeeded();
      await capture(page, info, 'migration-completeness-choices', '.valuation-migration-overlay');
      await page.locator('.js-month-next').click();
      await page.fill('[data-entry="1"][data-account="france"]', '1000');
      await page.selectOption('[data-coverage-review="3"]', '1');
      await expect(page.locator('#migration-progress')).toContainText('Month 2 of 2');
      await expect(page.locator('[data-entry]')).toHaveCount(2);
      await page.locator('.valuation-migration-overlay .js-review').click();
      await expect(page.locator('#migration-preview')).toContainText('totals conserved');
      await expect(page.locator('#migration-preview')).toContainText('Complete');
      await expect(page.locator('#migration-preview')).toContainText('Not reviewed');
      await page.locator('.js-month-prev').click();
      await expect(page.locator('#migration-preview')).toContainText('Partial');
      await expect(page.locator('[data-entry="0"][data-account="spain"]')).toHaveValue('400');
      await page.locator('#migration-preview').scrollIntoViewIfNeeded();
      await page.locator('#migration-confirm').scrollIntoViewIfNeeded();
      await capture(page, info, 'migration-review', '.valuation-migration-overlay');
      await page.check('#migration-confirm');
      await page.locator('.valuation-migration-overlay .js-submit').click();
      await expect(page.locator('.valuation-migration-overlay')).toHaveCount(0);
      await expectToast(page, 'valuation-migration-msg', 'Account-linked ETF values enabled');
      await expect(page.locator('#btn-migrate-valuations')).toHaveCount(0);
      await waitForSyncIdle(page);
      await page.reload();
      await gotoApp(page);
      await openTab(page, 'tab-settings');
      await ensureCardExpanded(page, 'settings-card-accounts');
      await expect
        .poll(() =>
          page.evaluate(async () => {
            const modulePath = '/src/db/index.ts';
            const db: typeof import('../../src/db') = await import(/* @vite-ignore */ modulePath);
            return (await db.loadSnapshots()).map((snapshot) => [
              snapshot['position_coverage:spain'] ?? null,
              snapshot['position_coverage:france'] ?? null,
            ]);
          }),
        )
        .toEqual([
          [1, 0],
          [null, 1],
        ]);
      await waitForSyncIdle(page);
      await page.getByText('Historical ETF completeness', { exact: true }).click();
      await page.locator('#btn-review-coverage').click();
      await page.getByText('Bulk actions', { exact: true }).click();
      await page.selectOption('#migration-account', 'france');
      await page.selectOption('#migration-coverage-state', '1');
      await page.locator('.js-coverage-rule').click();
      await capture(page, info, 'historical-completeness-bulk', '.valuation-migration-overlay');
      await expect(page.locator('[data-saved-position]')).toHaveCount(2);
      await expect(page.locator('[data-saved-position]').first()).toContainText('Saved 400,00');
      await page.locator('.js-review').click();
      await expect(page.locator('#migration-preview')).toContainText(
        'Amounts and balances unchanged',
      );
      await capture(page, info, 'historical-completeness-review', '.valuation-migration-overlay');
      await page.check('#migration-confirm');
      await page.locator('.valuation-migration-overlay .js-submit').click();
      await expect(page.locator('.valuation-migration-overlay')).toHaveCount(0);
      await expectToast(page, 'valuation-migration-msg', 'ETF completeness saved');
      await waitForSyncIdle(page);
      await expect
        .poll(() =>
          page.evaluate(async () => {
            const modulePath = '/src/db/index.ts';
            const db: typeof import('../../src/db') = await import(/* @vite-ignore */ modulePath);
            return (await db.loadSnapshots()).map((snapshot) => [
              snapshot.spain,
              snapshot.france,
              snapshot['position_coverage:france'],
            ]);
          }),
        )
        .toEqual([
          [400, 600, 1],
          [0, 1000, 1],
        ]);

      await expect(page.locator('#settings-accounts-tbl .js-acctd-lifecycle')).toHaveCount(0);
      await expect(page.locator('#acct-lifecycle-toggle')).toBeHidden();
      await capture(page, info, 'compact-account-settings', '#settings-accounts-tbl');
      await openAccountStatus(page, 1);
      await capture(page, info, 'account-status-open', '.acct-dialog-overlay');
      await page.locator('.js-acctd-lifecycle[data-mode="close"]').click();
      await page.fill('#lifecycle-month', monthOffsetValue(-3));
      await page.selectOption('#lifecycle-primary', 'france');
      await capture(page, info, 'close-account', '.lifecycle-dialog-overlay');
      await page.check('#lifecycle-confirm');
      await page.locator('.lifecycle-dialog-overlay .js-submit').click();
      await saveSettings(page, 'accts', 'Accounts saved');
      await waitForSyncIdle(page);
      await capture(page, info, 'closed-account-settings', '#settings-accounts-tbl');
      await openAccountStatus(page, 1);
      await capture(page, info, 'account-status-closed', '.acct-dialog-overlay');
      await page.locator('.js-acctd-lifecycle[data-mode="reopen"]').click();
      await page.fill('#lifecycle-month', monthOffsetValue(-2));
      await capture(page, info, 'reopen-account', '.lifecycle-dialog-overlay');
      await page.check('#lifecycle-confirm');
      await page.locator('.lifecycle-dialog-overlay .js-submit').click();
      await saveSettings(page, 'accts', 'Accounts saved');
      await waitForSyncIdle(page);
      await openAccountStatus(page, 1);
      await capture(page, info, 'account-status-history', '.acct-dialog-overlay');
      await page.locator('.js-acctd-lifecycle[data-mode="correct"]').click();
      await capture(page, info, 'correct-lifecycle', '.lifecycle-dialog-overlay');
      await page.locator('.lifecycle-dialog-overlay .js-cancel').click();

      await openTab(page, 'tab-log');
      await page.click('#btn-add-snap');
      await page.fill('#snapd-date', monthOffsetValue(-1));
      await page.fill('#snapd-acc-daily', '200');
      await page.fill('#snapd-acc-spain', '400');
      await page.fill('#snapd-acc-france', '600');
      for (const [id, value] of [
        ['spain', '400'],
        ['france', '600'],
      ]) {
        const input = page.locator(`[data-position-account="${id}"][data-etf-isin="${ISIN}"]`);
        if (!(await input.count())) {
          await page.fill(`#snapd-existing-${id}`, ISIN);
          await page.locator(`#snapd-existing-${id}`).press('Enter');
        }
        await input.fill(value);
        await page.selectOption(`[data-coverage-account="${id}"]`, '1');
      }
      await capture(page, info, 'account-snapshot-entry', '.snap-dialog-overlay');
      await page.locator('[data-coverage-account="france"]').scrollIntoViewIfNeeded();
      await capture(page, info, 'account-snapshot-coverage', '.snap-dialog-overlay');
      await page.click('.js-snapd-submit');
      await expect(page.locator('.snapd-review')).toBeVisible();
      await capture(page, info, 'account-snapshot-review-dialog', '.snap-dialog-overlay');
      await page.locator('.snapd-review').screenshot({
        path: info.outputPath('account-snapshot-review.png'),
        animations: 'disabled',
      });
      await waitForSyncIdle(page);
      await page.click('.js-snapd-submit');
      await expect(page.locator('#snap-msg')).toContainText('Saved');
      expect(
        await page.evaluate(async () => {
          const modulePath = '/src/db/index.ts';
          const db: typeof import('../../src/db') = await import(/* @vite-ignore */ modulePath);
          return (await db.loadHoldings()).length;
        }),
      ).toBe(1);

      await openTab(page, 'tab-portfolio');
      const row = page.locator(`.hold-row[data-etf-key="${ISIN}"]`);
      await expect(row.locator('.hold-account-count')).toHaveText('2');
      await expect(row.locator('.hold-account-count')).toHaveAttribute('aria-label', /2 accounts/);
      await expect(row.locator('.hold-name')).toHaveText('IWDA');
      await expect(row.locator('.hold-name')).toBeVisible();
      expect(
        await row
          .locator('.hold-name')
          .evaluate((element) => element.getBoundingClientRect().height),
      ).toBeGreaterThan(10);
      if ((await row.getAttribute('aria-expanded')) === 'true') await row.click();
      expect(
        await row.evaluate((element) => element.getBoundingClientRect().height),
      ).toBeLessThanOrEqual(40);
      await capture(page, info, 'holdings-compact', '#port-table');
      await row.click();
      await expect(page.locator('.hold-detail-accounts')).not.toHaveAttribute('open', '');
      await expect(page.locator('.hold-account-row').first()).toBeHidden();
      await capture(page, info, 'holdings-details-compact', '#port-table');
      await page.locator('.hold-detail-accounts > summary').click();
      await expect(page.locator('.hold-detail-accounts .hold-account-row')).toHaveCount(3);
      await capture(page, info, 'holdings-accounts', '#port-table');
      await expect(page.locator('.hold-filter-bar')).toHaveCount(0);
      await page.evaluate(async () => {
        const modulePath = '/src/db/index.ts';
        const db: typeof import('../../src/db') = await import(/* @vite-ignore */ modulePath);
        const holdings = await db.loadHoldings();
        await db.saveHoldings([
          ...holdings,
          {
            ...holdings[0],
            isin: 'IE00B3XXRP09',
            shortName: 'VUSA',
            name: 'S&P 500',
            order: 1,
          },
        ]);
        const snapshots = await db.loadSnapshots();
        const latest = snapshots[snapshots.length - 1];
        await db.upsertSnapshot({
          ...latest,
          france: Number(latest.france) + 100,
          'position:france:IE00B3XXRP09': 100,
        });
      });
      await page.reload();
      await gotoApp(page);
      await openTab(page, 'tab-portfolio');
      await expect(page.locator('#port-account-filter [data-hold-account="france"]')).toHaveCount(
        0,
      );
      await expect(page.locator('#port-account-filter [data-hold-account="spain"]')).toBeVisible();
      await capture(page, info, 'holdings-useful-chips', '#port-table');
      await page.locator('[data-hold-account="spain"]').click();
      await expect(page.locator('.hold-row[data-etf-key]')).toHaveCount(1);
      if ((await row.getAttribute('aria-expanded')) !== 'true') await row.click();
      await page.locator('.hold-detail-accounts > summary').click();
      await expect(page.locator('.hold-detail-accounts')).toContainText(
        'Spain investment (selected)',
      );
      await capture(page, info, 'holdings-filtered', '#port-table');
      await page.fill('#port-holdings-search', 'not present');
      await expect(page.locator('.hold-row[data-etf-key]')).toHaveCount(0);
      await expect(page.locator('[data-hold-account="spain"]')).toBeVisible();
      await capture(page, info, 'holdings-no-matches', '#port-table');
      await page.locator('[data-clear-hold-search]').click();
      await expect(page.locator('.hold-row[data-etf-key]')).toHaveCount(2);
      await page.evaluate(async () => {
        const modulePath = '/src/db/index.ts';
        const db: typeof import('../../src/db') = await import(/* @vite-ignore */ modulePath);
        const holdings = await db.loadHoldings();
        await db.saveHoldings(
          holdings.map((holding) =>
            holding.isin === 'IE00B3XXRP09' ? { ...holding, active: false, targetPct: 0 } : holding,
          ),
        );
      });
      await page.reload();
      await gotoApp(page);
      await openTab(page, 'tab-log');
      await waitForSyncIdle(page);
      await page.click('#btn-add-snap');
      const franceSection = page.locator('#snapd-etf-section-france');
      const other = franceSection.locator('.snap-etf-other');
      await expect(other).not.toHaveAttribute('open', '');
      await expect(
        franceSection.locator(`[data-usual-etfs] [data-etf-isin="${ISIN}"]`),
      ).toBeVisible();
      await expect(other.locator('[data-etf-isin="IE00B3XXRP09"]')).toHaveValue('100');
      await expect(other.locator('[data-etf-isin="IE00B3XXRP09"]')).toBeHidden();
      await franceSection.scrollIntoViewIfNeeded();
      await capture(page, info, 'snapshot-usual-other-collapsed', '.snap-dialog-overlay');
      await page.fill('#snapd-existing-france', 'IE00B3XXRP09');
      await page.locator('#snapd-existing-france').press('Enter');
      await expect(other.locator('[data-etf-isin="IE00B3XXRP09"]')).toBeVisible();
      await expect(other.locator('[data-etf-isin="IE00B3XXRP09"]')).toHaveCount(1);
      await capture(page, info, 'snapshot-other-expanded', '.snap-dialog-overlay');
      await page.locator('.js-snapd-cancel').click();
    });
  }
}
