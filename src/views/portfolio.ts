// @ts-nocheck — DOM-heavy view; full strict typing deferred to framework migration
import { fmt, fmtMon, esc, safeColor } from '../utils';
import { getISIN_ORDERList, getMETAMap } from '../constants';
import { getPrimaryInvestmentAccounts } from '../store/config';
import { splitHoldings } from '../model/holdings';
import type { PortfolioData, Snapshot, EtfPosition } from '../types';
import Chart from 'chart.js/auto';

const CH: Record<string, Chart> = {};

// Module-level filter state (survives re-renders)
let _showExited = false;
let _holdingsFilter = 'held'; // 'held' | 'closed' | 'all'

/** Get the current market value of the primary investment account from a snapshot. */
function getPrimaryInvestmentValue(snap: Snapshot | null): number | null {
  if (!snap) return null;
  const primAccts = getPrimaryInvestmentAccounts();
  if (primAccts.length > 0) {
    return primAccts.reduce((sum, a) => sum + ((snap[a.id || ''] as number) || 0), 0) || null;
  }
  return null;
}

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

  const rows = displayList.map(e => {
    const pct = pd.totalInv > 0 ? e.cost / pd.totalInv * 100 : 0;
    const avg = e.shares > 0 ? e.cost / e.shares : 0;
    const m   = META[e.ticker] || {};
    const isExited = e.exited || e.shares < 1e-6;
    const rpnl = e.realizedPnL || 0;

    return `<div class="tbl-row" style="${gridCols}${isExited ? ';opacity:0.6' : ''}">
      <div>
        <span style="font-weight:500;font-size:12px">${esc(e.ticker)}</span>
        ${isExited
          ? '<span class="badge b-closed" style="margin-left:4px">exited</span>'
          : `<span class="badge ${m.active ? 'b-active' : 'b-closed'}" style="margin-left:4px">${m.active ? 'active' : 'closed'}</span>`}
        <span class="badge ${e.acc ? 'b-acc' : 'b-dist'}" style="margin-left:4px">${e.acc ? 'Acc' : 'Dist'}</span>
        <div style="font-size:11px;color:#6b6a65">${esc(e.symbol)}</div>
      </div>
      <div><div style="font-weight:500">${fmt(e.cost)}</div>
        ${!isExited ? `<div class="bar-wrap" style="max-width:80px"><div class="bar-fill" style="width:${pct.toFixed(0)}%;background:${safeColor(e.color)}"></div></div>` : ''}
      </div>
      <div style="color:#52514e">${e.shares.toFixed(4)}</div>
      <div style="color:#52514e">${avg > 0 ? '\u20AC' + avg.toFixed(2) : '—'}</div>
      <div style="color:#52514e">${pct.toFixed(1)}%</div>
      <div style="color:${rpnl >= 0 ? '#0F6E56' : '#A32D2D'}">${rpnl !== 0 ? (rpnl >= 0 ? '+' : '') + fmt(rpnl, 2) : '—'}</div>
      <div style="color:${e.divNet > 0 ? '#0F6E56' : '#6b6a65'}">${e.divNet > 0 ? fmt(e.divNet, 2) : '—'}</div>
    </div>`;
  }).join('');

  document.getElementById('port-table').innerHTML = `
    ${filterHtml}
    <div class="tbl-row th" style="${gridCols}">
      <div>ETF</div><div>Cost basis</div><div>Shares</div><div>Avg price</div><div>% of cost</div><div>Realized P&amp;L</div><div>Div (net)</div>
    </div>${rows}
    <div class="tbl-row" style="${gridCols};border-top:1px solid #d3d1c7;margin-top:4px">
      <div style="font-weight:500">Total</div>
      <div style="font-weight:500">${fmt(pd.totalInv)}</div>
      <div></div><div></div>
      <div style="font-weight:500">100%</div>
      <div style="color:${pd.realizedPnL >= 0 ? '#0F6E56' : '#A32D2D'};font-weight:500">${(pd.realizedPnL >= 0 ? '+' : '') + fmt(pd.realizedPnL, 2)}</div>
      <div style="color:#0F6E56;font-weight:500">${fmt(pd.totalDivNet, 2)}</div>
    </div>`;

  // Bind filter listeners once (Commit 2G: _bound guard prevents stacking)
  const filterToggle = document.getElementById('port-filter-toggle') as HTMLElement & { _bound?: boolean } | null;
  if (filterToggle && !filterToggle._bound) {
    filterToggle._bound = true;
    filterToggle.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-filter]') as HTMLElement | null;
      if (!btn) return;
      _holdingsFilter = btn.dataset.filter || 'held';
      renderHoldingsTable(pd, snaps);
    });
  }
}

export function renderPortfolio(pd: PortfolioData | null, snaps: Snapshot[]): void {
  const ISIN_ORDER = getISIN_ORDERList();
  const META = getMETAMap();
  const has = pd && Object.keys(pd.etfs).length > 0;
  document.getElementById('port-empty').style.display   = has ? 'none'  : 'block';
  document.getElementById('port-content').style.display = has ? 'block' : 'none';
  if (!has) return;

  const latSnap = snaps.length > 0 ? snaps[snaps.length - 1] : null;
  const curVal  = getPrimaryInvestmentValue(latSnap);
  const gain    = curVal !== null ? curVal - pd.totalInv : null;
  const gainPct = gain !== null && pd.totalInv > 0 ? gain / pd.totalInv * 100 : null;

  document.getElementById('port-kpis').innerHTML = `
    <div class="kpi"><div class="kpi-label">Total invested</div><div class="kpi-val">${fmt(pd.totalInv)}</div><div class="kpi-sub">net of sells</div></div>
    <div class="kpi"><div class="kpi-label">Current value</div>
      <div class="kpi-val">${curVal !== null ? fmt(curVal) : '—'}</div>
      <div class="kpi-sub">${curVal !== null ? 'from ' + fmtMon(latSnap.date) + ' snapshot' : 'add a snapshot'}</div></div>
    <div class="kpi"><div class="kpi-label">Unrealized gain</div>
      <div class="kpi-val ${gain !== null && gain >= 0 ? 'pos' : 'neg'}">${gain !== null ? (gain >= 0 ? '+' : '') + fmt(gain) : '—'}</div>
      <div class="kpi-sub">${gainPct !== null ? (gainPct >= 0 ? '+' : '') + gainPct.toFixed(1) + '%' : ''}</div></div>
    <div class="kpi"><div class="kpi-label">Realized P&amp;L</div>
      <div class="kpi-val ${pd.realizedPnL >= 0 ? 'pos' : 'neg'}">${(pd.realizedPnL >= 0 ? '+' : '') + fmt(pd.realizedPnL, 2)}</div>
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
  if (CH['c-port-donut']) { CH['c-port-donut'].destroy(); }
  CH['c-port-donut'] = new Chart(document.getElementById('c-port-donut'), {
    type: 'doughnut',
    data: { labels: donutE.map(e => e.ticker), datasets: [{
      data: donutE.map(e => e.cost), backgroundColor: donutE.map(e => e.color),
      borderWidth: 3, borderColor: '#fff',
    }]},
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
  });
  document.getElementById('port-donut-legend').innerHTML =
    donutE.map(e => `<span class="leg-item"><span class="leg-sq" style="background:${safeColor(e.color)}"></span>${esc(e.ticker)} ${pd.totalInv > 0 ? (e.cost / pd.totalInv * 100).toFixed(0) : 0}%</span>`).join('');

  // TODO Phase: consolidation — populate foldInto on first SELL (IEEM→CMEIU, CECBE+EGB7Y→GABE)
  document.getElementById('port-summary').innerHTML = `
    <div class="row"><div class="row-label">Total invested (net)</div><div class="row-val">${fmt(pd.totalInv)}</div></div>
    <div class="row"><div class="row-label">Realized P&amp;L</div><div class="row-val ${pd.realizedPnL >= 0 ? 'ok' : 'neg'}">${(pd.realizedPnL >= 0 ? '+' : '') + fmt(pd.realizedPnL, 2)}</div></div>
    <div class="row"><div class="row-label">Total fees</div><div class="row-val">${fmt(pd.totalFees, 2)}</div></div>
    <div class="row"><div class="row-label">Dividends (net)</div><div class="row-val ok">${fmt(pd.totalDivNet, 2)}</div></div>
    <div class="row"><div class="row-label">Tax withheld on dividends</div><div class="row-val">${fmt(pd.totalTax, 2)}</div></div>
    <div class="row"><div class="row-label">Interest earned</div><div class="row-val ok">${fmt(pd.totalInterest, 2)}</div></div>
    ${gain !== null ? `<div class="row" style="border-top:1px solid #d3d1c7;margin-top:4px">
      <div class="row-label" style="font-weight:500">Unrealized gain</div>
      <div class="row-val ${gain >= 0 ? 'pos' : 'neg'}" style="font-weight:500">
        ${gain >= 0 ? '+' : ''}${fmt(gain)} (${gainPct >= 0 ? '+' : ''}${gainPct.toFixed(1)}%)</div></div>` : ''}
    <p class="note">Cost basis exact from CSV. Current value from latest snapshot (${latSnap ? fmtMon(latSnap.date) : 'none yet'}). Mixed-currency positions compute in account currency (no FX conversion).</p>
  `;
}
