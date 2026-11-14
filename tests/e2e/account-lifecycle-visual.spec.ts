import { expect, test, type Page, type TestInfo } from '@playwright/test';
import {
  ensureCardExpanded,
  gotoApp,
  monthOffsetValue,
  openTab,
  openAccountEditor,
  openAccountStatus,
  preparePage,
  saveSettings,
  waitForSyncIdle,
} from './helpers';

const ISIN = 'IE00B4L5Y983';
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
    // Phones show dialogs as full-width bottom sheets.
    const sheet = (page.viewportSize()?.width ?? 1280) <= 640;
    await expect(card).toHaveCSS(
      'max-width',
      sheet ? 'none' : selector.includes('snap-dialog') ? '720px' : '640px',
    );
    await expect(target.locator('.dialog-fields')).toHaveCSS('overflow-y', 'auto');
    await expect(actions).toBeInViewport();
    expect(await card.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true,
    );
    const bodyFont = await page
      .locator('body')
      .evaluate((element) => getComputedStyle(element).fontFamily);
    const buttonFonts = await target.locator('.btn').evaluateAll((buttons) =>
      buttons.map((button) => ({
        size: getComputedStyle(button).fontSize,
        family: getComputedStyle(button).fontFamily,
      })),
    );
    for (const font of buttonFonts) {
      expect(font.size).toBe('11px');
      expect(font.family).toBe(bodyFont);
    }
    if (!selector.includes('snap-dialog')) {
      const notes = await target.locator('.note').evaluateAll((notes) =>
        notes.map((note) => ({
          size: getComputedStyle(note).fontSize,
          style: getComputedStyle(note).fontStyle,
        })),
      );
      for (const note of notes) {
        expect(note.size).toBe('12px');
        expect(note.style).toBe('normal');
      }
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
              {
                date: earlier,
                daily: 200,
                spain: 400,
                france: 600,
                [`position:spain:${isin}`]: 400,
                [`position:france:${isin}`]: 600,
              },
              {
                date: latest,
                daily: 200,
                spain: 0,
                france: 1000,
                [`position:spain:${isin}`]: 0,
                [`position:france:${isin}`]: 1000,
              },
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

      await openAccountEditor(page, 0);
      await capture(page, info, 'existing-account-dialog-reference', '.acct-dialog-overlay');
      await page.locator('.js-acctd-cancel').click();
      await expect(page.locator('#settings-accounts-tbl .js-acctd-lifecycle')).toHaveCount(0);
      await expect(page.locator('#acct-lifecycle-toggle')).toBeHidden();
      await capture(page, info, 'compact-account-settings', '#settings-accounts-tbl');
      await openAccountStatus(page, 1);
      await capture(page, info, 'account-status-open', '.acct-dialog-overlay');
      await page.locator('.js-acctd-lifecycle[data-mode="close"]').click();
      await page.fill('#lifecycle-month', monthOffsetValue(-4));
      await expect(page.locator('#lifecycle-error')).toContainText('explicit zero');
      await capture(page, info, 'close-account-nonempty', '.lifecycle-dialog-overlay');
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
      await expect(page.locator('.snap-etf-toggle[data-acct-key="france"]')).toHaveAttribute(
        'aria-expanded',
        'true',
      );
      await expect(page.locator('.snap-etf-toggle[data-acct-key="spain"]')).toHaveAttribute(
        'aria-expanded',
        'false',
      );
      await capture(page, info, 'account-primary-only', '.snap-dialog-overlay');
      for (const [id, value] of [
        ['spain', '400'],
        ['france', '600'],
      ]) {
        const toggle = page.locator(`.snap-etf-toggle[data-acct-key="${id}"]`);
        if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
        const input = page.locator(`[data-position-account="${id}"][data-etf-isin="${ISIN}"]`);
        if (!(await input.count())) {
          await page.fill(`#snapd-existing-${id}`, ISIN);
          await page.locator(`#snapd-existing-${id}`).press('Enter');
        }
        await input.fill(value);
      }
      await capture(page, info, 'account-snapshot-entry', '.snap-dialog-overlay');
      const shared = page.locator('#snapd-etf-section-france [data-cross-account]').first();
      await expect(shared).toHaveText('+1');
      await expect(shared).toHaveAttribute('data-tip', /Spain investment/);
      await expect(page.locator('[data-coverage-account]')).toHaveCount(0);
      await shared.scrollIntoViewIfNeeded();
      await capture(page, info, 'account-shared-etf-hint', '.snap-dialog-overlay');
      await shared.click();
      await expect(page.locator('.info-tip-pop')).toContainText('Spain investment');
      await expect(page.locator('.info-tip-pop')).toBeVisible();
      await page.screenshot({
        path: info.outputPath('account-shared-etf-tooltip.png'),
        animations: 'disabled',
      });
      await shared.click();
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
      await page.locator(`.snap-row-compact[data-date="${monthOffsetValue(-1)}"]`).click();
      await expect(page.locator('.snap-detail-positions')).not.toHaveAttribute('open', '');
      await capture(page, info, 'snapshot-optional-breakdown', '.snap-detail');
      await page.locator('.snap-detail-positions > summary').click();
      const disclosureWidth = await page
        .locator('.snap-detail-positions')
        .evaluate((element) => element.getBoundingClientRect().width);
      const panelWidth = await page
        .locator('.snap-detail')
        .evaluate((element) => element.getBoundingClientRect().width);
      expect(disclosureWidth).toBeGreaterThan(panelWidth * 0.8);
      await capture(page, info, 'snapshot-expanded-breakdown', '.snap-detail');
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
      await expect(page.locator('#port-table .hold-detail-accounts')).not.toHaveAttribute(
        'open',
        '',
      );
      await expect(page.locator('.hold-account-row').first()).toBeHidden();
      await capture(page, info, 'holdings-details-compact', '#port-table');
      await page.locator('#port-table .hold-detail-accounts > summary').click();
      await expect(page.locator('#port-table .hold-detail-accounts .hold-account-row')).toHaveCount(
        3,
      );
      await capture(page, info, 'holdings-accounts', '#port-table');
      await expect(page.locator('#port-account-filter')).toBeVisible();
      await expect(page.locator('#port-account-filter')).toHaveClass(/filter-chips/);
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
      await expect(
        page.locator('#port-account-filter [data-hold-account="france"] .chip-count'),
      ).toHaveText('2');
      await expect(page.locator('#port-account-filter [data-hold-account="spain"]')).toBeVisible();
      await capture(page, info, 'holdings-useful-chips', '#port-table');
      if ((await row.getAttribute('aria-expanded')) === 'true') await row.click();
      const single = page.locator('.hold-row[data-etf-key="IE00B3XXRP09"]');
      await single.click();
      await expect(page.locator('#port-table .hold-detail-accounts')).toHaveCount(0);
      await capture(page, info, 'holdings-single-account', '#port-table');
      await single.click();
      await page.locator('[data-hold-account="spain"]').click();
      await expect(page.locator('.hold-row[data-etf-key]')).toHaveCount(1);
      if ((await row.getAttribute('aria-expanded')) !== 'true') await row.click();
      await page.locator('#port-table .hold-detail-accounts > summary').click();
      await expect(page.locator('#port-table .hold-detail-accounts')).toContainText(
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
