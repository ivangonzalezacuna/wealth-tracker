// @ts-nocheck — DOM-heavy view; full strict typing deferred to framework migration
import { fmtEur, fmtEur2, fmtMon, esc, safeColor } from '../utils';
import { getISIN_ORDERList, getMETAMap } from '../constants';
import { getAccounts, getHoldings } from '../store/config';
import { primaryInvestmentValue } from '../model/accounts';
import { splitHoldings } from '../model/holdings';
import { computeDrift, maxDrift } from '../model/drift';
import type { PortfolioData, Snapshot, EtfPosition } from '../types';
import Chart from 'chart.js/auto';
import { T, resolvedT } from '../theme';

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

  const gridCols = 'grid-template-columns:2.2fr 1fr 1fr 1fr 1fr 1fr 1fr';

  const rows = pageItems.map(e => {
    const pct = pd.totalInv > 0 ? e.cost / pd.totalInv * 100 : 0;
    const avg = e.shares > 0 ? e.cost / e.shares : 0;
    const m   = META[e.ticker] || {};
    const isExited = e.exited || e.shares < 1e-6;
    const rpnl = e.realizedPnL || 0;

    return `<div class="tbl-row" role="row" style="${gridCols}${isExited ? ';opacity:0.6' : ''}">
      <div role="cell" class="ticker-cell" data-isin="${esc(e.symbol)}">
        <span style="font-weight:500;font-size:12px">${esc(e.ticker)}</span>
        ${isExited
          ? '<span class="badge b-closed" style="margin-left:4px">exited</span>'
          : `<span class="badge ${m.active ? 'b-active' : 'b-closed'}" style="margin-left:4px">${m.active ? 'active' : 'closed'}</span>`}
        <span class="badge ${e.acc ? 'b-acc' : 'b-dist'}" style="margin-left:4px">${e.acc ? 'Acc' : 'Dist'}</span>
      </div>
      <div role="cell"><div style="font-weight:500">${fmtEur(e.cost)}</div>
        ${!isExited ? `<div class="bar-wrap" style="max-width:80px"><div class="bar-fill" style="width:${pct.toFixed(0)}%;background:${safeColor(e.color)}"></div></div>` : ''}
      </div>
      <div role="cell" style="color:${T.ink2}">${e.shares.toFixed(4)}</div>
      <div role="cell" style="color:${T.ink2}">${avg > 0 ? '\u20AC' + avg.toFixed(2) : '—'}</div>
      <div role="cell" style="color:${T.ink2}">${pct.toFixed(1)}%</div>
      <div role="cell" style="color:${rpnl >= 0 ? T.pos : T.neg}" aria-label="Realized P&L ${rpnl !== 0 ? (rpnl >= 0 ? '+' : '') + rpnl.toFixed(2) : 'none'}">${rpnl !== 0 ? (rpnl >= 0 ? '+' : '') + fmtEur2(rpnl) : '—'}</div>
      <div role="cell" style="color:${e.divNet > 0 ? T.pos : T.ink3}">${e.divNet > 0 ? fmtEur2(e.divNet) : '—'}</div>
    </div>`;
  }).join('');

  document.getElementById('port-table').innerHTML = `
    ${filterHtml}
    <div class="tbl-row th" role="row" style="${gridCols}">
      <div role="columnheader">ETF</div><div role="columnheader">Cost basis</div><div role="columnheader">Shares</div><div role="columnheader">Avg price</div><div role="columnheader">% of cost</div><div role="columnheader">Realized P&amp;L</div><div role="columnheader">Div (net)</div>
    </div>${rows}
    <div class="tbl-row" role="row" style="${gridCols};border-top:1px solid ${T.line2};margin-top:4px">
      <div style="font-weight:500">Total</div>
      <div style="font-weight:500">${fmtEur(pd.totalInv)}</div>
      <div></div><div></div>
      <div style="font-weight:500">100%</div>
      <div style="color:${pd.realizedPnL >= 0 ? T.pos : T.neg};font-weight:500">${(pd.realizedPnL >= 0 ? '+' : '') + fmtEur2(pd.realizedPnL)}</div>
      <div style="color:${T.pos};font-weight:500">${fmtEur2(pd.totalDivNet)}</div>
    </div>`;

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

  // ISIN tap-to-reveal (delegated on #port-table)
  const table = document.getElementById('port-table') as HTMLElement & { _isinReveal_bound?: boolean } | null;
  if (table && !table._isinReveal_bound) {
    table._isinReveal_bound = true;
    table.addEventListener('click', (e) => {
      const cell = (e.target as HTMLElement).closest('.ticker-cell') as HTMLElement | null;
      const existing = table.querySelector('.isin-reveal') as HTMLElement | null;
      const wasThisCell = existing && cell && existing.parentElement === cell;
      existing?.remove();
      if (cell && !wasThisCell) {
        const isin = cell.dataset.isin;
        if (isin) {
          const span = document.createElement('span');
          span.className = 'isin-reveal';
          span.textContent = isin;
          cell.appendChild(span);
        }
      }
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
      <div class="kpi-val ${pd.realizedPnL >= 0 ? 'pos' : 'neg'}">${(pd.realizedPnL >= 0 ? '+' : '') + fmtEur2(pd.realizedPnL)}</div>
      <div class="kpi-sub">from sells</div></div>
  `;

  // Render holdings table (filter-dependent)
  renderHoldingsTable(pd, snaps);

  // Build full ordered ETF list for donut (held positions only)
  const allEtfs = ISIN_ORDER.map(s => pd.etfs[s]).filter(Boolean)
    .concat(Object.values(pd.etfs).filter(e => !ISIN_ORDER.includes(e.symbol)));
  const { held } = splitHoldings(allEtfs);

  // Donut chart — only held positions with cost > 0
  const donutE = held.filter(e => e.cost > 0);
  const C = resolvedT();
  if (CH['c-port-donut']) { CH['c-port-donut'].destroy(); }
  CH['c-port-donut'] = new Chart(document.getElementById('c-port-donut'), {
    type: 'doughnut',
    data: { labels: donutE.map(e => e.ticker), datasets: [{
      data: donutE.map(e => e.cost), backgroundColor: donutE.map(e => safeColor(e.color)),
      borderWidth: 2, borderColor: C.surface,
    }]},
    options: { responsive: true, maintainAspectRatio: false, cutout: '72%', plugins: { legend: { display: false } } },
  });
  document.getElementById('port-donut-legend').innerHTML =
    donutE.map(e => `<span class="leg-item"><span class="leg-sq" style="background:${safeColor(e.color)}"></span>${esc(e.ticker)} ${pd.totalInv > 0 ? (e.cost / pd.totalInv * 100).toFixed(0) : 0}%</span>`).join('');

  // TODO Phase: consolidation — populate foldInto on first SELL (IEEM→CMEIU, CECBE+EGB7Y→GABE)
  document.getElementById('port-summary').innerHTML = `
    <div class="row"><div class="row-label">Total invested (net)</div><div class="row-val">${fmtEur(pd.totalInv)}</div></div>
    <div class="row"><div class="row-label">Realized P&amp;L</div><div class="row-val ${pd.realizedPnL >= 0 ? 'ok' : 'neg'}">${(pd.realizedPnL >= 0 ? '+' : '') + fmtEur2(pd.realizedPnL)}</div></div>
    <div class="row"><div class="row-label">Total fees</div><div class="row-val">${fmtEur2(pd.totalFees)}</div></div>
    <div class="row"><div class="row-label">Dividends (net)</div><div class="row-val ok">${fmtEur2(pd.totalDivNet)}</div></div>
    <div class="row"><div class="row-label">Tax withheld on dividends</div><div class="row-val">${fmtEur2(pd.totalTax)}</div></div>
    <div class="row"><div class="row-label">Interest earned</div><div class="row-val ok">${fmtEur2(pd.totalInterest)}</div></div>
    ${gain !== null ? `<div class="row" style="border-top:1px solid ${T.line2};margin-top:4px">
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
  const statusColor = max > 10 ? T.neg : max > 5 ? T.warn : T.pos;
  const statusLabel = max > 10 ? 'High drift' : max > 5 ? 'Moderate drift' : 'On target';

  const rows = drift.map(d => {
    const driftColor = d.driftPct > 5 ? T.neg : d.driftPct < -5 ? T.neg : d.driftPct > 2 ? T.warn : d.driftPct < -2 ? T.warn : T.pos;
    return `
      <div class="tbl-row" role="row" style="grid-template-columns:1.5fr 1fr 1fr 1fr 1fr">
        <div role="cell"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${safeColor(d.color)};margin-right:6px"></span>${esc(d.ticker)}</div>
        <div role="cell" style="text-align:right">${d.targetPct.toFixed(1)}%</div>
        <div role="cell" style="text-align:right">${d.actualPct.toFixed(1)}%</div>
        <div role="cell" style="text-align:right;color:${driftColor}" aria-label="Drift ${d.driftPct >= 0 ? '+' : ''}${d.driftPct.toFixed(1)}%">${d.driftPct >= 0 ? '+' : ''}${d.driftPct.toFixed(1)}%</div>
        <div role="cell" style="text-align:right;color:${d.deltaValue >= 0 ? T.ink3 : T.ink2}">${d.deltaValue >= 0 ? '+' : ''}${fmtEur(d.deltaValue)}</div>
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
