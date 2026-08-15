/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderLog } from './log';
import type { Snapshot } from '../types';

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

const DOM_FIXTURE = `
  <select id="snap-year-filter"></select>
  <input id="snap-search" />
  <button id="btn-start-del-snaps">Bulk delete</button>
  <button id="btn-add-snap">Add monthly snapshot</button>
  <div id="snap-bulk-actions" hidden>
    <button id="btn-cancel-del-snaps-mobile" hidden>✕</button>
    <button id="btn-snap-select-all"></button>
    <button id="btn-snap-clear-all"></button>
    <button id="btn-del-snaps">Delete selected</button>
  </div>
  <div id="snap-table-header"></div>
  <div id="snaps-list"></div>
  <div id="snap-pagination"></div>
  <select id="tx-type-filter"></select>
  <input id="tx-search" />
  <button id="btn-start-del-txs">Bulk delete</button>
  <div id="tx-bulk-actions" hidden>
    <button id="btn-cancel-del-txs-mobile" hidden>✕</button>
    <button id="btn-tx-select-all"></button>
    <button id="btn-tx-clear-all"></button>
    <button id="btn-del-txs">Delete selected</button>
  </div>
  <button id="btn-add-tx"></button>
  <div id="tx-ledger-list"></div>
  <div id="tx-pagination"></div>
  <div id="import-status"></div>
`;

function setViewportWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  });
}

describe('renderLog', () => {
  beforeEach(() => {
    document.body.innerHTML = DOM_FIXTURE;
    _collapseState = {};
    setViewportWidth(1024);
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

  it('enters snapshot bulk mode, selects rows, and forwards selected dates', () => {
    const onBulkDelSnaps = vi.fn();
    const snaps = [makeSnap('2026-03-01'), makeSnap('2026-02-01')];
    renderLog({
      txs: [],
      snaps,
      importMeta: null,
      onEditSnap: vi.fn(),
      onDelSnap: vi.fn(),
      onBulkDelSnaps,
    });
    (document.getElementById('btn-start-del-snaps') as HTMLButtonElement).click();
    const bulkBtn = document.getElementById('btn-del-snaps') as HTMLButtonElement;
    expect(bulkBtn.disabled).toBe(true);
    const firstCheckbox = document.querySelector(
      '.js-snap-select[data-date="2026-03-01"]',
    ) as HTMLInputElement;
    firstCheckbox.click();
    firstCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
    expect(bulkBtn.disabled).toBe(false);
    expect(bulkBtn.textContent).toContain('(1)');
    bulkBtn.click();
    expect(onBulkDelSnaps).toHaveBeenCalledTimes(1);
    const calledDates = onBulkDelSnaps.mock.calls[0][0] as string[];
    expect(calledDates).toHaveLength(1);
  });

  it('shows only the inline snapshot cancel icon on narrow screens', () => {
    setViewportWidth(720);
    renderLog({
      txs: [],
      snaps: [makeSnap('2026-03-01')],
      importMeta: null,
      onEditSnap: vi.fn(),
      onDelSnap: vi.fn(),
      onBulkDelSnaps: vi.fn(),
    });
    const startBtn = document.getElementById('btn-start-del-snaps') as HTMLButtonElement;
    const mobileCancelBtn = document.getElementById(
      'btn-cancel-del-snaps-mobile',
    ) as HTMLButtonElement;
    startBtn.click();
    expect(startBtn.hidden).toBe(true);
    expect(startBtn.textContent).toBe('Bulk delete');
    expect(mobileCancelBtn.hidden).toBe(false);
  });

  it('clears selected snapshots when filters hide the selected row', () => {
    const snaps = [
      { ...makeSnap('2026-01-01'), notes: 'alpha' },
      { ...makeSnap('2026-02-01'), notes: 'beta' },
    ];
    renderLog({
      txs: [],
      snaps,
      importMeta: null,
      onEditSnap: vi.fn(),
      onDelSnap: vi.fn(),
      onBulkDelSnaps: vi.fn(),
    });
    (document.getElementById('btn-start-del-snaps') as HTMLButtonElement).click();
    const bulkBtn = document.getElementById('btn-del-snaps') as HTMLButtonElement;
    const alphaCheckbox = document.querySelector(
      '.js-snap-select[data-date="2026-01-01"]',
    ) as HTMLInputElement;
    alphaCheckbox.click();
    alphaCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
    expect(bulkBtn.disabled).toBe(false);
    const searchEl = document.getElementById('snap-search') as HTMLInputElement;
    searchEl.value = 'beta';
    searchEl.dispatchEvent(new Event('input'));
    expect(bulkBtn.disabled).toBe(true);
    expect(bulkBtn.textContent).toBe('Delete selected');
  });

  it('supports snapshot select all and deselect all in bulk mode', () => {
    const snaps = [
      { ...makeSnap('2026-03-01'), notes: 'beta one' },
      { ...makeSnap('2026-02-01'), notes: 'beta two' },
    ];
    renderLog({
      txs: [],
      snaps,
      importMeta: null,
      onEditSnap: vi.fn(),
      onDelSnap: vi.fn(),
      onBulkDelSnaps: vi.fn(),
    });
    (document.getElementById('btn-start-del-snaps') as HTMLButtonElement).click();
    const selectAll = document.getElementById('btn-snap-select-all') as HTMLButtonElement;
    const clearAll = document.getElementById('btn-snap-clear-all') as HTMLButtonElement;
    const bulkBtn = document.getElementById('btn-del-snaps') as HTMLButtonElement;
    selectAll.click();
    expect(bulkBtn.textContent).toContain('(2)');
    clearAll.click();
    expect(bulkBtn.textContent).toBe('Delete selected');
    expect(bulkBtn.disabled).toBe(true);
  });

  it('disables add monthly snapshot while snapshot bulk mode is active', () => {
    const snaps = [makeSnap('2026-03-01')];
    renderLog({
      txs: [],
      snaps,
      importMeta: null,
      onEditSnap: vi.fn(),
      onDelSnap: vi.fn(),
      onBulkDelSnaps: vi.fn(),
    });
    const startBtn = document.getElementById('btn-start-del-snaps') as HTMLButtonElement;
    const addSnapBtn = document.getElementById('btn-add-snap') as HTMLButtonElement;
    expect(addSnapBtn.disabled).toBe(false);
    startBtn.click();
    expect(addSnapBtn.disabled).toBe(true);
    startBtn.click();
    expect(addSnapBtn.disabled).toBe(false);
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

  it('supports transaction bulk delete mode and callbacks', () => {
    const onBulkDelTxs = vi.fn();
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
        {
          rowId: 11n,
          id: 'tx-2',
          date: '2026-01-02',
          source: 'manual',
          type: 'BUY',
          name: 'VWCE',
          isin: 'IE00BK5BQT80',
          shares: 1,
          price: 110,
          amount: -110,
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
      onBulkDelTxs,
    });
    const startBtn = document.getElementById('btn-start-del-txs') as HTMLButtonElement;
    const addBtn = document.getElementById('btn-add-tx') as HTMLButtonElement;
    const actionsWrap = document.getElementById('tx-bulk-actions') as HTMLDivElement;
    const mobileCancelBtn = document.getElementById(
      'btn-cancel-del-txs-mobile',
    ) as HTMLButtonElement;
    expect(addBtn.hidden).toBe(false);
    startBtn.click();
    expect(startBtn.hidden).toBe(false);
    expect(startBtn.textContent).toBe('Cancel');
    expect(startBtn.classList.contains('bulk-toggle-active')).toBe(true);
    expect(actionsWrap.hidden).toBe(false);
    expect(mobileCancelBtn.hidden).toBe(true);
    expect(addBtn.hidden).toBe(true);
    expect(
      document.querySelector('.tx-card-header .tx-actions-mobile .js-tx-select'),
    ).not.toBeNull();
    const selectAll = document.getElementById('btn-tx-select-all') as HTMLButtonElement;
    const clearAll = document.getElementById('btn-tx-clear-all') as HTMLButtonElement;
    const bulkBtn = document.getElementById('btn-del-txs') as HTMLButtonElement;
    selectAll.click();
    expect(bulkBtn.disabled).toBe(false);
    expect(bulkBtn.textContent).toContain('(2)');
    clearAll.click();
    expect(bulkBtn.disabled).toBe(true);
    selectAll.click();
    bulkBtn.click();
    expect(onBulkDelTxs).toHaveBeenCalledTimes(1);
    expect(onBulkDelTxs).toHaveBeenCalledWith([10n, 11n], bulkBtn);
  });

  it('shows only the inline transaction cancel icon on narrow screens', () => {
    setViewportWidth(720);
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
      onBulkDelTxs: vi.fn(),
    });
    const startBtn = document.getElementById('btn-start-del-txs') as HTMLButtonElement;
    const mobileCancelBtn = document.getElementById(
      'btn-cancel-del-txs-mobile',
    ) as HTMLButtonElement;
    startBtn.click();
    expect(startBtn.hidden).toBe(true);
    expect(startBtn.textContent).toBe('Bulk delete');
    expect(mobileCancelBtn.hidden).toBe(false);
  });

  it('restores the transaction add button after cancelling bulk mode', () => {
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
      onBulkDelTxs: vi.fn(),
    });
    const startBtn = document.getElementById('btn-start-del-txs') as HTMLButtonElement;
    const addBtn = document.getElementById('btn-add-tx') as HTMLButtonElement;
    const actionsWrap = document.getElementById('tx-bulk-actions') as HTMLDivElement;
    const mobileCancelBtn = document.getElementById(
      'btn-cancel-del-txs-mobile',
    ) as HTMLButtonElement;
    startBtn.click();
    startBtn.click();
    expect(startBtn.hidden).toBe(false);
    expect(startBtn.textContent).toBe('Bulk delete');
    expect(startBtn.classList.contains('bulk-toggle-active')).toBe(false);
    expect(actionsWrap.hidden).toBe(true);
    expect(mobileCancelBtn.hidden).toBe(true);
    expect(addBtn.hidden).toBe(false);
  });

  it('allows cancelling transaction bulk mode from the mobile inline cancel button', () => {
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
      onBulkDelTxs: vi.fn(),
    });
    const startBtn = document.getElementById('btn-start-del-txs') as HTMLButtonElement;
    const actionsWrap = document.getElementById('tx-bulk-actions') as HTMLDivElement;
    const mobileCancelBtn = document.getElementById(
      'btn-cancel-del-txs-mobile',
    ) as HTMLButtonElement;
    startBtn.click();
    expect(actionsWrap.hidden).toBe(false);
    mobileCancelBtn.click();
    expect(startBtn.textContent).toBe('Bulk delete');
    expect(actionsWrap.hidden).toBe(true);
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
