// @ts-nocheck — DOM-heavy view; full strict typing deferred to framework migration
import { getACCTSList } from '../constants';
import { snapTotal, fmtEur2, fmtMon, esc } from '../utils';
import type { Snapshot, Transaction } from '../types';
import { T } from '../theme';

interface LogState {
  txs: Transaction[];
  snaps: Snapshot[];
  importMeta: Record<string, string> | null;
  onEditSnap: (date: string) => void;
  onDelSnap: (date: string) => void;
}

const PAGE_SIZE = 12;
let _snapPage = 1;
let _snapYear = '';
let _snapSearch = '';
let _lastOnEdit: ((date: string) => void) | null = null;
let _lastOnDel: ((date: string) => void) | null = null;

export function renderLog(state: LogState): void {
  const { txs, snaps, importMeta } = state;

  // Import status bar
  const el = document.getElementById('import-status');
  if (importMeta?.last_import && txs.length) {
    el.textContent = `\u2713 ${txs.length} transactions synced — last imported ${importMeta.last_import}`;
    el.className = 'status-bar status-ok';
  } else {
    el.textContent = 'No CSV imported yet — upload your transaction export below';
    el.className = 'status-bar status-empty';
  }

  _lastOnEdit = state.onEditSnap;
  _lastOnDel = state.onDelSnap;

  // Populate year filter options
  populateYearFilter(snaps);
  attachFilterListeners(snaps);
  renderSnapList(snaps, state.onEditSnap, state.onDelSnap);
}

function populateYearFilter(snaps: Snapshot[]): void {
  const select = document.getElementById('snap-year-filter');
  if (!select) return;
  const years = [...new Set(snaps.map(s => s.date.slice(0, 4)))].sort().reverse();
  const current = select.value;
  select.innerHTML = '<option value="">All years</option>' +
    years.map(y => `<option value="${y}" ${y === current ? 'selected' : ''}>${y}</option>`).join('');
}

function attachFilterListeners(snaps: Snapshot[]): void {
  const yearEl = document.getElementById('snap-year-filter') as HTMLSelectElement & { _bound?: boolean } | null;
  const searchEl = document.getElementById('snap-search') as HTMLInputElement & { _bound?: boolean } | null;

  if (yearEl && !yearEl._bound) {
    yearEl._bound = true;
    yearEl.addEventListener('change', () => {
      _snapYear = yearEl.value;
      _snapPage = 1;
      renderSnapList(snaps, _lastOnEdit, _lastOnDel);
    });
  }
  if (searchEl && !searchEl._bound) {
    searchEl._bound = true;
    searchEl.addEventListener('input', () => {
      _snapSearch = searchEl.value.toLowerCase();
      _snapPage = 1;
      renderSnapList(snaps, _lastOnEdit, _lastOnDel);
    });
  }
}

export function renderSnapList(snaps: Snapshot[], onEdit: (date: string) => void, onDel: (date: string) => void): void {
  const ACCTS = getACCTSList();
  const el = document.getElementById('snaps-list');
  if (!snaps.length) {
    el.innerHTML = '<div class="empty-state" style="padding:1.5rem;font-size:13px">No snapshots yet — add your first one above.</div>';
    hidePagination();
    return;
  }

  // Apply filters
  let filtered = [...snaps].reverse();
  if (_snapYear) {
    filtered = filtered.filter(s => s.date.startsWith(_snapYear));
  }
  if (_snapSearch) {
    filtered = filtered.filter(s =>
      (s.notes || '').toLowerCase().includes(_snapSearch) ||
      fmtMon(s.date).toLowerCase().includes(_snapSearch)
    );
  }

  if (filtered.length === 0) {
    el.innerHTML = '<div class="empty-state" style="padding:1rem;font-size:12px;color:' + T.ink3 + '">No matching snapshots.</div>';
    hidePagination();
    return;
  }

  // Pagination
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  if (_snapPage > totalPages) _snapPage = totalPages;
  const start = (_snapPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  // Show all accounts in the table header
  const shown = ACCTS;
  const gridCols = `auto 1fr ${shown.map(() => '1fr').join(' ')} auto`;
  el.innerHTML = `
    <div class="tbl"><div class="tbl-inner">
    <div class="snap-row snap-row--wide" role="row" style="grid-template-columns:${gridCols};color:${T.ink3};font-size:11px;text-transform:uppercase;letter-spacing:.04em;padding-bottom:6px">
      <div role="columnheader">Month</div><div role="columnheader">Net worth</div>${shown.map(a => `<div role="columnheader">${esc(a.label)}</div>`).join('')}<div></div>
    </div>
    ${pageItems.map(s => {
      const total = snapTotal(s);
      return `<div class="snap-row snap-row--wide" role="row" style="grid-template-columns:${gridCols}" data-date="${s.date}">
        <div role="cell" style="font-weight:500;font-size:12px">${fmtMon(s.date)}</div>
        <div role="cell" style="font-weight:500">${fmtEur2(total)}</div>
        ${shown.map(a => `<div role="cell" style="color:${T.ink2}">${s[a.key] ? fmtEur2(s[a.key]) : '—'}</div>`).join('')}
        <div class="snap-btns">
          <button class="btn btn-sm btn-outline js-edit-snap" data-date="${s.date}">Edit</button>
          <button class="btn btn-sm btn-danger js-del-snap" data-date="${s.date}">✕</button>
        </div>
      </div>
      ${s.notes ? `<div style="font-size:11px;color:${T.ink3};font-style:italic;padding:0 0 6px;border-bottom:1px solid ${T.surface3}">${esc(s.notes)}</div>` : ''}`;
    }).join('')}
    </div></div>
  `;

  // Pagination controls
  renderPagination('snap-pagination', _snapPage, totalPages, (page) => {
    _snapPage = page;
    renderSnapList(snaps, onEdit, onDel);
  });

  // Attach event listeners
  el.querySelectorAll('.js-edit-snap').forEach(btn => {
    btn.addEventListener('click', () => onEdit(btn.dataset.date));
  });
  el.querySelectorAll('.js-del-snap').forEach(btn => {
    btn.addEventListener('click', () => onDel(btn.dataset.date));
  });
}

function renderPagination(containerId: string, page: number, totalPages: number, onPageChange: (page: number) => void): void {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (totalPages <= 1) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `
    <button class="btn btn-sm btn-ghost js-page-prev" ${page <= 1 ? 'disabled' : ''}>←</button>
    <span class="page-info">${page} / ${totalPages}</span>
    <button class="btn btn-sm btn-ghost js-page-next" ${page >= totalPages ? 'disabled' : ''}>→</button>
  `;
  el.querySelector('.js-page-prev')?.addEventListener('click', () => {
    if (page > 1) onPageChange(page - 1);
  });
  el.querySelector('.js-page-next')?.addEventListener('click', () => {
    if (page < totalPages) onPageChange(page + 1);
  });
}

function hidePagination(): void {
  const el = document.getElementById('snap-pagination');
  if (el) el.innerHTML = '';
}
