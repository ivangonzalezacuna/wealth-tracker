import { getACCTSList } from '../constants';
import { snapTotal, fmtEur2, fmtMon, fmtDay, esc, safeColor } from '../utils';
import { sourceLabel } from '../import/profiles/index';
import type { Snapshot, Transaction } from '../types';
import { T } from '../theme';
import { isCollapsed, setCollapsed } from '../ui/collapseState';
import type { SortState } from './tableSort';
import type { ColumnDef } from './tableColumns';
import { renderTableHeader, renderTableRow } from './tableColumns';
import { renderPagination } from './pagination';
import { toggleSingleDetailRow } from './expandableRows';
import { bindSortedTableHeader, sortAndPaginate } from './tableView';

interface LogState {
  txs: Transaction[];
  snaps: Snapshot[];
  importMeta: Record<string, string> | null;
  onEditSnap: (date: string) => void;
  onDelSnap: (date: string, btn?: HTMLButtonElement) => void;
  onAddTx?: () => void;
  onEditTx?: (rowId: number) => void;
  onDelTx?: (rowId: number, btn?: HTMLButtonElement) => void;
  readOnly?: boolean;
}

const PAGE_SIZE = 12;
let _snapPage = 1;
let _snapYear = '';
let _snapSearch = '';
let _snapTblSort: SortState = { key: null, dir: null };
let _lastOnEdit: ((date: string) => void) | null = null;
let _lastOnDel: ((date: string, btn?: HTMLButtonElement) => void) | null = null;
let _lastOnAddTx: (() => void) | null = null;
let _lastOnEditTx: ((rowId: number) => void) | null = null;
let _lastOnDelTx: ((rowId: number, btn?: HTMLButtonElement) => void) | null = null;
let _readOnly = false;
let _snaps: Snapshot[] = [];
let _txs: Transaction[] = [];
let _txPage = 1;
let _txSearch = '';
let _txType = '';
let _txTblSort: SortState = { key: null, dir: null };

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
  _lastOnAddTx = state.onAddTx || null;
  _lastOnEditTx = state.onEditTx || null;
  _lastOnDelTx = state.onDelTx || null;
  _readOnly = !!state.readOnly;
  _snaps = snaps;
  _txs = txs;

  attachTxListeners();
  renderTxList(_txs);

  // Populate year filter options
  populateYearFilter(_snaps);
  attachFilterListeners();
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

function populateYearFilter(snaps: Snapshot[]): void {
  const select = document.getElementById('snap-year-filter') as HTMLSelectElement | null;
  if (!select) return;
  const years = [...new Set(snaps.map((s) => s.date.slice(0, 4)))].sort().reverse();
  const current = select.value;
  select.innerHTML =
    '<option value="">All years</option>' +
    years
      .map((y) => `<option value="${y}" ${y === current ? 'selected' : ''}>${y}</option>`)
      .join('');
}

function attachFilterListeners(): void {
  const yearEl = document.getElementById('snap-year-filter') as
    (HTMLSelectElement & { _bound?: boolean }) | null;
  const searchEl = document.getElementById('snap-search') as
    (HTMLInputElement & { _bound?: boolean }) | null;

  if (yearEl && !yearEl._bound) {
    yearEl._bound = true;
    yearEl.addEventListener('change', () => {
      _snapYear = yearEl.value;
      _snapPage = 1;
      _snapTblSort = { key: null, dir: null };
      if (_lastOnEdit && _lastOnDel) renderSnapList(_snaps, _lastOnEdit, _lastOnDel);
    });
  }
  if (searchEl && !searchEl._bound) {
    searchEl._bound = true;
    searchEl.addEventListener('input', () => {
      _snapSearch = searchEl.value.toLowerCase();
      _snapPage = 1;
      _snapTblSort = { key: null, dir: null };
      if (_lastOnEdit && _lastOnDel) renderSnapList(_snaps, _lastOnEdit, _lastOnDel);
    });
  }
}

function snapColumns(): ColumnDef<Snapshot>[] {
  return [
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
}

function renderSnapList(
  snaps: Snapshot[],
  onEdit: (date: string) => void,
  onDel: (date: string, btn?: HTMLButtonElement) => void,
): void {
  const el = document.getElementById('snaps-list')!;
  if (!snaps.length) {
    el.innerHTML =
      '<div class="empty-state" style="padding:1.5rem;font-size:13px">No snapshots yet. Add your first one above.</div>';
    hidePagination();
    return;
  }

  // Apply filters
  let filtered = [...snaps].reverse();
  if (_snapYear) {
    filtered = filtered.filter((s) => s.date.startsWith(_snapYear));
  }
  if (_snapSearch) {
    filtered = filtered.filter(
      (s) =>
        (s.notes || '').toLowerCase().includes(_snapSearch) ||
        fmtMon(s.date).toLowerCase().includes(_snapSearch),
    );
  }

  if (filtered.length === 0) {
    el.innerHTML = `<div class="empty-state" style="padding:1rem;font-size:12px;color:var(--ink-3)">
      No matching snapshots.
      <button class="btn btn-ghost btn-sm js-clear-snap-filters" style="margin-left:6px;font-size:12px">Clear filters</button>
    </div>`;
    hidePagination();
    el.querySelector('.js-clear-snap-filters')?.addEventListener('click', () => {
      _snapSearch = '';
      _snapYear = '';
      _snapPage = 1;
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
    _snapTblSort,
    _snapPage,
    PAGE_SIZE,
  );
  _snapPage = page;

  // Compact row layout - fixed 3-column (Month / Net worth / segment indicator)
  el.innerHTML = `
    <div class="snap-row-compact th" role="row" id="snap-table-header">
      ${renderTableHeader(columns, _snapTblSort)}
    </div>
    ${pageItems
      .map(
        (s) =>
          `<div class="snap-row-compact" role="row" tabindex="0" aria-expanded="${String(isCollapsed('snap:' + s.date))}" data-date="${s.date}">
        ${renderTableRow(columns, s)}
      </div>`,
      )
      .join('')}
  `;

  // Bind sort handler on header row
  bindSortedTableHeader(document.getElementById('snap-table-header'), _snapTblSort, (newState) => {
    _snapTblSort = newState;
    _snapPage = 1;
    renderSnapList(_snaps, onEdit, onDel);
  });

  // Row tap-to-expand detail panel (delegated on #snaps-list)
  const listEl = document.getElementById('snaps-list') as
    (HTMLElement & { _rowDetail_bound?: boolean }) | null;
  if (listEl && !listEl._rowDetail_bound) {
    listEl._rowDetail_bound = true;
    listEl.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      // Ignore clicks landing on action buttons inside an already-open panel
      if (target.closest('.js-edit-snap') || target.closest('.js-del-snap')) return;
      const row = target.closest('.snap-row-compact:not(.th)') as HTMLElement | null;
      if (!row) return;
      const date = row.dataset.date;
      const snap = _snaps.find((s) => s.date === date);
      if (!snap) return;
      toggleSingleDetailRow({
        container: listEl,
        row,
        item: snap,
        detailSelector: '.snap-detail',
        createDetail: () => _createSnapDetail(snap, date!, _lastOnEdit!, _lastOnDel!),
        onExpandedChange: (detailRow, expanded) => {
          const detailDate = detailRow.dataset.date;
          if (detailDate) setCollapsed('snap:' + detailDate, expanded);
        },
      });
    });
    listEl.addEventListener('keydown', (e) => {
      const row = (e.target as HTMLElement).closest(
        '.snap-row-compact:not(.th)',
      ) as HTMLElement | null;
      if (!row || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      row.click();
    });
  }

  // Restore previously expanded snap row (if still on this page)
  if (listEl) {
    listEl.querySelectorAll('.snap-row-compact:not(.th)').forEach((row) => {
      const date = (row as HTMLElement).dataset.date;
      if (date && isCollapsed('snap:' + date)) {
        const snap = snaps.find((s) => s.date === date);
        if (snap) {
          toggleSingleDetailRow({
            container: listEl,
            row: row as HTMLElement,
            item: snap,
            detailSelector: '.snap-detail',
            createDetail: () => _createSnapDetail(snap, date, onEdit, onDel),
            onExpandedChange: (detailRow, expanded) => {
              const detailDate = detailRow.dataset.date;
              if (detailDate) setCollapsed('snap:' + detailDate, expanded);
            },
          });
        }
      }
    });
  }

  // Pagination controls
  renderPagination('snap-pagination', _snapPage, totalPages, (page) => {
    _snapPage = page;
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

const TX_PAGE_SIZE = 15;

function txColumns(): ColumnDef<Transaction>[] {
  return [
    {
      key: 'date',
      label: 'Date',
      sortValue: (t) => t.date,
      cell: (t) => `<span class="snap-month">${fmtDay(t.date)}</span>`,
    },
    {
      key: 'type',
      label: 'Type',
      sortValue: (t) => t.type,
      cell: (t) => `<span class="tx-ledger-chip">${esc(t.type || '-')}</span>`,
    },
    {
      key: 'name',
      label: 'Name',
      sortValue: (t) => t.name || '',
      cell: (t) => `<span class="tx-ledger-name">${esc(t.name || '-')}</span>`,
    },
    {
      key: 'isin',
      label: 'ISIN',
      sortValue: (t) => t.isin || '',
      cell: (t) => `<span class="tx-ledger-isin">${esc(t.isin || '-')}</span>`,
    },
    {
      key: 'shares',
      label: 'Shares',
      align: 'right',
      sortValue: (t) => t.shares || 0,
      cell: (t) => (t.shares ? String(t.shares) : '-'),
    },
    {
      key: 'amount',
      label: 'Amount',
      align: 'right',
      sortValue: (t) => t.amount || 0,
      cell: (t) =>
        `<span class="tx-ledger-amount ${(t.amount || 0) < 0 ? 'neg' : 'pos'}">${fmtEur2(t.amount || 0)}</span>${
          t.type === 'INTEREST' && t.tax
            ? `<span class="tx-ledger-meta">Tax ${fmtEur2(t.tax)}</span>`
            : ''
        }`,
    },
    {
      key: 'source',
      label: 'Source',
      sortValue: (t) => t.source || '',
      cell: (t) => `<span class="tx-ledger-source">${esc(t.source || '-')}</span>`,
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
  const listEl = document.getElementById('tx-ledger-list') as
    (HTMLElement & { _bound?: boolean }) | null;

  if (searchEl && !searchEl._bound) {
    searchEl._bound = true;
    searchEl.addEventListener('input', () => {
      _txSearch = searchEl.value.toLowerCase();
      _txPage = 1;
      renderTxList(_txs);
    });
  }
  if (typeEl && !typeEl._bound) {
    typeEl._bound = true;
    typeEl.addEventListener('change', () => {
      _txType = typeEl.value;
      _txPage = 1;
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
        const rowId = Number(editBtn.dataset.rowid || 0);
        if (rowId > 0) _lastOnEditTx?.(rowId);
        return;
      }
      const delBtn = target.closest('.js-del-tx') as HTMLButtonElement | null;
      if (delBtn) {
        const rowId = Number(delBtn.dataset.rowid || 0);
        if (rowId > 0) _lastOnDelTx?.(rowId, delBtn);
      }
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
  listEl.className = `tx-ledger-grid${_readOnly ? ' tx-ledger-grid-readonly' : ''}`;

  const types = [...new Set(txs.map((t) => t.type).filter(Boolean))].sort() as string[];
  if (typeEl) {
    const prev = typeEl.value || _txType;
    typeEl.innerHTML =
      '<option value="">All types</option>' +
      types.map((type) => `<option value="${esc(type)}">${esc(type)}</option>`).join('');
    if (types.includes(prev)) typeEl.value = prev;
    _txType = typeEl.value;
  }

  if (!txs.length) {
    listEl.innerHTML =
      '<div class="empty-state" style="padding:1rem;font-size:13px">No transactions yet.</div>';
    if (paginationEl) paginationEl.innerHTML = '';
    return;
  }

  let filtered = [...txs];
  if (_txType) filtered = filtered.filter((t) => t.type === _txType);
  if (_txSearch) {
    filtered = filtered.filter((t) =>
      [t.date, t.name, t.isin, t.source, t.type].join(' ').toLowerCase().includes(_txSearch),
    );
  }

  if (!filtered.length) {
    listEl.innerHTML =
      '<div class="empty-state" style="padding:1rem;font-size:13px">No matching transactions.</div>';
    if (paginationEl) paginationEl.innerHTML = '';
    return;
  }

  const columns = txColumns();
  const { pageItems, page, totalPages } = sortAndPaginate(
    filtered,
    columns,
    _txTblSort,
    _txPage,
    TX_PAGE_SIZE,
  );
  _txPage = page;
  const showActions = !_readOnly;

  listEl.innerHTML = `
    <div class="tbl-row th tx-row" role="row" id="tx-table-header">
      ${renderTableHeader(columns, _txTblSort)}
      ${showActions ? '<div role="columnheader" style="text-align:right">Actions</div>' : ''}
    </div>
    ${pageItems
      .map((tx) => {
        const actions =
          !showActions || !tx.rowId
            ? ''
            : `<div role="cell" class="tx-actions">
            <button class="btn btn-ghost btn-sm js-edit-tx" data-rowid="${tx.rowId}">Edit</button>
            <button class="btn btn-danger btn-sm js-del-tx" data-rowid="${tx.rowId}">Delete</button>
          </div>`;
        return `<div class="tbl-row tx-row" role="row">
          ${renderTableRow(columns, tx)}
          ${actions}
        </div>`;
      })
      .join('')}
  `;

  bindSortedTableHeader(document.getElementById('tx-table-header'), _txTblSort, (newState) => {
    _txTblSort = newState;
    _txPage = 1;
    renderTxList(txs);
  });

  renderPagination('tx-pagination', _txPage, totalPages, (page) => {
    _txPage = page;
    renderTxList(txs);
  });
}
