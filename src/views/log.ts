import { getACCTSList } from '../constants';
import { snapTotal, fmtEur2, fmtMon, fmtDay, esc, safeColor } from '../utils';
import { sourceLabel } from '../import/profiles/index';
import type { Snapshot, Transaction } from '../types';
import { T } from '../theme';
import { isCollapsed, setCollapsed } from '../ui/collapseState';
import { EDIT_ICON, DELETE_ICON } from './icons';
import { attachEtfPopovers } from '../ui/etfPopover';
import type { ColumnDef } from './tableColumns';
import { renderTableHeader, renderTableRow } from './tableColumns';
import { renderPagination } from './pagination';
import { bindExpandableRows, restoreExpandableRows } from './expandableRows';
import { bindSortedTableHeader, sortAndPaginate } from './tableView';
import { populateYearFilterOptions } from './yearFilter';
import {
  bindTableSearchFilter,
  bindTableYearFilter,
  createTableState,
  getTableFilter,
  setTablePage,
  setTableSort,
} from './tableState';

interface LogState {
  txs: Transaction[];
  snaps: Snapshot[];
  importMeta: Record<string, string> | null;
  onEditSnap: (date: string) => void;
  onDelSnap: (date: string, btn?: HTMLButtonElement) => void;
  onBulkDelSnaps?: (dates: string[], btn?: HTMLButtonElement) => void;
  onAddTx?: () => void;
  onEditTx?: (rowId: bigint) => void;
  onDelTx?: (rowId: bigint, btn?: HTMLButtonElement) => void;
  onBulkDelTxs?: (rowIds: bigint[], btn?: HTMLButtonElement) => void;
  readOnly?: boolean;
}

const PAGE_SIZE = 12;
const _snapTableState = createTableState({
  sort: { key: null, dir: null },
  filters: { year: '', search: '' },
});
let _lastOnEdit: ((date: string) => void) | null = null;
let _lastOnDel: ((date: string, btn?: HTMLButtonElement) => void) | null = null;
let _lastOnBulkDel: ((dates: string[], btn?: HTMLButtonElement) => void) | null = null;
let _lastOnAddTx: (() => void) | null = null;
let _lastOnEditTx: ((rowId: bigint) => void) | null = null;
let _lastOnDelTx: ((rowId: bigint, btn?: HTMLButtonElement) => void) | null = null;
let _lastOnBulkDelTxs: ((rowIds: bigint[], btn?: HTMLButtonElement) => void) | null = null;
let _readOnly = false;
let _snaps: Snapshot[] = [];
let _txs: Transaction[] = [];
let _snapBulkMode = false;
let _txBulkMode = false;
const _selectedSnapDates = new Set<string>();
const _selectedTxRowIds = new Set<string>();
const _txTableState = createTableState({
  sort: { key: null, dir: null },
  filters: { search: '', type: '' },
});

/** Renders the snapshot log tab: the add/edit form and the snapshot history list. */
export function renderLog(state: LogState): void {
  const { txs, snaps, importMeta } = state;

  // Import status bar
  const el = document.getElementById('import-status');
  if (el) {
    if (importMeta?.last_import && txs.length) {
      el.innerHTML = renderTxSummary(txs);
      el.className = 'status-bar status-info';
    } else {
      el.textContent = 'No CSV imported yet';
      el.className = 'status-bar status-empty';
    }
  }

  _lastOnEdit = state.onEditSnap;
  _lastOnDel = state.onDelSnap;
  _lastOnBulkDel = state.onBulkDelSnaps || null;
  _lastOnAddTx = state.onAddTx || null;
  _lastOnEditTx = state.onEditTx || null;
  _lastOnDelTx = state.onDelTx || null;
  _lastOnBulkDelTxs = state.onBulkDelTxs || null;
  _readOnly = !!state.readOnly;
  _snaps = snaps;
  _txs = txs;
  _snapBulkMode = false;
  _txBulkMode = false;
  _selectedSnapDates.clear();
  _selectedTxRowIds.clear();

  attachTxListeners();
  _updateTxBulkControls();
  renderTxList(_txs);

  // Populate year filter options
  populateYearFilterOptions('snap-year-filter', _snaps);
  attachFilterListeners();
  _updateSnapBulkControls();
  renderSnapList(_snaps, state.onEditSnap, state.onDelSnap);
}

// ── Curated transaction summary ──────────────────────────────────

/** Build a curated HTML summary of imported transactions grouped by source. */
function renderTxSummary(txs: Transaction[]): string {
  const total = txs.length;
  const firstDate = txs[0]?.date || '';
  const lastDate = txs[total - 1]?.date || '';

  // Group by source
  const bySource: Record<string, Transaction[]> = {};
  for (const tx of txs) {
    const src = tx.source || 'unknown';
    if (!bySource[src]) bySource[src] = [];
    bySource[src].push(tx);
  }

  const sources = Object.keys(bySource).sort((a, b) => bySource[b].length - bySource[a].length);

  // Only show per-source breakdown when 2+ sources exist
  if (sources.length < 2) {
    return `\u2713 ${total} transactions \u00B7 ${fmtDay(firstDate)} \u2013 ${fmtDay(lastDate)}`;
  }

  const sourceLines = sources
    .map((src) => {
      const srcTxs = bySource[src];
      const srcFirst = srcTxs[0]?.date || '';
      const srcLast = srcTxs[srcTxs.length - 1]?.date || '';

      // Count by type
      const typeCounts: Record<string, number> = {};
      for (const tx of srcTxs) {
        const t = tx.type || 'UNKNOWN';
        typeCounts[t] = (typeCounts[t] || 0) + 1;
      }
      const typeBreakdown = Object.entries(typeCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([t, c]) => `${c} ${t.charAt(0) + t.slice(1).toLowerCase()}`)
        .join(' \u00B7 ');

      return `<span style="display:inline-block;margin-top:4px"><strong>${esc(sourceLabel(src))}</strong>: ${srcTxs.length} txs, ${fmtDay(srcFirst)} \u2013 ${fmtDay(srcLast)}<br><span style="color:var(--ink-3);font-size:0.85em;margin-left:8px">${typeBreakdown}</span></span>`;
    })
    .join('<br>');

  return `\u2713 <strong>${total} transactions</strong> synced<br>${sourceLines}`;
}

function attachFilterListeners(): void {
  bindTableYearFilter({
    elementId: 'snap-year-filter',
    state: _snapTableState,
    filterKey: 'year',
    resetSort: true,
    rerender: () => {
      if (_lastOnEdit && _lastOnDel) renderSnapList(_snaps, _lastOnEdit, _lastOnDel);
    },
  });
  bindTableSearchFilter({
    elementId: 'snap-search',
    state: _snapTableState,
    filterKey: 'search',
    resetSort: true,
    rerender: () => {
      if (_lastOnEdit && _lastOnDel) renderSnapList(_snaps, _lastOnEdit, _lastOnDel);
    },
  });
}

function snapColumns(): ColumnDef<Snapshot>[] {
  const selectable = !_readOnly && !!_lastOnBulkDel && _snapBulkMode;
  const cols: ColumnDef<Snapshot>[] = [
    ...(selectable
      ? [
          {
            key: 'select',
            label: '',
            cellClass: () => 'snap-select-cell',
            cell: (s: Snapshot) =>
              `<input type="checkbox" class="snap-select-input js-snap-select" aria-label="Select snapshot ${fmtMon(s.date)}" data-date="${s.date}" ${_selectedSnapDates.has(s.date) ? 'checked' : ''}>`,
          } satisfies ColumnDef<Snapshot>,
        ]
      : []),
    {
      key: 'month',
      label: 'Month',
      sortValue: (s) => s.date,
      cell: (s) =>
        `<span class="row-expand-chevron">&#x25B8;</span><span class="snap-month">${fmtMon(s.date)}</span>${s.notes ? '<span class="snap-note-dot" title="Has a note"></span>' : ''}`,
      cellClass: () => 'snap-month-cell',
    },
    {
      key: 'total',
      label: 'Net worth',
      align: 'right',
      sortValue: (s) => snapTotal(s),
      cell: (s) => `<span style="font-weight:500;font-size:14px">${fmtEur2(snapTotal(s))}</span>`,
    },
    {
      key: 'segbar',
      label: '',
      cellClass: () => 'snap-segbar',
      cell: (s) => {
        const shown = getACCTSList();
        const total = snapTotal(s);
        if (total <= 0) return '';
        return shown
          .filter((a) => ((s[a.key] as number) || 0) > 0)
          .map((a) => ({ a, share: ((s[a.key] as number) || 0) / total }))
          .sort((x, y) => y.share - x.share)
          .map(
            ({ a, share }) =>
              `<span class="snap-seg" style="flex-grow:${share.toFixed(4)};background:${safeColor(a.color)}" title="${esc(a.label)}: ${fmtEur2((s[a.key] as number) || 0)}"></span>`,
          )
          .join('');
      },
    },
  ];
  return cols;
}

function renderSnapList(
  snaps: Snapshot[],
  onEdit: (date: string) => void,
  onDel: (date: string, btn?: HTMLButtonElement) => void,
): void {
  const el = document.getElementById('snaps-list')!;
  if (!snaps.length) {
    _selectedSnapDates.clear();
    _updateSnapBulkControls();
    el.innerHTML =
      '<div class="empty-state" style="padding:1.5rem;font-size:13px">No snapshots yet. Add your first one above.</div>';
    hidePagination();
    return;
  }

  const filtered = getFilteredSnaps(snaps);
  const visibleFilteredDates = new Set(filtered.map((s) => s.date));
  for (const date of Array.from(_selectedSnapDates)) {
    if (!visibleFilteredDates.has(date)) _selectedSnapDates.delete(date);
  }
  _updateSnapBulkControls();

  if (filtered.length === 0) {
    _selectedSnapDates.clear();
    _updateSnapBulkControls();
    el.innerHTML = `<div class="empty-state" style="padding:1rem;font-size:12px;color:var(--ink-3)">
      No matching snapshots.
      <button class="btn btn-ghost btn-sm js-clear-snap-filters" style="margin-left:6px;font-size:12px">Clear filters</button>
    </div>`;
    hidePagination();
    el.querySelector('.js-clear-snap-filters')?.addEventListener('click', () => {
      _snapTableState.filters.search = '';
      _snapTableState.filters.year = '';
      setTablePage(_snapTableState, 1);
      const yearEl = document.getElementById('snap-year-filter') as HTMLSelectElement | null;
      const searchEl = document.getElementById('snap-search') as HTMLInputElement | null;
      if (yearEl) yearEl.value = '';
      if (searchEl) searchEl.value = '';
      renderSnapList(snaps, onEdit, onDel);
    });
    return;
  }

  // Column definitions
  const columns = snapColumns();

  // Apply sort (before pagination)
  const { pageItems, page, totalPages } = sortAndPaginate(
    filtered,
    columns,
    _snapTableState.sort,
    _snapTableState.page,
    PAGE_SIZE,
  );
  setTablePage(_snapTableState, page);
  _updateSnapBulkControls();

  // Compact row layout - fixed 3-column (Month / Net worth / segment indicator)
  const rowClass =
    !_readOnly && !!_lastOnBulkDel && _snapBulkMode
      ? 'snap-row-compact snap-row-selectable'
      : 'snap-row-compact';
  el.innerHTML = `
    <div class="${rowClass} th" role="row" id="snap-table-header">
      ${renderTableHeader(columns, _snapTableState.sort)}
    </div>
    ${pageItems
      .map(
        (s) =>
          `<div class="${rowClass}" role="row" tabindex="0" aria-expanded="${String(isCollapsed('snap:' + s.date))}" data-date="${s.date}">
        ${renderTableRow(columns, s)}
      </div>`,
      )
      .join('')}
  `;

  // Bind sort handler on header row
  bindSortedTableHeader(
    document.getElementById('snap-table-header'),
    _snapTableState.sort,
    (newState) => {
      setTableSort(_snapTableState, newState);
      renderSnapList(_snaps, onEdit, onDel);
    },
  );

  // Row tap-to-expand detail panel (delegated on #snaps-list)
  const listEl = document.getElementById('snaps-list');
  bindExpandableRows({
    container: listEl,
    rowSelector: '.snap-row-compact:not(.th)',
    detailSelector: '.snap-detail',
    getItem: (row) => {
      const date = row.dataset.date;
      return date ? _snaps.find((s) => s.date === date) : undefined;
    },
    createDetail: (row, snap) =>
      _createSnapDetail(snap, row.dataset.date || '', _lastOnEdit!, _lastOnDel!),
    ignoreClick: (target) =>
      !!target.closest('.js-edit-snap') ||
      !!target.closest('.js-del-snap') ||
      !!target.closest('.js-snap-select'),
    onExpandedChange: (detailRow, expanded) => {
      const detailDate = detailRow.dataset.date;
      if (detailDate) setCollapsed('snap:' + detailDate, expanded);
    },
  });

  // Restore previously expanded snap row (if still on this page)
  restoreExpandableRows({
    container: listEl,
    rowSelector: '.snap-row-compact:not(.th)',
    detailSelector: '.snap-detail',
    getItem: (row) => {
      const date = row.dataset.date;
      return date ? snaps.find((s) => s.date === date) : undefined;
    },
    createDetail: (row, snap) => _createSnapDetail(snap, row.dataset.date || '', onEdit, onDel),
    isExpanded: (row) => {
      const date = row.dataset.date;
      return !!date && isCollapsed('snap:' + date);
    },
    onExpandedChange: (detailRow, expanded) => {
      const detailDate = detailRow.dataset.date;
      if (detailDate) setCollapsed('snap:' + detailDate, expanded);
    },
  });
  el.querySelectorAll<HTMLInputElement>('.js-snap-select').forEach((input) => {
    input.addEventListener('click', (ev) => ev.stopPropagation());
    input.addEventListener('change', () => {
      const date = input.dataset.date || '';
      if (!date) return;
      if (input.checked) _selectedSnapDates.add(date);
      else _selectedSnapDates.delete(date);
      _updateSnapBulkControls();
    });
  });

  // Pagination controls
  renderPagination('snap-pagination', _snapTableState.page, totalPages, (page) => {
    setTablePage(_snapTableState, page);
    renderSnapList(snaps, onEdit, onDel);
  });
}

/** Build the detail panel shown beneath an expanded snapshot row. */
function _createSnapDetail(
  snap: Snapshot,
  date: string,
  onEdit: (d: string) => void,
  onDel: (d: string, btn?: HTMLButtonElement) => void,
): HTMLElement {
  const accts = getACCTSList();
  const detailRows = accts
    .filter((a) => ((snap[a.key] as number) || 0) > 0)
    .map(
      (a) =>
        `<div><span class="hold-detail-label">${esc(a.label)}</span><span class="hold-detail-value">${fmtEur2(snap[a.key] as number)}</span></div>`,
    )
    .join('');
  const panel = document.createElement('div');
  panel.className = 'hold-detail snap-detail';
  panel.innerHTML = `
    ${detailRows}
    ${snap.notes ? `<div class="snap-detail-note"><span class="hold-detail-label">Note</span><span class="hold-detail-value">${esc(snap.notes)}</span></div>` : ''}
    ${
      _readOnly
        ? ''
        : `<div class="snap-detail-actions">
      <button class="btn btn-sm btn-outline js-edit-snap" data-date="${date}">Edit</button>
      <button class="btn btn-sm btn-danger js-del-snap" data-date="${date}">Delete</button>
    </div>`
    }`;
  panel.querySelector('.js-edit-snap')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    onEdit(date);
  });
  panel.querySelector('.js-del-snap')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    onDel(date, ev.currentTarget as HTMLButtonElement);
  });
  return panel;
}

function hidePagination(): void {
  const el = document.getElementById('snap-pagination');
  if (el) el.innerHTML = '';
}

function getFilteredSnaps(snaps: Snapshot[]): Snapshot[] {
  let filtered = [...snaps].reverse();
  const selectedYear = getTableFilter(_snapTableState, 'year');
  const searchTerm = getTableFilter(_snapTableState, 'search');
  if (selectedYear) {
    filtered = filtered.filter((s) => s.date.startsWith(selectedYear));
  }
  if (searchTerm) {
    filtered = filtered.filter(
      (s) =>
        (s.notes || '').toLowerCase().includes(searchTerm) ||
        fmtMon(s.date).toLowerCase().includes(searchTerm),
    );
  }
  return filtered;
}

function _updateSnapBulkControls(): void {
  const startBtn = document.getElementById('btn-start-del-snaps') as
    (HTMLButtonElement & { _boundStart?: boolean }) | null;
  const addSnapBtn = document.getElementById('btn-add-snap') as HTMLButtonElement | null;
  const selectAllBtn = document.getElementById('btn-snap-select-all') as
    (HTMLButtonElement & { _boundSelectAll?: boolean }) | null;
  const clearAllBtn = document.getElementById('btn-snap-clear-all') as
    (HTMLButtonElement & { _boundClearAll?: boolean }) | null;
  const actionsWrap = document.getElementById('snap-bulk-actions');
  const btn = document.getElementById('btn-del-snaps') as
    (HTMLButtonElement & { _boundBulkDelete?: boolean }) | null;
  if (!startBtn || !selectAllBtn || !clearAllBtn || !actionsWrap || !btn) {
    return;
  }
  if (!startBtn._boundStart) {
    startBtn._boundStart = true;
    startBtn.addEventListener('click', () => {
      if (_readOnly || !_lastOnBulkDel) return;
      _snapBulkMode = !_snapBulkMode;
      if (!_snapBulkMode) _selectedSnapDates.clear();
      setTablePage(_snapTableState, 1);
      if (_lastOnEdit && _lastOnDel) renderSnapList(_snaps, _lastOnEdit, _lastOnDel);
    });
  }
  if (!selectAllBtn._boundSelectAll) {
    selectAllBtn._boundSelectAll = true;
    selectAllBtn.addEventListener('click', () => {
      if (!_snapBulkMode) return;
      for (const snap of getFilteredSnaps(_snaps)) _selectedSnapDates.add(snap.date);
      if (_lastOnEdit && _lastOnDel) renderSnapList(_snaps, _lastOnEdit, _lastOnDel);
    });
  }
  if (!clearAllBtn._boundClearAll) {
    clearAllBtn._boundClearAll = true;
    clearAllBtn.addEventListener('click', () => {
      if (!_snapBulkMode) return;
      _selectedSnapDates.clear();
      if (_lastOnEdit && _lastOnDel) renderSnapList(_snaps, _lastOnEdit, _lastOnDel);
    });
  }
  if (!btn._boundBulkDelete) {
    btn._boundBulkDelete = true;
    btn.addEventListener('click', () => {
      if (_readOnly || !_lastOnBulkDel || !_snapBulkMode || _selectedSnapDates.size === 0) return;
      _lastOnBulkDel(Array.from(_selectedSnapDates), btn);
    });
  }
  startBtn.hidden = _readOnly || !_lastOnBulkDel;
  if (_snapBulkMode) {
    startBtn.classList.add('btn-icon');
    startBtn.textContent = '✕';
    startBtn.setAttribute('aria-label', 'Cancel bulk delete');
    startBtn.title = 'Cancel bulk delete';
  } else {
    startBtn.classList.remove('btn-icon');
    startBtn.textContent = 'Bulk delete';
    startBtn.removeAttribute('aria-label');
    startBtn.removeAttribute('title');
  }
  if (addSnapBtn) addSnapBtn.disabled = _readOnly || _snapBulkMode;
  actionsWrap.hidden = !_snapBulkMode || _readOnly || !_lastOnBulkDel;
  const count = _selectedSnapDates.size;
  btn.textContent = count > 0 ? `Delete selected (${count})` : 'Delete selected';
  btn.disabled = _readOnly || !_lastOnBulkDel || !_snapBulkMode || count === 0;
  selectAllBtn.disabled = _readOnly || !_snapBulkMode || getFilteredSnaps(_snaps).length === 0;
  clearAllBtn.disabled = _readOnly || !_snapBulkMode || count === 0;
}

const TX_PAGE_SIZE = 15;

function txColumns(): ColumnDef<Transaction>[] {
  return [
    {
      key: 'date',
      label: 'Date',
      sortValue: (t) => t.date,
      cellAttrs: () => 'data-ledger-label="Date"',
      cell: (t) => `<span class="snap-month">${fmtDay(t.date)}</span>`,
    },
    {
      key: 'type',
      label: 'Type',
      sortValue: (t) => t.type,
      cellAttrs: () => 'data-ledger-label="Type"',
      cell: (t) => `<span class="tx-ledger-chip">${esc(t.type || '-')}</span>`,
    },
    {
      key: 'source',
      label: 'Source',
      sortValue: (t) => t.source || '',
      cellAttrs: (t) => `data-ledger-label="Source"${!t.source ? ' data-ledger-empty="1"' : ''}`,
      cell: (t) =>
        t.source
          ? `<span class="tx-ledger-source tx-ledger-chip-trim" title="${esc(t.source)}">${esc(t.source)}</span>`
          : '',
    },
    {
      key: 'name',
      label: 'Name',
      sortValue: (t) => t.name || '',
      cellAttrs: (t) => `data-ledger-label="Name"${!t.name ? ' data-ledger-empty="1"' : ''}`,
      cell: (t) =>
        t.name
          ? `<span class="tx-ledger-name" data-etf-isin="${esc(t.isin || '')}" data-etf-name="${esc(t.name)}">${esc(t.name)}</span>${
              t.isin ? `<span class="tx-ledger-meta tx-ledger-isin">${esc(t.isin)}</span>` : ''
            }`
          : '',
    },
    {
      key: 'amount',
      label: 'Amount',
      align: 'right',
      sortValue: (t) => t.amount || 0,
      cellAttrs: () => 'style="text-align:right" data-ledger-label="Amount"',
      cell: (t) => {
        const amountHtml = `<span class="tx-ledger-amount ${(t.amount || 0) < 0 ? 'neg' : 'pos'}">${fmtEur2(t.amount || 0)}</span>`;
        const sharesHtml = t.shares ? `<span class="tx-ledger-meta">${t.shares} shares</span>` : '';
        const taxHtml =
          t.type === 'INTEREST' && t.tax
            ? `<span class="tx-ledger-meta">Tax ${fmtEur2(t.tax)}</span>`
            : '';
        return amountHtml + sharesHtml + taxHtml;
      },
    },
  ];
}

function attachTxListeners(): void {
  const searchEl = document.getElementById('tx-search') as
    (HTMLInputElement & { _bound?: boolean }) | null;
  const typeEl = document.getElementById('tx-type-filter') as
    (HTMLSelectElement & { _bound?: boolean }) | null;
  const addBtn = document.getElementById('btn-add-tx') as
    (HTMLButtonElement & { _bound?: boolean }) | null;
  const startBulkBtn = document.getElementById('btn-start-del-txs') as
    (HTMLButtonElement & { _bound?: boolean }) | null;
  const selectAllBtn = document.getElementById('btn-tx-select-all') as
    (HTMLButtonElement & { _bound?: boolean }) | null;
  const clearAllBtn = document.getElementById('btn-tx-clear-all') as
    (HTMLButtonElement & { _bound?: boolean }) | null;
  const bulkDeleteBtn = document.getElementById('btn-del-txs') as
    (HTMLButtonElement & { _bound?: boolean }) | null;
  const listEl = document.getElementById('tx-ledger-list') as
    (HTMLElement & { _bound?: boolean }) | null;

  if (searchEl && !searchEl._bound) {
    searchEl._bound = true;
    searchEl.addEventListener('input', () => {
      _txTableState.filters.search = searchEl.value.toLowerCase();
      setTablePage(_txTableState, 1);
      renderTxList(_txs);
    });
  }
  if (typeEl && !typeEl._bound) {
    typeEl._bound = true;
    typeEl.addEventListener('change', () => {
      _txTableState.filters.type = typeEl.value;
      setTablePage(_txTableState, 1);
      renderTxList(_txs);
    });
  }
  if (addBtn && !addBtn._bound) {
    addBtn._bound = true;
    addBtn.addEventListener('click', () => {
      if (_readOnly) return;
      _lastOnAddTx?.();
    });
  }
  if (startBulkBtn && !startBulkBtn._bound) {
    startBulkBtn._bound = true;
    startBulkBtn.addEventListener('click', () => {
      if (_readOnly || !_lastOnBulkDelTxs) return;
      _txBulkMode = !_txBulkMode;
      if (!_txBulkMode) _selectedTxRowIds.clear();
      setTablePage(_txTableState, 1);
      renderTxList(_txs);
    });
  }
  if (selectAllBtn && !selectAllBtn._bound) {
    selectAllBtn._bound = true;
    selectAllBtn.addEventListener('click', () => {
      if (!_txBulkMode) return;
      for (const tx of getFilteredTxs(_txs)) {
        if (tx.rowId != null) _selectedTxRowIds.add(tx.rowId.toString());
      }
      renderTxList(_txs);
    });
  }
  if (clearAllBtn && !clearAllBtn._bound) {
    clearAllBtn._bound = true;
    clearAllBtn.addEventListener('click', () => {
      if (!_txBulkMode) return;
      _selectedTxRowIds.clear();
      renderTxList(_txs);
    });
  }
  if (bulkDeleteBtn && !bulkDeleteBtn._bound) {
    bulkDeleteBtn._bound = true;
    bulkDeleteBtn.addEventListener('click', () => {
      if (_readOnly || !_lastOnBulkDelTxs || !_txBulkMode || _selectedTxRowIds.size === 0) return;
      const rowIds = Array.from(_selectedTxRowIds).map((rowId) => BigInt(rowId));
      _lastOnBulkDelTxs(rowIds, bulkDeleteBtn);
    });
  }
  if (listEl && !listEl._bound) {
    listEl._bound = true;
    listEl.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const editBtn = target.closest('.js-edit-tx') as HTMLButtonElement | null;
      if (editBtn) {
        const raw = editBtn.dataset.rowid;
        const rowId = raw ? BigInt(raw) : null;
        if (rowId != null) _lastOnEditTx?.(rowId);
        return;
      }
      const delBtn = target.closest('.js-del-tx') as HTMLButtonElement | null;
      if (delBtn) {
        const raw = delBtn.dataset.rowid;
        const rowId = raw ? BigInt(raw) : null;
        if (rowId != null) _lastOnDelTx?.(rowId, delBtn);
      }
    });
    listEl.addEventListener('change', (e) => {
      const target = e.target as HTMLElement;
      const selectInput = target.closest('.js-tx-select') as HTMLInputElement | null;
      if (!selectInput) return;
      const rowId = selectInput.dataset.rowid;
      if (!rowId) return;
      if (selectInput.checked) _selectedTxRowIds.add(rowId);
      else _selectedTxRowIds.delete(rowId);
      _updateTxBulkControls();
    });
  }
}

function renderTxList(txs: Transaction[]): void {
  const listEl = document.getElementById('tx-ledger-list');
  const paginationEl = document.getElementById('tx-pagination');
  const typeEl = document.getElementById('tx-type-filter') as HTMLSelectElement | null;
  const addBtn = document.getElementById('btn-add-tx') as HTMLButtonElement | null;
  if (!listEl) return;
  if (addBtn) {
    addBtn.disabled = _readOnly;
    addBtn.hidden = _txBulkMode;
  }

  const types = [...new Set(txs.map((t) => t.type).filter(Boolean))].sort() as string[];
  const currentType = getTableFilter(_txTableState, 'type');
  if (typeEl) {
    const prev = typeEl.value || currentType;
    typeEl.innerHTML =
      '<option value="">All types</option>' +
      types.map((type) => `<option value="${esc(type)}">${esc(type)}</option>`).join('');
    if (types.includes(prev)) typeEl.value = prev;
    _txTableState.filters.type = typeEl.value;
  }

  if (!txs.length) {
    _selectedTxRowIds.clear();
    _updateTxBulkControls();
    listEl.className = `tx-ledger-grid${_readOnly ? ' tx-ledger-grid-readonly' : ''}`;
    listEl.innerHTML =
      '<div class="empty-state" style="padding:1rem;font-size:13px">No transactions yet.</div>';
    if (paginationEl) paginationEl.innerHTML = '';
    return;
  }

  const filtered = getFilteredTxs(txs);
  const visibleFilteredIds = new Set(
    filtered.map((t) => (t.rowId != null ? t.rowId.toString() : '')).filter(Boolean),
  );
  for (const rowId of Array.from(_selectedTxRowIds)) {
    if (!visibleFilteredIds.has(rowId)) _selectedTxRowIds.delete(rowId);
  }
  _updateTxBulkControls();

  if (!filtered.length) {
    _selectedTxRowIds.clear();
    _updateTxBulkControls();
    listEl.className = `tx-ledger-grid${_readOnly ? ' tx-ledger-grid-readonly' : ''}`;
    listEl.innerHTML =
      '<div class="empty-state" style="padding:1rem;font-size:13px">No matching transactions.</div>';
    if (paginationEl) paginationEl.innerHTML = '';
    return;
  }

  const columns = txColumns();
  const { pageItems, page, totalPages } = sortAndPaginate(
    filtered,
    columns,
    _txTableState.sort,
    _txTableState.page,
    TX_PAGE_SIZE,
  );
  setTablePage(_txTableState, page);
  const showSelection = !_readOnly && !!_lastOnBulkDelTxs && _txBulkMode;
  const showActions = !_readOnly && !_txBulkMode;
  const showActionBlock = showActions || showSelection;
  listEl.className = `tx-ledger-grid${_readOnly ? ' tx-ledger-grid-readonly' : ''}`;
  _updateTxBulkControls();

  listEl.innerHTML = `
    <div class="tbl-row th tx-row" role="row" id="tx-table-header">
      ${renderTableHeader(columns, _txTableState.sort)}
      ${showActionBlock ? `<div role="columnheader" style="text-align:right">${showSelection ? 'Select' : 'Actions'}</div>` : ''}
    </div>
    ${pageItems
      .map((tx) => {
        const actionBtns =
          !showActions || !tx.rowId
            ? ''
            : `<button class="btn btn-sm btn-outline btn-icon js-edit-tx" data-rowid="${tx.rowId}" aria-label="Edit transaction" title="Edit transaction">${EDIT_ICON}</button>
            <button class="btn btn-sm btn-danger btn-icon js-del-tx" data-rowid="${tx.rowId}" aria-label="Delete transaction" title="Delete transaction">${DELETE_ICON}</button>`;
        const selectInput =
          !showSelection || !tx.rowId
            ? ''
            : `<input type="checkbox" class="tx-select-input js-tx-select" aria-label="Select transaction ${esc(tx.date)} ${esc(tx.type || '')}" data-rowid="${tx.rowId}" ${_selectedTxRowIds.has(tx.rowId.toString()) ? 'checked' : ''}>`;
        const actionContent = showSelection ? selectInput : actionBtns;
        const [dateCol, typeCol, ...restCols] = columns;
        const headerCells = renderTableRow([dateCol, typeCol], tx);
        const sourceChip = tx.source
          ? `<span class="tx-ledger-source tx-ledger-chip-trim tx-header-source" title="${esc(tx.source)}">${esc(tx.source)}</span>`
          : '';
        const mobileHeaderCell =
          !tx.rowId || !showActionBlock
            ? ''
            : `<div role="cell" class="tx-actions tx-actions-mobile${showSelection ? ' tx-actions-select' : ''}" data-ledger-label="${showSelection ? 'Select' : 'Actions'}">
            ${actionContent}
          </div>`;
        const desktopActionsCell =
          !tx.rowId || !showActionBlock
            ? ''
            : `<div role="cell" class="tx-actions tx-actions-desktop${showSelection ? ' tx-actions-select' : ''}" data-ledger-label="${showSelection ? 'Select' : 'Actions'}">
            ${actionContent}
          </div>`;
        const bodyCells = renderTableRow(restCols, tx);
        return `<div class="tbl-row tx-row" role="row">
          <div class="tx-card-header">${headerCells}${sourceChip}${mobileHeaderCell}</div>
          ${bodyCells}
          ${desktopActionsCell}
        </div>`;
      })
      .join('')}
  `;

  bindSortedTableHeader(
    document.getElementById('tx-table-header'),
    _txTableState.sort,
    (newState) => {
      setTableSort(_txTableState, newState);
      renderTxList(txs);
    },
  );

  attachEtfPopovers(listEl);

  renderPagination('tx-pagination', _txTableState.page, totalPages, (page) => {
    setTablePage(_txTableState, page);
    renderTxList(txs);
  });
}

function getFilteredTxs(txs: Transaction[]): Transaction[] {
  let filtered = [...txs];
  const txType = getTableFilter(_txTableState, 'type');
  const txSearch = getTableFilter(_txTableState, 'search');
  if (txType) filtered = filtered.filter((t) => t.type === txType);
  if (txSearch) {
    filtered = filtered.filter((t) =>
      [t.date, t.name, t.isin, t.source, t.type].join(' ').toLowerCase().includes(txSearch),
    );
  }
  return filtered;
}

function _updateTxBulkControls(): void {
  const startBtn = document.getElementById('btn-start-del-txs') as HTMLButtonElement | null;
  const actionsWrap = document.getElementById('tx-bulk-actions');
  const selectAllBtn = document.getElementById('btn-tx-select-all') as HTMLButtonElement | null;
  const clearAllBtn = document.getElementById('btn-tx-clear-all') as HTMLButtonElement | null;
  const deleteBtn = document.getElementById('btn-del-txs') as HTMLButtonElement | null;
  const addBtn = document.getElementById('btn-add-tx') as HTMLButtonElement | null;
  if (!startBtn || !actionsWrap || !selectAllBtn || !clearAllBtn || !deleteBtn) return;
  const count = _selectedTxRowIds.size;
  startBtn.hidden = _readOnly || !_lastOnBulkDelTxs;
  if (_txBulkMode) {
    startBtn.classList.add('btn-icon');
    startBtn.textContent = '✕';
    startBtn.setAttribute('aria-label', 'Cancel bulk delete');
    startBtn.title = 'Cancel bulk delete';
  } else {
    startBtn.classList.remove('btn-icon');
    startBtn.textContent = 'Bulk delete';
    startBtn.removeAttribute('aria-label');
    startBtn.removeAttribute('title');
  }
  actionsWrap.hidden = !_txBulkMode || _readOnly || !_lastOnBulkDelTxs;
  if (addBtn) addBtn.hidden = _txBulkMode;
  const selectableCount = getFilteredTxs(_txs).filter((tx) => tx.rowId != null).length;
  selectAllBtn.disabled = _readOnly || !_txBulkMode || selectableCount === 0;
  clearAllBtn.disabled = _readOnly || !_txBulkMode || count === 0;
  deleteBtn.textContent = count > 0 ? `Delete selected (${count})` : 'Delete selected';
  deleteBtn.disabled = _readOnly || !_txBulkMode || !_lastOnBulkDelTxs || count === 0;
}
