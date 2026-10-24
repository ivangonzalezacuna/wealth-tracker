import { getACCTSList } from '../constants';
import { snapTotal, fmtEur2, fmtMon, fmtDay, esc, safeColor } from '../utils';
import { sourceLabel } from '../import/profiles/index';
import type { Snapshot, Transaction } from '../types';
import { isCollapsed, setCollapsed } from '../ui/collapseState';
import { EDIT_ICON, DELETE_ICON } from './icons';
import { attachEtfPopovers } from '../ui/etfPopover';
import type { ColumnDef } from './tableColumns';
import { renderTableHeader, renderTableRow } from './tableColumns';
import { renderPagination } from './pagination';
import { bindExpandableRows, restoreExpandableRows } from './expandableRows';
import { bindSortedTableHeader, sortAndPaginate } from './tableView';
import { populateYearFilterOptions } from './yearFilter';
import { LOG_VIEWS, type LogView } from '../nav';
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

const SNAP_PAGE_SIZES = [12, 24, 36] as const;
const TX_PAGE_SIZES = [15, 25, 50, 100] as const;
const SNAP_PAGE_SIZE_KEY = 'wt:log:snapPageSize';
const TX_PAGE_SIZE_KEY = 'wt:log:txPageSize';

function loadPageSize(key: string, allowed: readonly number[], fallback: number): number {
  try {
    const stored = Number(globalThis.localStorage?.getItem(key));
    return allowed.includes(stored) ? stored : fallback;
  } catch {
    return fallback;
  }
}

function savePageSize(key: string, size: number): void {
  try {
    globalThis.localStorage?.setItem(key, String(size));
  } catch {
    // Storage may be unavailable (private mode); the size still applies for this session.
  }
}

/** Sort value for ISO dates ("YYYY-MM" or "YYYY-MM-DD") so 'desc' means newest first. */
function isoDateSortValue(date: string): number {
  const ms = Date.parse(date.length === 7 ? `${date}-01` : date);
  return Number.isFinite(ms) ? ms : 0;
}

let _snapPageSize = loadPageSize(SNAP_PAGE_SIZE_KEY, SNAP_PAGE_SIZES, SNAP_PAGE_SIZES[0]);
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
let _txPageSize = loadPageSize(TX_PAGE_SIZE_KEY, TX_PAGE_SIZES, TX_PAGE_SIZES[0]);
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
  const legendEl = document.getElementById('snap-legend');
  if (legendEl) {
    const used = getACCTSList().filter((a) => snaps.some((s) => ((s[a.key] as number) || 0) > 0));
    legendEl.innerHTML = used
      .map(
        (a) =>
          `<span class="leg-item"><span class="leg-sq" style="background:${safeColor(a.color)}" aria-hidden="true"></span><span class="leg-label">${esc(a.label)}</span></span>`,
      )
      .join('');
    legendEl.hidden = used.length < 2;
  }
  // First-time users land on an empty ledger: show the drop zone right away.
  if (!_importPanelTouched) setImportPanelOpen(txs.length === 0);
}

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

  // Populate year filter options
  populateYearFilterOptions('snap-year-filter', _snaps);
  attachFilterListeners();
  _updateBulkControls('snap');
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

  startBtn.hidden = _readOnly || !hasBulkHandler();
  startBtn.textContent = isActive ? 'Cancel' : 'Bulk delete';
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
  const total = snapTotal(s);
  if (total <= 0) return [];
  return getACCTSList()
    .filter((a) => ((s[a.key] as number) || 0) > 0)
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
        `<span class="row-expand-chevron" aria-hidden="true">&#x25B8;</span><span class="snap-month">${fmtMon(s.date)}</span>${s.notes ? '<span class="snap-note-dot" title="Has a note"></span>' : ''}`,
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
      cellAttrs: (s) => {
        const shares = snapShares(s);
        if (!shares.length) return '';
        const label = shares
          .map(({ a, share }) => `${a.label} ${Math.round(share * 100)}%`)
          .join(', ');
        return `aria-label="Account mix: ${esc(label)}"`;
      },
      cell: (s) => {
        return snapShares(s)
          .map(
            ({ a, share }) =>
              `<span class="snap-seg" style="flex-grow:${share.toFixed(4)};background:${safeColor(a.color)}" title="${esc(a.label)}: ${fmtEur2((s[a.key] as number) || 0)}"></span>`,
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
    el.innerHTML =
      '<div class="empty-state" style="padding:1.5rem;font-size:13px">No snapshots yet. Add your first one above.</div>';
    hidePagination();
    _updateBulkControls('snap');
    return;
  }

  const filtered = getFilteredSnaps(snaps);

  if (filtered.length === 0) {
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
    <div class="snap-detail-head"><span class="snap-detail-month">${fmtMon(snap.date)}</span><span class="snap-detail-total">${fmtEur2(snapTotal(snap))}</span></div>
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

const TX_DETAIL_SELECTOR = '.tx-detail';

function txKey(tx: Transaction, index: number): string {
  return tx.id || (tx.rowId != null ? `row:${tx.rowId}` : `idx:${index}`);
}

function txDetailId(key: string): string {
  return `tx-detail-${key.replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

/** Build the detail panel shown beneath an expanded ledger row (all stored fields). */
function _createTxDetail(tx: Transaction, key: string): HTMLElement {
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
  row.insertAdjacentElement('afterend', _createTxDetail(tx, key));
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
      cell: (t) =>
        `<span class="row-expand-chevron" aria-hidden="true">&#x25B8;</span><span class="snap-month">${fmtDay(t.date)}</span>`,
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

function fmtTxMoney(n: number, currency: string | undefined): string {
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
  const typeEl = document.getElementById('tx-type-filter') as
    (HTMLSelectElement & { _bound?: boolean }) | null;
  const addBtn = document.getElementById('btn-add-tx') as
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
  const typeEl = document.getElementById('tx-type-filter') as HTMLSelectElement | null;
  const addBtn = document.getElementById('btn-add-tx') as HTMLButtonElement | null;
  if (!listEl) return;
  if (addBtn) addBtn.disabled = _readOnly;
  if (addBtn) addBtn.hidden = _txBulkMode;
  listEl.className = `tx-ledger-grid${_readOnly ? ' tx-ledger-grid-readonly' : ''}`;

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
    listEl.innerHTML =
      '<div class="empty-state" style="padding:1rem;font-size:13px">No transactions yet.</div>';
    if (paginationEl) paginationEl.innerHTML = '';
    _updateBulkControls('tx');
    return;
  }

  const filtered = getFilteredTxs(txs);

  if (!filtered.length) {
    listEl.innerHTML =
      '<div class="empty-state" style="padding:1rem;font-size:13px">No matching transactions.</div>';
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
          ? `<span class="tx-ledger-source tx-ledger-chip-trim tx-header-source" title="${esc(tx.source)}">${esc(tx.source)}</span>`
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
