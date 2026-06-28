import { getACCTSList } from '../constants.js';
import { snapTotal, fmt, fmtMon } from '../utils.js';

const PAGE_SIZE = 12;
let _snapPage = 1;
let _snapYear = '';
let _snapSearch = '';
let _lastOnEdit = null;
let _lastOnDel = null;

export function renderLog(state) {
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

function populateYearFilter(snaps) {
  const select = document.getElementById('snap-year-filter');
  if (!select) return;
  const years = [...new Set(snaps.map(s => s.date.slice(0, 4)))].sort().reverse();
  const current = select.value;
  select.innerHTML = '<option value="">All years</option>' +
    years.map(y => `<option value="${y}" ${y === current ? 'selected' : ''}>${y}</option>`).join('');
}

function attachFilterListeners(snaps) {
  const yearEl = document.getElementById('snap-year-filter');
  const searchEl = document.getElementById('snap-search');

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

export function renderSnapList(snaps, onEdit, onDel) {
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
    el.innerHTML = '<div class="empty-state" style="padding:1rem;font-size:12px;color:#6b6a65">No matching snapshots.</div>';
    hidePagination();
    return;
  }

  // Pagination
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  if (_snapPage > totalPages) _snapPage = totalPages;
  const start = (_snapPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  // Show first 3 accounts in the compact table header
  const shown = ACCTS.slice(0, 3);
  el.innerHTML = `
    <div class="snap-row" style="color:#6b6a65;font-size:11px;text-transform:uppercase;letter-spacing:.04em;padding-bottom:6px">
      <div>Month</div><div>Net worth</div>${shown.map(a => `<div>${a.label}</div>`).join('')}<div></div>
    </div>
    ${pageItems.map(s => {
      const total = snapTotal(s);
      return `<div class="snap-row" data-date="${s.date}">
        <div style="font-weight:500;font-size:12px">${fmtMon(s.date)}</div>
        <div style="font-weight:500">${fmt(total)}</div>
        ${shown.map(a => `<div style="color:#52514e">${s[a.key] ? fmt(s[a.key]) : '—'}</div>`).join('')}
        <div class="snap-btns">
          <button class="btn btn-sm btn-outline js-edit-snap" data-date="${s.date}">Edit</button>
          <button class="btn btn-sm btn-danger js-del-snap" data-date="${s.date}">✕</button>
        </div>
      </div>
      ${s.notes ? `<div style="font-size:11px;color:#6b6a65;font-style:italic;padding:0 0 6px;border-bottom:1px solid #f1efe8">${s.notes}</div>` : ''}`;
    }).join('')}
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

function renderPagination(containerId, page, totalPages, onPageChange) {
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

function hidePagination() {
  const el = document.getElementById('snap-pagination');
  if (el) el.innerHTML = '';
}
