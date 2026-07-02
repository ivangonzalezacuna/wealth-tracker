// @ts-nocheck - DOM-heavy view; full strict typing deferred to framework migration
import { getACCTSList } from '../constants';
import { snapTotal, fmtEur2, fmtMon, esc, safeColor } from '../utils';
import type { Snapshot, Transaction } from '../types';
import { T } from '../theme';
import { isCollapsed, toggleCollapsed } from '../ui/collapseState';
import type { SortState } from './tableSort';
import { applySort, bindSortableHeader } from './tableSort';
import type { ColumnDef } from './tableColumns';
import { renderTableHeader, renderTableRow, getSortGetters } from './tableColumns';
import { renderPagination } from './pagination';

interface LogState {
  txs: Transaction[];
  snaps: Snapshot[];
  importMeta: Record<string, string> | null;
  onEditSnap: (date: string) => void;
  onDelSnap: (date: string) => void;
  readOnly?: boolean;
}

const PAGE_SIZE = 12;
let _snapPage = 1;
let _snapYear = '';
let _snapSearch = '';
let _snapTblSort: SortState = { key: null, dir: null };
let _lastOnEdit: ((date: string) => void) | null = null;
let _lastOnDel: ((date: string) => void) | null = null;
let _readOnly = false;

export function renderLog(state: LogState): void {
  const { txs, snaps, importMeta } = state;

  // Import status bar
  const el = document.getElementById('import-status');
  if (importMeta?.last_import && txs.length) {
    el.textContent = `\u2713 ${txs.length} transactions synced, last imported ${importMeta.last_import}`;
    el.className = 'status-bar status-ok';
  } else {
    el.textContent = 'No CSV imported yet';
    el.className = 'status-bar status-empty';
  }

  _lastOnEdit = state.onEditSnap;
  _lastOnDel = state.onDelSnap;
  _readOnly = !!state.readOnly;

  // Populate year filter options
  populateYearFilter(snaps);
  attachFilterListeners(snaps);
  renderSnapList(snaps, state.onEditSnap, state.onDelSnap);
}

function populateYearFilter(snaps: Snapshot[]): void {
  const select = document.getElementById('snap-year-filter');
  if (!select) return;
  const years = [...new Set(snaps.map((s) => s.date.slice(0, 4)))].sort().reverse();
  const current = select.value;
  select.innerHTML =
    '<option value="">All years</option>' +
    years
      .map((y) => `<option value="${y}" ${y === current ? 'selected' : ''}>${y}</option>`)
      .join('');
}

function attachFilterListeners(snaps: Snapshot[]): void {
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
      renderSnapList(snaps, _lastOnEdit, _lastOnDel);
    });
  }
  if (searchEl && !searchEl._bound) {
    searchEl._bound = true;
    searchEl.addEventListener('input', () => {
      _snapSearch = searchEl.value.toLowerCase();
      _snapPage = 1;
      _snapTblSort = { key: null, dir: null };
      renderSnapList(snaps, _lastOnEdit, _lastOnDel);
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
        `<span class="snap-month">${fmtMon(s.date)}</span>${s.notes ? '<span class="snap-note-dot" title="Has a note"></span>' : ''}`,
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
          .filter((a) => (s[a.key] || 0) > 0)
          .map((a) => {
            const share = (s[a.key] || 0) / total;
            return `<span class="snap-seg" style="flex-grow:${share.toFixed(4)};background:${safeColor(a.color)}" title="${esc(a.label)}: ${fmtEur2(s[a.key] || 0)}"></span>`;
          })
          .join('');
      },
    },
  ];
}

export function renderSnapList(
  snaps: Snapshot[],
  onEdit: (date: string) => void,
  onDel: (date: string) => void,
): void {
  const el = document.getElementById('snaps-list');
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
  const sorted = applySort(filtered, _snapTblSort, getSortGetters(columns));

  // Pagination
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  if (_snapPage > totalPages) _snapPage = totalPages;
  const start = (_snapPage - 1) * PAGE_SIZE;
  const pageItems = sorted.slice(start, start + PAGE_SIZE);

  // Compact row layout - fixed 3-column (Month / Net worth / segment indicator)
  el.innerHTML = `
    <div class="snap-row-compact th" role="row" id="snap-table-header">
      ${renderTableHeader(columns, _snapTblSort)}
    </div>
    ${pageItems
      .map(
        (s) =>
          `<div class="snap-row-compact" role="row" data-date="${s.date}">
        ${renderTableRow(columns, s)}
      </div>`,
      )
      .join('')}
  `;

  // Bind sort handler on header row
  const snapHeaderEl = document.getElementById('snap-table-header');
  if (snapHeaderEl) {
    bindSortableHeader(snapHeaderEl, _snapTblSort, (newState) => {
      _snapTblSort = newState;
      _snapPage = 1;
      renderSnapList(snaps, onEdit, onDel);
    });
  }

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
      const existing = listEl.querySelector('.snap-detail') as HTMLElement | null;
      if (existing) {
        const wasThis = existing.previousElementSibling === row;
        const prevDate = existing.previousElementSibling?.dataset?.date;
        existing.remove();
        if (prevDate) toggleCollapsed('snap:' + prevDate); // mark collapsed
        if (wasThis) return;
      }
      const date = row.dataset.date;
      const snap = snaps.find((s) => s.date === date);
      if (!snap) return;
      if (date) toggleCollapsed('snap:' + date); // mark expanded
      _expandSnapRow(row, snap, date!, listEl, onEdit, onDel);
    });
  }

  // Restore previously expanded snap row (if still on this page)
  if (listEl) {
    listEl.querySelectorAll('.snap-row-compact:not(.th)').forEach((row) => {
      const date = (row as HTMLElement).dataset.date;
      if (date && isCollapsed('snap:' + date)) {
        const snap = snaps.find((s) => s.date === date);
        if (snap) _expandSnapRow(row as HTMLElement, snap, date, listEl, onEdit, onDel);
      }
    });
  }

  // Pagination controls
  renderPagination('snap-pagination', _snapPage, totalPages, (page) => {
    _snapPage = page;
    renderSnapList(snaps, onEdit, onDel);
  });
}

/** Expand a snapshot row into its detail panel. */
function _expandSnapRow(
  row: HTMLElement,
  snap: any,
  date: string,
  listEl: HTMLElement,
  onEdit: (d: string) => void,
  onDel: (d: string) => void,
): void {
  const accts = getACCTSList();
  const detailRows = accts
    .filter((a) => (snap[a.key] || 0) > 0)
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
  row.insertAdjacentElement('afterend', panel);
  panel.querySelector('.js-edit-snap')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    onEdit(date);
  });
  panel.querySelector('.js-del-snap')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    onDel(date);
  });
}

function hidePagination(): void {
  const el = document.getElementById('snap-pagination');
  if (el) el.innerHTML = '';
}
