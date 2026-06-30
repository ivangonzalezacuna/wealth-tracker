// @ts-nocheck — DOM-heavy view; full strict typing deferred to framework migration
import { fmtEur, fmtEur2, fmtMon, fmtShares, esc, safeColor } from '../utils';
import { getISIN_ORDERList, getMETAMap } from '../constants';
import { getAccounts, getHoldings } from '../store/config';
import { primaryInvestmentValue } from '../model/accounts';
import { splitHoldings } from '../model/holdings';
import { computeDrift, maxDrift } from '../model/drift';
import type { PortfolioData, Snapshot, EtfPosition } from '../types';
import Chart from 'chart.js/auto';
import { T, resolvedT } from '../theme';
import { infoTip, attachInfoTips } from '../ui/infoTip';

const CH: Record<string, Chart> = {};

// Module-level filter state (survives re-renders)
let _showExited = false;
let _holdingsFilter = 'held'; // 'held' | 'closed' | 'all'
const HOLD_PAGE_SIZE = 10;
let _holdPage = 1;

/**
 * Render only the holdings table (filter-dependent portion).
 * Called on filter toggle without recreating the donut, KPIs, or summary.
 */
function renderHoldingsTable(pd: PortfolioData, snaps: Snapshot[]): void {
  const ISIN_ORDER = getISIN_ORDERList();
  const META = getMETAMap();

  // Build full ordered ETF list
  const allEtfs = ISIN_ORDER.map(s => pd.etfs[s]).filter(Boolean)
    .concat(Object.values(pd.etfs).filter(e => !ISIN_ORDER.includes(e.symbol)));

  // Split into held / exited
  const { held, exited } = splitHoldings(allEtfs);
  const exitedCount = exited.length;

  // Determine which ETFs to show based on filter
  let displayList;
  if (_holdingsFilter === 'closed') {
    displayList = exited;
  } else if (_holdingsFilter === 'all') {
    displayList = allEtfs;
  } else {
    displayList = held;
  }

  // Pagination
  const totalPages = Math.ceil(displayList.length / HOLD_PAGE_SIZE);
  if (_holdPage > totalPages) _holdPage = Math.max(1, totalPages);
  const pageItems = displayList.slice((_holdPage - 1) * HOLD_PAGE_SIZE, _holdPage * HOLD_PAGE_SIZE);

  // Filter controls
  const filterHtml = `
    <div class="filter-bar" style="margin-bottom:8px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
      <div class="range-toggle" id="port-filter-toggle">
        <button class="btn btn-sm btn-ghost ${_holdingsFilter === 'held' ? 'active' : ''}" data-filter="held">Held</button>
        <button class="btn btn-sm btn-ghost ${_holdingsFilter === 'closed' ? 'active' : ''}" data-filter="closed">Closed${exitedCount > 0 ? ' (' + exitedCount + ')' : ''}</button>
        <button class="btn btn-sm btn-ghost ${_holdingsFilter === 'all' ? 'active' : ''}" data-filter="all">All</button>
      </div>
    </div>`;

  const rows = pageItems.map(e => {
    const pct = pd.totalInv > 0 ? e.cost / pd.totalInv * 100 : 0;
    const avg = e.shares > 0 ? e.cost / e.shares : 0;
    const m   = META[e.ticker] || {};
    const isExited = e.exited || e.shares < 1e-6;
    const rpnl = e.realizedPnL || 0;

    return `<div class="tbl-row hold-row" role="row"${isExited ? ' style="opacity:0.6"' : ''}>
      <div role="cell" class="hold-etf-cell"
           data-isin="${esc(e.symbol)}"
           data-active="${m.active ? '1' : '0'}"
           data-acc="${e.acc ? '1' : '0'}"
           data-shares="${fmtShares(e.shares)}"
           data-avg="${avg > 0 ? fmtEur2(avg) : ''}"
           data-rpnl="${rpnl}">
        <span class="hold-ticker">${esc(e.ticker)}</span>
        <span class="hold-dot" style="background:${safeColor(e.color)};opacity:${isExited ? '0.45' : '1'}"></span>
      </div>
      <div role="cell" style="text-align:right;font-weight:500">${fmtEur(e.cost)}
        ${!isExited ? `<div class="bar-wrap"><div class="bar-fill" style="width:${pct.toFixed(0)}%;background:${safeColor(e.color)}"></div></div>` : ''}
      </div>
      <div role="cell" style="text-align:right;color:var(--ink-2)">${fmtShares(e.shares)}</div>
      <div role="cell" style="text-align:right;color:var(--ink-2)">${avg > 0 ? fmtEur2(avg) : '—'}</div>
      <div role="cell" style="text-align:right;color:var(--ink-2)">${pct.toFixed(1)}%</div>
      <div role="cell" style="text-align:right;color:${rpnl >= 0 ? 'var(--pos)' : 'var(--neg)'}" aria-label="Realized P&L ${rpnl !== 0 ? (rpnl >= 0 ? '+' : '') + rpnl.toFixed(2) : 'none'}">${rpnl === 0 ? '—' : (rpnl > 0 ? '+' : '') + fmtEur2(rpnl)}</div>
      <div role="cell" style="text-align:right;color:${e.divNet > 0 ? 'var(--pos)' : 'var(--ink-3)'}">${e.divNet > 0 ? fmtEur2(e.divNet) : '—'}</div>
    </div>`;
  }).join('');

  document.getElementById('port-table').innerHTML = `
    ${filterHtml}
    <div class="tbl-row th hold-row" role="row">
      <div role="columnheader">ETF</div><div role="columnheader" style="text-align:right"><span class="th-label">Cost basis${infoTip('Total amount invested (net of sells). Calculated from your imported CSV transactions using the method chosen in Settings.')}</span></div><div role="columnheader" style="text-align:right">Shares</div><div role="columnheader" style="text-align:right">Avg price</div><div role="columnheader" style="text-align:right">% of cost</div><div role="columnheader" style="text-align:right">Realized P&amp;L</div><div role="columnheader" style="text-align:right">Div (net)</div>
    </div>${rows}
    <div class="tbl-row hold-total" role="row" style="border-top:1px solid var(--line-2);margin-top:4px">
      <div style="font-weight:500">Total</div>
      <div style="font-weight:500;text-align:right">${fmtEur(pd.totalInv)}</div>
      <div></div><div></div>
      <div style="font-weight:500;text-align:right">100%</div>
      <div style="text-align:right;color:${pd.realizedPnL >= 0 ? 'var(--pos)' : 'var(--neg)'};font-weight:500">${pd.realizedPnL === 0 ? fmtEur2(0) : (pd.realizedPnL > 0 ? '+' : '') + fmtEur2(pd.realizedPnL)}</div>
      <div style="text-align:right;color:var(--pos);font-weight:500">${fmtEur2(pd.totalDivNet)}</div>
    </div>`;

  // Attach info-tips in the freshly-rendered table header
  const portTable = document.getElementById('port-table');
  if (portTable) attachInfoTips(portTable);

  // Bind filter listeners once (Commit 2G: _bound guard prevents stacking)
  const filterToggle = document.getElementById('port-filter-toggle') as HTMLElement & { _bound?: boolean } | null;
  if (filterToggle && !filterToggle._bound) {
    filterToggle._bound = true;
    filterToggle.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-filter]') as HTMLElement | null;
      if (!btn) return;
      _holdingsFilter = btn.dataset.filter || 'held';
      _holdPage = 1;
      renderHoldingsTable(pd, snaps);
    });
  }

  // Row tap-to-expand detail panel (delegated on #port-table)
  const tbl = document.getElementById('port-table') as HTMLElement & { _rowDetail_bound?: boolean } | null;
  if (tbl && !tbl._rowDetail_bound) {
    tbl._rowDetail_bound = true;
    tbl.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest('.hold-row') as HTMLElement | null;
      if (!row) return;
      const existing = tbl.querySelector('.hold-detail') as HTMLElement | null;
      if (existing) {
        const wasThis = existing.previousElementSibling === row;
        existing.remove();
        if (wasThis) return;
      }
      const cell = row.querySelector('.hold-etf-cell') as HTMLElement | null;
      if (!cell) return;
      const isin   = cell.dataset.isin   || '—';
      const active = cell.dataset.active === '1' ? 'Active' : 'Closed';
      const acc    = cell.dataset.acc    === '1' ? 'Accumulating' : 'Distributing';
      const shares = cell.dataset.shares || '—';
      const avg    = cell.dataset.avg || '—';
      const rpnlNum = parseFloat(cell.dataset.rpnl || '0');
      const rpnl = rpnlNum === 0 ? '—' : (rpnlNum > 0 ? '+' : '') + fmtEur2(rpnlNum);
      const rpnlClass = rpnlNum >= 0 ? 'pos' : 'neg';
      const panel  = document.createElement('div');
      panel.className = 'hold-detail';
      panel.innerHTML = `
        <div><span class="hold-detail-label">ISIN</span><span class="hold-detail-value hold-detail-isin">${isin}</span></div>
        <div><span class="hold-detail-label">Status</span><span class="hold-detail-value">${active}</span></div>
        <div><span class="hold-detail-label">Type</span><span class="hold-detail-value">${acc}</span></div>
        <div><span class="hold-detail-label">Shares</span><span class="hold-detail-value">${shares}</span></div>
        <div><span class="hold-detail-label">Avg price</span><span class="hold-detail-value">${avg}</span></div>
        <div><span class="hold-detail-label">Realized P&L</span><span class="hold-detail-value ${rpnlClass}">${rpnl}</span></div>`;
      row.insertAdjacentElement('afterend', panel);
    });
  }

  // Holdings pagination controls
  renderHoldPagination(totalPages, pd, snaps);
}

function renderHoldPagination(totalPages: number, pd: PortfolioData, snaps: Snapshot[]): void {
  const el = document.getElementById('port-pagination');
  if (!el) return;
  if (totalPages <= 1) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `
    <button class="btn btn-sm btn-ghost js-hold-prev" ${_holdPage <= 1 ? 'disabled' : ''}>←</button>
    <span class="page-info">${_holdPage} / ${totalPages}</span>
    <button class="btn btn-sm btn-ghost js-hold-next" ${_holdPage >= totalPages ? 'disabled' : ''}>→</button>
  `;
  el.querySelector('.js-hold-prev')?.addEventListener('click', () => {
    if (_holdPage > 1) { _holdPage--; renderHoldingsTable(pd, snaps); }
  });
  el.querySelector('.js-hold-next')?.addEventListener('click', () => {
    if (_holdPage < totalPages) { _holdPage++; renderHoldingsTable(pd, snaps); }
  });
}

export function renderPortfolio(pd: PortfolioData | null, snaps: Snapshot[]): void {
  const ISIN_ORDER = getISIN_ORDERList();
  const META = getMETAMap();
  const has = pd && Object.keys(pd.etfs).length > 0;
  document.getElementById('port-empty').style.display   = has ? 'none'  : 'block';
  document.getElementById('port-content').style.display = has ? 'block' : 'none';
  if (!has) return;

  _holdPage = 1;

  const latSnap = snaps.length > 0 ? snaps[snaps.length - 1] : null;
  const curVal  = primaryInvestmentValue(latSnap, getAccounts());
  const gain    = curVal !== null ? curVal - pd.totalInv : null;
  const gainPct = gain !== null && pd.totalInv > 0 ? gain / pd.totalInv * 100 : null;

  document.getElementById('port-kpis').innerHTML = `
    <div class="kpi"><div class="kpi-label">Total invested</div><div class="kpi-val">${fmtEur(pd.totalInv)}</div><div class="kpi-sub">net of sells</div></div>
    <div class="kpi"><div class="kpi-label">Current value</div>
      <div class="kpi-val">${curVal !== null ? fmtEur2(curVal) : '—'}</div>
      <div class="kpi-sub">${curVal !== null ? 'from ' + fmtMon(latSnap.date) + ' snapshot' : (latSnap ? 'no primary investment account flagged' : 'add a snapshot')}</div></div>
    <div class="kpi"><div class="kpi-label">Unrealized gain</div>
      <div class="kpi-val ${gain !== null && gain >= 0 ? 'pos' : 'neg'}">${gain !== null ? (gain >= 0 ? '+' : '') + fmtEur2(gain) : '—'}</div>
      <div class="kpi-sub">${gainPct !== null ? (gainPct >= 0 ? '+' : '') + gainPct.toFixed(1) + '%' : ''}</div></div>
    <div class="kpi"><div class="kpi-label">Realized P&amp;L</div>
      <div class="kpi-val ${pd.realizedPnL >= 0 ? 'pos' : 'neg'}">${pd.realizedPnL === 0 ? fmtEur2(0) : (pd.realizedPnL > 0 ? '+' : '') + fmtEur2(pd.realizedPnL)}</div>
      <div class="kpi-sub">from sells</div></div>
  `;

  // Render holdings table (filter-dependent)
  renderHoldingsTable(pd, snaps);

  // Build full ordered ETF list for donut (held positions only)
  const allEtfs = ISIN_ORDER.map(s => pd.etfs[s]).filter(Boolean)
    .concat(Object.values(pd.etfs).filter(e => !ISIN_ORDER.includes(e.symbol)));
  const { held } = splitHoldings(allEtfs);

  // Bar chart — only held positions with cost > 0
  const donutE = held.filter(e => e.cost > 0);
  const C = resolvedT();
  if (CH['c-port-donut']) { CH['c-port-donut'].destroy(); }
  CH['c-port-donut'] = new Chart(document.getElementById('c-port-donut'), {
    type: 'bar',
    data: {
      labels: donutE.map(e => e.ticker),
      datasets: [{ data: donutE.map(e => e.cost),
        backgroundColor: donutE.map(e => safeColor(e.color)),
        borderColor: donutE.map(e => safeColor(e.color)),
        borderWidth: 1, borderRadius: 5, borderSkipped: false }],
    },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: C.surface, borderColor: C.line, borderWidth: 1,
          titleColor: C.ink, bodyColor: C.ink2, padding: 10, cornerRadius: 8,
          callbacks: { label: ctx => ` ${fmtEur(ctx.raw as number)}` },
        },
      },
      scales: {
        x: { grid: { color: C.line }, ticks: { color: C.ink4, callback: (v: number) => '€' + (v / 1000).toFixed(0) + 'k' } },
        y: { grid: { display: false }, ticks: { color: C.ink2, font: { size: 12 } } },
      },
    },
  });
  document.getElementById('port-donut-legend').innerHTML =
    donutE.map(e => `<span class="leg-item"><span class="leg-sq" style="background:${safeColor(e.color)}"></span>${esc(e.ticker)} ${pd.totalInv > 0 ? (e.cost / pd.totalInv * 100).toFixed(0) : 0}%</span>`).join('');

  // TODO Phase: consolidation — populate foldInto on first SELL (IEEM→CMEIU, CECBE+EGB7Y→GABE)
  document.getElementById('port-summary').innerHTML = `
    <div class="row"><div class="row-label">Total invested (net)</div><div class="row-val">${fmtEur(pd.totalInv)}</div></div>
    <div class="row"><div class="row-label">Realized P&amp;L</div><div class="row-val ${pd.realizedPnL >= 0 ? 'ok' : 'neg'}">${pd.realizedPnL === 0 ? fmtEur2(0) : (pd.realizedPnL > 0 ? '+' : '') + fmtEur2(pd.realizedPnL)}</div></div>
    <div class="row"><div class="row-label">Total fees</div><div class="row-val">${fmtEur2(pd.totalFees)}</div></div>
    <div class="row"><div class="row-label">Dividends (net)</div><div class="row-val ok">${fmtEur2(pd.totalDivNet)}</div></div>
    <div class="row"><div class="row-label">Tax withheld on dividends</div><div class="row-val">${fmtEur2(pd.totalTax)}</div></div>
    <div class="row"><div class="row-label">Interest earned</div><div class="row-val ok">${fmtEur2(pd.totalInterest)}</div></div>
    ${gain !== null ? `<div class="row" style="border-top:1px solid var(--line-2);margin-top:4px">
      <div class="row-label" style="font-weight:500">Unrealized gain</div>
      <div class="row-val ${gain >= 0 ? 'pos' : 'neg'}" style="font-weight:500">
        ${gain >= 0 ? '+' : ''}${fmtEur2(gain)} (${gainPct >= 0 ? '+' : ''}${gainPct.toFixed(1)}%)</div></div>` : ''}
    <p class="note">Cost basis exact from CSV. Current value from latest snapshot (${latSnap ? fmtMon(latSnap.date) : 'none yet'}). Mixed-currency positions compute in account currency (no FX conversion).</p>
  `;

  // ── Drift / rebalance card ──
  _renderDriftCard(pd);
}

// ── Drift / rebalance card ──

function _renderDriftCard(pd: PortfolioData): void {
  const driftEl = document.getElementById('port-drift');
  if (!driftEl) return;

  const holdings = getHoldings();
  const drift = computeDrift(holdings, pd.etfs, pd.totalInv);

  if (drift.length === 0) {
    driftEl.innerHTML = '';
    return;
  }

  const max = maxDrift(drift);
  const statusColor = max > 10 ? 'var(--neg)' : max > 5 ? 'var(--warn)' : 'var(--pos)';
  const statusLabel = max > 10 ? 'High drift' : max > 5 ? 'Moderate drift' : 'On target';

  const rows = drift.map(d => {
    const driftColor = d.driftPct > 5 ? 'var(--neg)' : d.driftPct < -5 ? 'var(--neg)' : d.driftPct > 2 ? 'var(--warn)' : d.driftPct < -2 ? 'var(--warn)' : 'var(--pos)';
    return `
      <div class="tbl-row" role="row" style="grid-template-columns:1.5fr 1fr 1fr 1fr 1fr">
        <div role="cell"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${safeColor(d.color)};margin-right:6px"></span>${esc(d.ticker)}</div>
        <div role="cell" style="text-align:right">${d.targetPct.toFixed(1)}%</div>
        <div role="cell" style="text-align:right">${d.actualPct.toFixed(1)}%</div>
        <div role="cell" style="text-align:right;color:${driftColor}" aria-label="Drift ${d.driftPct >= 0 ? '+' : ''}${d.driftPct.toFixed(1)}%">${d.driftPct >= 0 ? '+' : ''}${d.driftPct.toFixed(1)}%</div>
        <div role="cell" style="text-align:right;color:${d.deltaValue >= 0 ? 'var(--ink-3)' : 'var(--ink-2)'}">${d.deltaValue >= 0 ? '+' : ''}${fmtEur(d.deltaValue)}</div>
      </div>`;
  }).join('');

  driftEl.innerHTML = `
    <div class="card">
      <div class="card-title">Allocation drift <span style="font-size:12px;font-weight:400;color:${statusColor};margin-left:8px">${statusLabel} (max ${max.toFixed(1)}%)</span></div>
      <div class="tbl" role="table" aria-label="Allocation drift">
        <div class="tbl-row th" role="row" style="grid-template-columns:1.5fr 1fr 1fr 1fr 1fr">
          <div role="columnheader">ETF</div><div role="columnheader" style="text-align:right">Target</div><div role="columnheader" style="text-align:right">Actual</div><div role="columnheader" style="text-align:right">Drift</div><div role="columnheader" style="text-align:right">Delta</div>
        </div>
        ${rows}
      </div>
      <p class="note" style="margin-top:.5rem">Target derived from contribution weights. Actual from cost basis. Delta = amount to sell/buy to reach target.</p>
    </div>`;
}
