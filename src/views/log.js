import { snapTotal, fmt, fmtMon } from '../utils.js';

export function renderLog(state) {
  const { txs, snaps, importMeta } = state;

  // Import status bar
  const el = document.getElementById('import-status');
  if (importMeta?.last_import && txs.length) {
    el.textContent = `✓ ${txs.length} transactions synced — last imported ${importMeta.last_import}`;
    el.className = 'status-bar status-ok';
  } else {
    el.textContent = 'No CSV imported yet — upload your Transaktionsexport below';
    el.className = 'status-bar status-empty';
  }

  renderSnapList(snaps, state.onEditSnap, state.onDelSnap);
}

export function renderSnapList(snaps, onEdit, onDel) {
  const el = document.getElementById('snaps-list');
  if (!snaps.length) {
    el.innerHTML = '<div class="empty-state" style="padding:1.5rem;font-size:13px">No snapshots yet — add your first one above.</div>';
    return;
  }
  const sorted = [...snaps].reverse();
  el.innerHTML = `
    <div class="snap-row" style="color:#898781;font-size:11px;text-transform:uppercase;letter-spacing:.04em;padding-bottom:6px">
      <div>Month</div><div>Net worth</div><div>TR ETF</div><div>N26</div><div>bAV</div><div></div>
    </div>
    ${sorted.map(s => {
      const total = snapTotal(s);
      return `<div class="snap-row" data-date="${s.date}">
        <div style="font-weight:500;font-size:12px">${fmtMon(s.date)}</div>
        <div style="font-weight:500">${fmt(total)}</div>
        <div style="color:#52514e">${s.tr_portfolio ? fmt(s.tr_portfolio) : '—'}</div>
        <div style="color:#52514e">${s.n26 ? fmt(s.n26) : '—'}</div>
        <div style="color:#52514e">${s.bav ? fmt(s.bav) : '—'}</div>
        <div class="snap-btns">
          <button class="btn btn-sm btn-outline js-edit-snap" data-date="${s.date}">Edit</button>
          <button class="btn btn-sm btn-danger js-del-snap" data-date="${s.date}">✕</button>
        </div>
      </div>
      ${s.notes ? `<div style="font-size:11px;color:#898781;font-style:italic;padding:0 0 6px;border-bottom:1px solid #f1efe8">📝 ${s.notes}</div>` : ''}`;
    }).join('')}
  `;

  // Attach event listeners via delegation
  el.querySelectorAll('.js-edit-snap').forEach(btn => {
    btn.addEventListener('click', () => onEdit(btn.dataset.date));
  });
  el.querySelectorAll('.js-del-snap').forEach(btn => {
    btn.addEventListener('click', () => onDel(btn.dataset.date));
  });
}
