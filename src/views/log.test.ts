/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderLog, applyLogView, fmtCountBadge, revealSnapshot, showTransactions } from './log';
import type { Snapshot, Transaction } from '../types';

vi.mock('../constants', () => ({
  getACCTSList: () => [
    { key: 'acct_1', label: 'Main', color: '#111' },
    { key: 'acct_2', label: 'Savings', color: '#222' },
  ],
}));

let _collapseState: Record<string, boolean> = {};
vi.mock('../ui/collapseState', () => ({
  isCollapsed: (key: string) => !!_collapseState[key],
  setCollapsed: (key: string, collapsed: boolean) => {
    if (collapsed) _collapseState[key] = true;
    else delete _collapseState[key];
  },
  toggleCollapsed: (key: string) => {
    _collapseState[key] = !_collapseState[key];
    return _collapseState[key];
  },
}));

function makeSnap(date: string, total = 1000): Snapshot {
  return { date, acct_1: total };
}

function makeTx(rowId: bigint, overrides: Partial<Transaction> = {}): Transaction {
  return {
    rowId,
    id: `tx-${rowId}`,
    date: '2026-01-01',
    source: 'manual',
    type: 'BUY',
    name: 'IWDA',
    isin: 'IE00B4L5Y983',
    shares: 2,
    price: 100,
    amount: -200,
    fee: 0,
    tax: 0,
    currency: 'EUR',
    fxRate: 1,
    ...overrides,
  };
}

function resetRenderedFilters(): void {
  const txSearch = document.getElementById('tx-search') as HTMLInputElement | null;
  const snapSearch = document.getElementById('snap-search') as HTMLInputElement | null;

  if (txSearch) {
    txSearch.value = '';
    txSearch.dispatchEvent(new Event('input'));
  }
  document.querySelector<HTMLButtonElement>('#tx-type-filter [data-tx-type=""]')?.click();
  if (snapSearch) {
    snapSearch.value = '';
    snapSearch.dispatchEvent(new Event('input'));
  }
}

const DOM_FIXTURE = `
  <input id="snap-search" />
  <div id="snap-table-header"></div>
  <div id="snaps-list"></div>
  <div id="snap-pagination"></div>
  <div id="tx-type-filter"></div>
  <input id="tx-search" />
  <button id="btn-add-tx"></button>
  <div id="tx-ledger-list"></div>
  <div id="tx-pagination"></div>
  <div id="tx-filter-status" hidden></div>
  <div id="snap-filter-status" hidden></div>
  <button id="btn-ledger-summary" hidden></button>
  <div id="tx-ledger-summary" hidden></div>
`;

const BULK_DOM_FIXTURE = `
  <input id="snap-search" />
  <div id="snaps-list"></div>
  <div id="snap-pagination"></div>
  <button id="btn-add-snap"></button>
  <button id="btn-start-del-snaps"></button>
  <div id="snap-bulk-actions" hidden>
    <button id="btn-snap-select-all"></button>
    <button id="btn-snap-clear-all"></button>
    <button id="btn-del-snaps" disabled></button>
  </div>
  <div id="tx-type-filter"></div>
  <input id="tx-search" />
  <button id="btn-add-tx"></button>
  <div id="tx-ledger-list"></div>
  <div id="tx-pagination"></div>
  <button id="btn-start-del-txs"></button>
  <div id="tx-bulk-actions" hidden>
    <button id="btn-tx-select-all"></button>
    <button id="btn-tx-clear-all"></button>
    <button id="btn-del-txs" disabled></button>
  </div>
  <button id="btn-ledger-summary" hidden></button>
  <div id="tx-ledger-summary" hidden></div>
`;

describe('renderLog', () => {
  beforeEach(() => {
    document.body.innerHTML = DOM_FIXTURE;
    _collapseState = {};
  });

  it('renders one row per snapshot', () => {
    const snaps = [makeSnap('2026-01-01'), makeSnap('2026-02-01')];
    renderLog({
      txs: [],
      snaps,
      importMeta: null,
      onEditSnap: vi.fn(),
      onDelSnap: vi.fn(),
    });
    const listHtml = document.getElementById('snaps-list')!.innerHTML;
    expect(listHtml).toContain('2026-01-01');
    expect(listHtml).toContain('2026-02-01');
  });

  it('renders an empty-state message when snaps is empty', () => {
    renderLog({ txs: [], snaps: [], importMeta: null, onEditSnap: vi.fn(), onDelSnap: vi.fn() });
    expect(document.getElementById('snaps-list')!.textContent).toContain('No snapshots yet');
  });

  it('hides edit/delete buttons when readOnly is true', () => {
    const snaps = [makeSnap('2026-01-01')];
    renderLog({
      txs: [],
      snaps,
      importMeta: null,
      onEditSnap: vi.fn(),
      onDelSnap: vi.fn(),
      readOnly: true,
    });
    // Expand the row by clicking it to get the detail panel
    const row = document.querySelector('.snap-row-compact:not(.th)') as HTMLElement;
    row.click();
    const detail = document.querySelector('.snap-detail');
    expect(detail).not.toBeNull();
    // readOnly hides the action buttons
    expect(detail!.innerHTML).not.toContain('js-edit-snap');
    expect(detail!.innerHTML).not.toContain('js-del-snap');
  });

  it('shows edit/delete buttons when readOnly is false', () => {
    const snaps = [makeSnap('2026-01-01')];
    renderLog({
      txs: [],
      snaps,
      importMeta: null,
      onEditSnap: vi.fn(),
      onDelSnap: vi.fn(),
      readOnly: false,
    });

    // Expand the row
    const row = document.querySelector('.snap-row-compact:not(.th)') as HTMLElement;
    row.click();
    const detail = document.querySelector('.snap-detail');
    expect(detail).not.toBeNull();
    expect(detail!.innerHTML).toContain('js-edit-snap');
    expect(detail!.innerHTML).toContain('js-del-snap');
  });

  it('groups scoped ETF valuations under readable account labels', () => {
    renderLog({
      txs: [],
      snaps: [
        {
          date: '2026-06',
          acct_1: 4000,
          acct_2: 6000,
          'position:acct_1:IE00B4L5Y983': 4000,
          'position:acct_2:IE00B4L5Y983': 6000,
        },
      ],
      importMeta: null,
      onEditSnap: vi.fn(),
      onDelSnap: vi.fn(),
    });
    (document.querySelector('.snap-row-compact:not(.th)') as HTMLElement).click();
    const detail = document.querySelector('.snap-detail')!.textContent!;
    expect(detail).toContain('Main · ETF valuations');
    expect(detail).toContain('Savings · ETF valuations');
    expect(detail).toContain('IE00B4L5Y983');
    expect(detail).not.toContain('position:');
  });

  it('supports keyboard expansion and updates aria-expanded', () => {
    const snaps = [makeSnap('2026-01-01')];
    renderLog({
      txs: [],
      snaps,
      importMeta: null,
      onEditSnap: vi.fn(),
      onDelSnap: vi.fn(),
    });
    const row = document.querySelector('.snap-row-compact:not(.th)') as HTMLElement;
    expect(row.getAttribute('aria-expanded')).toBe('false');
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(document.querySelector('.snap-detail')).not.toBeNull();
    expect(row.getAttribute('aria-expanded')).toBe('true');
    row.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(document.querySelector('.snap-detail')).toBeNull();
    expect(row.getAttribute('aria-expanded')).toBe('false');
  });

  it('invokes onEditSnap when edit button is clicked', () => {
    const onEdit = vi.fn();
    const snaps = [makeSnap('2026-03-01')];
    renderLog({
      txs: [],
      snaps,
      importMeta: null,
      onEditSnap: onEdit,
      onDelSnap: vi.fn(),
    });
    // Expand row
    const row = document.querySelector('.snap-row-compact:not(.th)') as HTMLElement;
    row.click();
    // Click edit button
    const editBtn = document.querySelector('.js-edit-snap') as HTMLElement;
    expect(editBtn).not.toBeNull();
    editBtn.click();
    expect(onEdit).toHaveBeenCalledWith('2026-03-01');
  });

  it('invokes onDelSnap with date and button when delete button is clicked', () => {
    const onDel = vi.fn();
    const snaps = [makeSnap('2026-03-01')];
    renderLog({
      txs: [],
      snaps,
      importMeta: null,
      onEditSnap: vi.fn(),
      onDelSnap: onDel,
    });
    // Expand row
    const row = document.querySelector('.snap-row-compact:not(.th)') as HTMLElement;
    row.click();
    // Click delete button
    const delBtn = document.querySelector('.js-del-snap') as HTMLButtonElement;
    expect(delBtn).not.toBeNull();
    delBtn.click();
    expect(onDel).toHaveBeenCalledWith('2026-03-01', delBtn);
  });

  it('search filters snapshots by year', () => {
    const snaps = [makeSnap('2025-06-01'), makeSnap('2026-01-01'), makeSnap('2026-02-01')];
    renderLog({
      txs: [],
      snaps,
      importMeta: null,
      onEditSnap: vi.fn(),
      onDelSnap: vi.fn(),
    });
    const input = document.getElementById('snap-search') as HTMLInputElement;
    input.value = '2025';
    input.dispatchEvent(new Event('input'));
    const dates = [
      ...document.querySelectorAll<HTMLElement>('#snaps-list .snap-row-compact:not(.th)'),
    ].map((r) => r.dataset.date);
    expect(dates).toEqual(['2025-06-01']);
  });

  it('search filters snapshots by date/notes', () => {
    const snaps = [{ ...makeSnap('2026-01-01'), notes: 'bonus payment' }, makeSnap('2026-06-01')];
    renderLog({
      txs: [],
      snaps,
      importMeta: null,
      onEditSnap: vi.fn(),
      onDelSnap: vi.fn(),
    });
    // Simulate typing into search that matches no snapshot
    const searchEl = document.getElementById('snap-search') as HTMLInputElement;
    searchEl.value = 'zzzznonexistent';
    searchEl.dispatchEvent(new Event('input'));
    expect(document.getElementById('snaps-list')!.textContent).toContain('No matching snapshots');
  });

  it('shows import status when importMeta has last_import and txs are present', () => {
    renderLog({
      txs: [
        {
          id: '1',
          date: '2026-01-01',
          source: 'TR',
          type: 'BUY',
          name: 'IWDA',
          isin: 'IE00',
          shares: 1,
          price: 80,
          amount: 80,
          fee: 0,
          tax: 0,
          currency: 'EUR',
          fxRate: 1,
        },
      ],
      snaps: [],
      importMeta: { last_import: '2026-07-01' },
      onEditSnap: vi.fn(),
      onDelSnap: vi.fn(),
    });
    const btn = document.getElementById('btn-ledger-summary')!;
    expect(btn.hidden).toBe(false);
    expect(btn.textContent).toContain('1 transaction ·');
    expect(btn.textContent).not.toContain('transactions');
  });

  it('toggles a per-source breakdown with the last import date', () => {
    const tx = {
      id: 's1',
      date: '2025-03-01',
      source: 'manual',
      type: 'BUY' as const,
      name: 'IWDA',
      isin: 'IE00',
      shares: 1,
      price: 80,
      amount: 80,
      fee: 0,
      tax: 0,
      currency: 'EUR',
      fxRate: 1,
    };
    renderLog({
      txs: [
        tx,
        { ...tx, id: 's2', source: 'TR', date: '2025-01-10' },
        { ...tx, id: 's3', source: 'TR', date: '2025-06-20' },
      ],
      snaps: [],
      importMeta: { last_import: '2025-07-01' },
      onEditSnap: vi.fn(),
      onDelSnap: vi.fn(),
    });
    const btn = document.getElementById('btn-ledger-summary')!;
    const panel = document.getElementById('tx-ledger-summary')!;
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(panel.hidden).toBe(true);
    btn.click();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(panel.hidden).toBe(false);
    const rows = [...panel.querySelectorAll('.ledger-summary-item')];
    expect(rows).toHaveLength(2);
    // Largest source first, with its own count and range.
    expect(rows[0].textContent).toContain('2');
    expect(rows[0].textContent).toContain('Jan 2025');
    expect(rows[0].textContent).toContain('Jun 2025');
    expect(rows[1].textContent).toContain('Manual');
    expect(panel.textContent).toContain('Last CSV import');
    btn.click();
    expect(panel.hidden).toBe(true);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows the ledger meta even without an import, and clears it when empty', () => {
    const tx = {
      id: 'm1',
      date: '2026-02-03',
      source: 'manual',
      type: 'BUY' as const,
      name: 'IWDA',
      isin: 'IE00',
      shares: 1,
      price: 80,
      amount: 80,
      fee: 0,
      tax: 0,
      currency: 'EUR',
      fxRate: 1,
    };
    renderLog({
      txs: [tx, { ...tx, id: 'm2' }],
      snaps: [],
      importMeta: null,
      onEditSnap: vi.fn(),
      onDelSnap: vi.fn(),
    });
    expect(document.getElementById('btn-ledger-summary')!.textContent).toContain('2 transactions');
    renderLog({ txs: [], snaps: [], importMeta: null, onEditSnap: vi.fn(), onDelSnap: vi.fn() });
    expect(document.getElementById('btn-ledger-summary')!.hidden).toBe(true);
    expect(document.getElementById('tx-ledger-summary')!.hidden).toBe(true);
    expect(
      document.getElementById('tx-ledger-list')!.querySelector('.tbl-empty-state'),
    ).not.toBeNull();
  });

  it('renders transaction ledger rows', () => {
    renderLog({
      txs: [
        {
          rowId: 10n,
          id: 'tx-1',
          date: '2026-01-01',
          source: 'manual',
          type: 'BUY',
          name: 'IWDA',
          isin: 'IE00B4L5Y983',
          shares: 2,
          price: 100,
          amount: -200,
          fee: 0,
          tax: 0,
          currency: 'EUR',
          fxRate: 1,
        },
      ],
      snaps: [],
      importMeta: { last_import: '2026-01-01' },
      onEditSnap: vi.fn(),
      onDelSnap: vi.fn(),
    });
    const ledger = document.getElementById('tx-ledger-list')!;
    expect(ledger.textContent).toContain('IWDA');
    expect(ledger.textContent).toContain('BUY');
    expect(ledger.querySelector('.tx-ledger-chip')?.textContent).toContain('BUY');
    expect(ledger.querySelector('.tx-ledger-isin')?.textContent).toContain('IE00B4L5Y983');
    expect(ledger.querySelector('.tx-ledger-amount.neg')?.textContent).toContain('€');
    expect(ledger.querySelector('[data-ledger-label="Name"]')?.textContent).toContain('IWDA');
    expect(ledger.querySelector('[data-ledger-label="Amount"]')?.textContent).toContain('€');
  });

  it('shows tax alongside ledger interest amounts when present', () => {
    renderLog({
      txs: [
        {
          rowId: 11n,
          id: 'tx-int-1',
          date: '2026-01-15',
          source: 'manual',
          type: 'INTEREST',
          name: 'Cash interest',
          isin: '',
          shares: 0,
          price: 0,
          amount: 3.75,
          fee: 0,
          tax: -0.5,
          currency: 'EUR',
          fxRate: 1,
        },
      ],
      snaps: [],
      importMeta: { last_import: '2026-01-01' },
      onEditSnap: vi.fn(),
      onDelSnap: vi.fn(),
    });
    const ledger = document.getElementById('tx-ledger-list')!;
    expect(ledger.textContent).toContain('Cash interest');
    expect(ledger.textContent).toContain('Tax');
    expect(ledger.textContent).toContain('-0,50');
  });

  it('renders non-EUR transaction amounts with their native currency in ledger', () => {
    renderLog({
      txs: [
        {
          rowId: 12n,
          id: 'tx-int-dkk',
          date: '2026-02-15',
          source: 'manual',
          type: 'INTEREST',
          name: 'DKK interest',
          isin: '',
          shares: 0,
          price: 0,
          amount: 100,
          fee: 0,
          tax: -5,
          currency: 'DKK',
          fxRate: 0.13,
        },
      ],
      snaps: [],
      importMeta: { last_import: '2026-02-01' },
      onEditSnap: vi.fn(),
      onDelSnap: vi.fn(),
    });
    const ledger = document.getElementById('tx-ledger-list')!;
    const amountCellText = ledger.querySelector('[data-ledger-label="Amount"]')?.textContent || '';
    expect(amountCellText).toContain('DKK');
    expect(amountCellText).not.toContain('€');
  });

  it('wires transaction add/edit/delete callbacks', () => {
    const onAddTx = vi.fn();
    const onEditTx = vi.fn();
    const onDelTx = vi.fn();
    renderLog({
      txs: [
        {
          rowId: 10n,
          id: 'tx-1',
          date: '2026-01-01',
          source: 'manual',
          type: 'BUY',
          name: 'IWDA',
          isin: 'IE00B4L5Y983',
          shares: 2,
          price: 100,
          amount: -200,
          fee: 0,
          tax: 0,
          currency: 'EUR',
          fxRate: 1,
        },
      ],
      snaps: [],
      importMeta: { last_import: '2026-01-01' },
      onEditSnap: vi.fn(),
      onDelSnap: vi.fn(),
      onAddTx,
      onEditTx,
      onDelTx,
    });

    (document.getElementById('btn-add-tx') as HTMLButtonElement).click();
    expect(onAddTx).toHaveBeenCalled();

    const editBtn = document.querySelector('.js-edit-tx') as HTMLButtonElement;
    const delBtn = document.querySelector('.js-del-tx') as HTMLButtonElement;
    expect(document.querySelector('.tx-actions-desktop')?.getAttribute('data-ledger-label')).toBe(
      'Actions',
    );
    expect(document.querySelector('.tx-card-header .tx-actions-mobile')).not.toBeNull();
    expect(document.querySelector('.tx-row > .tx-actions-desktop')).not.toBeNull();
    editBtn.click();
    delBtn.click();
    expect(onEditTx).toHaveBeenCalledWith(10n);
    expect(onDelTx).toHaveBeenCalledWith(10n, delBtn);
  });

  it('hides transaction actions in read-only mode', () => {
    renderLog({
      txs: [
        {
          rowId: 10n,
          id: 'tx-1',
          date: '2026-01-01',
          source: 'manual',
          type: 'BUY',
          name: 'IWDA',
          isin: 'IE00B4L5Y983',
          shares: 2,
          price: 100,
          amount: -200,
          fee: 0,
          tax: 0,
          currency: 'EUR',
          fxRate: 1,
        },
      ],
      snaps: [],
      importMeta: { last_import: '2026-01-01' },
      onEditSnap: vi.fn(),
      onDelSnap: vi.fn(),
      readOnly: true,
    });

    expect(document.querySelector('.js-edit-tx')).toBeNull();
    expect(document.querySelector('.js-del-tx')).toBeNull();
    expect(document.getElementById('tx-ledger-list')?.className).toContain(
      'tx-ledger-grid-readonly',
    );
    expect((document.getElementById('btn-add-tx') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('snapshot list regressions', () => {
  beforeEach(() => {
    document.body.innerHTML = DOM_FIXTURE;
    _collapseState = {};
    renderLog({ txs: [], snaps: [], importMeta: null, onEditSnap: vi.fn(), onDelSnap: vi.fn() });
    resetRenderedFilters();
  });

  it('explains the account mix in expanded details without distorting small segments', () => {
    renderLog({
      txs: [],
      snaps: [{ date: '2024-12', acct_1: 9999, acct_2: 1 }],
      importMeta: null,
      onEditSnap: vi.fn(),
      onDelSnap: vi.fn(),
    });
    const row = document.querySelector<HTMLElement>('.snap-row-compact[data-date="2024-12"]')!;
    const segments = row.querySelectorAll<HTMLElement>('.snap-seg');
    expect(segments[0].style.flexGrow).toBe('0.9999');
    expect(segments[1].style.flexGrow).toBe('0.0001');
    expect(row.querySelector('.snap-segbar')?.getAttribute('title')).toContain('Main');
    expect(segments[1].title).toContain('Savings');
    row.click();
    const accounts = document.querySelectorAll('.snap-detail-account');
    expect(accounts).toHaveLength(2);
    expect(accounts[0].querySelector('.hold-dot')).not.toBeNull();
    expect(accounts[0].querySelector('.snap-detail-share')?.textContent).toBe('99.99%');
    expect(accounts[1].querySelector('.snap-detail-share')?.textContent).toBe('0.01%');
  });

  it.each([
    [250, 750, ['Savings', 'Main'], ['75%', '25%']],
    [500, 500, ['Main', 'Savings'], ['50%', '50%']],
  ])(
    'orders expanded accounts like bar segments for balances %s and %s, with stable ties',
    (main, savings, labels, percentages) => {
      renderLog({
        txs: [],
        snaps: [{ date: '2024-12', acct_1: main, acct_2: savings }],
        importMeta: null,
        onEditSnap: vi.fn(),
        onDelSnap: vi.fn(),
      });
      const row = document.querySelector<HTMLElement>('.snap-row-compact[data-date="2024-12"]')!;
      const segmentLabels = Array.from(row.querySelectorAll<HTMLElement>('.snap-seg')).map(
        (segment) => segment.title.split(':')[0],
      );
      row.click();
      const detailLabels = Array.from(
        document.querySelectorAll('.snap-detail-account .hold-detail-label'),
      ).map((label) => label.textContent);
      expect(detailLabels).toEqual(labels);
      expect(detailLabels).toEqual(segmentLabels);
      expect(
        Array.from(document.querySelectorAll('.snap-detail-share')).map(
          (share) => share.textContent,
        ),
      ).toEqual(percentages);
    },
  );

  it('uses positive balances as the account-mix denominator when net worth includes debt', () => {
    renderLog({
      txs: [],
      snaps: [{ date: '2024-12', acct_1: 1000, acct_2: -250 }],
      importMeta: null,
      onEditSnap: vi.fn(),
      onDelSnap: vi.fn(),
    });
    const row = document.querySelector<HTMLElement>('.snap-row-compact[data-date="2024-12"]')!;
    expect(row.querySelector<HTMLElement>('.snap-seg')!.style.flexGrow).toBe('1');
    expect(row.querySelector('.snap-segbar')?.getAttribute('aria-label')).toContain('Main 100%');
    expect(row.querySelector('.snap-total')?.textContent).toContain('750');
  });

  it.each(['search', 'chart'])(
    'clears stale counts and chart origin after deleting the last %s-filtered snapshot',
    (origin) => {
      const snap = { ...makeSnap('2024-12'), notes: 'Final filtered snapshot' };
      const onDelSnap = vi.fn(() => render([]));
      const render = (snaps: Snapshot[]) =>
        renderLog({ txs: [], snaps, importMeta: null, onEditSnap: vi.fn(), onDelSnap });
      render([snap]);
      const search = document.getElementById('snap-search') as HTMLInputElement;
      if (origin === 'chart') {
        revealSnapshot(snap.date);
      } else {
        search.value = 'Final filtered';
        search.dispatchEvent(new Event('input'));
        document.querySelector<HTMLElement>('.snap-row-compact:not(.th)')!.click();
      }
      const query = search.value;
      const status = document.getElementById('snap-filter-status')!;
      expect(status.hidden).toBe(false);
      expect(status.textContent).toContain('1 of 1 snapshots');
      expect(status.textContent?.includes('From chart')).toBe(origin === 'chart');

      document.querySelector<HTMLButtonElement>('.js-del-snap')!.click();

      expect(onDelSnap).toHaveBeenCalledWith(snap.date, expect.any(HTMLButtonElement));
      expect(search.value).toBe(query);
      expect(status.hidden).toBe(true);
      expect(status.innerHTML).toBe('');
      expect(
        document.querySelector('#snaps-list .tbl-empty-state[role="note"]')?.textContent,
      ).toContain('No snapshots yet');
      expect(document.querySelector('.snap-detail')).toBeNull();
      expect(document.querySelector('[aria-controls^="snap-detail-"]')).toBeNull();
      expect(document.getElementById('snap-pagination')!.innerHTML).toBe('');

      render([makeSnap('2025-01')]);
      expect(search.value).toBe(query);
      expect(status.textContent).toContain('0 of 1 snapshots');
      expect(status.textContent).not.toContain('From chart');
      const empty = document.querySelector('#snaps-list .tbl-empty-state')!;
      expect(empty.textContent).toContain('No matching snapshots');
      empty.querySelector<HTMLButtonElement>('.js-clear-snap-filters')!.click();
      expect(search.value).toBe('');
      expect(status.hidden).toBe(true);
      expect(document.querySelector('.snap-row-compact:not(.th)')).not.toBeNull();
    },
  );

  it('keeps expanded row and panel IDs stable across rerender without collapsed controls', () => {
    const state = {
      txs: [],
      snaps: [makeSnap('2026-01'), makeSnap('2026-02')],
      importMeta: null,
      onEditSnap: vi.fn(),
      onDelSnap: vi.fn(),
    };
    renderLog(state);
    const rowFor = (date: string) =>
      document.querySelector<HTMLElement>(`.snap-row-compact[data-date="${date}"]`)!;
    const expectLinkedPanel = (date: string) => {
      const row = rowFor(date);
      expect(row.getAttribute('aria-expanded')).toBe('true');
      const id = row.getAttribute('aria-controls')!;
      expect(id).toBeTruthy();
      const panel = document.getElementById(id)!;
      expect(panel).not.toBeNull();
      expect(panel.matches('.snap-detail[role="region"]')).toBe(true);
      expect(panel.getAttribute('aria-labelledby')).toBe(row.id);
      expect(panel.previousElementSibling).toBe(row);
      expect(document.querySelectorAll('.snap-detail')).toHaveLength(1);
      return { rowId: row.id, panelId: id };
    };

    expect(rowFor('2026-01').hasAttribute('aria-controls')).toBe(false);
    rowFor('2026-01').click();
    const ids = expectLinkedPanel('2026-01');
    renderLog(state);
    expect(expectLinkedPanel('2026-01')).toEqual(ids);
    const search = document.getElementById('snap-search') as HTMLInputElement;
    search.value = '2026';
    search.dispatchEvent(new Event('input'));
    expect(expectLinkedPanel('2026-01')).toEqual(ids);

    rowFor('2026-02').click();
    expectLinkedPanel('2026-02');
    expect(rowFor('2026-01').getAttribute('aria-expanded')).toBe('false');
    expect(rowFor('2026-01').hasAttribute('aria-controls')).toBe(false);
    expect(document.getElementById(ids.panelId)).toBeNull();
    rowFor('2026-02').dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(rowFor('2026-02').hasAttribute('aria-controls')).toBe(false);
    expect(document.querySelector('.snap-detail')).toBeNull();
    resetRenderedFilters();
  });
});

describe('bulk delete mode', () => {
  beforeEach(() => {
    document.body.innerHTML = BULK_DOM_FIXTURE;
    _collapseState = {};
  });

  it('toggles bulk mode on and off for transactions and snapshots', () => {
    renderLog({
      txs: [makeTx(10n)],
      snaps: [makeSnap('2026-01-01')],
      importMeta: null,
      onEditSnap: vi.fn(),
      onDelSnap: vi.fn(),
      onBulkDelSnaps: vi.fn(),
      onBulkDelTxs: vi.fn(),
    });
    resetRenderedFilters();

    const txToggle = document.getElementById('btn-start-del-txs') as HTMLButtonElement;
    const snapToggle = document.getElementById('btn-start-del-snaps') as HTMLButtonElement;
    txToggle.click();
    snapToggle.click();

    expect(txToggle.textContent).toBe('Cancel');
    expect(snapToggle.textContent).toBe('Cancel');
    expect(document.getElementById('tx-bulk-actions')?.hidden).toBe(false);
    expect(document.getElementById('snap-bulk-actions')?.hidden).toBe(false);
    expect(document.querySelector('.js-tx-select')).not.toBeNull();
    expect(document.querySelector('.js-snap-select')).not.toBeNull();

    txToggle.click();
    snapToggle.click();
    expect(txToggle.textContent).toBe('Select');
    expect(snapToggle.textContent).toBe('Select');
    expect(document.getElementById('tx-bulk-actions')?.hidden).toBe(true);
    expect(document.getElementById('snap-bulk-actions')?.hidden).toBe(true);
  });

  it('select all and deselect all update bulk selections', () => {
    const onBulkDelTxs = vi.fn();
    const onBulkDelSnaps = vi.fn();
    renderLog({
      txs: [makeTx(10n), makeTx(11n, { date: '2026-02-01' })],
      snaps: [makeSnap('2026-01-01'), makeSnap('2026-02-01')],
      importMeta: null,
      onEditSnap: vi.fn(),
      onDelSnap: vi.fn(),
      onBulkDelSnaps,
      onBulkDelTxs,
    });
    resetRenderedFilters();

    (document.getElementById('btn-start-del-txs') as HTMLButtonElement).click();
    (document.getElementById('btn-start-del-snaps') as HTMLButtonElement).click();
    (document.getElementById('btn-tx-select-all') as HTMLButtonElement).click();
    (document.getElementById('btn-snap-select-all') as HTMLButtonElement).click();
    (document.getElementById('btn-del-txs') as HTMLButtonElement).click();
    (document.getElementById('btn-del-snaps') as HTMLButtonElement).click();

    expect(onBulkDelTxs).toHaveBeenCalledWith(
      expect.arrayContaining([10n, 11n]),
      expect.any(HTMLButtonElement),
    );
    expect(onBulkDelSnaps).toHaveBeenCalledWith(
      expect.arrayContaining(['2026-01-01', '2026-02-01']),
      expect.any(HTMLButtonElement),
    );
    expect((document.getElementById('btn-del-txs') as HTMLButtonElement).textContent).toBe(
      'Delete (2)',
    );
    expect((document.getElementById('btn-del-snaps') as HTMLButtonElement).textContent).toBe(
      'Delete (2)',
    );

    (document.getElementById('btn-tx-clear-all') as HTMLButtonElement).click();
    (document.getElementById('btn-snap-clear-all') as HTMLButtonElement).click();
    expect((document.getElementById('btn-del-txs') as HTMLButtonElement).textContent).toBe(
      'Delete',
    );
    expect((document.getElementById('btn-del-snaps') as HTMLButtonElement).textContent).toBe(
      'Delete',
    );
  });

  it('enables delete buttons only when bulk items are selected', () => {
    renderLog({
      txs: [makeTx(10n)],
      snaps: [makeSnap('2026-01-01')],
      importMeta: null,
      onEditSnap: vi.fn(),
      onDelSnap: vi.fn(),
      onBulkDelSnaps: vi.fn(),
      onBulkDelTxs: vi.fn(),
    });
    resetRenderedFilters();

    (document.getElementById('btn-start-del-txs') as HTMLButtonElement).click();
    (document.getElementById('btn-start-del-snaps') as HTMLButtonElement).click();
    const txDelete = document.getElementById('btn-del-txs') as HTMLButtonElement;
    const snapDelete = document.getElementById('btn-del-snaps') as HTMLButtonElement;

    expect(txDelete.disabled).toBe(true);
    expect(snapDelete.disabled).toBe(true);

    const txSelect = document.querySelector('.js-tx-select') as HTMLInputElement;
    const snapSelect = document.querySelector('.js-snap-select') as HTMLInputElement;
    txSelect.checked = true;
    snapSelect.checked = true;
    txSelect.dispatchEvent(new Event('change', { bubbles: true }));
    snapSelect.dispatchEvent(new Event('change', { bubbles: true }));

    expect(txDelete.disabled).toBe(false);
    expect(snapDelete.disabled).toBe(false);
  });

  it('resets bulk delete mode on rerender', () => {
    renderLog({
      txs: [makeTx(10n)],
      snaps: [makeSnap('2026-01-01')],
      importMeta: null,
      onEditSnap: vi.fn(),
      onDelSnap: vi.fn(),
      onBulkDelSnaps: vi.fn(),
      onBulkDelTxs: vi.fn(),
    });
    resetRenderedFilters();

    (document.getElementById('btn-start-del-txs') as HTMLButtonElement).click();
    (document.getElementById('btn-start-del-snaps') as HTMLButtonElement).click();
    (document.getElementById('btn-tx-select-all') as HTMLButtonElement).click();
    (document.getElementById('btn-snap-select-all') as HTMLButtonElement).click();

    renderLog({
      txs: [makeTx(10n)],
      snaps: [makeSnap('2026-01-01')],
      importMeta: null,
      onEditSnap: vi.fn(),
      onDelSnap: vi.fn(),
      onBulkDelSnaps: vi.fn(),
      onBulkDelTxs: vi.fn(),
    });
    resetRenderedFilters();

    expect((document.getElementById('btn-start-del-txs') as HTMLButtonElement).textContent).toBe(
      'Select',
    );
    expect((document.getElementById('btn-start-del-snaps') as HTMLButtonElement).textContent).toBe(
      'Select',
    );
    expect(document.getElementById('tx-bulk-actions')?.hidden).toBe(true);
    expect(document.getElementById('snap-bulk-actions')?.hidden).toBe(true);
    expect(document.querySelector('.js-tx-select')).toBeNull();
    expect(document.querySelector('.js-snap-select')).toBeNull();
    expect((document.getElementById('btn-del-txs') as HTMLButtonElement).textContent).toBe(
      'Delete',
    );
    expect((document.getElementById('btn-del-snaps') as HTMLButtonElement).textContent).toBe(
      'Delete',
    );
  });
});

const LAYOUT_DOM_FIXTURE = `
  <button id="log-tab-transactions" role="tab"><span id="log-count-transactions"></span></button>
  <button id="log-tab-snapshots" role="tab"><span id="log-count-snapshots"></span></button>
  <div id="csv-import-card">
    <button id="btn-toggle-import" aria-expanded="false"></button>
    <div id="csv-import-panel" hidden></div>
  </div>
  <div id="balance-card" hidden><span id="snap-latest-meta"></span></div>
  ${DOM_FIXTURE}
`;

describe('log layout helpers', () => {
  beforeEach(() => {
    document.body.innerHTML = LAYOUT_DOM_FIXTURE;
    _collapseState = {};
    localStorage.clear();
  });

  function render(txs: Transaction[], snaps: Snapshot[] = []) {
    renderLog({
      txs,
      snaps,
      importMeta: txs.length ? { last_import: '2026-01-01' } : null,
      onEditSnap: vi.fn(),
      onDelSnap: vi.fn(),
    });
    resetRenderedFilters();
  }

  it('lists transactions newest first by default', () => {
    render([
      makeTx(1n, { date: '2026-01-05', name: 'Oldest' }),
      makeTx(2n, { date: '2026-03-05', name: 'Newest' }),
    ]);
    const names = [...document.querySelectorAll('.tx-row:not(.th) .tx-ledger-name')].map(
      (el) => el.textContent,
    );
    expect(names).toEqual(['Newest', 'Oldest']);
  });

  it('keeps tab count badges short for large ledgers', () => {
    expect(fmtCountBadge(0)).toBe('');
    expect(fmtCountBadge(36)).toBe('36');
    expect(fmtCountBadge(9_999)).toBe('9.999');
    expect(fmtCountBadge(12_345)).toBe('12k');
    expect(fmtCountBadge(999_999)).toBe('999k');
    expect(fmtCountBadge(1_250_000)).toBe('1,2M');
  });

  it('fills tab counts, latest snapshot meta and the account mix', () => {
    render(
      [makeTx(1n), makeTx(2n)],
      [makeSnap('2026-01-01', 500), { date: '2026-02-01', acct_1: 700, acct_2: 300 }],
    );
    expect(document.getElementById('log-count-transactions')?.textContent).toBe('2');
    expect(document.getElementById('log-count-snapshots')?.textContent).toBe('2');
    expect(document.getElementById('log-tab-transactions')?.getAttribute('aria-label')).toBe(
      'Transactions (2)',
    );
    expect(document.getElementById('snap-latest-meta')?.textContent).toContain('Latest');
    expect(
      document.querySelector('.snap-row-compact:not(.th) .snap-segbar')?.getAttribute('aria-label'),
    ).toContain('Main 70%');
  });

  it('expands a ledger row to show every stored field', () => {
    render([makeTx(7n, { fee: 1.5, note: 'Monthly plan', category: 'ETF' })]);
    const row = document.querySelector('.tx-row:not(.th)') as HTMLElement;
    expect(row.getAttribute('aria-expanded')).toBe('false');
    row.click();
    const detail = row.nextElementSibling as HTMLElement;
    expect(row.getAttribute('aria-expanded')).toBe('true');
    expect(detail.classList.contains('tx-detail')).toBe(true);
    expect(detail.classList.contains('tx-row')).toBe(false);
    expect(detail.textContent).toContain('IE00B4L5Y983');
    expect(detail.textContent).toContain('Fee');
    expect(detail.textContent).toContain('Monthly plan');
    expect(detail.textContent).toContain('ETF');

    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.tx-detail')).toBeNull();
  });

  it('does not expand the row when an action button is clicked', () => {
    const onEditTx = vi.fn();
    renderLog({
      txs: [makeTx(8n)],
      snaps: [],
      importMeta: null,
      onEditSnap: vi.fn(),
      onDelSnap: vi.fn(),
      onEditTx,
    });
    (document.querySelector('.js-edit-tx') as HTMLButtonElement).click();
    expect(onEditTx).toHaveBeenCalledWith(8n);
    expect(document.querySelector('.tx-detail')).toBeNull();
  });

  it('changes and persists the ledger page size', () => {
    const txs = Array.from({ length: 30 }, (_, i) =>
      makeTx(BigInt(i + 1), { id: `t${i}`, date: `2026-01-${String(i + 1).padStart(2, '0')}` }),
    );
    render(txs);
    expect(document.querySelectorAll('.tx-row:not(.th)')).toHaveLength(15);
    const select = document.querySelector('#tx-pagination .js-page-size') as HTMLSelectElement;
    select.value = '50';
    select.dispatchEvent(new Event('change'));
    expect(document.querySelectorAll('.tx-row:not(.th)')).toHaveLength(30);
    expect(localStorage.getItem('wt:log:txPageSize')).toBe('50');
    expect(document.querySelector('#tx-pagination .page-range')?.textContent).toBe(
      '1\u201330 of 30',
    );

    // Restore default for other tests sharing module state.
    const reset = document.querySelector('#tx-pagination .js-page-size') as HTMLSelectElement;
    reset.value = '15';
    reset.dispatchEvent(new Event('change'));
  });

  it('opens the import panel automatically only while the ledger is empty', () => {
    render([]);
    expect(document.getElementById('csv-import-panel')?.hidden).toBe(false);
    expect(document.getElementById('btn-toggle-import')?.getAttribute('aria-expanded')).toBe(
      'true',
    );
    render([makeTx(1n)]);
    expect(document.getElementById('csv-import-panel')?.hidden).toBe(true);
  });

  it('switches between the transactions and snapshots panels', () => {
    applyLogView('snapshots');
    expect(document.getElementById('balance-card')?.hidden).toBe(false);
    expect(document.getElementById('csv-import-card')?.hidden).toBe(true);
    expect(document.getElementById('log-tab-snapshots')?.getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(document.getElementById('log-tab-transactions')?.getAttribute('tabindex')).toBe('-1');
    applyLogView('transactions');
    expect(document.getElementById('balance-card')?.hidden).toBe(true);
    expect(document.getElementById('csv-import-card')?.hidden).toBe(false);
  });
});

describe('chart drill-down targets', () => {
  beforeEach(() => {
    document.body.innerHTML = `<div id="tx-ledger-card">${DOM_FIXTURE}</div>`;
    _collapseState = {};
  });

  const render = (snaps: Snapshot[], txs: Transaction[] = []) =>
    renderLog({ txs, snaps, importMeta: null, onEditSnap: vi.fn(), onDelSnap: vi.fn() });

  it('filters the history to the snapshot month and expands it', () => {
    const snaps = ['2024-11', '2024-12', '2025-01', '2025-02'].map((d) => makeSnap(d));
    render(snaps);
    const row = revealSnapshot('2024-12');
    expect(row?.dataset.date).toBe('2024-12');
    expect(_collapseState['snap:2024-12']).toBe(true);
    expect((document.getElementById('snap-search') as HTMLInputElement).value).toBe('Dec 2024');
    const dates = [
      ...document.querySelectorAll<HTMLElement>('#snaps-list .snap-row-compact:not(.th)'),
    ].map((r) => r.dataset.date);
    expect(dates).toEqual(['2024-12']);
    expect(document.querySelector('.snap-detail')).not.toBeNull();
  });

  it('opens a newer month of the same year after an older one', () => {
    const snaps = ['2025-01', '2025-02', '2025-03', '2025-04'].map((d) => makeSnap(d));
    render(snaps);
    revealSnapshot('2025-01');
    const row = revealSnapshot('2025-03');
    expect(row?.getAttribute('aria-expanded')).toBe('true');
    const detail = document.querySelectorAll('.snap-detail');
    expect(detail).toHaveLength(1);
    expect((detail[0].previousElementSibling as HTMLElement).dataset.date).toBe('2025-03');
    expect(_collapseState['snap:2025-01']).toBeUndefined();
  });

  it('returns null for an unknown snapshot', () => {
    render([makeSnap('2025-01')]);
    expect(revealSnapshot('2020-01')).toBeNull();
  });

  it('filters the ledger to a month and transaction type', () => {
    render(
      [],
      [
        makeTx(1n, { date: '2026-01-05', name: 'JanBuy' }),
        makeTx(2n, { date: '2026-02-05', name: 'FebBuy' }),
        makeTx(3n, { date: '2026-02-10', name: 'FebDiv', type: 'DIVIDEND', shares: 0 }),
      ],
    );
    const card = showTransactions({ search: '2026-02', type: 'BUY' });
    expect(card?.id).toBe('tx-ledger-card');
    const text = document.getElementById('tx-ledger-list')!.textContent!;
    expect(text).toContain('FebBuy');
    expect(text).not.toContain('JanBuy');
    expect(text).not.toContain('FebDiv');
    expect((document.getElementById('tx-search') as HTMLInputElement).value).toBe('2026-02');
    const buy = document.querySelector('#tx-type-filter [data-tx-type="BUY"]')!;
    expect(buy.getAttribute('aria-pressed')).toBe('true');
    const status = document.getElementById('tx-filter-status')!;
    expect(status.hidden).toBe(false);
    expect(status.textContent).toContain('From chart');
    expect(status.textContent).toContain('1 of 3 transactions');
  });

  it('shows type chips with counts and clears all filters from the status line', () => {
    render(
      [],
      [
        makeTx(1n, { date: '2026-01-05', name: 'JanBuy' }),
        makeTx(2n, { date: '2026-02-05', name: 'FebBuy' }),
        makeTx(3n, { date: '2026-02-10', name: 'FebDiv', type: 'DIVIDEND', shares: 0 }),
      ],
    );
    resetRenderedFilters();
    const chips = document.getElementById('tx-type-filter')!;
    expect(chips.textContent).toBe('All 3Buy 2Dividend 1');
    const status = document.getElementById('tx-filter-status')!;
    expect(status.hidden).toBe(true);
    (chips.querySelector('[data-tx-type="DIVIDEND"]') as HTMLButtonElement).click();
    const list = document.getElementById('tx-ledger-list')!;
    expect(list.textContent).toContain('FebDiv');
    expect(list.textContent).not.toContain('JanBuy');
    expect(status.textContent).not.toContain('From chart');
    expect(status.textContent).toContain('1 of 3 transactions');
    (status.querySelector('[data-clear-filters]') as HTMLButtonElement).click();
    expect(status.hidden).toBe(true);
    expect(list.textContent).toContain('JanBuy');
  });

  it('hides type chips when the ledger has a single type', () => {
    render([], [makeTx(1n), makeTx(2n, { date: '2026-02-05' })]);
    expect(document.getElementById('tx-type-filter')!.hidden).toBe(true);
  });
});
