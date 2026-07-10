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
  <div id="snap-table-header"></div>
  <div id="snaps-list"></div>
  <div id="snap-pagination"></div>
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
});
