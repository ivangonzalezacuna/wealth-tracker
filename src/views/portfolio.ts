// @ts-nocheck - DOM-heavy view; full strict typing deferred to framework migration
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
import type { SortState } from './tableSort';
import { applySort, sortableHeader, bindSortableHeader } from './tableSort';
import { renderPagination } from './pagination';
import type { ColumnDef } from './tableColumns';
import { renderTableHeader, renderTableRow, getSortGetters } from './tableColumns';

const CH: Record<string, Chart> = {};

// Module-level filter state (survives re-renders)
let _showExited = false;
let _holdingsFilter = 'held'; // 'held' | 'closed' | 'all'
const HOLD_PAGE_SIZE = 10;
let _holdPage = 1;
let _holdSort: SortState = { key: null, dir: null };

// mobile-visible column count must match styles.css's #port-table mobile grid-template-columns track count
/** Single source of truth for the Holdings table's columns: header label,
 *  alignment, sort behavior, InfoTip, mobile visibility, and cell content
 *  are all declared once here instead of independently in three separate
 *  hand-written template strings. `detail: true` marks a column whose value
 *  also belongs in the tap-to-expand detail panel -- this prevents a repeat
 *  of Phase 27a's bug where Realized P&L was silently missing because nothing
 *  forced the two to stay in sync. */
function holdingsColumns(pd: PortfolioData): ColumnDef<EtfPosition>[] {
  const META = getMETAMap();
  return [
    {
      key: 'ticker',
      label: 'ETF',
      sortValue: (e) => e.ticker || '',
      cellClass: () => 'hold-etf-cell',
      cell: (e) => {
        const m = META[e.ticker] || {};
        const isExited = e.exited || e.shares < 1e-6;
        return `<span class="hold-ticker">${esc(e.ticker)}</span><span class="hold-dot" style="background:${safeColor(e.color)};opacity:${isExited ? '0.45' : '1'}"></span>`;
      },
    },
    {
      key: 'cost',
      label: 'Cost basis',
      align: 'right',
      sortValue: (e) => e.cost || 0,
      tip: 'Total amount invested (net of sells). Calculated from your imported CSV transactions using the method chosen in Settings.',
      cellAttrs: (e) => 'style="text-align:right;font-weight:500"',
      cell: (e) => {
        const pct = pd.totalInv > 0 ? (e.cost / pd.totalInv) * 100 : 0;
        const isExited = e.exited || e.shares < 1e-6;
        return `${fmtEur(e.cost)}${!isExited ? `\n        <div class="bar-wrap"><div class="bar-fill" style="width:${pct.toFixed(0)}%;background:${safeColor(e.color)}"></div></div>` : ''}`;
      },
    },
    {
      key: 'shares',
      label: 'Shares',
      align: 'right',
      mobileHidden: true,
      detail: true,
      sortValue: (e) => e.shares || 0,
      cellAttrs: () => 'style="text-align:right;color:var(--ink-2)"',
      cell: (e) => fmtShares(e.shares),
    },
    {
      key: 'avgPrice',
      label: 'Avg price',
      align: 'right',
      mobileHidden: true,
      detail: true,
      sortValue: (e) => (e.shares > 0 ? e.cost / e.shares : 0),
      cellAttrs: () => 'style="text-align:right;color:var(--ink-2)"',
      cell: (e) => {
        const avg = e.shares > 0 ? e.cost / e.shares : 0;
        return avg > 0 ? fmtEur2(avg) : '-';
      },
    },
    {
      key: 'pctOfCost',
      label: '% of cost',
      align: 'right',
      sortValue: (e) => (pd.totalInv > 0 ? e.cost / pd.totalInv : 0),
      cellAttrs: () => 'style="text-align:right;color:var(--ink-2)"',
      cell: (e) => (pd.totalInv > 0 ? (e.cost / pd.totalInv) * 100 : 0).toFixed(1) + '%',
    },
    {
      key: 'realizedPnL',
      label: 'Realized P&amp;L',
      align: 'right',
      mobileHidden: true,
      detail: true,
      sortValue: (e) => e.realizedPnL || 0,
      tip: 'Gain or loss already locked in from shares you have sold (proceeds minus their cost basis, fees included). Separate from unrealized gain on shares still held. Changes if you switch the cost-basis method in Settings.',
      cellAttrs: (e) => {
        const rpnl = e.realizedPnL || 0;
        return `style="text-align:right;color:${rpnl >= 0 ? 'var(--pos)' : 'var(--neg)'}" aria-label="Realized P&L ${rpnl !== 0 ? (rpnl >= 0 ? '+' : '') + rpnl.toFixed(2) : 'none'}"`;
      },
      cell: (e) => {
        const rpnl = e.realizedPnL || 0;
        return rpnl === 0 ? '-' : (rpnl > 0 ? '+' : '') + fmtEur2(rpnl);
      },
    },
    {
      key: 'divNet',
      label: 'Div (net)',
      align: 'right',
      sortValue: (e) => e.divNet || 0,
      cellAttrs: (e) =>
        `style="text-align:right;color:${e.divNet > 0 ? 'var(--pos)' : 'var(--ink-3)'}"`,
      cell: (e) => (e.divNet > 0 ? fmtEur2(e.divNet) : '-'),
    },
  ];
}

/**
 * Render only the holdings table (filter-dependent portion).
 * Called on filter toggle without recreating the donut, KPIs, or summary.
 */
function renderHoldingsTable(pd: PortfolioData, snaps: Snapshot[]): void {
  const ISIN_ORDER = getISIN_ORDERList();
  const META = getMETAMap();
  const columns = holdingsColumns(pd);

  // Build full ordered ETF list
  const allEtfs = ISIN_ORDER.map((s) => pd.etfs[s])
    .filter(Boolean)
    .concat(Object.values(pd.etfs).filter((e) => !ISIN_ORDER.includes(e.symbol)));

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

  // Apply sort (before pagination)
  const sorted = applySort(displayList, _holdSort, getSortGetters(columns));

  // Pagination
  const totalPages = Math.ceil(sorted.length / HOLD_PAGE_SIZE);
  if (_holdPage > totalPages) _holdPage = Math.max(1, totalPages);
  const pageItems = sorted.slice((_holdPage - 1) * HOLD_PAGE_SIZE, _holdPage * HOLD_PAGE_SIZE);
  const pageItemsByKey = new Map(pageItems.map((e) => [e.symbol, e]));

  // Filter controls
  const filterHtml = `
    <div class="filter-bar" style="margin-bottom:8px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
      <div class="range-toggle" id="port-filter-toggle">
        <button class="btn btn-sm btn-ghost ${_holdingsFilter === 'held' ? 'active' : ''}" data-filter="held">Held</button>
        <button class="btn btn-sm btn-ghost ${_holdingsFilter === 'closed' ? 'active' : ''}" data-filter="closed">Closed${exitedCount > 0 ? ' (' + exitedCount + ')' : ''}</button>
        <button class="btn btn-sm btn-ghost ${_holdingsFilter === 'all' ? 'active' : ''}" data-filter="all">All</button>
      </div>
    </div>`;

  const rows = pageItems
    .map((e) => {
      const isExited = e.exited || e.shares < 1e-6;
      return `<div class="tbl-row hold-row" role="row"${isExited ? ' style="opacity:0.6"' : ''} data-etf-key="${esc(e.symbol)}">
    ${renderTableRow(columns, e)}
  </div>`;
    })
    .join('');

  document.getElementById('port-table').innerHTML = `
    ${filterHtml}
    <div class="hold-grid">
      <div class="tbl-row th hold-row" role="row" id="port-table-header">
        ${renderTableHeader(columns, _holdSort)}
      </div>${rows}
      <div class="tbl-row hold-total" role="row" style="border-top:1px solid var(--line-2);margin-top:4px">
        <div style="font-weight:500">Total</div>
        <div style="font-weight:500;text-align:right">${fmtEur(pd.totalInv)}</div>
        <div></div><div></div>
        <div style="font-weight:500;text-align:right">100%</div>
        <div style="text-align:right;color:${pd.realizedPnL >= 0 ? 'var(--pos)' : 'var(--neg)'};font-weight:500">${pd.realizedPnL === 0 ? fmtEur2(0) : (pd.realizedPnL > 0 ? '+' : '') + fmtEur2(pd.realizedPnL)}</div>
        <div style="text-align:right;color:var(--pos);font-weight:500">${fmtEur2(pd.totalDivNet)}</div>
      </div>
    </div>`;

  // Attach info-tips in the freshly-rendered table header
  const portTable = document.getElementById('port-table');
  if (portTable) attachInfoTips(portTable);

  // Bind sort handler on header row
  const holdHeaderEl = document.getElementById('port-table-header');
  if (holdHeaderEl) {
    bindSortableHeader(holdHeaderEl, _holdSort, (newState) => {
      _holdSort = newState;
      _holdPage = 1;
      renderHoldingsTable(pd, snaps);
    });
  }

  // Bind filter listeners once (Commit 2G: _bound guard prevents stacking)
  const filterToggle = document.getElementById('port-filter-toggle') as
    (HTMLElement & { _bound?: boolean }) | null;
  if (filterToggle && !filterToggle._bound) {
    filterToggle._bound = true;
    filterToggle.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-filter]') as HTMLElement | null;
      if (!btn) return;
      _holdingsFilter = btn.dataset.filter || 'held';
      _holdPage = 1;
      _holdSort = { key: null, dir: null };
      renderHoldingsTable(pd, snaps);
    });
  }

  // Row tap-to-expand detail panel (delegated on #port-table)
  const tbl = document.getElementById('port-table') as
    (HTMLElement & { _rowDetail_bound?: boolean }) | null;
  if (tbl && !tbl._rowDetail_bound) {
    tbl._rowDetail_bound = true;
    tbl.addEventListener('click', (ev) => {
      const row = (ev.target as HTMLElement).closest('.hold-row') as HTMLElement | null;
      if (!row) return;
      const existing = tbl.querySelector('.hold-detail') as HTMLElement | null;
      if (existing) {
        const wasThis = existing.previousElementSibling === row;
        existing.remove();
        if (wasThis) return;
      }
      const etfKey = row.dataset.etfKey;
      const e = etfKey ? pageItemsByKey.get(etfKey) : undefined;
      if (!e) return;
      const meta = getMETAMap()[e.ticker] || {};
      const active = meta.active ? 'Active' : 'Closed';
      const acc = e.acc ? 'Accumulating' : 'Distributing';
      const detailCols = columns.filter((c) => c.detail);
      const detailColRows = detailCols
        .map((c) => {
          const value = c.cell ? c.cell(e) : '';
          const rpnl = e.realizedPnL || 0;
          const valueClass = c.key === 'realizedPnL' ? (rpnl >= 0 ? ' pos' : ' neg') : '';
          const rowClass = c.mobileHidden ? ' class="hold-detail-mobile-only"' : '';
          return `<div${rowClass}><span class="hold-detail-label">${c.label}</span><span class="hold-detail-value${valueClass}">${value}</span></div>`;
        })
        .join('');
      const panel = document.createElement('div');
      panel.className = 'hold-detail';
      panel.innerHTML = `
        <div><span class="hold-detail-label">ISIN</span><span class="hold-detail-value hold-detail-isin">${esc(e.symbol)}</span></div>
        <div><span class="hold-detail-label">Status</span><span class="hold-detail-value">${active}</span></div>
        <div><span class="hold-detail-label">Type</span><span class="hold-detail-value">${acc}</span></div>
        ${detailColRows}`;
      row.insertAdjacentElement('afterend', panel);
    });
  }

  // Holdings pagination controls
  renderHoldPagination(totalPages, pd, snaps);
}

function renderHoldPagination(totalPages: number, pd: PortfolioData, snaps: Snapshot[]): void {
  renderPagination('port-pagination', _holdPage, totalPages, (p) => {
    _holdPage = p;
    renderHoldingsTable(pd, snaps);
  });
}

export function renderPortfolio(pd: PortfolioData | null, snaps: Snapshot[]): void {
  const ISIN_ORDER = getISIN_ORDERList();
  const META = getMETAMap();
  const has = pd && Object.keys(pd.etfs).length > 0;
  document.getElementById('port-empty').style.display = has ? 'none' : 'block';
  document.getElementById('port-content').style.display = has ? 'block' : 'none';
  if (!has) return;

  _holdPage = 1;

  const latSnap = snaps.length > 0 ? snaps[snaps.length - 1] : null;
  const curVal = primaryInvestmentValue(latSnap, getAccounts());
  const gain = curVal !== null ? curVal - pd.totalInv : null;
  const gainPct = gain !== null && pd.totalInv > 0 ? (gain / pd.totalInv) * 100 : null;

  document.getElementById('port-kpis').innerHTML = `
    <div class="kpi"><div class="kpi-label">Total invested</div><div class="kpi-val">${fmtEur(pd.totalInv)}</div><div class="kpi-sub">net of sells</div></div>
    <div class="kpi"><div class="kpi-label">Current value</div>
      <div class="kpi-val">${curVal !== null ? fmtEur2(curVal) : '-'}</div>
      <div class="kpi-sub">${curVal !== null ? 'from ' + fmtMon(latSnap.date) + ' snapshot' : latSnap ? 'no primary investment account flagged' : 'add a snapshot'}</div></div>
    <div class="kpi"><div class="kpi-label">Unrealized gain</div>
      <div class="kpi-val ${gain !== null && gain >= 0 ? 'pos' : 'neg'}">${gain !== null ? (gain >= 0 ? '+' : '') + fmtEur2(gain) : '-'}</div>
      <div class="kpi-sub">${gainPct !== null ? (gainPct >= 0 ? '+' : '') + gainPct.toFixed(1) + '%' : ''}</div></div>
    <div class="kpi"><div class="kpi-label">Realized P&amp;L${infoTip('Gain or loss already locked in from shares you have sold. Distinct from the unrealized gain on positions you still hold.')}</div>
      <div class="kpi-val ${pd.realizedPnL >= 0 ? 'pos' : 'neg'}">${pd.realizedPnL === 0 ? fmtEur2(0) : (pd.realizedPnL > 0 ? '+' : '') + fmtEur2(pd.realizedPnL)}</div>
      <div class="kpi-sub">from sells</div></div>
  `;

  // Attach info-tips in the KPI row
  const portKpis = document.getElementById('port-kpis');
  if (portKpis) attachInfoTips(portKpis);

  // Render holdings table (filter-dependent)
  renderHoldingsTable(pd, snaps);

  // Build full ordered ETF list for donut (held positions only)
  const allEtfs = ISIN_ORDER.map((s) => pd.etfs[s])
    .filter(Boolean)
    .concat(Object.values(pd.etfs).filter((e) => !ISIN_ORDER.includes(e.symbol)));
  const { held } = splitHoldings(allEtfs);

  // Bar chart - only held positions with cost > 0
  const donutE = held.filter((e) => e.cost > 0);
  const C = resolvedT();
  if (CH['c-port-donut']) {
    CH['c-port-donut'].destroy();
  }
  CH['c-port-donut'] = new Chart(document.getElementById('c-port-donut'), {
    type: 'bar',
    data: {
      labels: donutE.map((e) => e.ticker),
      datasets: [
        {
          data: donutE.map((e) => e.cost),
          backgroundColor: donutE.map((e) => safeColor(e.color)),
          borderColor: donutE.map((e) => safeColor(e.color)),
          borderWidth: 1,
          borderRadius: 5,
          borderSkipped: false,
        },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: C.surface,
          borderColor: C.line,
          borderWidth: 1,
          titleColor: C.ink,
          bodyColor: C.ink2,
          padding: 10,
          cornerRadius: 8,
          callbacks: { label: (ctx) => ` ${fmtEur(ctx.raw as number)}` },
        },
      },
      scales: {
        x: {
          grid: { color: C.line },
          ticks: { color: C.ink4, callback: (v: number) => '€' + (v / 1000).toFixed(0) + 'k' },
        },
        y: { grid: { display: false }, ticks: { color: C.ink2, font: { size: 12 } } },
      },
    },
  });
  document.getElementById('port-donut-legend').innerHTML = donutE
    .map(
      (e) =>
        `<span class="leg-item"><span class="leg-sq" style="background:${safeColor(e.color)}"></span>${esc(e.ticker)} ${pd.totalInv > 0 ? ((e.cost / pd.totalInv) * 100).toFixed(0) : 0}%</span>`,
    )
    .join('');

  // TODO Phase: consolidation - populate foldInto on first SELL (IEEM→CMEIU, CECBE+EGB7Y→GABE)
  document.getElementById('port-summary').innerHTML = `
    <div class="row"><div class="row-label">Total invested (net)</div><div class="row-val">${fmtEur(pd.totalInv)}</div></div>
    <div class="row"><div class="row-label">Realized P&amp;L</div><div class="row-val ${pd.realizedPnL >= 0 ? 'ok' : 'neg'}">${pd.realizedPnL === 0 ? fmtEur2(0) : (pd.realizedPnL > 0 ? '+' : '') + fmtEur2(pd.realizedPnL)}</div></div>
    <div class="row"><div class="row-label">Total fees</div><div class="row-val">${fmtEur2(pd.totalFees)}</div></div>
    <div class="row"><div class="row-label">Dividends (net)</div><div class="row-val ok">${fmtEur2(pd.totalDivNet)}</div></div>
    <div class="row"><div class="row-label">Tax withheld on dividends</div><div class="row-val">${fmtEur2(pd.totalTax)}</div></div>
    <div class="row"><div class="row-label">Interest earned</div><div class="row-val ok">${fmtEur2(pd.totalInterest)}</div></div>
    ${
      gain !== null
        ? `<div class="row" style="border-top:1px solid var(--line-2);margin-top:4px">
      <div class="row-label" style="font-weight:500">Unrealized gain</div>
      <div class="row-val ${gain >= 0 ? 'pos' : 'neg'}" style="font-weight:500">
        ${gain >= 0 ? '+' : ''}${fmtEur2(gain)} (${gainPct >= 0 ? '+' : ''}${gainPct.toFixed(1)}%)</div></div>`
        : ''
    }
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

  const rows = drift
    .map((d) => {
      const driftColor =
        d.driftPct > 5
          ? 'var(--neg)'
          : d.driftPct < -5
            ? 'var(--neg)'
            : d.driftPct > 2
              ? 'var(--warn)'
              : d.driftPct < -2
                ? 'var(--warn)'
                : 'var(--pos)';
      return `
      <div class="tbl-row" role="row" style="grid-template-columns:1.5fr 1fr 1fr 1fr 1fr">
        <div role="cell"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${safeColor(d.color)};margin-right:6px"></span>${esc(d.ticker)}</div>
        <div role="cell" style="text-align:right">${d.targetPct.toFixed(1)}%</div>
        <div role="cell" style="text-align:right">${d.actualPct.toFixed(1)}%</div>
        <div role="cell" style="text-align:right;color:${driftColor}" aria-label="Drift ${d.driftPct >= 0 ? '+' : ''}${d.driftPct.toFixed(1)}%">${d.driftPct >= 0 ? '+' : ''}${d.driftPct.toFixed(1)}%</div>
        <div role="cell" style="text-align:right;color:${d.deltaValue >= 0 ? 'var(--ink-3)' : 'var(--ink-2)'}">${d.deltaValue >= 0 ? '+' : ''}${fmtEur(d.deltaValue)}</div>
      </div>`;
    })
    .join('');

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
