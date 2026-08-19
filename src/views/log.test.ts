/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderLog } from './log';
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
  const txType = document.getElementById('tx-type-filter') as HTMLSelectElement | null;
  const snapSearch = document.getElementById('snap-search') as HTMLInputElement | null;
  const snapYear = document.getElementById('snap-year-filter') as HTMLSelectElement | null;

  if (txSearch) {
    txSearch.value = '';
    txSearch.dispatchEvent(new Event('input'));
  }
  if (txType) {
    txType.value = '';
    txType.dispatchEvent(new Event('change'));
  }
  if (snapSearch) {
    snapSearch.value = '';
    snapSearch.dispatchEvent(new Event('input'));
  }
  if (snapYear) {
    snapYear.value = '';
    snapYear.dispatchEvent(new Event('change'));
  }
}

const DOM_FIXTURE = `
  <select id="snap-year-filter"></select>
  <input id="snap-search" />
  <div id="snap-table-header"></div>
  <div id="snaps-list"></div>
  <div id="snap-pagination"></div>
  <select id="tx-type-filter"></select>
  <input id="tx-search" />
  <button id="btn-add-tx"></button>
  <div id="tx-ledger-list"></div>
  <div id="tx-pagination"></div>
  <div id="import-status"></div>
`;

const BULK_DOM_FIXTURE = `
  <select id="snap-year-filter"></select>
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
  <select id="tx-type-filter"></select>
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
  <div id="import-status"></div>
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

  it('populates year filter with distinct years from snaps', () => {
    const snaps = [makeSnap('2025-06-01'), makeSnap('2026-01-01'), makeSnap('2026-02-01')];
    renderLog({
      txs: [],
      snaps,
      importMeta: null,
      onEditSnap: vi.fn(),
      onDelSnap: vi.fn(),
    });
    const select = document.getElementById('snap-year-filter') as HTMLSelectElement;
    const options = Array.from(select.querySelectorAll('option'));
    expect(options[0].value).toBe('');
    expect(options[0].textContent).toBe('All years');
    expect(options[1].value).toBe('2026');
    expect(options[2].value).toBe('2025');
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
    const statusEl = document.getElementById('import-status')!;
    expect(statusEl.textContent).toContain('1 transactions');
  });

  it('shows "No CSV imported yet" when importMeta is null', () => {
    renderLog({
      txs: [],
      snaps: [],
      importMeta: null,
      onEditSnap: vi.fn(),
      onDelSnap: vi.fn(),
    });
    expect(document.getElementById('import-status')!.textContent).toContain('No CSV imported yet');
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
    expect(txToggle.textContent).toBe('Bulk delete');
    expect(snapToggle.textContent).toBe('Bulk delete');
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

    expect(onBulkDelTxs).toHaveBeenCalledWith([10n, 11n], expect.any(HTMLButtonElement));
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
      'Bulk delete',
    );
    expect((document.getElementById('btn-start-del-snaps') as HTMLButtonElement).textContent).toBe(
      'Bulk delete',
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
