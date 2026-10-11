/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { snapshotDialog, type SnapshotDialogFxPrefetchResult } from './snapshotDialog';
import type { Account, Holding, PortfolioData, Snapshot } from '../types';
import { fmtEur2 } from '../utils';

const accounts: Account[] = [
  { id: 'cash', label: 'Cash account' },
  {
    id: 'broker',
    label: 'Broker',
    currency: 'USD',
    moneyType: 'investment',
    isPrimaryInvestment: true,
  },
];

const configHoldings: Holding[] = [
  {
    isin: 'IE00AAA',
    name: 'World ETF',
    shortName: 'WORLD',
    color: '#111111',
    acc: true,
    active: true,
    targetPct: 100,
    assetClass: 'equity',
    region: 'world',
    foldInto: '',
    order: 1,
  },
  {
    isin: 'IE00BBB',
    name: 'Legacy ETF',
    shortName: 'LEGACY',
    color: '#222222',
    acc: true,
    active: false,
    assetClass: 'bond',
    region: 'eu',
    foldInto: '',
    order: 2,
  },
];

const holdings: PortfolioData['etfs'] = {
  IE00AAA: {
    isin: 'IE00AAA',
    shortName: 'WORLD',
    name: 'World ETF',
    color: '#111111',
    acc: true,
    active: true,
    shares: 10,
    cost: 1000,
    divNet: 0,
    taxPaid: 0,
    buys: 0,
    realizedPnL: 0,
    totalFees: 0,
    exited: false,
  },
  IE00BBB: {
    isin: 'IE00BBB',
    shortName: 'LEGACY',
    name: 'Legacy ETF',
    color: '#222222',
    acc: true,
    active: false,
    shares: 5,
    cost: 500,
    divNet: 0,
    taxPaid: 0,
    buys: 0,
    realizedPnL: 0,
    totalFees: 0,
    exited: false,
  },
};

function getOverlay() {
  return document.querySelector('.snap-dialog-overlay') as HTMLElement | null;
}
function getSubmit() {
  return document.querySelector('.js-snapd-submit') as HTMLElement | null;
}
function getCancel() {
  return document.querySelector('.js-snapd-cancel') as HTMLElement | null;
}
async function reviewDraft() {
  getSubmit()!.click();
  await vi.waitFor(() => expect(getSubmit()!.textContent).toBe('Save snapshot'));
}
function fxPrefetchResult(
  overrides: Partial<SnapshotDialogFxPrefetchResult> = {},
): SnapshotDialogFxPrefetchResult {
  return {
    needed: true,
    disabled: false,
    attempted: 1,
    resolved: 1,
    failed: 0,
    rates: { USD: 0.9 },
    ...overrides,
  };
}
function setField(id: string, value: string) {
  const el = document.querySelector('#' + id) as HTMLInputElement | null;
  if (el) {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
function baseOpts(extra: Partial<Parameters<typeof snapshotDialog>[0]> = {}) {
  return {
    accounts,
    holdings,
    configHoldings,
    onReview: async (draft: Snapshot) => ({ snapshot: draft }),
    ...extra,
  };
}

function nextMonth(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

describe('snapshotDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    getOverlay()?.remove();
    document.body.style.overflow = '';
    document.removeEventListener('keydown', () => {});
  });

  it('appends exactly one .snap-dialog-overlay', () => {
    snapshotDialog(baseOpts());
    expect(document.querySelectorAll('.snap-dialog-overlay').length).toBe(1);
  });

  it('cancelling resolves null and removes overlay', async () => {
    const p = snapshotDialog(baseOpts());
    getCancel()!.click();
    expect(await p).toBeNull();
    expect(getOverlay()).toBeNull();
  });

  it('Escape resolves null and removes overlay', async () => {
    const p = snapshotDialog(baseOpts());
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(await p).toBeNull();
    expect(getOverlay()).toBeNull();
  });

  it('clicking backdrop resolves null', async () => {
    const p = snapshotDialog(baseOpts());
    getOverlay()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(await p).toBeNull();
  });

  it('validates required date field', async () => {
    const p = snapshotDialog(baseOpts());
    setField('snapd-date', '');
    let settled = false;
    void p.then(() => {
      settled = true;
    });
    getSubmit()!.click();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect((document.querySelector('#snapd-date-err') as HTMLElement).textContent).not.toBe('');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await p;
  });

  it('validates future date field', async () => {
    const p = snapshotDialog(baseOpts());
    setField('snapd-date', nextMonth());
    let settled = false;
    void p.then(() => {
      settled = true;
    });
    getSubmit()!.click();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect((document.querySelector('#snapd-date-err') as HTMLElement).textContent).toContain(
      'future',
    );
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await p;
  });

  it('accepts partial ETF allocation as unallocated cash', async () => {
    const p = snapshotDialog(baseOpts());
    (document.querySelector('.snap-etf-toggle') as HTMLButtonElement).click();
    setField('snapd-acc-cash', '0');
    setField('snapd-acc-broker', '1000');
    setField('snapd-etf-broker-IE00AAA', '700');
    await reviewDraft();
    getSubmit()!.click();
    const snap = await p;
    expect(snap).not.toBeNull();
    expect(snap!.broker).toBe(1000);
    expect(snap!.etf_IE00AAA).toBe(700);
  });

  it('rejects ETF over-allocation inline', async () => {
    const p = snapshotDialog(baseOpts());
    (document.querySelector('.snap-etf-toggle') as HTMLButtonElement).click();
    setField('snapd-acc-broker', '1000');
    setField('snapd-etf-broker-IE00AAA', '700');
    setField('snapd-etf-broker-IE00BBB', '400');
    let settled = false;
    void p.then(() => {
      settled = true;
    });
    getSubmit()!.click();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect((document.querySelector('#snapd-etf-broker-err') as HTMLElement).textContent).toContain(
      'cannot exceed the account total',
    );
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await p;
  });

  it('submits with valid fields and resolves a Snapshot', async () => {
    const p = snapshotDialog(baseOpts());
    (document.querySelector('.snap-etf-toggle') as HTMLButtonElement).click();
    setField('snapd-date', '2024-06');
    setField('snapd-notes', 'Done');
    setField('snapd-acc-cash', '500');
    setField('snapd-acc-broker', '1000');
    setField('snapd-etf-broker-IE00AAA', '750');
    setField('snapd-etf-broker-IE00BBB', '250');
    await reviewDraft();
    getSubmit()!.click();
    const snap = await p;
    expect(snap).not.toBeNull();
    expect(snap!.date).toBe('2024-06');
    expect(snap!.notes).toBe('Done');
    expect(snap!.cash).toBe(500);
    expect(snap!.broker).toBe(1000);
    expect(snap!.etf_IE00AAA).toBe(750);
    expect(snap!.etf_IE00BBB).toBe(250);
  });

  it('title shows edit mode and prefills existing values', () => {
    const existing: Snapshot = {
      date: '2024-04',
      notes: 'Prefilled',
      cash: 200,
      broker: 800,
      etf_IE00AAA: 500,
    };
    snapshotDialog(baseOpts({ existing, mode: 'edit' }));
    expect((document.querySelector('.dialog-title') as HTMLElement).textContent).toContain('Edit');
    expect((document.querySelector('#snapd-date') as HTMLInputElement).value).toBe('2024-04');
    expect((document.querySelector('#snapd-notes') as HTMLInputElement).value).toBe('Prefilled');
    expect((document.querySelector('#snapd-acc-broker') as HTMLInputElement).value).toBe('800');
    expect((document.querySelector('#snapd-etf-broker-IE00AAA') as HTMLInputElement).value).toBe(
      '500',
    );
    expect(
      (document.querySelector('.snap-etf-toggle') as HTMLElement).getAttribute('aria-expanded'),
    ).toBe('true');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  it('calling a second time resolves first call null', async () => {
    const p1 = snapshotDialog(baseOpts());
    const p2 = snapshotDialog(baseOpts());
    expect(await p1).toBeNull();
    expect(document.querySelectorAll('.snap-dialog-overlay').length).toBe(1);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(await p2).toBeNull();
  });

  it('traps Tab inside the dialog', () => {
    snapshotDialog(baseOpts());
    const ov = getOverlay()!;
    const focusables = Array.from(
      ov.querySelectorAll('input:not([disabled]), button:not([disabled])'),
    ) as HTMLElement[];
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    last.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(first);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  it('keeps compact account spacing classes for regression safety', () => {
    snapshotDialog(baseOpts());
    const accountBlocks = document.querySelectorAll('.snap-dialog-account');
    expect(accountBlocks.length).toBe(2);
    expect(
      document.querySelectorAll('.snap-dialog-account .dialog-error.dialog-error-compact').length,
    ).toBeGreaterThan(0);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  it('shows account labels with per-account currency', () => {
    snapshotDialog(baseOpts());
    const cashLabel = document.querySelector('label[for="snapd-acc-cash"]') as HTMLElement | null;
    const brokerLabel = document.querySelector(
      'label[for="snapd-acc-broker"]',
    ) as HTMLElement | null;
    expect(cashLabel?.textContent).toContain('Cash account (EUR)');
    expect(brokerLabel?.textContent).toContain('Broker (USD)');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  it('prefetches FX rates on open and when month changes', async () => {
    const onFxPrefetchMonth = vi.fn().mockResolvedValue(fxPrefetchResult());
    snapshotDialog(baseOpts({ onFxPrefetchMonth }));
    await Promise.resolve();
    const initialMonth = (document.querySelector('#snapd-date') as HTMLInputElement).value;
    expect(onFxPrefetchMonth).toHaveBeenCalledWith(initialMonth);
    setField('snapd-date', '2024-06');
    (document.querySelector('#snapd-date') as HTMLInputElement).dispatchEvent(
      new Event('change', { bubbles: true }),
    );
    await Promise.resolve();
    expect(onFxPrefetchMonth).toHaveBeenCalledWith('2024-06');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  it('renders unavailable FX prefetch status message', async () => {
    const onFxPrefetchMonth = vi
      .fn()
      .mockResolvedValue(fxPrefetchResult({ resolved: 0, failed: 1, rates: {} }));
    snapshotDialog(baseOpts({ onFxPrefetchMonth }));
    await Promise.resolve();
    const status = document.querySelector('#snapd-fx-status') as HTMLElement | null;
    expect(status?.textContent).toContain('FX rate fetch failed');
    expect(status?.textContent).toContain('converted to EUR');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  it.each([
    [2026, 0, '2025-12', '2026-01'],
    [2026, 2, '2026-02', '2026-03'],
    [2024, 2, '2024-02', '2024-03'],
  ] as const)('defaults to %s-%s month-end and marks the current month provisional', (year, month, expected, current) => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(year, month, 31));
      snapshotDialog(baseOpts());
      expect((document.querySelector('#snapd-date') as HTMLInputElement).value).toBe(expected);
      setField('snapd-date', current);
      document.querySelector('#snapd-date')!.dispatchEvent(new Event('change'));
      expect(document.querySelector('#snapd-month-note')!.textContent).toContain('provisional');
      getCancel()!.click();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['', '12junk', 'Infinity', 'NaN', '1e309', '1e3', '12,34.50'])(
    'rejects non-complete account number %s',
    async (raw) => {
      snapshotDialog(baseOpts());
      setField('snapd-acc-cash', raw);
      setField('snapd-acc-broker', '1000');
      getSubmit()!.click();
      expect(document.querySelector('#snapd-acc-cash-err')!.textContent).toContain(
        'explicit finite',
      );
      expect(document.querySelector('.snapd-review')!.hasAttribute('hidden')).toBe(true);
      getCancel()!.click();
    },
  );

  it('reviews canonical amounts once, warns about replacement and Back preserves draft', async () => {
    const onReview = vi.fn(async (draft: Snapshot) => ({ snapshot: { ...draft, broker: 900 } }));
    const p = snapshotDialog(
      baseOpts({ existingMonths: ['2024-06'], copiedFromMonth: '2024-05', onReview }),
    );
    setField('snapd-date', '2024-06');
    setField('snapd-acc-cash', '0');
    setField('snapd-acc-broker', '1000');
    setField('snapd-etf-broker-IE00AAA', '500');
    await reviewDraft();
    expect(document.querySelector('.snapd-review')!.textContent).toContain('replace');
    expect(document.querySelector('.snapd-review')!.textContent).not.toContain('Copied from');
    expect(document.querySelector('.snapd-review')!.textContent).toContain('Unexplained remainder');
    expect(document.querySelector('.snapd-review')!.textContent).toContain('900');
    expect(document.querySelector('.dialog-header')!.hasAttribute('hidden')).toBe(true);
    expect(document.querySelector('.snapd-review .dialog-title')!.textContent).toContain(
      'Jun 2024',
    );
    const values = document.querySelectorAll('.snapd-review-values dd');
    for (const value of values) {
      expect(value.textContent).toContain('€');
      expect(value.textContent).not.toContain('EUR');
    }
    expect(document.querySelector('.snapd-review-isin')!.textContent).toBe('IE00AAA');
    expect(document.querySelector('.snapd-review')!.textContent).toContain('World ETF');
    (document.querySelector('.js-snapd-back') as HTMLElement).click();
    expect(document.querySelector('.dialog-header')!.hasAttribute('hidden')).toBe(false);
    expect((document.querySelector('#snapd-acc-broker') as HTMLInputElement).value).toBe('1000');
    await reviewDraft();
    getSubmit()!.click();
    expect((await p)!.broker).toBe(900);
    expect(onReview).toHaveBeenCalledTimes(2);
  });

  it('keeps draft on failed FX review and supports explicit EUR retry', async () => {
    const onReview = vi
      .fn()
      .mockResolvedValueOnce({ error: 'FX unavailable for USD. Retry or use EUR.' })
      .mockImplementation(async (draft: Snapshot) => ({ snapshot: draft }));
    const p = snapshotDialog(baseOpts({ onReview }));
    setField('snapd-acc-cash', '0');
    setField('snapd-acc-broker', '1000');
    getSubmit()!.click();
    await vi.waitFor(() =>
      expect(document.querySelector('#snapd-review-err')!.textContent).toContain('FX unavailable'),
    );
    expect(getOverlay()).not.toBeNull();
    expect((document.querySelector('#snapd-acc-broker') as HTMLInputElement).value).toBe('1000');
    setField('snapd-acc-broker', '');
    (document.querySelector('#snapd-eur') as HTMLInputElement).click();
    setField('snapd-acc-broker', '900');
    await reviewDraft();
    expect(onReview.mock.calls[1][1].broker).toBe('EUR');
    getSubmit()!.click();
    expect((await p)!.broker).toBe(900);
  });

  it('preserves hidden extra ETFs, retired balances, unknown keys and explicit zeros on edit', async () => {
    const existing = {
      date: '2024-06',
      cash: 0,
      broker: 1000,
      retired: 123,
      future: 'metadata',
      etf_IE00CCC: 250,
      etf_IE00AAA: 0,
    };
    const p = snapshotDialog(baseOpts({ existing }));
    expect((document.querySelector('.snap-etf-other') as HTMLDetailsElement).open).toBe(false);
    expect(document.querySelector('[data-etf-isin="IE00CCC"]')).toBeNull();
    expect(document.querySelector('[data-extra-isin]')).toBeNull();
    await reviewDraft();
    getSubmit()!.click();
    expect(await p).toEqual({ ...existing, notes: '' });
  });

  it('copies canonical EUR safely, converts to native on request, and clears stale month context', async () => {
    const onFxPrefetchMonth = vi.fn().mockResolvedValue(fxPrefetchResult());
    snapshotDialog(
      baseOpts({
        prefill: { date: '2024-06', cash: 0, broker: 900, etf_IE00AAA: 450 },
        onFxPrefetchMonth,
      }),
    );
    await vi.waitFor(() =>
      expect(document.querySelector('#snapd-fx-status')!.textContent).toContain('ready'),
    );
    expect(document.querySelector('label[for="snapd-acc-broker"]')!.textContent).toContain('EUR');
    (document.querySelector('#snapd-eur') as HTMLInputElement).click();
    expect((document.querySelector('#snapd-acc-broker') as HTMLInputElement).value).toBe('1000');
    expect((document.querySelector('#snapd-etf-broker-IE00AAA') as HTMLInputElement).value).toBe(
      '500',
    );
    setField('snapd-date', '2024-07');
    document.querySelector('#snapd-date')!.dispatchEvent(new Event('change'));
    expect((document.querySelector('#snapd-eur') as HTMLInputElement).checked).toBe(true);
    expect((document.querySelector('#snapd-acc-broker') as HTMLInputElement).value).toBe('900');
    expect((document.querySelector('#snapd-etf-broker-IE00AAA') as HTMLInputElement).value).toBe(
      '450',
    );
    getCancel()!.click();
  });

  it.each<Record<string, number>>([{}, { GBP: 1.25 }, { USD: 0 }, { USD: -1 }, { USD: Infinity }, { USD: NaN }])(
    'keeps draft and reverts the currency toggle with missing or invalid rates %j',
    async (rates) => {
      snapshotDialog(
        baseOpts({
          prefill: { date: '2024-06', cash: 0, broker: 900, etf_IE00AAA: 450 },
          onFxPrefetchMonth: async () => fxPrefetchResult({ rates }),
        }),
      );
      await vi.waitFor(() =>
        expect(document.querySelector('#snapd-fx-status')!.textContent).toContain('ready'),
      );
      const eurMode = document.querySelector<HTMLInputElement>('#snapd-eur')!;
      eurMode.click();
      expect(eurMode.checked).toBe(true);
      expect(document.querySelector('#snapd-review-err')!.textContent).toContain('FX unavailable');
      eurMode.checked = false;
      setField('snapd-date', '2024-07');
      document.querySelector('#snapd-date')!.dispatchEvent(new Event('change'));
      expect(eurMode.checked).toBe(false);
      expect(document.querySelector<HTMLInputElement>('#snapd-acc-broker')!.value).toBe('900');
      expect(document.querySelector<HTMLInputElement>('[data-etf-isin="IE00AAA"]')!.value).toBe(
        '450',
      );
      getCancel()!.click();
    },
  );

  it.each(['resolved', 'rejected'] as const)(
    'ignores a %s FX prefetch after dismissal',
    async (outcome) => {
      let resolve!: (result: SnapshotDialogFxPrefetchResult) => void;
      let reject!: (error: Error) => void;
      const p = snapshotDialog(
        baseOpts({
          onFxPrefetchMonth: () =>
            new Promise<SnapshotDialogFxPrefetchResult>((res, rej) => {
              resolve = res;
              reject = rej;
            }),
        }),
      );
      const status = document.querySelector('#snapd-fx-status')!;
      getCancel()!.click();
      expect(await p).toBeNull();
      if (outcome === 'resolved') resolve(fxPrefetchResult());
      else reject(new Error('offline'));
      await Promise.resolve();
      await Promise.resolve();
      expect(status.textContent).toContain('fetching');
      expect(getOverlay()).toBeNull();
    },
  );

  it('keeps an etf-prefixed account out of ETF review totals', async () => {
    const existing = { date: '2024-06', cash: 0, broker: 900, etf_broker: 125, etf_IE00AAA: 450 };
    const p = snapshotDialog(
      baseOpts({
        accounts: [...accounts, { id: 'etf_broker', label: 'GBP account', currency: 'GBP' }],
        existing,
      }),
    );
    await reviewDraft();
    const accountValues = document.querySelector('[aria-label="Account balances"]')!;
    const etfValues = document.querySelector('[aria-label="ETF values"]')!;
    expect(accountValues.textContent).toContain('GBP account');
    expect(etfValues.textContent).not.toContain('GBP account');
    expect(
      Array.from(document.querySelectorAll('.snapd-review-summary dd')).map((el) => el.textContent),
    ).toEqual([fmtEur2(450), fmtEur2(450)]);
    getSubmit()!.click();
    expect(await p).toEqual({ ...existing, notes: '' });
  });

  it('locks draft while asynchronous review is pending and ignores a dismissed result', async () => {
    let complete!: (value: { snapshot: Snapshot }) => void;
    const onReview = () =>
      new Promise<{ snapshot: Snapshot }>((resolve) => {
        complete = resolve;
      });
    const p = snapshotDialog(baseOpts({ onReview }));
    setField('snapd-acc-cash', '0');
    setField('snapd-acc-broker', '1000');
    getSubmit()!.click();
    expect((document.querySelector('#snapd-acc-broker') as HTMLInputElement).disabled).toBe(true);
    getCancel()!.click();
    complete({ snapshot: { date: '2024-06', broker: 900 } });
    expect(await p).toBeNull();
    await Promise.resolve();
    expect(getOverlay()).toBeNull();
  });

  it('keeps review focus on visible actions rather than hidden draft fields', async () => {
    snapshotDialog(baseOpts());
    setField('snapd-acc-cash', '0');
    setField('snapd-acc-broker', '1000');
    await reviewDraft();
    expect(document.activeElement).toBe(document.querySelector('.snapd-review'));
    const immediateShiftTab = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(immediateShiftTab);
    expect(immediateShiftTab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(getSubmit());
    getSubmit()!.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(getCancel());
    getCancel()!.focus();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }),
    );
    expect(document.activeElement).toBe(getSubmit());
    getCancel()!.click();
  });

  it.each(['1,234.50', '1.234,50'])('accepts complete locale format %s', async (value) => {
    const p = snapshotDialog(baseOpts());
    setField('snapd-acc-cash', value);
    setField('snapd-acc-broker', '0');
    await reviewDraft();
    getSubmit()!.click();
    expect((await p)!.cash).toBe(1234.5);
  });

  it('keeps active held ETFs without strategic targets in the usual group', () => {
    snapshotDialog(
      baseOpts({ configHoldings: configHoldings.map((h) => ({ ...h, targetPct: undefined })) }),
    );
    const usual = document.querySelector('.snap-etf-group')!;
    expect(usual.textContent).toContain('World ETF');
    expect(usual.closest('details')).toBeNull();
    expect(document.querySelector('.snap-etf-other')!.textContent).toContain('Legacy ETF');
    getCancel()!.click();
  });

  it('accepts configured ETFs without transactions and multiple untracked extra rows; rejects duplicates', async () => {
    const p = snapshotDialog(baseOpts({ holdings: {} }));
    setField('snapd-acc-cash', '0');
    setField('snapd-acc-broker', '1000');
    setField('snapd-etf-broker-IE00AAA', '100');
    for (const isin of ['IE0000000001', 'IE0000000002']) {
      (document.querySelector('.js-snapd-extra') as HTMLElement).click();
      const rows = document.querySelectorAll('.snap-etf-extra');
      const row = rows[rows.length - 1];
      (row.querySelector('[data-extra-isin]') as HTMLInputElement).value = isin;
      (row.querySelector('[data-etf-isin]') as HTMLInputElement).value = '100';
    }
    const isins = document.querySelectorAll<HTMLInputElement>('[data-extra-isin]');
    isins[1].value = isins[0].value;
    getSubmit()!.click();
    expect(document.querySelector('#snapd-etf-broker-err')!.textContent).toContain('duplicates');
    isins[1].value = 'IE0000000002';
    await reviewDraft();
    getSubmit()!.click();
    expect(await p).toMatchObject({
      etf_IE0000000001: 100,
      etf_IE0000000002: 100,
      etf_IE00AAA: 100,
    });
  });

  it.each([
    ['unchanged', {}, true],
    ['changed balance', { broker: 901 }, false],
    ['changed ETF', { etf_IE00AAA: 451 }, false],
    ['omitted zero', { etf_IE00BBB: undefined }, false],
    ['added zero', { etf_IE0000000001: 0 }, false],
    ['renamed zero', { etf_IE00BBB: undefined, etf_IE0000000001: 0 }, false],
    ['changed hidden balance', { retired: 124 }, false],
  ])('compares canonical numeric keys symmetrically: %s', async (_, changes, warning) => {
    const baseline: Snapshot = {
      date: '2024-06',
      notes: 'Source',
      cash: 0,
      broker: 900,
      retired: 123,
      etf_IE00AAA: 450,
      etf_IE00BBB: 0,
    };
    const p = snapshotDialog(
      baseOpts({
        prefill: baseline,
        copiedFromMonth: '2024-05',
        onReview: async (draft) => {
          const snapshot: Snapshot = { ...draft, ...changes };
          for (const key of Object.keys(snapshot)) {
            if (snapshot[key] === undefined) delete snapshot[key];
          }
          return { snapshot };
        },
      }),
    );
    expect(document.querySelector('.dialog-fields')!.textContent).not.toContain('Copied from');
    setField('snapd-notes', 'New notes do not affect numeric equality');
    await reviewDraft();
    expect(document.querySelector('.snapd-review')!.textContent!.includes('Copied from')).toBe(
      warning,
    );
    if (warning)
      expect(document.querySelector('.snapd-review [role="status"]')!.className).toBe(
        'snapd-review-warning',
      );
    getCancel()!.click();
    expect(await p).toBeNull();
  });

  it.each(['add', 'edit'] as const)(
    'never warns about copying in %s for the source month',
    async (mode) => {
      const baseline = { date: '2024-06', cash: 0, broker: 900, etf_IE00AAA: 450 };
      snapshotDialog(
        baseOpts({
          prefill: baseline,
          existing: mode === 'edit' ? baseline : undefined,
          copiedFromMonth: '2024-06',
          mode,
        }),
      );
      await reviewDraft();
      expect(document.querySelector('.snapd-review')!.textContent).not.toContain('Copied from');
      if (mode === 'edit')
        expect(document.querySelector('.snapd-review')!.textContent).toContain('replace');
      getCancel()!.click();
    },
  );

  it.each([900, 901])('compares after FX normalization to EUR (%s)', async (canonical) => {
    snapshotDialog(
      baseOpts({
        prefill: { date: '2024-06', cash: 0, broker: 900 },
        copiedFromMonth: '2024-05',
        onFxPrefetchMonth: async () => fxPrefetchResult(),
        onReview: async (draft) => ({
          snapshot: { ...draft, broker: Number(draft.broker) * 0.9 },
          rates: { USD: 0.9 },
        }),
      }),
    );
    await vi.waitFor(() =>
      expect(document.querySelector('#snapd-fx-status')!.textContent).toContain('ready'),
    );
    (document.querySelector('#snapd-eur') as HTMLInputElement).click();
    setField('snapd-acc-broker', String(canonical / 0.9));
    await reviewDraft();
    expect(document.querySelector('.snapd-review')!.textContent!.includes('Copied from')).toBe(
      canonical === 900,
    );
    getCancel()!.click();
  });

  it('shows overwrite only when an unchanged copied Add draft selects another existing month', async () => {
    snapshotDialog(
      baseOpts({
        mode: 'add',
        prefill: { date: '2024-06', cash: 0, broker: 900, etf_IE00AAA: 450 },
        copiedFromMonth: '2024-05',
        existingMonths: ['2024-04'],
      }),
    );
    setField('snapd-date', '2024-04');
    await reviewDraft();
    expect(document.querySelector('.snapd-review')!.textContent).toContain('replace');
    expect(document.querySelector('.snapd-review')!.textContent).not.toContain('Copied from');
    getCancel()!.click();
  });

  it('keeps configured and transaction-record identifiers fixed, including exited holdings', () => {
    snapshotDialog(
      baseOpts({
        holdings: {
          IE00AAA: { ...holdings.IE00AAA, shares: 0, exited: true },
          IE0000000004: { ...holdings.IE00AAA, isin: 'IE0000000004', shares: 0, exited: true },
        },
        configHoldings: [configHoldings[1]],
        existing: {
          date: '2024-06',
          cash: 0,
          broker: 900,
          etf_IE00AAA: 150,
          etf_IE0000000001: 0,
        },
      }),
    );
    for (const isin of ['IE00AAA', 'IE00BBB']) {
      const row = document.querySelector(`[data-etf-isin="${isin}"]`)!.parentElement!;
      expect(row.querySelector('[data-extra-isin]')).toBeNull();
      expect(row.querySelector('.js-snapd-remove')).toBeNull();
      expect(row.closest('[aria-label="Existing holdings"]')).not.toBeNull();
    }
    expect(document.querySelectorAll('.snap-etf-extra')).toHaveLength(1);
    expect(document.querySelector('[data-etf-isin="IE0000000004"]')).toBeNull();
    expect(document.querySelector('[aria-label="Manual entries"] .snap-etf-extra')).not.toBeNull();
    expect((document.querySelector('[data-extra-isin]') as HTMLInputElement).value).toBe(
      'IE0000000001',
    );
    getCancel()!.click();
  });

  it.each(['existing', 'prefill'] as const)(
    'removes and renames persisted %s rows without resurrecting original keys',
    async (source) => {
      const baseline: Snapshot = {
        date: '2024-06',
        cash: 0,
        broker: 1000,
        retired: 123,
        etf_unsupported_key: 321,
        etf_IE0000000001: 100,
        etf_IE0000000002: 200,
        etf_IE00AAA: 300,
      };
      const p = snapshotDialog(baseOpts({ [source]: baseline }));
      const rows = document.querySelectorAll('.snap-etf-extra');
      (rows[0].querySelector('.js-snapd-remove') as HTMLElement).click();
      expect(document.activeElement).toBe(rows[1].querySelector('[data-extra-isin]'));
      expect(document.querySelector('.snap-etf-recon-alloc b')!.textContent).toContain('500');
      (rows[1].querySelector('[data-extra-isin]') as HTMLInputElement).value = 'IE0000000003';
      (rows[1].querySelector('[data-etf-isin]') as HTMLInputElement).value = '0';
      await reviewDraft();
      expect(document.querySelector('.snapd-review')!.textContent).not.toContain('IE0000000001');
      expect(document.querySelector('.snapd-review')!.textContent).not.toContain('IE0000000002');
      (document.querySelector('.js-snapd-back') as HTMLElement).click();
      expect(document.querySelectorAll('.snap-etf-extra')).toHaveLength(1);
      expect((document.querySelector('[data-extra-isin]') as HTMLInputElement).value).toBe(
        'IE0000000003',
      );
      await reviewDraft();
      getSubmit()!.click();
      expect(await p).toEqual({
        date: '2024-06',
        notes: '',
        cash: 0,
        broker: 1000,
        retired: 123,
        etf_unsupported_key: 321,
        etf_IE00AAA: 300,
        etf_IE0000000003: 0,
      });
      expect(baseline.etf_IE0000000001).toBe(100);
    },
  );

  it('validates persisted/manual duplicates, removes new rows, and cancels without mutation', async () => {
    const baseline = { date: '2024-06', cash: 0, broker: 1000, etf_IE0000000001: 100 };
    const p = snapshotDialog(baseOpts({ existing: baseline }));
    (document.querySelector('.js-snapd-extra') as HTMLElement).click();
    const rows = document.querySelectorAll('.snap-etf-extra');
    const isin = rows[1].querySelector('[data-extra-isin]') as HTMLInputElement;
    isin.value = 'IE0000000001';
    (rows[1].querySelector('[data-etf-isin]') as HTMLInputElement).value = '0';
    getSubmit()!.click();
    expect(isin.getAttribute('aria-invalid')).toBe('true');
    expect(document.querySelector('#snapd-etf-broker-err')!.textContent).toContain('duplicates');
    (rows[1].querySelector('.js-snapd-remove') as HTMLElement).click();
    expect(document.activeElement).toBe(rows[0].querySelector('[data-extra-isin]'));
    (rows[0].querySelector('.js-snapd-remove') as HTMLElement).click();
    expect(document.activeElement).toBe(document.querySelector('.js-snapd-extra'));
    expect((document.querySelector('.snap-etf-recon') as HTMLElement).style.display).toBe('none');
    getCancel()!.click();
    expect(await p).toBeNull();
    expect(baseline).toEqual({
      date: '2024-06',
      cash: 0,
      broker: 1000,
      etf_IE0000000001: 100,
    });
  });

  it('shows shared currency infoTip without toggling the checkbox and cleans up on cancel', () => {
    snapshotDialog(baseOpts());
    const tip = document.querySelector<HTMLElement>('.snapd-currency-help .info-tip')!;
    const checkbox = document.querySelector<HTMLInputElement>('#snapd-eur')!;
    expect(tip.closest('label')).toBe(checkbox.closest('label'));
    expect(checkbox.closest('label')!.className).toBe('dialog-label');
    expect(document.querySelector('.snapd-currency-details')).toBeNull();
    expect(tip.dataset.tipBound).toBe('1');
    expect(tip.tabIndex).toBe(0);
    tip.click();
    expect(document.querySelector('.info-tip-pop')!.textContent).toContain('native currency');
    expect(checkbox.checked).toBe(false);
    getCancel()!.click();
    expect(document.querySelector('.info-tip-pop')).toBeNull();
    snapshotDialog(baseOpts({ accounts: accounts.map((a) => ({ ...a, currency: 'EUR' })) }));
    expect(document.querySelector('.snapd-currency-help')).toBeNull();
    getCancel()!.click();
  });

  it('dismisses currency infoTip when entering review and supports keyboard focus', async () => {
    snapshotDialog(baseOpts());
    setField('snapd-acc-cash', '0');
    setField('snapd-acc-broker', '0');
    const tip = document.querySelector<HTMLElement>('.snapd-currency-help .info-tip')!;
    tip.focus();
    expect(document.querySelector('.info-tip-pop')).not.toBeNull();
    tip.blur();
    expect(document.querySelector('.info-tip-pop')).toBeNull();
    tip.click();
    await reviewDraft();
    expect(document.querySelector('.info-tip-pop')).toBeNull();
    getCancel()!.click();
  });
});
