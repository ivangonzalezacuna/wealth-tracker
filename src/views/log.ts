import { getACCTSList } from '../constants';
import { snapTotal, fmtEur2, fmtMon, fmtDay, fmtPctVal, esc, safeColor } from '../utils';
import { sourceLabel } from '../import/profiles/index';
import { accountPositionValues } from '../model/snapshotPositions';
import { getHoldings } from '../store/config';
import type { Snapshot, Transaction } from '../types';
import { isCollapsed, setCollapsed } from '../ui/collapseState';
import { EDIT_ICON, DELETE_ICON, ROW_DISCLOSURE_ICON } from './icons';
import { attachEtfPopovers } from '../ui/etfPopover';
import type { ColumnDef } from './tableColumns';
import { renderTableHeader, renderTableRow } from './tableColumns';
import { loadPageSize, renderPagination, savePageSize } from './pagination';
import { bindExpandableRows, restoreExpandableRows } from './expandableRows';
import { bindSortedTableHeader, sortAndPaginate, tableEmptyStateHtml } from './tableView';
import { LOG_VIEWS, type LogView } from '../nav';
import {
  bindChipGroup,
  bindFilterStatus,
  bindSearchClear,
  chipButtonsHtml,
  renderFilterStatus,
} from '../ui/filterBar';
import {
  bindTableSearchFilter,
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

const SNAP_PAGE_SIZES = [12, 24, 36] as const;
export const TX_PAGE_SIZES = [15, 25, 50, 100] as const;
const SNAP_PAGE_SIZE_KEY = 'wt:log:snapPageSize';
const TX_PAGE_SIZE_KEY = 'wt:log:txPageSize';

/** Sort value for ISO dates ("YYYY-MM" or "YYYY-MM-DD") so 'desc' means newest first. */
function isoDateSortValue(date: string): number {
  const ms = Date.parse(date.length === 7 ? `${date}-01` : date);
  return Number.isFinite(ms) ? ms : 0;
}

let _snapPageSize = loadPageSize(SNAP_PAGE_SIZE_KEY, SNAP_PAGE_SIZES, SNAP_PAGE_SIZES[0]);
const _snapTableState = createTableState({
  sort: { key: null, dir: null },
  filters: { search: '' },
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
let _txPageSize = loadPageSize(TX_PAGE_SIZE_KEY, TX_PAGE_SIZES, TX_PAGE_SIZES[0]);
/** Filters were set by a chart drill-down (shown as a "From chart" note until changed). */
let _txFromChart = false;
let _snapFromChart = false;

/** "DIVIDEND" → "Dividend", "SAVINGS_PLAN" → "Savings plan". */
export function txTypeLabel(type: string): string {
  const s = type.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const _openTxDetails = new Set<string>();
let _importPanelTouched = false;

const LOG_VIEW_PANELS: Record<LogView, string> = {
  transactions: 'csv-import-card',
  snapshots: 'balance-card',
};

/** Show one Log sub-view (Transactions or Snapshots) and sync the tablist state. */
export function applyLogView(view: LogView): void {
  for (const v of LOG_VIEWS) {
    const active = v === view;
    const tab = document.getElementById(`log-tab-${v}`);
    if (tab) {
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.setAttribute('tabindex', active ? '0' : '-1');
    }
    const panel = document.getElementById(LOG_VIEW_PANELS[v]);
    if (panel) panel.hidden = !active;
  }
}

/** Open or close the collapsible CSV import panel. `userAction` remembers an explicit choice. */
export function setImportPanelOpen(open: boolean, userAction = false): void {
  if (userAction) _importPanelTouched = true;
  const panel = document.getElementById('csv-import-panel');
  const toggle = document.getElementById('btn-toggle-import');
  if (panel) panel.hidden = !open;
  toggle?.setAttribute('aria-expanded', String(open));
}

export function isImportPanelOpen(): boolean {
  const panel = document.getElementById('csv-import-panel');
  return !!panel && !panel.hidden;
}

/** Short tab-badge label: exact up to 9.999, then "12k" / "1,2M" so the chip stays narrow. */
export function fmtCountBadge(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 10_000) return n.toLocaleString('de-DE');
  if (n < 1_000_000) return `${Math.floor(n / 1000)}k`;
  return `${(Math.floor(n / 100_000) / 10).toLocaleString('de-DE')}M`;
}

function setTabCount(id: string, tabId: string, label: string, n: number): void {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = fmtCountBadge(n);
    if (n > 0) el.title = `${n.toLocaleString('de-DE')} ${label.toLowerCase()}`;
    else el.removeAttribute('title');
  }
  const tab = document.getElementById(tabId);
  if (tab) {
    if (n > 0) tab.setAttribute('aria-label', `${label} (${n.toLocaleString('de-DE')})`);
    else tab.removeAttribute('aria-label');
  }
}

function updateLogSummary(txs: Transaction[], snaps: Snapshot[]): void {
  setTabCount('log-count-transactions', 'log-tab-transactions', 'Transactions', txs.length);
  setTabCount('log-count-snapshots', 'log-tab-snapshots', 'Snapshots', snaps.length);
  const latestEl = document.getElementById('snap-latest-meta');
  if (latestEl) {
    const latest = snaps[snaps.length - 1];
    latestEl.textContent = latest
      ? `Latest ${fmtMon(latest.date)} \u00B7 ${fmtEur2(snapTotal(latest))}`
      : '';
  }
  // First-time users land on an empty ledger: show the drop zone right away.
  if (!_importPanelTouched) setImportPanelOpen(txs.length === 0);
}

/** Renders the snapshot log tab: the add/edit form and the snapshot history list. */
export function renderLog(state: LogState): void {
  const { txs, snaps, importMeta } = state;

  renderLedgerSummary(txs, importMeta);

  _lastOnEdit = state.onEditSnap;
  _lastOnDel = state.onDelSnap;
  _lastOnBulkDel = state.onBulkDelSnaps || null;
  _lastOnAddTx = state.onAddTx || null;
  _lastOnEditTx = state.onEditTx || null;
  _lastOnDelTx = state.onDelTx || null;
  _lastOnBulkDelTxs = state.onBulkDelTxs || null;
  _snapBulkMode = false;
  _txBulkMode = false;
  _selectedSnapDates.clear();
  _selectedTxRowIds.clear();
  _readOnly = !!state.readOnly;
  _snaps = snaps;
  _txs = txs;

  updateLogSummary(txs, snaps);
  attachTxListeners();
  _updateBulkControls('tx');
  renderTxList(_txs);

  attachFilterListeners();
  _updateBulkControls('snap');
  renderSnapList(_snaps, state.onEditSnap, state.onDelSnap);
}

// ── Ledger header summary ────────────────────────────────────────

let _ledgerSummaryOpen = false;

interface SourceSummary {
  source: string;
  count: number;
  first: string;
  last: string;
}

/** Per-source counts and date ranges, largest source first. */
export function summarizeSources(txs: Transaction[]): SourceSummary[] {
  const bySource = new Map<string, SourceSummary>();
  for (const tx of txs) {
    const source = tx.source || 'unknown';
    const s = bySource.get(source);
    if (!s) bySource.set(source, { source, count: 1, first: tx.date, last: tx.date });
    else {
      s.count += 1;
      if (tx.date < s.first) s.first = tx.date;
      if (tx.date > s.last) s.last = tx.date;
    }
  }
  return [...bySource.values()].sort(
    (a, b) => b.count - a.count || a.source.localeCompare(b.source),
  );
}

/**
 * Header line "702 transactions · 05 Jan 2023 – 28 May 2026 ▸" that toggles a small
 * per-source table (closed by default), so long source lists never crowd the header.
 */
function renderLedgerSummary(txs: Transaction[], importMeta: Record<string, string> | null): void {
  const btn = document.getElementById('btn-ledger-summary') as
    (HTMLButtonElement & { _bound?: boolean }) | null;
  const panel = document.getElementById('tx-ledger-summary');
  if (!btn || !panel) return;
  if (!btn._bound) {
    btn._bound = true;
    btn.addEventListener('click', () => {
      _ledgerSummaryOpen = !_ledgerSummaryOpen;
      btn.setAttribute('aria-expanded', String(_ledgerSummaryOpen));
      panel.hidden = !_ledgerSummaryOpen;
    });
  }
  if (!txs.length) {
    btn.hidden = true;
    btn.innerHTML = '';
    panel.hidden = true;
    panel.innerHTML = '';
    return;
  }
  const sources = summarizeSources(txs);
  const first = sources.reduce((d, s) => (s.first < d ? s.first : d), sources[0].first);
  const last = sources.reduce((d, s) => (s.last > d ? s.last : d), sources[0].last);
  const n = txs.length;
  btn.hidden = false;
  btn.innerHTML = `<span>${esc(
    `${n.toLocaleString('de-DE')} transaction${n === 1 ? '' : 's'} \u00B7 ${fmtDay(first)} \u2013 ${fmtDay(last)}`,
  )}</span>${ROW_DISCLOSURE_ICON}`;
  btn.setAttribute('aria-expanded', String(_ledgerSummaryOpen));
  btn.title = _ledgerSummaryOpen ? 'Hide breakdown by source' : 'Show breakdown by source';
  panel.hidden = !_ledgerSummaryOpen;
  panel.innerHTML = `
    <ul class="ledger-summary-list" aria-label="Transactions by source">
      ${sources
        .map(
          (s) => `<li class="ledger-summary-item">
        <span class="ledger-summary-source" title="${esc(sourceLabel(s.source))}">${esc(sourceLabel(s.source))}</span>
        <span class="ledger-summary-count">${s.count.toLocaleString('de-DE')}</span>
        <span class="ledger-summary-range">${fmtDay(s.first)} \u2013 ${fmtDay(s.last)}</span>
      </li>`,
        )
        .join('')}
    </ul>
    ${
      importMeta?.last_import
        ? `<p class="note ledger-summary-note">Last CSV import: ${fmtDay(importMeta.last_import)}</p>`
        : ''
    }`;
}

function attachFilterListeners(): void {
  const rerender = () => {
    _snapFromChart = false;
    if (_lastOnEdit && _lastOnDel) renderSnapList(_snaps, _lastOnEdit, _lastOnDel);
  };

  bindTableSearchFilter({
    elementId: 'snap-search',
    state: _snapTableState,
    filterKey: 'search',
    resetSort: true,
    rerender,
  });
  bindSearchClear(document.getElementById('snap-filter-bar'));
  bindFilterStatus(document.getElementById('snap-filter-status'), clearSnapFilters);
}

function clearSnapFilters(): void {
  _snapTableState.filters.search = '';
  _snapFromChart = false;
  setTablePage(_snapTableState, 1);
  const searchEl = document.getElementById('snap-search') as HTMLInputElement | null;
  if (searchEl) searchEl.value = '';
  if (_lastOnEdit && _lastOnDel) renderSnapList(_snaps, _lastOnEdit, _lastOnDel);
}

function getFilteredSnaps(snaps: Snapshot[]): Snapshot[] {
  let filtered = [...snaps].reverse();
  const searchTerm = getTableFilter(_snapTableState, 'search');
  if (searchTerm) {
    filtered = filtered.filter(
      (s) =>
        s.date.includes(searchTerm) ||
        (s.notes || '').toLowerCase().includes(searchTerm) ||
        fmtMon(s.date).toLowerCase().includes(searchTerm),
    );
  }
  return filtered;
}

function getFilteredTxs(txs: Transaction[]): Transaction[] {
  // Newest first by default, matching the snapshot history.
  let filtered = [...txs].reverse();
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

/**
 * Show one snapshot in the history (chart drill-down): filter to its month, matching the
 * ledger drill-down, and expand its row. Returns the row, or null when the snapshot is unknown.
 */
export function revealSnapshot(date: string): HTMLElement | null {
  if (!_lastOnEdit || !_lastOnDel || !_snaps.some((s) => s.date === date)) return null;
  const month = fmtMon(date);
  _snapTableState.filters.search = month.toLowerCase();
  _snapFromChart = true;
  const searchEl = document.getElementById('snap-search') as HTMLInputElement | null;
  if (searchEl) searchEl.value = month;
  const { pageItems: ordered } = sortAndPaginate(
    getFilteredSnaps(_snaps),
    snapColumns(),
    _snapTableState.sort,
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const idx = Math.max(
    0,
    ordered.findIndex((s) => s.date === date),
  );
  setTablePage(_snapTableState, Math.floor(idx / _snapPageSize) + 1);
  // Only one snapshot is open at a time; a stale `snap:` entry later in the list would
  // otherwise be restored after (and replace) this one.
  for (const s of _snaps) if (s.date !== date) setCollapsed('snap:' + s.date, false);
  setCollapsed('snap:' + date, true);
  renderSnapList(_snaps, _lastOnEdit, _lastOnDel);
  return (
    [...document.querySelectorAll<HTMLElement>('#snaps-list .snap-row-compact:not(.th)')].find(
      (row) => row.dataset.date === date,
    ) ?? null
  );
}

/** Filter the transaction ledger (chart drill-down) and return the ledger card. */
export function showTransactions(filter: { search?: string; type?: string }): HTMLElement | null {
  const search = filter.search ?? '';
  const type = filter.type ?? '';
  _txTableState.filters.search = search.toLowerCase();
  _txTableState.filters.type = type;
  _txFromChart = true;
  setTablePage(_txTableState, 1);
  const searchEl = document.getElementById('tx-search') as HTMLInputElement | null;
  if (searchEl) searchEl.value = search;
  renderTxList(_txs);
  return document.getElementById('tx-ledger-card');
}

function _updateBulkControls(kind: 'tx' | 'snap'): void {
  const isTx = kind === 'tx';
  const hasBulkHandler = () => (isTx ? !!_lastOnBulkDelTxs : !!_lastOnBulkDel);
  const startBtn = document.getElementById(
    isTx ? 'btn-start-del-txs' : 'btn-start-del-snaps',
  ) as HTMLButtonElement | null;
  const actionsEl = document.getElementById(isTx ? 'tx-bulk-actions' : 'snap-bulk-actions');
  const selectAllBtn = document.getElementById(
    isTx ? 'btn-tx-select-all' : 'btn-snap-select-all',
  ) as HTMLButtonElement | null;
  const clearAllBtn = document.getElementById(
    isTx ? 'btn-tx-clear-all' : 'btn-snap-clear-all',
  ) as HTMLButtonElement | null;
  const deleteBtn = document.getElementById(
    isTx ? 'btn-del-txs' : 'btn-del-snaps',
  ) as HTMLButtonElement | null;
  const addBtn = isTx
    ? ((document.getElementById('btn-add-tx') as HTMLButtonElement | null) ?? null)
    : null;
  const addSnapBtn = !isTx
    ? ((document.getElementById('btn-add-snap') as HTMLButtonElement | null) ?? null)
    : null;
  if (!startBtn || !actionsEl || !selectAllBtn || !clearAllBtn || !deleteBtn) return;

  const isActive = isTx ? _txBulkMode : _snapBulkMode;
  const count = isTx ? _selectedTxRowIds.size : _selectedSnapDates.size;
  const filteredCount = isTx
    ? getFilteredTxs(_txs).filter((t) => t.rowId != null).length
    : getFilteredSnaps(_snaps).length;

  const total = isTx ? _txs.length : _snaps.length;
  startBtn.hidden = _readOnly || !hasBulkHandler() || (total === 0 && !isActive);
  startBtn.textContent = isActive ? 'Cancel' : 'Select';
  startBtn.setAttribute('aria-pressed', String(isActive));
  actionsEl.hidden = !isActive || _readOnly || !hasBulkHandler();
  if (addBtn) addBtn.hidden = isActive;
  if (addSnapBtn) addSnapBtn.disabled = _readOnly || isActive;
  selectAllBtn.disabled = _readOnly || !isActive || filteredCount === 0;
  clearAllBtn.disabled = _readOnly || !isActive || count === 0;
  deleteBtn.textContent = count > 0 ? `Delete (${count})` : 'Delete';
  deleteBtn.disabled = _readOnly || !isActive || !hasBulkHandler() || count === 0;

  type BoundEl = HTMLButtonElement & { _bulkBound?: boolean };
  if (!(startBtn as BoundEl)._bulkBound) {
    (startBtn as BoundEl)._bulkBound = true;
    startBtn.addEventListener('click', () => {
      if (_readOnly || (isTx ? !_lastOnBulkDelTxs : !_lastOnBulkDel)) return;
      if (isTx) {
        _txBulkMode = !_txBulkMode;
        if (!_txBulkMode) _selectedTxRowIds.clear();
        setTablePage(_txTableState, 1);
        renderTxList(_txs);
        return;
      }
      _snapBulkMode = !_snapBulkMode;
      if (!_snapBulkMode) _selectedSnapDates.clear();
      setTablePage(_snapTableState, 1);
      if (_lastOnEdit && _lastOnDel) renderSnapList(_snaps, _lastOnEdit, _lastOnDel);
    });
  }
  if (!(selectAllBtn as BoundEl)._bulkBound) {
    (selectAllBtn as BoundEl)._bulkBound = true;
    selectAllBtn.addEventListener('click', () => {
      if (isTx) {
        for (const tx of getFilteredTxs(_txs)) {
          if (tx.rowId != null) _selectedTxRowIds.add(tx.rowId.toString());
        }
        renderTxList(_txs);
        return;
      }
      for (const snap of getFilteredSnaps(_snaps)) _selectedSnapDates.add(snap.date);
      if (_lastOnEdit && _lastOnDel) renderSnapList(_snaps, _lastOnEdit, _lastOnDel);
    });
  }
  if (!(clearAllBtn as BoundEl)._bulkBound) {
    (clearAllBtn as BoundEl)._bulkBound = true;
    clearAllBtn.addEventListener('click', () => {
      if (isTx) {
        _selectedTxRowIds.clear();
        renderTxList(_txs);
        return;
      }
      _selectedSnapDates.clear();
      if (_lastOnEdit && _lastOnDel) renderSnapList(_snaps, _lastOnEdit, _lastOnDel);
    });
  }
  if (!(deleteBtn as BoundEl)._bulkBound) {
    (deleteBtn as BoundEl)._bulkBound = true;
    deleteBtn.addEventListener('click', () => {
      if (isTx) {
        if (_readOnly || !_lastOnBulkDelTxs || _selectedTxRowIds.size === 0) return;
        _lastOnBulkDelTxs(
          Array.from(_selectedTxRowIds).map((id) => BigInt(id)),
          deleteBtn,
        );
        return;
      }
      if (_readOnly || !_lastOnBulkDel || _selectedSnapDates.size === 0) return;
      _lastOnBulkDel(Array.from(_selectedSnapDates), deleteBtn);
    });
  }
}

function snapShares(s: Snapshot) {
  const accounts = getACCTSList().filter((a) => ((s[a.key] as number) || 0) > 0);
  const total = accounts.reduce((sum, a) => sum + Number(s[a.key]), 0);
  return accounts
    .map((a) => ({ a, share: ((s[a.key] as number) || 0) / total }))
    .sort((x, y) => y.share - x.share);
}

function snapColumns(): ColumnDef<Snapshot>[] {
  const columns: ColumnDef<Snapshot>[] = [];
  if (_snapBulkMode && !_readOnly && !!_lastOnBulkDel) {
    columns.push({
      key: 'select',
      label: '',
      cellClass: () => 'snap-select-cell',
      cell: (s) =>
        `<input type="checkbox" class="snap-select-input js-snap-select" aria-label="Select ${fmtMon(s.date)}" data-date="${s.date}" ${
          _selectedSnapDates.has(s.date) ? 'checked' : ''
        }>`,
    });
  }
  columns.push(
    {
      key: 'month',
      label: 'Month',
      sortValue: (s) => isoDateSortValue(s.date),
      cell: (s) =>
        `${ROW_DISCLOSURE_ICON}<span class="snap-month">${fmtMon(s.date)}</span>${s.notes ? '<span class="snap-note-dot" title="Has a note"></span>' : ''}`,
      cellClass: () => 'snap-month-cell',
    },
    {
      key: 'total',
      label: 'Net worth',
      align: 'right',
      sortValue: (s) => snapTotal(s),
      cell: (s) => `<span class="snap-total">${fmtEur2(snapTotal(s))}</span>`,
    },
    {
      key: 'segbar',
      label: '',
      cellClass: () => 'snap-segbar',
      cellAttrs: (s) => {
        const shares = snapShares(s);
        if (!shares.length) return '';
        const label = shares
          .map(({ a, share }) => `${a.label} ${fmtPctVal(share * 100, 'auto')}`)
          .join(', ');
        return `aria-label="Account mix: ${esc(label)}" title="${esc(label)}"`;
      },
      cell: (s) => {
        return snapShares(s)
          .map(
            ({ a, share }) =>
              `<span class="snap-seg" style="flex-grow:${share};background:${safeColor(a.color)}" title="${esc(a.label)}: ${fmtEur2((s[a.key] as number) || 0)} · ${fmtPctVal(share * 100, 'auto')}"></span>`,
          )
          .join('');
      },
    },
  );
  return columns;
}

function renderSnapList(
  snaps: Snapshot[],
  onEdit: (date: string) => void,
  onDel: (date: string, btn?: HTMLButtonElement) => void,
): void {
  const el = document.getElementById('snaps-list')!;
  if (!snaps.length) {
    _selectedSnapDates.clear();
    _snapFromChart = false;
    setTablePage(_snapTableState, 1);
    el.style.removeProperty('--snap-rows');
    el.innerHTML = tableEmptyStateHtml(
      '<p class="note">No snapshots yet. Add your first one above.</p>',
    );
    renderFilterStatus(document.getElementById('snap-filter-status'), {
      shown: 0,
      total: 0,
      noun: 'snapshots',
      active: false,
    });
    hidePagination();
    _updateBulkControls('snap');
    return;
  }

  const filtered = getFilteredSnaps(snaps);
  renderFilterStatus(document.getElementById('snap-filter-status'), {
    shown: filtered.length,
    total: snaps.length,
    noun: 'snapshots',
    active: !!getTableFilter(_snapTableState, 'search'),
    note: _snapFromChart ? 'From chart' : undefined,
  });

  if (filtered.length === 0) {
    el.innerHTML = tableEmptyStateHtml(
      '<p class="note">No matching snapshots. <button type="button" class="btn-link filter-clear-all js-clear-snap-filters">Clear filters</button></p>',
    );
    hidePagination();
    el.querySelector('.js-clear-snap-filters')?.addEventListener('click', clearSnapFilters);
    _updateBulkControls('snap');
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
    _snapPageSize,
  );
  setTablePage(_snapTableState, page);
  el.style.setProperty('--snap-rows', String(pageItems.length + 1));
  const rowClass =
    _snapBulkMode && !_readOnly && !!_lastOnBulkDel
      ? 'snap-row-compact snap-row-selectable'
      : 'snap-row-compact';

  // Compact row layout - fixed 3-column (Month / Net worth / segment indicator)
  el.innerHTML = `
    <div class="${rowClass} th" role="row" id="snap-table-header">
      ${renderTableHeader(columns, _snapTableState.sort)}
    </div>
    ${pageItems
      .map(
        (s) =>
          `<div class="${rowClass}" id="snap-row-${encodeURIComponent(s.date)}" role="row" tabindex="0" aria-expanded="false" data-date="${s.date}">
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
    onExpandedChange: onSnapExpandedChange,
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
    onExpandedChange: onSnapExpandedChange,
  });

  el.querySelectorAll('.js-snap-select').forEach((input) => {
    input.addEventListener('click', (ev) => ev.stopPropagation());
    input.addEventListener('change', (ev) => {
      ev.stopPropagation();
      const checkbox = ev.currentTarget as HTMLInputElement;
      const date = checkbox.dataset.date;
      if (!date) return;
      if (checkbox.checked) _selectedSnapDates.add(date);
      else _selectedSnapDates.delete(date);
      _updateBulkControls('snap');
    });
  });

  // Pagination controls
  renderPagination(
    'snap-pagination',
    _snapTableState.page,
    totalPages,
    (page) => {
      setTablePage(_snapTableState, page);
      renderSnapList(snaps, onEdit, onDel);
      _updateBulkControls('snap');
    },
    {
      totalItems: filtered.length,
      pageSize: _snapPageSize,
      pageSizeOptions: SNAP_PAGE_SIZES,
      itemLabel: 'snapshots',
      onPageSizeChange: (size) => {
        _snapPageSize = size;
        savePageSize(SNAP_PAGE_SIZE_KEY, size);
        setTablePage(_snapTableState, 1);
        renderSnapList(snaps, onEdit, onDel);
      },
    },
  );
  _updateBulkControls('snap');
}

function onSnapExpandedChange(row: HTMLElement, expanded: boolean): void {
  const date = row.dataset.date;
  if (!date) return;
  setCollapsed('snap:' + date, expanded);
  if (expanded) row.setAttribute('aria-controls', `snap-detail-${encodeURIComponent(date)}`);
  else row.removeAttribute('aria-controls');
}

/** Build the detail panel shown beneath an expanded snapshot row. */
function _createSnapDetail(
  snap: Snapshot,
  date: string,
  onEdit: (d: string) => void,
  onDel: (d: string, btn?: HTMLButtonElement) => void,
): HTMLElement {
  const detailRows = snapShares(snap)
    .map(
      ({ a, share }) =>
        `<div class="snap-detail-account"><span class="hold-detail-label"><span class="hold-dot" style="background:${safeColor(a.color)}" aria-hidden="true"></span>${esc(a.label)}</span><span class="hold-detail-value">${fmtEur2(snap[a.key] as number)}<span class="snap-detail-share" title="Share of positive account balances">${fmtPctVal(share * 100, 'auto')}</span></span></div>`,
    )
    .join('');
  const holdingNames = new Map(
    getHoldings().map((holding) => [holding.isin, holding.shortName || holding.name]),
  );
  const positionRows = getACCTSList()
    .map((account) => {
      const positions = Object.entries(accountPositionValues(snap, account.key));
      if (!positions.length) return '';
      return `<div><span class="hold-detail-label">${esc(account.label)} · ETF valuations</span></div>${positions.map(([isin, value]) => `<div class="snap-detail-account"><span class="hold-detail-label">${esc(holdingNames.get(isin) || isin)}</span><span class="hold-detail-value">${fmtEur2(value)}</span></div>`).join('')}`;
    })
    .join('');
  const panel = document.createElement('div');
  panel.className = 'hold-detail snap-detail';
  panel.id = `snap-detail-${encodeURIComponent(date)}`;
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-labelledby', `snap-row-${encodeURIComponent(date)}`);
  panel.innerHTML = `
    <div class="snap-detail-head"><span class="snap-detail-month">${fmtMon(snap.date)}</span><span class="snap-detail-total">${fmtEur2(snapTotal(snap))}</span></div>
    ${detailRows}
    ${positionRows}
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

const TX_DETAIL_SELECTOR = '.tx-detail';

function txKey(tx: Transaction, index: number): string {
  return tx.id || (tx.rowId != null ? `row:${tx.rowId}` : `idx:${index}`);
}

export function txDetailId(key: string): string {
  return `tx-detail-${key.replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

/** Build the detail panel shown beneath an expanded ledger row (all stored fields). */
export function createTxDetail(tx: Transaction, key: string): HTMLElement {
  const field = (label: string, value: string, cls = '') =>
    `<div><span class="hold-detail-label">${label}</span><span class="hold-detail-value${cls ? ' ' + cls : ''}">${value}</span></div>`;
  const parts: string[] = [];
  if (tx.name) parts.push(field('Name', esc(tx.name)));
  if (tx.isin) parts.push(field('ISIN', esc(tx.isin), 'hold-detail-isin'));
  parts.push(
    field('Amount', fmtTxMoney(tx.amount || 0, tx.currency), (tx.amount || 0) < 0 ? 'neg' : 'pos'),
  );
  if (tx.shares) parts.push(field('Shares', esc(String(tx.shares))));
  if (tx.price) parts.push(field('Price', fmtTxMoney(tx.price, tx.currency)));
  if (tx.fee) parts.push(field('Fee', fmtTxMoney(tx.fee, tx.currency)));
  if (tx.tax) parts.push(field('Tax', fmtTxMoney(tx.tax, tx.currency)));
  if (tx.currency) parts.push(field('Currency', esc(tx.currency.toUpperCase())));
  if (tx.fxRate && tx.fxRate !== 1) parts.push(field('FX rate', esc(String(tx.fxRate))));
  if (tx.source) parts.push(field('Source', esc(sourceLabel(tx.source))));
  if (tx.category) parts.push(field('Category', esc(tx.category)));
  if (tx.note)
    parts.push(
      `<div class="snap-detail-note"><span class="hold-detail-label">Note</span><span class="hold-detail-value">${esc(tx.note)}</span></div>`,
    );
  const panel = document.createElement('div');
  panel.className = 'hold-detail tx-detail';
  panel.id = txDetailId(key);
  panel.dataset.txkey = key;
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', `Transaction details, ${fmtDay(tx.date)}`);
  panel.innerHTML = parts.join('');
  return panel;
}

function toggleTxDetail(row: HTMLElement): void {
  const key = row.dataset.txkey;
  if (!key) return;
  const next = row.nextElementSibling as HTMLElement | null;
  if (next?.matches(TX_DETAIL_SELECTOR)) {
    next.remove();
    row.setAttribute('aria-expanded', 'false');
    _openTxDetails.delete(key);
    return;
  }
  const tx = _txByKey.get(key);
  if (!tx) return;
  row.insertAdjacentElement('afterend', createTxDetail(tx, key));
  row.setAttribute('aria-expanded', 'true');
  _openTxDetails.add(key);
}

let _txByKey = new Map<string, Transaction>();

function txColumns(): ColumnDef<Transaction>[] {
  return [
    {
      key: 'date',
      label: 'Date',
      sortValue: (t) => isoDateSortValue(t.date),
      cellAttrs: () => 'data-ledger-label="Date"',
      cell: (t) => `${ROW_DISCLOSURE_ICON}<span class="snap-month">${fmtDay(t.date)}</span>`,
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
          ? `<span class="tx-ledger-source tx-ledger-chip-trim" title="${esc(sourceLabel(t.source))}">${esc(sourceLabel(t.source))}</span>`
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
        const amountHtml = `<span class="tx-ledger-amount ${(t.amount || 0) < 0 ? 'neg' : 'pos'}">${fmtTxMoney(t.amount || 0, t.currency)}</span>`;
        const sharesHtml = t.shares ? `<span class="tx-ledger-meta">${t.shares} shares</span>` : '';
        const taxHtml =
          t.type === 'INTEREST' && t.tax
            ? `<span class="tx-ledger-meta">Tax ${fmtTxMoney(t.tax, t.currency)}</span>`
            : '';
        return amountHtml + sharesHtml + taxHtml;
      },
    },
  ];
}

export function fmtTxMoney(n: number, currency: string | undefined): string {
  const code = (currency || 'EUR').toUpperCase();
  const safeCode = /^[A-Z]{3}$/.test(code) ? code : 'EUR';
  const value = Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: safeCode,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function attachTxListeners(): void {
  const searchEl = document.getElementById('tx-search') as
    (HTMLInputElement & { _bound?: boolean }) | null;
  const typeEl = document.getElementById('tx-type-filter');
  const addBtn = document.getElementById('btn-add-tx') as
    (HTMLButtonElement & { _bound?: boolean }) | null;
  const listEl = document.getElementById('tx-ledger-list') as
    (HTMLElement & { _bound?: boolean }) | null;

  if (searchEl && !searchEl._bound) {
    searchEl._bound = true;
    searchEl.addEventListener('input', () => {
      _txTableState.filters.search = searchEl.value.toLowerCase();
      _txFromChart = false;
      setTablePage(_txTableState, 1);
      renderTxList(_txs);
    });
  }
  bindChipGroup(typeEl, 'tx-type', (value) => {
    if (value === getTableFilter(_txTableState, 'type')) return;
    _txTableState.filters.type = value;
    _txFromChart = false;
    setTablePage(_txTableState, 1);
    renderTxList(_txs);
  });
  bindSearchClear(document.getElementById('tx-filter-bar'));
  const clearTxFilters = () => {
    _txTableState.filters.search = '';
    _txTableState.filters.type = '';
    _txFromChart = false;
    setTablePage(_txTableState, 1);
    const input = document.getElementById('tx-search') as HTMLInputElement | null;
    if (input) input.value = '';
    renderTxList(_txs);
  };
  bindFilterStatus(document.getElementById('tx-filter-status'), clearTxFilters);
  if (listEl && !listEl.dataset.clearBound) {
    listEl.dataset.clearBound = '1';
    listEl.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-clear-filters]')) clearTxFilters();
    });
  }
  if (addBtn && !addBtn._bound) {
    addBtn._bound = true;
    addBtn.addEventListener('click', () => {
      if (_readOnly) return;
      _lastOnAddTx?.();
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
        return;
      }
      if (target.closest('button, a, input, select, label, textarea')) return;
      const row = target.closest('.tx-row:not(.th)') as HTMLElement | null;
      if (row) toggleTxDetail(row);
    });
    listEl.addEventListener('keydown', (e) => {
      const row = e.target as HTMLElement;
      if (!row.matches?.('.tx-row:not(.th)')) return;
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      toggleTxDetail(row);
    });
    listEl.addEventListener('change', (e) => {
      const inp = (e.target as HTMLElement).closest('.js-tx-select') as HTMLInputElement | null;
      if (!inp) return;
      const rowId = inp.dataset.rowid;
      if (!rowId) return;
      if (inp.checked) _selectedTxRowIds.add(rowId);
      else _selectedTxRowIds.delete(rowId);
      _updateBulkControls('tx');
    });
  }
}

function renderTxList(txs: Transaction[]): void {
  const listEl = document.getElementById('tx-ledger-list');
  const paginationEl = document.getElementById('tx-pagination');
  const typeEl = document.getElementById('tx-type-filter');
  const statusEl = document.getElementById('tx-filter-status');
  const addBtn = document.getElementById('btn-add-tx') as HTMLButtonElement | null;
  if (!listEl) return;
  if (addBtn) addBtn.disabled = _readOnly;
  if (addBtn) addBtn.hidden = _txBulkMode;
  listEl.className = `tx-ledger-grid${_readOnly ? ' tx-ledger-grid-readonly' : ''}`;

  // Type chips: only types present in the ledger, each with its count; hidden for a single type.
  const typeCounts = new Map<string, number>();
  for (const t of txs) if (t.type) typeCounts.set(t.type, (typeCounts.get(t.type) ?? 0) + 1);
  const types = [...typeCounts.keys()].sort();
  if (!types.includes(getTableFilter(_txTableState, 'type'))) _txTableState.filters.type = '';
  const currentType = getTableFilter(_txTableState, 'type');
  if (typeEl) {
    typeEl.hidden = types.length < 2;
    typeEl.innerHTML =
      types.length < 2
        ? ''
        : chipButtonsHtml({
            attr: 'tx-type',
            value: currentType,
            chips: [
              { value: '', label: 'All', count: txs.length },
              ...types.map((type) => ({
                value: type,
                label: txTypeLabel(type),
                count: typeCounts.get(type),
              })),
            ],
          });
  }

  if (!txs.length) {
    _selectedTxRowIds.clear();
    listEl.innerHTML = tableEmptyStateHtml(
      '<p class="note">No transactions yet. Import a CSV export from your broker or add one manually.</p>',
    );
    if (paginationEl) paginationEl.innerHTML = '';
    renderFilterStatus(statusEl, { shown: 0, total: 0, noun: 'transactions', active: false });
    _updateBulkControls('tx');
    return;
  }

  const filtered = getFilteredTxs(txs);
  renderFilterStatus(statusEl, {
    shown: filtered.length,
    total: txs.length,
    noun: 'transactions',
    active: !!(currentType || getTableFilter(_txTableState, 'search')),
    note: _txFromChart ? 'From chart' : undefined,
  });

  if (!filtered.length) {
    listEl.innerHTML = tableEmptyStateHtml(
      '<p class="note">No matching transactions. <button type="button" class="btn-link filter-clear-all" data-clear-filters>Clear filters</button></p>',
    );
    if (paginationEl) paginationEl.innerHTML = '';
    _updateBulkControls('tx');
    return;
  }

  const columns = txColumns();
  const { pageItems, page, totalPages } = sortAndPaginate(
    filtered,
    columns,
    _txTableState.sort,
    _txTableState.page,
    _txPageSize,
  );
  setTablePage(_txTableState, page);
  const showActions = !_readOnly;
  const showSelection = !_readOnly && !!_lastOnBulkDelTxs && _txBulkMode;
  const pageStart = (page - 1) * _txPageSize;
  _txByKey = new Map();

  listEl.innerHTML = `
    <div class="tbl-row th tx-row" role="row" id="tx-table-header">
      ${renderTableHeader(columns, _txTableState.sort)}
      ${
        showActions
          ? `<div role="columnheader" style="text-align:right">${showSelection ? 'Select' : 'Actions'}</div>`
          : ''
      }
    </div>
    ${pageItems
      .map((tx, i) => {
        const key = txKey(tx, pageStart + i);
        _txByKey.set(key, tx);
        const actionBtns = showSelection
          ? tx.rowId
            ? `<input type="checkbox" class="js-tx-select" data-rowid="${tx.rowId}" aria-label="Select transaction on ${fmtDay(tx.date)}" ${
                _selectedTxRowIds.has(tx.rowId.toString()) ? 'checked' : ''
              }>`
            : ''
          : !showActions || !tx.rowId
            ? ''
            : `<button class="btn btn-sm btn-outline btn-icon js-edit-tx" data-rowid="${tx.rowId}" aria-label="Edit transaction" title="Edit transaction">${EDIT_ICON}</button>
            <button class="btn btn-sm btn-danger btn-icon js-del-tx" data-rowid="${tx.rowId}" aria-label="Delete transaction" title="Delete transaction">${DELETE_ICON}</button>`;
        const [dateCol, typeCol, ...restCols] = columns;
        const headerCells = renderTableRow([dateCol, typeCol], tx);
        const sourceChip = tx.source
          ? `<span class="tx-ledger-source tx-ledger-chip-trim tx-header-source" title="${esc(sourceLabel(tx.source))}">${esc(sourceLabel(tx.source))}</span>`
          : '';
        const mobileActionsCell =
          !showActions || !tx.rowId
            ? ''
            : `<div role="cell" class="tx-actions tx-actions-mobile" data-ledger-label="${
                showSelection ? 'Select' : 'Actions'
              }">
            ${actionBtns}
          </div>`;
        const desktopActionsCell =
          !showActions || !tx.rowId
            ? ''
            : `<div role="cell" class="tx-actions tx-actions-desktop" data-ledger-label="${
                showSelection ? 'Select' : 'Actions'
              }">
            ${actionBtns}
          </div>`;
        const bodyCells = renderTableRow(restCols, tx);
        return `<div class="tbl-row tx-row" role="row" tabindex="0" aria-expanded="false" aria-controls="${txDetailId(key)}"         data-txkey="${esc(key)}">
          <div class="tx-card-header">${headerCells}${sourceChip}${mobileActionsCell}</div>
          ${bodyCells}
          ${desktopActionsCell}
        </div>`;
      })
      .join('')}
  `;

  // Re-open details that were expanded before the re-render (still on this page).
  if (_openTxDetails.size) {
    const keys = new Set(_openTxDetails);
    _openTxDetails.clear();
    listEl.querySelectorAll<HTMLElement>('.tx-row:not(.th)').forEach((row) => {
      if (row.dataset.txkey && keys.has(row.dataset.txkey)) toggleTxDetail(row);
    });
  }

  bindSortedTableHeader(
    document.getElementById('tx-table-header'),
    _txTableState.sort,
    (newState) => {
      setTableSort(_txTableState, newState);
      renderTxList(txs);
    },
  );

  attachEtfPopovers(listEl);

  renderPagination(
    'tx-pagination',
    _txTableState.page,
    totalPages,
    (page) => {
      setTablePage(_txTableState, page);
      renderTxList(txs);
    },
    {
      totalItems: filtered.length,
      pageSize: _txPageSize,
      pageSizeOptions: TX_PAGE_SIZES,
      itemLabel: 'transactions',
      onPageSizeChange: (size) => {
        _txPageSize = size;
        savePageSize(TX_PAGE_SIZE_KEY, size);
        setTablePage(_txTableState, 1);
        renderTxList(txs);
      },
    },
  );
  _updateBulkControls('tx');
}
