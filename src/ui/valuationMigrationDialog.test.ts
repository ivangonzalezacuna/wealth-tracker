/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { valuationMigrationDialog } from './valuationMigrationDialog';
import type { Account } from '../types';
import { fmtEur2 } from '../utils';

const accounts: Account[] = [
  { id: 'spain', label: 'Spain', moneyType: 'investment', isPrimaryInvestment: true },
  { id: 'france', label: 'France', moneyType: 'investment' },
];
const snapshots = [{ date: '2026-01', spain: 4000, france: 6000, etf_IE00B4L5Y983: 10000 }];
const click = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!.click();
const input = (selector: string, value: string) => {
  const field = document.querySelector<HTMLInputElement>(selector)!;
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
};
afterEach(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  document.body.innerHTML = '';
});

describe('ETF valuation migration review', () => {
  it('prefills the sole investment account from saved ETF values without marking coverage Complete', async () => {
    const history = [
      { date: '2026-01', spain: 200.5, etf_IE00B4L5Y983: 100.25, etf_IE00B3XXRP09: 0 },
    ];
    const pending = valuationMigrationDialog({ accounts: [accounts[0]], snapshots: history });
    expect(document.querySelector<HTMLInputElement>('[data-entry="0"]')!.value).toBe('100.25');
    expect(document.querySelector<HTMLInputElement>('[data-entry="1"]')!.value).toBe('0');
    expect(document.querySelector('#migration-month-editor')!.textContent).toContain(
      'Saved ETF breakdown',
    );
    expect(document.querySelector('#migration-month-editor')!.textContent).toContain(
      'Prefilled for Spain',
    );
    expect(document.querySelector<HTMLSelectElement>('[data-coverage-review="0"]')!.value).toBe('');
    click('.js-review');
    const confirm = document.querySelector<HTMLInputElement>('#migration-confirm')!;
    confirm.checked = true;
    confirm.dispatchEvent(new Event('change'));
    click('.js-submit');
    expect(await pending).toEqual({
      assignments: [
        { month: '2026-01', isin: 'IE00B4L5Y983', allocations: { spain: 100.25 } },
        { month: '2026-01', isin: 'IE00B3XXRP09', allocations: { spain: 0 } },
      ],
      coverage: [],
    });
    expect(history[0].etf_IE00B4L5Y983).toBe(100.25);
  });

  it('keeps validation for sole-account prefilled values that exceed its balance', async () => {
    const pending = valuationMigrationDialog({ accounts: [accounts[0]], snapshots });
    expect(document.querySelector<HTMLInputElement>('[data-entry="0"]')!.value).toBe('10000');
    expect(document.querySelector('[data-account-check="0"]')!.textContent).toContain('exceed');
    click('.js-review');
    expect(document.querySelector<HTMLInputElement>('#migration-confirm')!.disabled).toBe(true);
    click('.js-cancel');
    await pending;
  });

  it('shows original values and reuses a full monthly breakdown only for the chosen account', async () => {
    const pending = valuationMigrationDialog({
      accounts,
      snapshots: [
        {
          date: '2026-01',
          spain: 200,
          france: 200,
          etf_IE00B4L5Y983: 100.25,
          etf_IE00B3XXRP09: 50.12,
        },
        { date: '2026-02', spain: 200, france: 200, etf_IE00B4L5Y983: 125.34 },
      ],
    });
    expect(document.querySelector('#migration-month-editor')!.textContent).toContain(
      `Saved ${fmtEur2(100.25)}`,
    );
    expect(document.querySelector<HTMLInputElement>('[data-entry="0"]')!.value).toBe('');
    click('.js-assign-month[data-account-id="france"]');
    expect(
      document.querySelector<HTMLInputElement>('[data-entry="0"][data-account="france"]')!.value,
    ).toBe('100.25');
    expect(
      document.querySelector<HTMLInputElement>('[data-entry="1"][data-account="france"]')!.value,
    ).toBe('50.12');
    expect(
      document.querySelector<HTMLInputElement>('[data-entry="0"][data-account="spain"]')!.value,
    ).toBe('');
    click('.js-month-next');
    expect(document.querySelector<HTMLInputElement>('[data-entry="2"]')!.value).toBe('');
    click('.js-assign-month[data-account-id="spain"]');
    click('.js-review');
    const confirm = document.querySelector<HTMLInputElement>('#migration-confirm')!;
    confirm.checked = true;
    confirm.dispatchEvent(new Event('change'));
    click('.js-month-prev');
    click('.js-assign-month[data-account-id="spain"]');
    expect(confirm.disabled).toBe(true);
    expect(
      document.querySelector<HTMLInputElement>('[data-entry="0"][data-account="france"]')!.value,
    ).toBe('');
    expect(
      document.querySelector<HTMLInputElement>('[data-entry="0"][data-account="spain"]')!.value,
    ).toBe('100.25');
    click('.js-month-next');
    expect(
      document.querySelector<HTMLInputElement>('[data-entry="2"][data-account="spain"]')!.value,
    ).toBe('125.34');
    expect(document.querySelector<HTMLSelectElement>('[data-coverage-review="2"]')!.value).toBe('');
    click('.js-cancel');
    await pending;
  });

  it('shows saved account-linked ETF values, including explicit zeroes, during completeness review', async () => {
    const pending = valuationMigrationDialog({
      accounts,
      coverageOnly: true,
      snapshots: [
        {
          date: '2026-01',
          spain: 200,
          france: 200,
          'position:spain:IE00B4L5Y983': 100.25,
          'position:france:IE00B4L5Y983': 0,
        },
      ],
    });
    const values = document.querySelectorAll('[data-saved-position="IE00B4L5Y983"]');
    expect(values).toHaveLength(2);
    expect(values[0].textContent).toContain(`Saved ${fmtEur2(100.25)}`);
    expect(values[1].textContent).toContain(`Saved ${fmtEur2(0)}`);
    expect(document.querySelectorAll('.js-assign-month')).toHaveLength(0);
    click('.js-cancel');
    await pending;
  });

  it('highlights missing assignments and exact shortfalls or excesses as amounts are typed', async () => {
    const pending = valuationMigrationDialog({
      accounts,
      snapshots: [{ date: '2026-01', spain: 200, france: 200, etf_IE00B4L5Y983: 100.25 }],
    });
    let total = document.querySelector('[data-total="0"]')!;
    expect(total.textContent).toContain('Missing assignment');
    expect(total.classList.contains('migration-reconcile-error')).toBe(true);
    input('[data-account="spain"]', '90.25');
    expect(total.textContent).toContain(`${fmtEur2(10)} still missing`);
    input('[data-account="spain"]', '110.25');
    expect(total.textContent).toContain(`${fmtEur2(10)} too high`);
    click('.js-review');
    expect(document.querySelector('#migration-error')!.textContent).toContain('total');
    expect(document.querySelector<HTMLInputElement>('#migration-confirm')!.disabled).toBe(true);
    input('[data-account="spain"]', '100.25');
    total = document.querySelector('[data-total="0"]')!;
    expect(total.textContent).toContain('Total matched');
    expect(total.classList.contains('migration-reconcile-error')).toBe(false);
    expect(document.querySelector('[data-account="spain"]')!.getAttribute('aria-invalid')).toBe(
      'false',
    );
    click('.js-cancel');
    await pending;
  });

  it('flags invalid negative splits even when their sum matches and distinguishes an explicit zero', async () => {
    const pending = valuationMigrationDialog({
      accounts,
      snapshots: [{ date: '2026-01', spain: 200, france: 200, etf_IE00B4L5Y983: 0 }],
    });
    expect(document.querySelector('[data-total="0"]')!.textContent).toContain('Missing assignment');
    input('[data-account="spain"]', '0');
    expect(document.querySelector('[data-total="0"]')!.textContent).toContain('Total matched');
    input('[data-account="spain"]', '10');
    input('[data-account="france"]', '-10');
    expect(document.querySelector('[data-total="0"]')!.textContent).toContain('Invalid amount');
    expect(document.querySelector('#migration-progress')!.textContent).toContain(
      '1 month unassigned',
    );
    input('[data-account="france"]', '1e308');
    input('[data-account="spain"]', '1e308');
    expect(document.querySelector('[data-total="0"]')!.textContent).toContain('Invalid amount');
    click('.js-cancel');
    await pending;
  });

  it('uses the same half-cent tolerance as persistence without rounding away mismatches', async () => {
    const pending = valuationMigrationDialog({
      accounts,
      snapshots: [{ date: '2026-01', spain: 200, france: 200, etf_IE00B4L5Y983: 100 }],
    });
    input('[data-account="spain"]', '100.004');
    expect(document.querySelector('[data-total="0"]')!.textContent).toContain('Total matched');
    input('[data-account="spain"]', '100.006');
    expect(document.querySelector('[data-total="0"]')!.textContent).toContain(
      `${fmtEur2(0.01)} too high`,
    );
    click('.js-cancel');
    await pending;
  });

  it('flags account balance excesses separately, navigates to offscreen issues and clears resolved warnings', async () => {
    const pending = valuationMigrationDialog({
      accounts,
      snapshots: [
        { date: '2026-01', spain: 100, france: 200, etf_IE00B4L5Y983: 100 },
        { date: '2026-02', spain: 50, france: 200, etf_IE00B4L5Y983: 100 },
      ],
    });
    click('.js-rule');
    expect(document.querySelector('[data-total="0"]')!.textContent).toContain('Total matched');
    expect(document.querySelector('#migration-progress')!.textContent).toContain(
      '1 month with account balance issues',
    );
    click('.js-unassigned');
    expect(document.querySelector<HTMLInputElement>('#migration-month')!.value).toBe('2026-02');
    expect(document.querySelector('[data-account-check="2"]')!.textContent).toContain(
      `exceed the account balance by ${fmtEur2(50)}`,
    );
    input('[data-account="spain"]', '50');
    input('[data-account="france"]', '50');
    expect(document.querySelector('[data-account-check="2"]')!.textContent).toContain(
      'Balance matched',
    );
    expect(document.querySelector<HTMLButtonElement>('.js-unassigned')!.disabled).toBe(true);
    click('.js-cancel');
    await pending;
  });

  it.each([
    [{ date: '2026-01', france: 200, etf_IE00B4L5Y983: 100 }, accounts, 'balance missing'],
    [
      { date: '2026-01', spain: 100, france: 200, etf_IE00B4L5Y983: 100 },
      [{ ...accounts[0], closedPeriods: [{ closedFromMonth: '2026-01' }] }, accounts[1]],
      'Account is closed',
    ],
  ])(
    'highlights missing balances and closed-account assignments',
    async (history, accountList, message) => {
      const pending = valuationMigrationDialog({ accounts: accountList, snapshots: [history] });
      click('.js-rule');
      expect(document.querySelector('[data-account-check="0"]')!.textContent).toContain(message);
      expect(
        document
          .querySelector('[data-account-check="0"]')!
          .classList.contains('migration-reconcile-error'),
      ).toBe(true);
      click('.js-review');
      expect(document.querySelector('#migration-error')!.textContent).not.toBe('');
      click('.js-cancel');
      await pending;
    },
  );

  it('warns about a possible cash or missing-ETF remainder without treating Complete as ETF/balance equality', async () => {
    const pending = valuationMigrationDialog({
      accounts,
      snapshots: [
        { date: '2026-01', spain: 120.25, france: 0, 'position:spain:IE00B4L5Y983': 100.25 },
      ],
      coverageOnly: true,
    });

    const status = document.querySelector('[data-account-check="0"]')!;
    expect(status.textContent).toContain(
      `${fmtEur2(20)} not itemized: may be cash or unrecorded ETFs`,
    );
    expect(status.classList.contains('migration-reconcile-warning')).toBe(true);
    const coverage = document.querySelector<HTMLSelectElement>('[data-coverage-review="0"]')!;
    coverage.value = '1';
    coverage.dispatchEvent(new Event('change', { bubbles: true }));
    click('.js-review');
    expect(document.querySelector('#migration-error')!.textContent).toBe('');
    const confirm = document.querySelector<HTMLInputElement>('#migration-confirm')!;
    confirm.checked = true;
    confirm.dispatchEvent(new Event('change'));
    click('.js-submit');
    expect((await pending)?.coverage).toEqual([
      { month: '2026-01', accountId: 'spain', complete: true },
    ]);
  });

  it('preserves total-only months as Not reviewed without a missing-cash warning, independently of later complete months', async () => {
    const history = [
      { date: '2026-01', spain: 10000, france: 0 },
      {
        date: '2026-02',
        spain: 10000,
        france: 0,
        'position:spain:IE00B4L5Y983': 9500,
        'position_coverage:spain': 1,
        'position_coverage:france': 1,
      },
    ];
    const pending = valuationMigrationDialog({ accounts, snapshots: history, coverageOnly: true });
    const status = document.querySelector('[data-account-check="0"]')!;
    expect(status.textContent).toContain(`Account total ${fmtEur2(10000)} preserved`);
    expect(status.textContent).toContain('No ETF breakdown recorded; Not reviewed is valid');
    expect(status.classList.contains('migration-reconcile-warning')).toBe(false);
    expect(document.querySelector<HTMLSelectElement>('[data-coverage-review="0"]')!.value).toBe('');
    click('.js-month-next');
    expect(document.querySelector<HTMLSelectElement>('[data-coverage-review="2"]')!.value).toBe(
      '1',
    );
    click('.js-review');
    const confirm = document.querySelector<HTMLInputElement>('#migration-confirm')!;
    confirm.checked = true;
    confirm.dispatchEvent(new Event('change'));
    click('.js-submit');
    expect((await pending)?.coverage).toEqual([
      { month: '2026-02', accountId: 'spain', complete: true },
      { month: '2026-02', accountId: 'france', complete: true },
    ]);
    expect(history[0]).toEqual({ date: '2026-01', spain: 10000, france: 0 });
  });

  it('does not describe unassigned legacy ETF values as an optional total-only breakdown', async () => {
    const pending = valuationMigrationDialog({ accounts, snapshots });
    const status = document.querySelector('[data-account-check="0"]')!;
    expect(status.textContent).not.toContain('No ETF breakdown recorded');
    expect(status.classList.contains('migration-reconcile-warning')).toBe(true);
    expect(document.querySelector('[data-total="0"]')!.textContent).toContain('Missing assignment');
    click('.js-review');
    expect(document.querySelector<HTMLInputElement>('#migration-confirm')!.disabled).toBe(true);
    click('.js-cancel');
    await pending;
  });

  it('compares the combined ETF subtotal against the balance even when each individual ETF total matches', async () => {
    const pending = valuationMigrationDialog({
      accounts,
      snapshots: [
        { date: '2026-01', spain: 120, france: 200, etf_IE00B4L5Y983: 100, etf_IE00B3XXRP09: 50 },
      ],
    });
    click('.js-rule');
    for (const row of document.querySelectorAll('[data-total]'))
      expect(row.textContent).toContain('Total matched');
    expect(document.querySelector('[data-account-check="0"]')!.textContent).toContain(
      `exceed the account balance by ${fmtEur2(30)}`,
    );
    click('.js-review');
    expect(document.querySelector('#migration-error')!.textContent).toContain('balance');
    click('.js-cancel');
    await pending;
  });

  it('never auto-assigns the current primary and validates every old value', async () => {
    const pending = valuationMigrationDialog({ accounts, snapshots });
    expect(document.querySelector<HTMLInputElement>('[data-entry="0"]')!.value).toBe('');
    click('.js-review');
    expect(document.querySelector('#migration-error')!.textContent).toContain('assign');
    expect(document.activeElement).toBe(document.querySelector('#migration-error'));
    click('.js-rule');
    click('.js-review');
    expect(document.querySelector('#migration-error')!.textContent).toContain('balance');
    input('[data-account="spain"]', '4000');
    input('[data-account="france"]', '6000');
    click('.js-review');
    expect(document.querySelector('#migration-preview')!.textContent).toContain('conserved');
    expect(document.activeElement).toBe(document.querySelector('#migration-preview'));
    const check = document.querySelector<HTMLInputElement>('#migration-confirm')!;
    check.checked = true;
    check.dispatchEvent(new Event('change'));
    click('.js-submit');
    expect(await pending).toEqual({
      assignments: [
        { month: '2026-01', isin: 'IE00B4L5Y983', allocations: { spain: 4000, france: 6000 } },
      ],
      coverage: [],
    });
    expect(snapshots[0].etf_IE00B4L5Y983).toBe(10000);
  });

  it('invalidates review when a split changes and cancellation does not mutate data', async () => {
    const pending = valuationMigrationDialog({ accounts, snapshots });
    input('[data-account="spain"]', '4000');
    input('[data-account="france"]', '6000');
    click('.js-review');
    input('[data-account="spain"]', '3999');
    expect(document.querySelector<HTMLInputElement>('#migration-confirm')!.disabled).toBe(true);
    click('.js-review');
    expect(document.querySelector('#migration-error')!.textContent).toContain('total');
    click('.js-cancel');
    expect(await pending).toBeNull();
  });

  it('uses the standard Review then Save footer and returns to editing without losing drafts', async () => {
    const pending = valuationMigrationDialog({ accounts, snapshots });
    const review = document.querySelector<HTMLButtonElement>('.js-review')!;
    const save = document.querySelector<HTMLButtonElement>('.js-submit')!;
    const back = document.querySelector<HTMLButtonElement>('.js-back')!;
    expect(review.classList.contains('btn-primary')).toBe(true);
    expect(save.hidden).toBe(true);
    input('[data-account="spain"]', '4000');
    input('[data-account="france"]', '6000');
    review.click();
    expect(review.hidden).toBe(true);
    expect(save.hidden).toBe(false);
    expect(back.hidden).toBe(false);
    back.click();
    expect(review.hidden).toBe(false);
    expect(save.hidden).toBe(true);
    expect(document.querySelector<HTMLInputElement>('[data-account="spain"]')!.value).toBe('4000');
    expect(document.querySelector('#migration-preview')!.textContent).toBe('');
    click('.js-cancel');
    expect(await pending).toBeNull();
  });

  it('supports empty-dataset activation and an existing backup callback', async () => {
    const backup = vi.fn(async () => {});
    const pending = valuationMigrationDialog({ accounts: [], snapshots: [], exportBackup: backup });
    click('.js-backup');
    await Promise.resolve();
    expect(backup).toHaveBeenCalledOnce();
    click('.js-review');
    const check = document.querySelector<HTMLInputElement>('#migration-confirm')!;
    check.checked = true;
    check.dispatchEvent(new Event('change'));
    click('.js-submit');
    expect(await pending).toEqual({ assignments: [], coverage: [] });
  });

  it('blocks malformed legacy inventory instead of silently dropping it', async () => {
    const pending = valuationMigrationDialog({
      accounts,
      snapshots: [{ date: '2026-01', etf_bad: 10 }],
    });
    expect(document.querySelector('#migration-error')!.textContent).toContain('invalid legacy');
    expect(document.querySelector<HTMLButtonElement>('.js-review')!.disabled).toBe(true);
    click('.js-cancel');
    expect(await pending).toBeNull();
  });

  it('uses the shared month input with all history selected by default and rejects empty matches', async () => {
    const pending = valuationMigrationDialog({ accounts, snapshots });
    const from = document.querySelector<HTMLInputElement>('#migration-from')!;
    expect(from.type).toBe('month');
    expect(from.dataset.monthBound).toBe('true');
    expect(from.min).toBe('2026-01');
    expect(from.max).toBe('2026-01');
    expect(from.value).toBe('');
    input('#migration-from', '2026-01');
    click('.js-all-months');
    expect(from.value).toBe('');
    expect(document.querySelector('#migration-period')!.textContent).toBe('All saved months');
    input('#migration-isin', 'IE00B3XXRP09');
    click('.js-rule');
    expect(document.querySelector('#migration-error')!.textContent).toContain(
      'No saved ETF values',
    );
    expect(document.querySelector<HTMLInputElement>('[data-entry="0"]')!.value).toBe('');
    click('.js-cancel');
    expect(await pending).toBeNull();
  });

  it('bulk reviews coverage by period/account and permits individual overrides before final review', async () => {
    const history = [...snapshots, { ...snapshots[0], date: '2026-02' }];
    const pending = valuationMigrationDialog({ accounts, snapshots: history });
    input('#migration-coverage-state', '1');
    click('.js-coverage-rule');
    expect(document.querySelector<HTMLSelectElement>('[data-coverage-review="0"]')!.value).toBe(
      '1',
    );
    expect(document.querySelector<HTMLSelectElement>('[data-coverage-review="1"]')!.value).toBe('');
    input('#migration-0-0', '4000');
    input('#migration-0-1', '6000');
    click('.js-month-next');
    const override = document.querySelector<HTMLSelectElement>('[data-coverage-review="2"]')!;
    expect(override.value).toBe('1');
    override.value = '0';
    override.dispatchEvent(new Event('change', { bubbles: true }));
    for (const field of document.querySelectorAll<HTMLInputElement>('[data-entry]')) {
      input(`#${field.id}`, field.dataset.account === 'spain' ? '4000' : '6000');
    }
    click('.js-review');
    expect(document.querySelector('#migration-preview')!.textContent).toContain('Partial');
    expect(document.querySelector('#migration-preview')!.textContent).toContain('Not reviewed');
    click('.js-month-prev');
    expect(document.querySelector('#migration-preview')!.textContent).toContain('Complete');
    click('.js-month-next');
    const currentOverride = document.querySelector<HTMLSelectElement>(
      '[data-coverage-review="2"]',
    )!;
    currentOverride.value = '1';
    currentOverride.dispatchEvent(new Event('change', { bubbles: true }));
    expect(document.querySelector<HTMLInputElement>('#migration-confirm')!.disabled).toBe(true);
    click('.js-review');
    const confirm = document.querySelector<HTMLInputElement>('#migration-confirm')!;
    confirm.checked = true;
    confirm.dispatchEvent(new Event('change'));
    click('.js-submit');
    expect((await pending)?.coverage).toEqual([
      { month: '2026-01', accountId: 'spain', complete: true },
      { month: '2026-02', accountId: 'spain', complete: true },
    ]);
  });

  it('uses inclusive saved dates for bulk coverage independently of the ISIN filter', async () => {
    const pending = valuationMigrationDialog({
      accounts,
      snapshots: [...snapshots, { ...snapshots[0], date: '2026-02' }],
    });
    input('#migration-from', '2026-02');
    input('#migration-to', '2026-01');
    click('.js-coverage-rule');
    expect(document.querySelector('#migration-error')!.textContent).toContain('reversed');
    input('#migration-to', '2026-02');
    input('#migration-isin', 'IE00B3XXRP09');
    input('#migration-coverage-state', '1');
    click('.js-coverage-rule');
    expect(document.querySelector<HTMLSelectElement>('[data-coverage-review="0"]')!.value).toBe('');
    click('.js-month-next');
    expect(document.querySelector<HTMLSelectElement>('[data-coverage-review="2"]')!.value).toBe(
      '1',
    );
    expect(document.querySelector<HTMLSelectElement>('[data-coverage-review="3"]')!.value).toBe('');
    click('.js-cancel');
    expect(await pending).toBeNull();
  });

  it('accepts range boundaries between saved months but requires a saved month for direct review', async () => {
    const pending = valuationMigrationDialog({
      accounts,
      snapshots: [snapshots[0], { ...snapshots[0], date: '2026-03' }],
    });
    input('#migration-from', '2026-02');
    input('#migration-account', 'france');
    input('#migration-coverage-state', '1');
    click('.js-coverage-rule');
    expect(document.querySelector<HTMLSelectElement>('[data-coverage-review="1"]')!.value).toBe('');
    const month = document.querySelector<HTMLInputElement>('#migration-month')!;
    month.value = '2026-02';
    month.dispatchEvent(new Event('change'));
    expect(month.getAttribute('aria-invalid')).toBe('true');
    expect(document.querySelector('#migration-month-error')!.textContent).toContain(
      'Choose a saved month',
    );
    click('.js-month-next');
    expect(month.value).toBe('2026-03');
    expect(month.hasAttribute('aria-invalid')).toBe(false);
    expect(document.querySelector<HTMLSelectElement>('[data-coverage-review="3"]')!.value).toBe(
      '1',
    );
    input('#migration-from', '2025-12');
    click('.js-coverage-rule');
    expect(document.querySelector('#migration-error')!.textContent).toContain(
      'within the saved history',
    );
    click('.js-cancel');
    expect(await pending).toBeNull();
  });

  it('prepopulates existing completeness and can clear it without changing amounts', async () => {
    const pending = valuationMigrationDialog({
      accounts,
      snapshots: [{ date: '2026-01', spain: 4000, france: 6000, 'position_coverage:spain': 1 }],
      coverageOnly: true,
    });
    expect(document.querySelector<HTMLSelectElement>('[data-coverage-review="0"]')!.value).toBe(
      '1',
    );
    input('#migration-coverage-state', '');
    click('.js-coverage-rule');
    click('.js-review');
    expect(document.querySelector('#migration-preview')!.textContent).toContain(
      'Amounts and balances unchanged',
    );
    const confirm = document.querySelector<HTMLInputElement>('#migration-confirm')!;
    confirm.checked = true;
    confirm.dispatchEvent(new Event('change'));
    click('.js-submit');
    expect(await pending).toEqual({
      assignments: [],
      coverage: [{ month: '2026-01', accountId: 'spain', complete: null }],
    });
  });

  it('keeps hundreds of months out of the DOM, preserves off-screen drafts and reviews all history', async () => {
    const history = Array.from({ length: 240 }, (_, i) => ({
      ...snapshots[0],
      date: `${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`,
    }));
    const pending = valuationMigrationDialog({ accounts, snapshots: history });
    expect(document.querySelectorAll('[data-entry]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-coverage-review]')).toHaveLength(2);
    expect(document.querySelector('#migration-progress')!.textContent).toContain(
      '240 months unassigned',
    );
    input('#migration-0-0', '4000');
    input('#migration-0-1', '6000');
    click('.js-unassigned');
    expect(document.querySelector<HTMLInputElement>('#migration-month')!.value).toBe('2000-02');
    click('.js-month-prev');
    expect(document.querySelector<HTMLInputElement>('#migration-0-0')!.value).toBe('4000');
    click('.js-review');
    expect(document.querySelector<HTMLInputElement>('#migration-month')!.value).toBe('2000-02');
    expect(document.querySelector('#migration-error')!.textContent).toContain('assign');
    input('#migration-account', 'france');
    click('.js-rule');
    click('.js-review');
    expect(document.querySelector('#migration-error')!.textContent).toContain('balance');
    click('.js-cancel');
    expect(await pending).toBeNull();
    expect(history[0].etf_IE00B4L5Y983).toBe(10000);
  });

  it('retains cents in editor totals and paged before/after reports without rounding stored values', async () => {
    const pending = valuationMigrationDialog({
      accounts,
      snapshots: [{ date: '2026-01', spain: 4000.12, france: 6000.34, etf_IE00B4L5Y983: 10000.46 }],
    });
    input('#migration-0-0', '4000.12');
    input('#migration-0-1', '6000.34');
    expect(document.querySelector('[data-total="0"]')!.textContent).toContain('10.000,46');
    click('.js-review');
    expect(document.querySelector('#migration-preview')!.textContent).toContain('Before 10.000,46');
    expect(document.querySelector('#migration-preview')!.textContent).toContain('After 10.000,46');
    expect(document.querySelector('#migration-preview')!.textContent).toContain('4.000,12');
    const confirm = document.querySelector<HTMLInputElement>('#migration-confirm')!;
    confirm.checked = true;
    confirm.dispatchEvent(new Event('change'));
    click('.js-submit');
    expect((await pending)?.assignments[0].allocations).toEqual({
      spain: 4000.12,
      france: 6000.34,
    });
  });
});
