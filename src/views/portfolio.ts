import {
  fmtEur,
  fmtEur2,
  fmtMon,
  fmtShares,
  fmtEurNeg,
  fmtPctNeg,
  fmtEurSigned,
  fmtPctSigned,
  fmtPctVal,
  esc,
  safeColor,
  kpiTile,
} from '../utils';
import { getISIN_ORDERList, getMETAMap } from '../constants';
import { getAccounts, getHoldings } from '../store/config';
import { primaryInvestmentValue } from '../model/accounts';
import { splitHoldings } from '../model/holdings';
import { computeDrift, maxDrift, computeRebalancePlan } from '../model/drift';
import { builtInProfiles } from '../import/profiles/index';
import type { PortfolioData, Snapshot, EtfPosition, ContribInterval } from '../types';
import Chart from 'chart.js/auto';
import { T, R, resolvedT } from '../theme';
import { infoTip, attachInfoTips } from '../ui/infoTip';
import { attachEtfPopovers } from '../ui/etfPopover';
import type { SortState } from './tableSort';
import { applySort, bindSortableHeader } from './tableSort';
import { renderPagination } from './pagination';
import type { ColumnDef } from './tableColumns';
import { renderTableHeader, renderTableRow, getSortGetters } from './tableColumns';
import { TOOLTIP_BOX, renderLegendHtml, tooltipSwatch } from './chartLegend';

const CH: Record<string, Chart> = {};

/**
 * Extract per-ETF market values from a snapshot.
 * Keys prefixed "etf_" hold the ISIN market value entered by the user.
 */
function extractSnapEtfValues(snap: Snapshot | null): Record<string, number> {
  if (!snap) return {};
  const out: Record<string, number> = {};
  for (const [key, val] of Object.entries(snap)) {
    if (key.startsWith('etf_') && typeof val === 'number' && val > 0) {
      out[key.slice(4)] = val;
    }
  }
  return out;
}

/** Resolve a profile source ID (e.g. 'trade_republic') to its display label. */
function sourceLabel(id: string): string {
  const profile = builtInProfiles.find((p) => p.id === id);
  return profile?.label || id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Render per-source sub-rows for a breakdown map (only when 2+ sources). */
function renderSourceBreakdown(bySource: Record<string, number>, signed = false): string {
  const keys = Object.keys(bySource);
  if (keys.length < 2) return '';
  return keys
    .sort((a, b) => Math.abs(bySource[b]) - Math.abs(bySource[a]))
    .map((src) => {
      const val = bySource[src];
      const display = signed ? fmtEurNeg(val, 2) : fmtEur2(val);
      return `<div class="row" style="padding-left:1rem"><div class="row-label" style="font-size:12px;color:var(--ink-3)">${esc(sourceLabel(src))}</div><div class="row-val" style="font-size:12px">${display}</div></div>`;
    })
    .join('');
}

function foldedIsin(isin: string, holdingByIsin: Record<string, { foldInto: string }>): string {
  let cur = isin;
  const seen = new Set<string>();
  while (holdingByIsin[cur]?.foldInto) {
    if (seen.has(cur)) break;
    seen.add(cur);
    cur = holdingByIsin[cur].foldInto;
  }
  return cur;
}

function allocationWeightsInfo(
  held: EtfPosition[],
  snapEtfValues: Record<string, number>,
  latSnap: Snapshot | null,
): { useMarketValues: boolean; note: string } {
  const hasAnyMarketValues = Object.keys(snapEtfValues).length > 0;
  const hasCompleteMarketValues =
    held.length > 0 && held.every((e) => snapEtfValues[e.isin] !== undefined);
  const useMarketValues = hasCompleteMarketValues;
  const note = useMarketValues
    ? `Allocation weights use market values from ${latSnap ? fmtMon(latSnap.date) : 'latest snapshot'}.`
    : hasAnyMarketValues
      ? 'Allocation weights use current cost basis because latest snapshot ETF values are incomplete.'
      : 'Allocation weights use current cost basis because market values are not available in the latest snapshot.';
  return { useMarketValues, note };
}

function renderAllocationBreakdowns(
  held: EtfPosition[],
  snapEtfValues: Record<string, number>,
  latSnap: Snapshot | null,
): void {
  const C = resolvedT();
  const ASSET_CLASS_LABELS: Record<string, string> = {
    equity: 'Equity',
    bond: 'Bond',
    reit: 'REIT',
    commodity: 'Commodity',
    cash: 'Cash',
    other: 'Other',
  };
  const REGION_LABELS: Record<string, string> = {
    developed: 'Developed',
    emerging: 'Emerging',
    global: 'Global',
    europe: 'Europe',
    us: 'US',
    other: 'Other',
  };
  const normalizeLabel = (kind: 'assetClass' | 'region', value: string): string =>
    kind === 'assetClass'
      ? ASSET_CLASS_LABELS[value] || value.replace(/\b\w/g, (c) => c.toUpperCase())
      : REGION_LABELS[value] || value.replace(/\b\w/g, (c) => c.toUpperCase());

  const holdings = getHoldings();
  const holdingByIsin = Object.fromEntries(holdings.map((h) => [h.isin, h]));
  const { useMarketValues } = allocationWeightsInfo(held, snapEtfValues, latSnap);

  const byClass: Record<string, number> = {};
  const byRegion: Record<string, number> = {};
  for (const e of held) {
    const targetIsin = foldedIsin(e.isin, holdingByIsin);
    const targetHolding = holdingByIsin[targetIsin] || holdingByIsin[e.isin];
    const weight = useMarketValues ? (snapEtfValues[e.isin] ?? 0) : e.cost;
    if (weight <= 0) continue;
    const assetClass = targetHolding?.assetClass || 'other';
    const region = targetHolding?.region || 'other';
    byClass[assetClass] = (byClass[assetClass] || 0) + weight;
    byRegion[region] = (byRegion[region] || 0) + weight;
  }

  const drawBreakdown = (
    chartId: string,
    legendId: string,
    rows: Array<{ label: string; value: number }>,
    kind: 'assetClass' | 'region',
    paletteSeed = 0,
  ) => {
    const labels = rows.map((r) => r.label);
    const values = rows.map((r) => r.value);
    const total = values.reduce((s, v) => s + v, 0);
    const colors = rows.map((_, i) => {
      const hue = (paletteSeed + i * 57) % 360;
      return `hsl(${hue} 60% 55%)`;
    });
    if (CH[chartId]) CH[chartId].destroy();
    CH[chartId] = new Chart(document.getElementById(chartId) as HTMLCanvasElement, {
      type: 'doughnut',
      data: {
        labels: labels.map((l) => normalizeLabel(kind, l)),
        datasets: [
          {
            data: values,
            backgroundColor: colors,
            borderColor: C.surface,
            borderWidth: 2,
            hoverOffset: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: C.surface,
            ...TOOLTIP_BOX,
            borderColor: C.line,
            borderWidth: 1,
            titleColor: C.ink,
            bodyColor: C.ink2,
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              label: (ctx) => ` ${fmtEur2(ctx.raw as number)}`,
              labelColor: tooltipSwatch(C.surface),
            },
          },
        },
      },
    });
    const items = rows.map((r, i) => ({
      label: normalizeLabel(kind, r.label),
      meta: total > 0 ? fmtPctVal((r.value / total) * 100) : '0%',
      color: colors[i],
    }));
    const legendEl = document.getElementById(legendId);
    if (legendEl) legendEl.innerHTML = renderLegendHtml(items);
  };

  const classRows = Object.entries(byClass)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
  const regionRows = Object.entries(byRegion)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  drawBreakdown('c-port-alloc-class', 'port-alloc-class-legend', classRows, 'assetClass', 15);
  drawBreakdown('c-port-alloc-region', 'port-alloc-region-legend', regionRows, 'region', 180);
}

// Module-level filter state (survives re-renders)
let _holdingsFilter = 'held'; // 'held' | 'closed' | 'all'
let _holdingsSearch = '';
const HOLD_PAGE_SIZE = 10;
let _holdPage = 1;
let _holdSort: SortState = { key: null, dir: null };

// Module-level references updated on each render (avoids stale closure in click handler)
let _pageItemsByKey = new Map<string, EtfPosition>();
let _currentColumns: ColumnDef<EtfPosition>[] = [];

// mobile-visible column count must match styles.css's #port-table mobile grid-template-columns track count
/** Single source of truth for the Holdings table's columns. `detail: true` marks
 *  columns whose values also appear in the mobile tap-to-expand panel.
 *  `detailOnly: true` marks columns that appear only in the detail panel. */
function holdingsColumns(
  pd: PortfolioData,
  snapEtfValues: Record<string, number>,
): ColumnDef<EtfPosition>[] {
  const cols: ColumnDef<EtfPosition>[] = [
    {
      key: 'shortName',
      label: 'ETF',
      sortValue: (e) => e.shortName || '',
      cellClass: () => 'hold-etf-cell',
      cell: (e) => {
        const isExited = e.exited || e.shares < 1e-6;
        return `<span class="hold-name">${esc(e.shortName)}</span><span class="hold-dot" style="background:${safeColor(e.color)};opacity:${isExited ? '0.45' : '1'}"></span>`;
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
        return `<div class="hold-value-line"><span>${fmtEur(e.cost)}</span><span class="hold-inline-meta">${fmtPctVal(pct)}</span></div>${!isExited ? `\n        <div class="bar-wrap"><div class="bar-fill" style="width:${pct.toFixed(0)}%;background:${safeColor(e.color)}"></div></div>` : ''}`;
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
      key: 'realizedPnL',
      label: 'Realized P&amp;L',
      align: 'right',
      mobileHidden: true,
      detail: true,
      sortValue: (e) => e.realizedPnL || 0,
      tip: 'Gain or loss already locked in from shares you have sold (proceeds minus their cost basis, fees included). Separate from unrealized gain on shares still held. Changes if you switch the cost-basis method in Settings.',
      cellAttrs: (e) => {
        const rpnl = e.realizedPnL || 0;
        return `style="text-align:right;color:${rpnl >= 0 ? 'var(--pos)' : 'var(--neg)'}" aria-label="Realized P&L ${rpnl !== 0 ? fmtEurNeg(rpnl, 2) : 'none'}"`;
      },
      cell: (e) => {
        const rpnl = e.realizedPnL || 0;
        return rpnl === 0 ? '-' : fmtEurNeg(rpnl, 2);
      },
      detailValueClass: (e) => ((e.realizedPnL || 0) >= 0 ? 'pos' : 'neg'),
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
    {
      key: 'marketValue',
      label: 'Market value',
      align: 'right',
      mobileHidden: true,
      detail: true,
      sortValue: (e) => snapEtfValues[e.isin] ?? -Infinity,
      tip: 'Current market value from the latest snapshot ETF breakdown.',
      cellAttrs: (e) =>
        `style="text-align:right;color:${snapEtfValues[e.isin] !== undefined ? 'var(--ink)' : 'var(--ink-3)'}" title="${
          snapEtfValues[e.isin] !== undefined
            ? ''
            : 'Add etf_' + e.isin + ' value in your next snapshot to populate this field.'
        }"`,
      cell: (e) => {
        const mv = snapEtfValues[e.isin];
        return mv !== undefined ? fmtEur2(mv) : '-';
      },
    },
    {
      key: 'unrealizedPnL',
      label: 'Unrealized P&amp;L',
      align: 'right',
      mobileHidden: true,
      detail: true,
      sortValue: (e) => {
        const mv = snapEtfValues[e.isin];
        return mv !== undefined ? mv - e.cost : -Infinity;
      },
      tip: 'Market value minus cost basis. Positive means the position is in profit.',
      cellAttrs: (e) => {
        const mv = snapEtfValues[e.isin];
        const pnl = mv !== undefined ? mv - e.cost : null;
        const color = pnl === null ? 'var(--ink-3)' : pnl >= 0 ? 'var(--pos)' : 'var(--neg)';
        const title =
          pnl === null
            ? `title="Add etf_${e.isin} value in your next snapshot to populate this field."`
            : '';
        return `style="text-align:right;color:${color}" ${title}`;
      },
      cell: (e) => {
        const mv = snapEtfValues[e.isin];
        if (mv === undefined) return '-';
        return fmtEurNeg(mv - e.cost, 2);
      },
      detailValueClass: (e) => {
        const mv = snapEtfValues[e.isin];
        if (mv === undefined) return '';
        return mv - e.cost >= 0 ? 'pos' : 'neg';
      },
    },
  ];

  return cols;
}

/**
 * Render only the holdings table (filter-dependent portion).
 * Called on filter toggle without recreating the donut, KPIs, or summary.
 */
function renderHoldingsTable(pd: PortfolioData, snaps: Snapshot[]): void {
  const ISIN_ORDER = getISIN_ORDERList();
  const META = getMETAMap();
  const latSnap = snaps.length > 0 ? snaps[snaps.length - 1] : null;
  const snapEtfValues = extractSnapEtfValues(latSnap);
  const columns = holdingsColumns(pd, snapEtfValues);

  // Build full ordered ETF list
  const allEtfs: EtfPosition[] = ISIN_ORDER.map((s) => pd.etfs[s])
    .filter((e): e is EtfPosition => !!e)
    .concat(Object.values(pd.etfs).filter((e) => !ISIN_ORDER.includes(e.isin)));
  const knownMarketValues = allEtfs
    .map((e) => snapEtfValues[e.isin])
    .filter((v): v is number => v !== undefined);
  const totalKnownMarket = knownMarketValues.reduce((sum, v) => sum + v, 0);
  const totalKnownUnrealized = allEtfs.reduce((sum, e) => {
    const mv = snapEtfValues[e.isin];
    return sum + (mv !== undefined ? mv - e.cost : 0);
  }, 0);

  // Split into held / exited
  const { held, exited } = splitHoldings(allEtfs as (EtfPosition & { [key: string]: unknown })[]);
  const exitedCount = exited.length;

  // Determine which ETFs to show based on filter
  let displayList: EtfPosition[];
  if (_holdingsFilter === 'closed') {
    displayList = exited;
  } else if (_holdingsFilter === 'all') {
    displayList = allEtfs;
  } else {
    displayList = held;
  }

  // Apply text search (ISIN or name, case-insensitive)
  if (_holdingsSearch) {
    const q = _holdingsSearch.toLowerCase();
    displayList = displayList.filter(
      (e) => e.isin.toLowerCase().includes(q) || (e.name || '').toLowerCase().includes(q),
    );
  }

  const defaultOrdered = displayList.slice().sort((a, b) => (b.cost || 0) - (a.cost || 0));

  // Apply user sort on top of the default allocation order
  const sorted = applySort(defaultOrdered, _holdSort, getSortGetters(columns));

  // Pagination
  const totalPages = Math.ceil(sorted.length / HOLD_PAGE_SIZE);
  if (_holdPage > totalPages) _holdPage = Math.max(1, totalPages);
  const pageItems = sorted.slice((_holdPage - 1) * HOLD_PAGE_SIZE, _holdPage * HOLD_PAGE_SIZE);
  const pageItemsByKey = new Map(pageItems.map((e) => [e.isin, e]));

  // Update module-level refs so the click handler (bound once) always sees fresh data
  _pageItemsByKey = pageItemsByKey;
  _currentColumns = columns;

  // Filter controls
  const filterHtml = `
    <div class="filter-bar" style="margin-bottom:8px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
      <div class="range-toggle" id="port-filter-toggle">
        <button class="btn btn-sm btn-ghost ${_holdingsFilter === 'held' ? 'active' : ''}" data-filter="held">Held</button>
        <button class="btn btn-sm btn-ghost ${_holdingsFilter === 'closed' ? 'active' : ''}" data-filter="closed">Closed${exitedCount > 0 ? ' (' + exitedCount + ')' : ''}</button>
        <button class="btn btn-sm btn-ghost ${_holdingsFilter === 'all' ? 'active' : ''}" data-filter="all">All</button>
      </div>
      <input id="port-holdings-search" type="search" class="form-input form-input-sm holdings-search-input" placeholder="Search ISIN or name"
        value="${esc(_holdingsSearch)}" style="flex:1" aria-label="Search holdings by ISIN or name">
    </div>`;

  const rows = pageItems
    .map((e) => {
      const isExited = e.exited || e.shares < 1e-6;
      return `<div class="tbl-row hold-row" role="row"${isExited ? ' style="opacity:0.6"' : ''} data-etf-key="${esc(e.isin)}">
    ${renderTableRow(columns, e)}
  </div>`;
    })
    .join('');

  document.getElementById('port-table')!.innerHTML = `
    ${filterHtml}
    <div class="hold-grid">
      <div class="tbl-row th hold-row" role="row" id="port-table-header">
        ${renderTableHeader(columns, _holdSort)}
      </div>${rows}
      <div class="tbl-row hold-total" role="row" style="border-top:1px solid var(--line-2);margin-top:4px">
        <div style="font-weight:500">Total</div>
        <div style="font-weight:500;text-align:right"><div class="hold-value-line"><span>${fmtEur(pd.totalInv)}</span><span class="hold-inline-meta">100%</span></div></div>
        <div></div><div></div>
        <div style="text-align:right;color:${pd.realizedPnL >= 0 ? 'var(--pos)' : 'var(--neg)'};font-weight:500">${pd.realizedPnL === 0 ? '-' : fmtEurNeg(pd.realizedPnL, 2)}</div>
        <div style="text-align:right;color:var(--pos);font-weight:500">${fmtEur2(pd.totalDivNet)}</div>
        <div style="text-align:right;color:${knownMarketValues.length > 0 ? 'var(--ink)' : 'var(--ink-3)'};font-weight:500">${knownMarketValues.length > 0 ? fmtEur2(totalKnownMarket) : '-'}</div>
        <div style="text-align:right;color:${knownMarketValues.length > 0 && totalKnownUnrealized >= 0 ? 'var(--pos)' : knownMarketValues.length > 0 ? 'var(--neg)' : 'var(--ink-3)'};font-weight:500">${knownMarketValues.length > 0 ? fmtEurNeg(totalKnownUnrealized, 2) : '-'}</div>
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

  // Bind filter listeners once (_bound guard prevents stacking)
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

  // Bind search input (re-bound each render since the element is recreated)
  const searchInput = document.getElementById('port-holdings-search') as HTMLInputElement | null;
  if (searchInput) {
    searchInput.addEventListener('input', (event) => {
      const input = event.currentTarget as HTMLInputElement;
      _holdingsSearch = input.value;
      _holdPage = 1;
      renderHoldingsTable(pd, snaps);
      const nextInput = document.getElementById('port-holdings-search') as HTMLInputElement | null;
      if (nextInput) {
        nextInput.focus();
        const pos = _holdingsSearch.length;
        nextInput.setSelectionRange(pos, pos);
      }
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
      const e = etfKey ? _pageItemsByKey.get(etfKey) : undefined;
      if (!e) return;
      const meta = getMETAMap()[e.isin] || {};
      const active = meta.active ? 'Active' : 'Closed';
      const acc = e.acc ? 'Accumulating' : 'Distributing';
      // Prefer holding settings name (live) over position name (stale from computePD)
      const holdCfg = getHoldings().find((h) => h.isin === e.isin);
      const displayName = holdCfg?.name || e.name || '';
      const detailCols = _currentColumns.filter((c) => c.detail);
      const detailColRows = detailCols
        .map((c) => {
          const value = c.cell ? c.cell(e) : '';
          const detailValueClass = c.detailValueClass ? c.detailValueClass(e) : '';
          const valueClass = detailValueClass ? ` ${detailValueClass}` : '';
          const rowClass = c.mobileHidden ? ' class="hold-detail-mobile-only"' : '';
          return `<div${rowClass}><span class="hold-detail-label">${c.label}</span><span class="hold-detail-value${valueClass}">${value}</span></div>`;
        })
        .join('');
      const panel = document.createElement('div');
      panel.className = 'hold-detail';
      panel.innerHTML = `
        <div><span class="hold-detail-label">Name</span><span class="hold-detail-value" style="font-size:11px">${esc(displayName)}</span></div>
        <div><span class="hold-detail-label">ISIN</span><span class="hold-detail-value hold-detail-isin">${esc(e.isin)}</span></div>
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

/**
 * Renders the Portfolio tab: KPI row, holdings table, cost-basis donut/bar,
 * and the allocation-drift card. No-op (shows the empty state) if `pd` is null.
 */
export function renderPortfolio(pd: PortfolioData | null, snaps: Snapshot[]): void {
  const ISIN_ORDER = getISIN_ORDERList();
  const META = getMETAMap();
  const has = pd && Object.keys(pd.etfs).length > 0;
  document.getElementById('port-empty')!.style.display = has ? 'none' : 'block';
  document.getElementById('port-content')!.style.display = has ? 'block' : 'none';
  if (!has) return;

  _holdPage = 1;
  _holdingsFilter = 'held';
  _holdingsSearch = '';

  const latSnap = snaps.length > 0 ? snaps[snaps.length - 1] : null;
  const snapEtfValues = extractSnapEtfValues(latSnap);
  const snapHasEtfValues = Object.keys(snapEtfValues).length > 0;
  const allEtfs = ISIN_ORDER.map((s) => pd.etfs[s])
    .filter((e): e is EtfPosition => !!e)
    .concat(Object.values(pd.etfs).filter((e) => !ISIN_ORDER.includes(e.isin)));
  const { held } = splitHoldings(allEtfs as (EtfPosition & { [key: string]: unknown })[]);
  const heldWithMarket = held.filter((e) => snapEtfValues[e.isin] !== undefined);
  const marketValueKnown = heldWithMarket.reduce((sum, e) => sum + (snapEtfValues[e.isin] || 0), 0);
  const costKnown = heldWithMarket.reduce((sum, e) => sum + e.cost, 0);
  const hasKnownPositionValues = heldWithMarket.length > 0;
  const hasPartialPositionValues = heldWithMarket.length > 0 && heldWithMarket.length < held.length;
  const snapMarketValue = snapHasEtfValues
    ? Object.values(snapEtfValues).reduce((sum, val) => sum + val, 0)
    : null;
  const curVal = primaryInvestmentValue(latSnap, getAccounts());
  const marketValue = snapMarketValue !== null ? snapMarketValue : curVal;
  const gain = hasKnownPositionValues ? marketValueKnown - costKnown : null;
  const gainPct = gain !== null && costKnown > 0 ? (gain / costKnown) * 100 : null;
  const summaryGainBase = snapMarketValue !== null ? snapMarketValue : curVal;
  const summaryGain = summaryGainBase !== null ? summaryGainBase - pd.totalInv : null;
  const summaryGainPct =
    summaryGain !== null && pd.totalInv > 0 ? (summaryGain / pd.totalInv) * 100 : null;
  const cashUnallocated =
    curVal !== null && snapMarketValue !== null ? curVal - snapMarketValue : null;
  const gainLabel =
    snapMarketValue !== null ? 'Unrealized P&amp;L (positions)' : 'Unrealized P&amp;L';
  const totalDivGross = pd.totalDivNet + pd.totalTax;
  const totalInterestGross = pd.totalIntGross || pd.totalInterest - pd.totalIntTax;
  const interestGrossBySource = Object.fromEntries(
    Object.entries(pd.interestBySource).map(([src, net]) => [
      src,
      net - (pd.taxBySource[src] || 0),
    ]),
  );
  const totalReturn =
    (summaryGain ?? 0) + pd.realizedPnL + pd.totalDivNet + pd.totalInterest - pd.totalFees;
  const unrealizedTip = hasKnownPositionValues
    ? 'Gain or loss on ETF positions still held. Computed as position market value (from ETF breakdown) minus invested capital (cost basis). Not locked in until you sell.'
    : 'Gain or loss on your portfolio. Computed as account market value (from snapshot) minus invested capital (cost basis). Not locked in until you sell.';
  const realizedTip =
    'Gain or loss already locked in from shares you have sold. Computed as sell proceeds minus the cost basis of those shares, including fees.';
  const valueNote =
    snapMarketValue !== null
      ? `Position market value from latest snapshot ETF breakdown (${latSnap ? fmtMon(latSnap.date) : 'none yet'}).`
      : `Market value from latest account snapshot (${latSnap ? fmtMon(latSnap.date) : 'none yet'}).`;

  // Annual fee drag: sum over held positions of (position value * TER).
  // Uses market value from latest snapshot ETF breakdown when available, falls back to cost basis.
  const holdingsCfg = getHoldings();
  const holdingByIsin = Object.fromEntries(holdingsCfg.map((h) => [h.isin, h]));
  const annualFeeDrag = held.reduce((sum, e) => {
    const ter = holdingByIsin[e.isin]?.ter ?? 0;
    if (!ter) return sum;
    const posValue = snapEtfValues[e.isin] ?? e.cost;
    return sum + posValue * ter;
  }, 0);
  const holdingsWithTer = holdingsCfg.filter((h) => h.ter && h.ter > 0);
  const feeDragTip =
    holdingsWithTer.length > 0
      ? `Estimated annual fee drag based on TER/OCF entered for ${holdingsWithTer.length} holding(s). Uses market value from latest snapshot when available, otherwise cost basis. Set TER for each holding in Settings.`
      : 'No TER configured for any holding. Set the TER/OCF (% p.a.) for each ETF in Settings to see an estimated annual fee drag.';

  document.getElementById('port-kpis')!.innerHTML = `
    ${kpiTile({ label: 'Total invested', value: fmtEur(pd.totalInv), sub: 'net of sells' })}
    ${kpiTile({
      label: 'Market value',
      value: marketValue !== null ? fmtEur2(marketValue) : '-',
      sub:
        marketValue !== null
          ? 'from ' + fmtMon(latSnap!.date) + ' snapshot'
          : latSnap
            ? 'no primary investment account flagged'
            : 'add a snapshot',
    })}
    ${kpiTile({
      label: `Unrealized P&amp;L${infoTip('Gain or loss on positions still held. Computed as market value minus invested capital (cost basis). Not locked in until you sell.')}`,
      value: gain !== null ? fmtEurNeg(gain, 2) : '-',
      valueClass: gain === null ? '' : gain >= 0 ? 'pos' : 'neg',
      sub:
        gainPct !== null
          ? `${fmtPctNeg(gainPct)}${hasPartialPositionValues ? ' (partial)' : ''}`
          : hasPartialPositionValues
            ? 'partial'
            : '',
    })}
    ${kpiTile({
      label: `Realized P&amp;L${infoTip('Gain or loss already locked in from shares you have sold. Computed as sell proceeds minus the cost basis of those shares, including fees.')}`,
      value: fmtEurNeg(pd.realizedPnL, 2),
      valueClass: pd.realizedPnL >= 0 ? 'pos' : 'neg',
      sub: 'from sells',
    })}
    ${kpiTile({
      label: `Est. fee drag${infoTip(feeDragTip)}`,
      value: holdingsWithTer.length > 0 ? '~' + fmtEur2(annualFeeDrag) + ' / yr' : '-',
      sub: holdingsWithTer.length > 0 ? 'TER on held positions' : 'set TER in Settings',
    })}
  `;

  // Attach info-tips in the KPI row
  const portKpis = document.getElementById('port-kpis');
  if (portKpis) attachInfoTips(portKpis);

  // Render holdings table (filter-dependent)
  renderHoldingsTable(pd, snaps);

  // Bar chart - only held positions with cost > 0
  const donutE = held.filter((e) => e.cost > 0).sort((a, b) => b.cost - a.cost);
  const C = resolvedT();
  if (CH['c-port-donut']) {
    CH['c-port-donut'].destroy();
  }
  CH['c-port-donut'] = new Chart(document.getElementById('c-port-donut') as HTMLCanvasElement, {
    type: 'bar',
    data: {
      labels: donutE.map((e) => e.shortName),
      datasets: [
        {
          data: donutE.map((e) => e.cost),
          backgroundColor: donutE.map((e) => safeColor(e.color)),
          borderColor: donutE.map((e) => safeColor(e.color)),
          borderWidth: 1,
          borderRadius: {
            topLeft: R.none,
            bottomLeft: R.none,
            topRight: R.xs,
            bottomRight: R.xs,
          },
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
          ...TOOLTIP_BOX,
          borderColor: C.line,
          borderWidth: 1,
          titleColor: C.ink,
          bodyColor: C.ink2,
          footerColor: C.ink4,
          footerFont: { weight: 'normal' as const, size: 10 },
          footerMarginTop: 6,
          padding: 10,
          cornerRadius: 8,
          callbacks: {
            label: (ctx) => ` ${fmtEur(ctx.raw as number)}`,
            labelColor: tooltipSwatch(C.surface),
            footer: (items) => {
              if (!items.length) return '';
              const idx = items[0].dataIndex;
              const e = donutE[idx];
              if (!e) return '';
              const h = getHoldings().find((x) => x.isin === e.isin);
              const name = h?.name || e.name || '';
              const lines: string[] = [];
              if (name) lines.push(name);
              lines.push(e.isin);
              return lines;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: C.line },
          ticks: {
            color: C.ink4,
            callback: (v) => ((v as number) / 1000).toFixed(0) + 'k\u00A0\u20AC',
          },
        },
        y: { grid: { display: false }, ticks: { color: C.ink2, font: { size: 12 } } },
      },
    },
  });
  document.getElementById('port-donut-legend')!.innerHTML = renderLegendHtml(
    donutE.map((e) => ({
      label: e.shortName,
      meta: pd.totalInv > 0 ? fmtPctVal((e.cost / pd.totalInv) * 100) : '0%',
      color: e.color,
    })),
  );
  renderAllocationBreakdowns(held, snapEtfValues, latSnap);

  const mvRow =
    snapMarketValue !== null
      ? `<div class="row"><div class="row-label">Market value (positions)</div><div class="row-val">${fmtEur2(snapMarketValue)}</div></div>`
      : curVal !== null
        ? `<div class="row"><div class="row-label">Market value (snapshot)</div><div class="row-val">${fmtEur2(curVal)}</div></div>`
        : '';
  const acctRow =
    cashUnallocated !== null && Math.abs(cashUnallocated) > 0.01
      ? `<div class="row"><div class="row-label">Account value (snapshot)</div><div class="row-val">${fmtEur2(curVal!)}</div></div>`
      : '';
  const cashRow =
    cashUnallocated !== null && Math.abs(cashUnallocated) > 0.01
      ? `<div class="row"><div class="row-label">Unallocated cash ${infoTip('Difference between the account snapshot total and the sum of ETF position market values. A non-zero value may indicate uninvested cash, pending settlement, rounding drift, or an incomplete ETF breakdown.')}</div><div class="row-val ${cashUnallocated >= 0 ? 'ok' : 'neg'}">${fmtEurNeg(cashUnallocated, 2)}</div></div>`
      : '';
  const sectionHead = (label: string) =>
    `<div style="padding-top:8px;padding-bottom:2px"><span style="font-size:10px;font-weight:600;letter-spacing:.06em;color:var(--ink-4)">${label}</span></div>`;
  const unrealizedRow =
    summaryGain !== null
      ? `<div class="row"><div class="row-label" style="font-weight:500">${gainLabel} ${infoTip(unrealizedTip)}</div><div class="row-val ${summaryGain >= 0 ? 'pos' : 'neg'}" style="font-weight:500">${fmtEurNeg(summaryGain, 2)} (${fmtPctNeg(summaryGainPct!)})</div></div>`
      : '';
  const totalReturnRow =
    summaryGain !== null
      ? `<div class="row" style="border-top:1px solid var(--line-2);margin-top:4px"><div class="row-label" style="font-weight:600">Total return</div><div class="row-val ${totalReturn >= 0 ? 'pos' : 'neg'}" style="font-weight:600">${fmtEurNeg(totalReturn, 2)}</div></div>`
      : '';

  // Known limitation: foldInto (multi-leg SELL consolidation, e.g. IEEM→CMEIU,
  // CECBE+EGB7Y→GABE) is implemented per spec but has never run against a real
  // consolidation event. The logic should work; treat the first real occurrence
  // as unverified and double-check Realized P&L manually. See README "Known
  // limitations".
  document.getElementById('port-summary')!.innerHTML = `
    <div class="row"><div class="row-label">Invested capital (cost basis)</div><div class="row-val">${fmtEur(pd.totalInv)}</div></div>
    ${mvRow}${acctRow}${cashRow}
    ${sectionHead('PERFORMANCE')}
    ${unrealizedRow}
    <div class="row"><div class="row-label">Realized P&amp;L ${infoTip(realizedTip)}</div><div class="row-val ${pd.realizedPnL >= 0 ? 'ok' : 'neg'}">${fmtEurNeg(pd.realizedPnL, 2)}</div></div>
    ${sectionHead('INCOME &amp; COSTS')}
    <div class="row"><div class="row-label">Dividends (gross)</div><div class="row-val ok">${fmtEur2(totalDivGross)}</div></div>
    <div class="row"><div class="row-label">Tax withheld on dividends</div><div class="row-val ${pd.totalTax > 0 ? 'neg' : 'ok'}">${fmtEur2(pd.totalTax)}</div></div>
    <div class="row"><div class="row-label">Interest received (gross)</div><div class="row-val ok">${fmtEur2(totalInterestGross)}</div></div>
    ${renderSourceBreakdown(interestGrossBySource)}
    <div class="row"><div class="row-label">Tax on savings</div><div class="row-val ${pd.totalIntTax > 0 ? 'neg' : 'ok'}">${fmtEur2(pd.totalIntTax)}</div></div>
    <div class="row"><div class="row-label">Fees</div><div class="row-val">${fmtEur2(pd.totalFees)}</div></div>
    ${totalReturnRow}
    <p class="note">Cost basis exact from CSV. ${valueNote} Mixed-currency positions compute in account currency (no FX conversion).</p>
  `;
  const portSummary = document.getElementById('port-summary');
  if (portSummary) attachInfoTips(portSummary);

  _renderDriftCard(pd, snaps);
}

// ── Drift / rebalance card ──

/** Cadence suffix labels for the rebalance table (e.g. "/wk"). */
const REBALANCE_INTERVAL_SUFFIX: Record<string, string> = {
  weekly: '/wk',
  biweekly: '/2wk',
  monthly: '/mo',
  quarterly: '/qtr',
};

const REBALANCE_MIN_ACTION_BY_INTERVAL: Record<ContribInterval, number> = {
  weekly: 1,
  biweekly: 2,
  monthly: 5,
  quarterly: 10,
};

const REBALANCE_ROUNDING_STEP_BY_INTERVAL: Record<ContribInterval, number> = {
  weekly: 1,
  biweekly: 1,
  monthly: 5,
  quarterly: 5,
};

/** Stored callback so the picker can re-render the drift card after a month selection. */
let _redrawDrift: ((keepRebalanceOpen?: boolean) => void) | null = null;

const REBALANCE_MONTH_OPTIONS = [1, 2, 3, 6, 12];

function _renderDriftCard(pd: PortfolioData, snaps: Snapshot[], keepRebalanceOpen = false): void {
  const driftEl = document.getElementById('port-drift');
  if (!driftEl) return;

  // Store a redraw callback so the month picker can trigger a re-render.
  _redrawDrift = (keepOpen = false) => _renderDriftCard(pd, snaps, keepOpen);

  const holdings = getHoldings();

  // Extract per-ETF market values from the latest snapshot when available.
  const latSnap = snaps.length > 0 ? snaps[snaps.length - 1] : null;
  const snapEtfValues = extractSnapEtfValues(latSnap);
  const hasSnapValues = Object.keys(snapEtfValues).length > 0;
  const allEtfs = Object.values(pd.etfs);
  const { held } = splitHoldings(allEtfs as (EtfPosition & { [key: string]: unknown })[]);
  const primaryInvTotal = primaryInvestmentValue(latSnap, getAccounts());
  const hasHeldPositions = held.length > 0;

  // Use the snapshot primary-investment account total as totalValue when market
  // values are available. Also use it when there are no held positions (all cash)
  // so rebalance guidance still works for re-entry portfolios.
  const totalValue =
    hasSnapValues || !hasHeldPositions ? (primaryInvTotal ?? pd.totalInv) : pd.totalInv;

  const drift = computeDrift(
    holdings,
    pd.etfs,
    totalValue,
    hasSnapValues ? snapEtfValues : undefined,
  );

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
        Math.abs(d.driftPct) > 5
          ? 'var(--neg)'
          : Math.abs(d.driftPct) > 2
            ? 'var(--warn)'
            : 'var(--pos)';
      const isLegacy = d.targetPct === 0;
      const costBadge =
        d.valuationMode === 'cost'
          ? infoTip(
              'Actual % based on cost basis, not current market value. Enter ETF values in your next snapshot for market-based drift.',
            )
          : '';
      return `
      <div class="tbl-row" role="row" style="grid-template-columns:1.5fr 1fr 1fr 1fr 1fr">
        <div role="cell"><span style="display:inline-block;width:8px;height:8px;border-radius:var(--radius-xs);background:${safeColor(d.color)};margin-right:6px;opacity:${isLegacy ? '0.6' : '1'}"></span><span data-etf-isin="${esc(d.isin)}" data-etf-name="${esc(d.name)}">${esc(d.shortName)}</span></div>
        <div role="cell" style="text-align:right${isLegacy ? ';color:var(--ink-3)' : ''}">${isLegacy ? '(legacy)' : fmtPctVal(d.targetPct)}</div>
        <div role="cell" style="text-align:right">${fmtPctVal(d.actualPct)}${costBadge}</div>
        <div role="cell" style="text-align:right;color:${driftColor}" aria-label="Drift ${fmtPctSigned(d.driftPct)}">${fmtPctSigned(d.driftPct)}</div>
        <div role="cell" style="text-align:right;color:${d.deltaValue >= 0 ? 'var(--ink-3)' : 'var(--ink-2)'}">${fmtEurSigned(d.deltaValue)}</div>
      </div>`;
    })
    .join('');

  const noteSource = hasSnapValues
    ? `Actual from market values (snapshot: ${fmtMon(latSnap!.date)}). Legacy = inactive positions still held.`
    : `Actual from cost basis (no ETF values in latest snapshot). Legacy = inactive positions still held.`;
  const hasCostMode = drift.some((d) => d.valuationMode === 'cost');
  const costModeBanner = hasCostMode
    ? `<div class="status-bar status-warn" style="margin-bottom:.6rem">Allocation is based on purchase cost, not current market value. Enter ETF values in your next snapshot for market-based drift.</div>`
    : '';

  // ── Contribution rebalance plan ──────────────────────────────────────────
  const selectedMonths = Math.max(
    1,
    parseInt(localStorage.getItem('drift-rebalance-months') || '3', 10) || 3,
  );

  const plan = computeRebalancePlan(drift, holdings, totalValue, selectedMonths, {
    minActionByInterval: REBALANCE_MIN_ACTION_BY_INTERVAL,
    roundingStepByInterval: REBALANCE_ROUNDING_STEP_BY_INTERVAL,
  });

  // Check whether any holding remains overweight even at a 12-month horizon.
  const plan12 = computeRebalancePlan(drift, holdings, totalValue, 12, {
    minActionByInterval: REBALANCE_MIN_ACTION_BY_INTERVAL,
    roundingStepByInterval: REBALANCE_ROUNDING_STEP_BY_INTERVAL,
  });
  const needsSell = plan12.some((e) => e.projectedDriftPct > 0.05);

  let rebalanceSection = '';
  // Only show the rebalance plan when market values are available for held positions.
  // Cost-basis drift figures are not reliable enough to base contribution decisions on.
  // When there are no held positions (all cash / re-entry), cost mode is irrelevant and
  // the plan is shown since it is purely contribution-target-based.
  if (plan.length >= 2 && !(hasCostMode && hasHeldPositions)) {
    const isRebalanceRecommended = max > 10;
    const shouldOpenRebalance = keepRebalanceOpen || isRebalanceRecommended;
    const pickerBtns = REBALANCE_MONTH_OPTIONS.map((m) => {
      const active = m === selectedMonths;
      const label = m === 12 ? '1 yr' : `${m} mo`;
      return `<button class="btn btn-sm btn-ghost ${active ? 'active' : ''}" data-rebalance-months="${m}" aria-pressed="${active ? 'true' : 'false'}">${label}</button>`;
    }).join('');

    const activeCurrentMax = maxDrift(drift.filter((d) => d.targetPct > 0));
    const projectedActiveMax =
      Math.round(Math.max(...plan.map((e) => Math.abs(e.projectedDriftPct))) * 10) / 10;
    const hasLegacyDrift = drift.some((d) => d.targetPct === 0 && Math.abs(d.driftPct) > 0);
    const periodLabel = selectedMonths === 1 ? '1 month' : `${selectedMonths} months`;
    const legacyScopeNote = hasLegacyDrift
      ? ' Projection reflects active-target holdings only; legacy positions are unchanged.'
      : '';

    const rebalanceRows = plan
      .map((e) => {
        const suffix = esc(REBALANCE_INTERVAL_SUFFIX[e.contribInterval] ?? '');
        const delta = e.suggestedContribAmt - e.currentContribAmt;
        const stateLabel =
          e.state === 'overweight'
            ? 'Overweight'
            : e.state === 'on-target'
              ? 'On target'
              : 'Underweight';
        let changeCell: string;
        if (Math.abs(delta) < 0.005) {
          changeCell = `<span style="color:var(--ink-3)">no change</span>`;
        } else {
          const changeColor = delta > 0 ? 'var(--pos)' : 'var(--warn)';
          changeCell = `<span style="color:${changeColor}">${fmtEurSigned(delta, 2)}${suffix}</span>`;
        }
        const suggestedCell =
          e.suggestedContribAmt < 0.005
            ? `<span style="color:var(--warn)">hold</span>`
            : `${fmtEur2(e.suggestedContribAmt)}<span style="color:var(--ink-3);font-size:11px">${suffix}</span>`;
        return `
        <div class="tbl-row" role="row" data-rebalance-state="${esc(e.state)}" style="grid-template-columns:1.5fr 1fr 1.1fr 1fr">
          <div role="cell"><span style="display:inline-block;width:8px;height:8px;border-radius:var(--radius-xs);background:${safeColor(e.color)};margin-right:6px"></span>${esc(e.shortName)} <span class="rebalance-state-badge rebalance-state-${esc(e.state)}">${stateLabel}</span></div>
          <div role="cell" style="text-align:right">${fmtEur2(e.currentContribAmt)}<span style="color:var(--ink-3);font-size:11px">${suffix}</span></div>
          <div role="cell" style="text-align:right">${suggestedCell}</div>
          <div role="cell" style="text-align:right">${changeCell}</div>
        </div>`;
      })
      .join('');

    const sellWarning = needsSell
      ? `<div class="status-bar status-warn" style="margin-top:.5rem">Some holdings remain overweight beyond a 12-month horizon. Consider reviewing whether a partial sell could speed up rebalancing, and account for taxes and trading fees before acting.</div>`
      : '';

    rebalanceSection = `
      <details class="rebalance-collapsible" ${shouldOpenRebalance ? 'open' : ''}>
        <summary class="rebalance-summary">
          Contribution rebalance
          <span class="rebalance-summary-note">${isRebalanceRecommended ? 'Recommended now' : 'Optional when drift is moderate or low'}</span>
        </summary>
        <div class="rebalance-body">
          <div class="rebalance-picker-row">
            <span class="rebalance-picker-label">Timeline, click to change:</span>
            <div class="range-toggle rebalance-range-toggle" role="group" aria-label="Rebalance timeline">
              ${pickerBtns}
            </div>
          </div>
          <div class="tbl" role="table" aria-label="Contribution rebalance plan">
            <div class="tbl-row th" role="row" style="grid-template-columns:1.5fr 1fr 1.1fr 1fr">
              <div role="columnheader">ETF</div>
              <div role="columnheader" style="text-align:right">Current</div>
              <div role="columnheader" style="text-align:right">Suggested</div>
              <div role="columnheader" style="text-align:right">Change</div>
            </div>
            ${rebalanceRows}
          </div>
          <p class="note" style="margin-top:.5rem">Routing the suggested amounts for ${periodLabel} will reduce max drift from ${fmtPctVal(activeCurrentMax)} to ${fmtPctVal(projectedActiveMax)}. This is a scenario estimate that assumes buy-only contributions and no market movement, actual results will vary.${legacyScopeNote}</p>
          ${sellWarning}
        </div>
      </details>`;
  }

  driftEl.innerHTML = `
    <div class="card">
      <div class="card-title drift-title">Allocation drift <span class="drift-title-status" style="color:${statusColor}">${statusLabel} (max ${fmtPctVal(max)})</span></div>
      ${costModeBanner}
      <div class="tbl" role="table" aria-label="Allocation drift">
        <div class="tbl-row th" role="row" style="grid-template-columns:1.5fr 1fr 1fr 1fr 1fr">
          <div role="columnheader">ETF</div><div role="columnheader" style="text-align:right">Target</div><div role="columnheader" style="text-align:right">Actual</div><div role="columnheader" style="text-align:right">Drift</div><div role="columnheader" style="text-align:right">Delta</div>
        </div>
        ${rows}
      </div>
      <p class="note" style="margin-top:.5rem">Target from contribution weights. ${noteSource} Delta = amount to sell/buy to reach target.</p>
      ${rebalanceSection}
    </div>`;

  // Attach picker click handlers.
  driftEl.querySelectorAll('[data-rebalance-months]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const details = (btn as HTMLElement).closest(
        '.rebalance-collapsible',
      ) as HTMLDetailsElement | null;
      const keepOpen = details?.open ?? false;
      const m = parseInt((btn as HTMLElement).dataset.rebalanceMonths || '3', 10);
      localStorage.setItem('drift-rebalance-months', String(m));
      _redrawDrift?.(keepOpen);
    });
  });

  attachEtfPopovers(driftEl);
  attachInfoTips(driftEl);
}

/**
 * Returns the maximum allocation drift (in percentage points) across all held
 * positions, or null when there is not enough data to compute drift.
 * Used by the nav badge to alert the user when drift exceeds the threshold.
 */
export function getMaxDrift(pd: PortfolioData | null, snaps: Snapshot[]): number | null {
  if (!pd || Object.keys(pd.etfs).length === 0) return null;
  const holdings = getHoldings();
  const latSnap = snaps.length > 0 ? snaps[snaps.length - 1] : null;
  const snapEtfValues = extractSnapEtfValues(latSnap);
  const hasSnapValues = Object.keys(snapEtfValues).length > 0;
  const allEtfs = Object.values(pd.etfs);
  const { held } = splitHoldings(allEtfs as (EtfPosition & { [key: string]: unknown })[]);
  const primaryInvTotal = primaryInvestmentValue(latSnap, getAccounts());
  const hasHeldPositions = held.length > 0;
  const totalValue =
    hasSnapValues || !hasHeldPositions ? (primaryInvTotal ?? pd.totalInv) : pd.totalInv;
  const drift = computeDrift(
    holdings,
    pd.etfs,
    totalValue,
    hasSnapValues ? snapEtfValues : undefined,
  );
  if (drift.length === 0) return null;
  return maxDrift(drift);
}
