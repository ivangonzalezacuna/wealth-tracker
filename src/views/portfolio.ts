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
  kpiGroup,
  kpiTile,
} from '../utils';
import { getISIN_ORDERList, getMETAMap } from '../constants';
import {
  getAccounts,
  getHoldings,
  getAlertSettings,
  getMonthlyContribBudget,
  getCalibrationInterval,
} from '../store/config';
import {
  allInvestmentAccountsValue,
  isAccountClosedInMonth,
  isAccountOpenNow,
} from '../model/accounts';
import {
  accountPositionValues,
  aggregatePositionValues,
  hasCompletePositionCoverage,
  parsePositionKey,
  coverageKey,
} from '../model/snapshotPositions';
import { splitHoldings, computeFeeDrag } from '../model/holdings';
import { computeDrift, maxDrift, computeRebalancePlan, driftStatus } from '../model/drift';
import type { DriftEntry } from '../model/drift';
import { sourceLabel } from '../import/profiles/index';
import type { PortfolioData, Snapshot, EtfPosition, Holding } from '../types';
import { infoTip, attachInfoTips } from '../ui/infoTip';
import { bindChipGroup, bindSearchClear, chipGroupHtml, searchHtml } from '../ui/filterBar';
import { attachEtfPopovers } from '../ui/etfPopover';
import { createPageSizePref, DEFAULT_PAGE_SIZES, renderPagination } from './pagination';
import type { ColumnDef } from './tableColumns';
import { renderTableHeader, renderTableRow } from './tableColumns';
import { bindExpandableRows, restoreExpandableRows } from './expandableRows';
import { bindSortedTableHeader, sortAndPaginate } from './tableView';
import { isCollapsed, setCollapsed } from '../ui/collapseState';
import { ROW_DISCLOSURE_ICON } from './icons';
import {
  disposeChart,
  drillHint,
  fmtEurCompact,
  renderChart,
  toRgba,
  tooltipHint,
  type ChartTokens,
} from './charts';
import { revealElement } from './drill';
import {
  createTableState,
  getTableFilter,
  setTableFilter,
  setTablePage,
  setTableSort,
} from './tableState';

/**
 * Extract per-ETF market values from a snapshot.
 * Keys prefixed "etf_" hold the ISIN market value entered by the user.
 */
function extractSnapEtfValues(snap: Snapshot | null): Record<string, number> {
  const values = aggregatePositionValues(snap);
  // Keep the pre-conversion reader's permissive legacy keys until scoped activation.
  if (snap && !scopedSnapshot(snap)) {
    for (const [key, value] of Object.entries(snap)) {
      if (
        key.startsWith('etf_') &&
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= 0
      )
        values[key.slice(4)] = value;
    }
  }
  return values;
}

function scopedSnapshot(snap: Snapshot | null): boolean {
  return (
    !!snap &&
    Object.keys(snap).some(
      (key) => parsePositionKey(key) !== null || key.startsWith('position_coverage:'),
    )
  );
}

type HoldingRow =
  | (EtfPosition & { kind: 'ledger' })
  | (Pick<Holding, 'isin' | 'name' | 'shortName' | 'color' | 'acc' | 'active'> & {
      kind: 'valuation';
    });

let _holdingSnapshot: Snapshot | null = null;

function positionAccounts(isin: string): ReturnType<typeof getAccounts> {
  if (!_holdingSnapshot) return [];
  return getAccounts().filter(
    (account) =>
      (accountPositionValues(_holdingSnapshot!, account.id || account.key || '')[isin] || 0) > 0,
  );
}

function holdingRows(pd: PortfolioData, snap: Snapshot | null): HoldingRow[] {
  const rows = new Map<string, HoldingRow>(
    Object.values(pd.etfs).map((position) => [position.isin, { ...position, kind: 'ledger' }]),
  );
  const config = new Map(getHoldings().map((holding) => [holding.isin, holding]));
  for (const isin of Object.keys(extractSnapEtfValues(snap))) {
    if (rows.has(isin)) continue;
    const holding = config.get(isin);
    rows.set(isin, {
      kind: 'valuation',
      isin,
      name: holding?.name || isin,
      shortName: holding?.shortName || isin,
      color: holding?.color || '#888888',
      acc: holding?.acc ?? true,
      active: holding?.active ?? false,
    });
  }
  const order = getISIN_ORDERList();
  return [...rows.values()].sort((a, b) => {
    const ai = order.indexOf(a.isin);
    const bi = order.indexOf(b.isin);
    return (ai < 0 ? Infinity : ai) - (bi < 0 ? Infinity : bi);
  });
}

function isExitedRow(row: HoldingRow): boolean {
  return (
    row.kind === 'ledger' && (row.exited || row.shares < 1e-6) && !positionAccounts(row.isin).length
  );
}

type DriftValuationMode = 'cost' | 'market';

interface DriftValuationPolicy {
  mode: DriftValuationMode;
  latestSnapshot: Snapshot | null;
  snapEtfValues: Record<string, number>;
  snapEtfValuesForDrift: Record<string, number> | undefined;
  totalValue: number;
  hasHeldPositions: boolean;
  hasAnySnapshotEtfValues: boolean;
  hasPartialSnapshotCoverage: boolean;
}

function getDriftValuationPolicy(pd: PortfolioData, snaps: Snapshot[]): DriftValuationPolicy {
  const latestSnapshot = snaps.length > 0 ? snaps[snaps.length - 1] : null;
  const snapEtfValues = extractSnapEtfValues(latestSnapshot);
  const hasAnySnapshotEtfValues = Object.keys(snapEtfValues).length > 0;
  const allEtfs = Object.values(pd.etfs);
  const { held } = splitHoldings(allEtfs as (EtfPosition & { [key: string]: unknown })[]);
  const hasHeldPositions =
    held.length > 0 ||
    (scopedSnapshot(latestSnapshot) && Object.values(snapEtfValues).some((value) => value > 0));
  const heldWithSnapshotValueCount = held.filter((e) => snapEtfValues[e.isin] !== undefined).length;
  const hasFullCoverage = scopedSnapshot(latestSnapshot)
    ? !!latestSnapshot && hasCompletePositionCoverage(latestSnapshot, getAccounts())
    : hasHeldPositions && heldWithSnapshotValueCount === held.length;
  const hasPartialSnapshotCoverage = hasAnySnapshotEtfValues && !hasFullCoverage;
  const mode: DriftValuationMode = hasFullCoverage ? 'market' : 'cost';
  const primaryInvTotal = allInvestmentAccountsValue(latestSnapshot, getAccounts());
  const totalValue =
    !hasHeldPositions || mode === 'market' ? (primaryInvTotal ?? pd.totalInv) : pd.totalInv;
  const driftValues = mode === 'market' ? { ...snapEtfValues } : undefined;
  if (driftValues && scopedSnapshot(latestSnapshot)) {
    for (const isin of [...Object.keys(pd.etfs), ...getHoldings().map((holding) => holding.isin)]) {
      driftValues[isin] ??= 0;
    }
  }

  return {
    mode,
    latestSnapshot,
    snapEtfValues,
    snapEtfValuesForDrift: driftValues,
    totalValue,
    hasHeldPositions,
    hasAnySnapshotEtfValues,
    hasPartialSnapshotCoverage,
  };
}

function portfolioDrift(pd: PortfolioData, valuation: DriftValuationPolicy): DriftEntry[] {
  const drift = computeDrift(
    getHoldings(),
    pd.etfs,
    valuation.totalValue,
    valuation.snapEtfValuesForDrift,
  );
  if (valuation.mode !== 'market' || valuation.totalValue <= 0 || drift.length === 0) return drift;
  const included = new Set(drift.map((entry) => entry.isin));
  for (const row of holdingRows(pd, valuation.latestSnapshot)) {
    const value = valuation.snapEtfValues[row.isin] || 0;
    if (included.has(row.isin) || value <= 0) continue;
    const pct = Math.round((value / valuation.totalValue) * 1000) / 10;
    drift.push({
      isin: row.isin,
      name: row.name,
      shortName: row.shortName,
      color: row.color,
      targetPct: 0,
      actualPct: pct,
      driftPct: pct,
      actualValue: value,
      targetValue: 0,
      deltaValue: Math.round(value),
      valuationMode: 'market',
    });
  }
  return drift;
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

// Module-level filter state (survives re-renders)
const _holdPageSize = createPageSizePref('wt:holdings:pageSize', DEFAULT_PAGE_SIZES);
/** Latest holdings re-render (delegated filter handlers are bound once and call this). */
let _holdRender: (() => void) | null = null;
const _holdTableState = createTableState({
  sort: { key: null, dir: null },
  filters: { status: 'held', search: '', account: '' },
});

// Module-level references updated on each render (avoids stale closure in click handler)
let _pageItemsByKey = new Map<string, HoldingRow>();
let _currentColumns: ColumnDef<HoldingRow>[] = [];

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
        return `${ROW_DISCLOSURE_ICON}<span class="hold-name">${esc(e.shortName)}</span><span class="hold-dot" style="background:${safeColor(e.color)};opacity:${isExited ? '0.45' : '1'}"></span>`;
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
  const latSnap = snaps.length > 0 ? snaps[snaps.length - 1] : null;
  _holdingSnapshot = latSnap;
  const snapEtfValues = extractSnapEtfValues(latSnap);
  const complete = !scopedSnapshot(latSnap) || hasCompletePositionCoverage(latSnap!, getAccounts());
  const columns: ColumnDef<HoldingRow>[] = holdingsColumns(pd, complete ? snapEtfValues : {}).map(
    (column) => ({
      ...column,
      sortValue: (row) =>
        column.key === 'marketValue'
          ? (snapEtfValues[row.isin] ?? -Infinity)
          : row.kind === 'ledger'
            ? (column.sortValue?.(row) ?? 0)
            : column.key === 'shortName'
              ? row.shortName
              : -Infinity,
      cellClass: () => (column.key === 'shortName' ? 'hold-etf-cell' : ''),
      cellAttrs: (row) => {
        if (column.key === 'marketValue')
          return `style="text-align:right" title="${snapEtfValues[row.isin] === undefined ? 'No saved position valuation in the latest snapshot.' : !complete ? 'Partial recorded valuation; account breakdown coverage is incomplete.' : ''}"`;
        if (column.key === 'unrealizedPnL' && !complete)
          return 'style="text-align:right" title="P&L is unavailable until account valuation coverage is complete."';
        return row.kind === 'ledger' ? (column.cellAttrs?.(row) ?? '') : 'style="text-align:right"';
      },
      detailValueClass: (row) =>
        row.kind === 'ledger' ? (column.detailValueClass?.(row) ?? '') : '',
      cell: (row) => {
        if (column.key === 'shortName') {
          const count = positionAccounts(row.isin).length;
          const accountLabel = `${count} accounts as of ${latSnap ? fmtMon(latSnap.date) : ''}`;
          return `${ROW_DISCLOSURE_ICON}<span class="hold-name">${esc(row.shortName)}</span>${count > 1 ? `<span class="hold-account-count" aria-label="${esc(accountLabel)}" title="${esc(accountLabel)}">${count}</span>` : ''}<span class="hold-dot" style="background:${safeColor(row.color)}"></span>`;
        }
        if (column.key === 'marketValue') {
          const value = snapEtfValues[row.isin];
          return value === undefined
            ? '-'
            : `${fmtEur2(value)}${!complete ? '<span class="hold-inline-meta">partial</span>' : ''}`;
        }
        return row.kind === 'ledger' ? (column.cell?.(row) ?? '') : '-';
      },
    }),
  );

  // Build full ordered ETF list
  const allEtfs = holdingRows(pd, latSnap);
  const hasGlobalCostBasis = allEtfs.every((row) => row.kind === 'ledger');
  const knownMarketValues = allEtfs
    .map((e) => snapEtfValues[e.isin])
    .filter((v): v is number => v !== undefined);
  const totalKnownMarket = knownMarketValues.reduce((sum, v) => sum + v, 0);
  const totalKnownUnrealized = allEtfs.reduce((sum, e) => {
    const mv = snapEtfValues[e.isin];
    return sum + (mv !== undefined && e.kind === 'ledger' ? mv - e.cost : 0);
  }, 0);

  // Split into held / exited
  const held = allEtfs.filter((row) => !isExitedRow(row));
  const exited = allEtfs.filter(isExitedRow);
  const exitedCount = exited.length;

  let holdingsFilter = getTableFilter(_holdTableState, 'status') || 'held';
  if (!held.length || !exited.length) {
    holdingsFilter = held.length ? 'held' : 'all';
    _holdTableState.filters.status = holdingsFilter;
  }
  let displayList: HoldingRow[];
  if (holdingsFilter === 'closed') {
    displayList = exited;
  } else if (holdingsFilter === 'all') {
    displayList = allEtfs;
  } else {
    displayList = held;
  }

  const accountChoices = [
    ...getAccounts()
      .filter((account) => account.moneyType?.toLowerCase() === 'investment')
      .map((account) => ({
        value: account.id || account.key || '',
        label: `${account.label}${latSnap && isAccountClosedInMonth(account, latSnap.date) ? ' (closed)' : ''}`,
      })),
    { value: ':multiple', label: 'Multiple accounts' },
  ]
    .map((choice) => ({
      ...choice,
      members: displayList
        .filter((row) => {
          const accounts = positionAccounts(row.isin);
          return choice.value === ':multiple'
            ? accounts.length > 1
            : accounts.some((account) => (account.id || account.key) === choice.value);
        })
        .map((row) => row.isin),
    }))
    .filter((choice) => choice.members.length > 0 && choice.members.length < displayList.length)
    .filter(
      (choice, index, choices) =>
        choices.findIndex((other) => other.members.join('|') === choice.members.join('|')) ===
        index,
    )
    .map(({ value, label, members }) => ({ value, label, count: members.length }));
  let accountFilter = getTableFilter(_holdTableState, 'account');
  if (accountFilter && !accountChoices.some((choice) => choice.value === accountFilter)) {
    accountFilter = '';
    _holdTableState.filters.account = '';
  }
  const accountTotal = displayList.length;
  if (accountFilter) {
    displayList = displayList.filter((row) => {
      const accounts = positionAccounts(row.isin);
      return accountFilter === ':multiple'
        ? accounts.length > 1
        : accounts.some((account) => (account.id || account.key) === accountFilter);
    });
  }
  // Apply text search (ISIN or name, case-insensitive)
  const holdingsSearch = getTableFilter(_holdTableState, 'search');
  if (holdingsSearch) {
    const q = holdingsSearch.toLowerCase();
    displayList = displayList.filter(
      (e) => e.isin.toLowerCase().includes(q) || (e.name || '').toLowerCase().includes(q),
    );
  }

  const defaultOrdered = displayList
    .slice()
    .sort((a, b) => (b.kind === 'ledger' ? b.cost : 0) - (a.kind === 'ledger' ? a.cost : 0));

  // Apply user sort on top of the default allocation order
  const { pageItems, page, totalPages } = sortAndPaginate(
    defaultOrdered,
    columns,
    _holdTableState.sort,
    _holdTableState.page,
    _holdPageSize.size,
  );
  setTablePage(_holdTableState, page);
  const pageItemsByKey = new Map(pageItems.map((e) => [e.isin, e]));

  // Update module-level refs so the click handler (bound once) always sees fresh data
  _pageItemsByKey = pageItemsByKey;
  _currentColumns = columns;

  // Filter controls
  const statusChips =
    exitedCount > 0 && held.length > 0
      ? chipGroupHtml({
          id: 'port-filter-toggle',
          ariaLabel: 'Show holdings',
          attr: 'filter',
          value: holdingsFilter,
          chips: [
            { value: 'all', label: 'All', count: allEtfs.length },
            { value: 'held', label: 'Held', count: held.length },
            { value: 'closed', label: 'Closed', count: exitedCount },
          ],
        })
      : '';
  // Same layout as the ledger: search first, chips on their own row below.
  const filterHtml =
    allEtfs.length > 1 || holdingsSearch || statusChips || accountChoices.length
      ? `
    <div class="filter-bar filter-bar-stacked hold-filter-bar">
      ${
        allEtfs.length > 1 || holdingsSearch
          ? searchHtml({
              id: 'port-holdings-search',
              value: holdingsSearch,
              placeholder: 'Search ISIN or name',
              ariaLabel: 'Search holdings by ISIN or name',
            })
          : ''
      }
      ${statusChips}
      ${
        accountChoices.length
          ? chipGroupHtml({
              id: 'port-account-filter',
              ariaLabel: 'Filter holdings by account. Metrics and totals remain portfolio-wide.',
              attr: 'hold-account',
              value: accountFilter,
              chips: [{ value: '', label: 'All accounts', count: accountTotal }, ...accountChoices],
            })
          : ''
      }
    </div>`
      : '';
  const noMatch =
    pageItems.length === 0 && (holdingsSearch || accountFilter)
      ? `<div class="empty-state hold-empty" role="row">No holdings match${holdingsSearch ? ` “${esc(holdingsSearch)}”` : ' these filters'}. <button type="button" class="filter-clear-all" data-clear-hold-search>${accountFilter ? 'Clear filters' : 'Clear search'}</button></div>`
      : '';

  const rows = pageItems
    .map((e) => {
      const isExited = isExitedRow(e);
      return `<div class="tbl-row hold-row" role="row" tabindex="0" aria-expanded="${String(isCollapsed('hold:' + e.isin))}"${isExited ? ' style="opacity:0.6"' : ''} data-etf-key="${esc(e.isin)}">
    ${renderTableRow(columns, e)}
  </div>`;
    })
    .join('');

  document.getElementById('port-table')!.innerHTML = `
    ${filterHtml}
    <div class="hold-grid">
      <div class="tbl-row th hold-row" role="row" id="port-table-header">
        ${renderTableHeader(columns, _holdTableState.sort)}
      </div>${rows}${noMatch}
      <div class="tbl-row hold-total" role="row" style="border-top:1px solid var(--line-2);margin-top:4px">
        <div style="font-weight:500">Total (all accounts)</div>
        <div style="font-weight:500;text-align:right"><div class="hold-value-line"><span>${fmtEur(pd.totalInv)}</span><span class="hold-inline-meta">100%</span></div></div>
        <div></div><div></div>
        <div style="text-align:right;color:${pd.realizedPnL >= 0 ? 'var(--pos)' : 'var(--neg)'};font-weight:500">${pd.realizedPnL === 0 ? '-' : fmtEurNeg(pd.realizedPnL, 2)}</div>
        <div style="text-align:right;color:var(--pos);font-weight:500">${fmtEur2(pd.totalDivNet)}</div>
        <div style="text-align:right;color:${knownMarketValues.length > 0 ? 'var(--ink)' : 'var(--ink-3)'};font-weight:500">${knownMarketValues.length > 0 ? fmtEur2(totalKnownMarket) : '-'}${!complete && knownMarketValues.length > 0 ? '<span class="hold-inline-meta">partial</span>' : ''}</div>
        <div style="text-align:right;color:${knownMarketValues.length > 0 && totalKnownUnrealized >= 0 ? 'var(--pos)' : knownMarketValues.length > 0 ? 'var(--neg)' : 'var(--ink-3)'};font-weight:500">${complete && hasGlobalCostBasis && knownMarketValues.length > 0 ? fmtEurNeg(totalKnownUnrealized, 2) : '-'}</div>
      </div>
    </div>`;

  // Attach info-tips in the freshly-rendered table header
  const portTable = document.getElementById('port-table');
  if (portTable) attachInfoTips(portTable);

  // Bind sort handler on header row
  bindSortedTableHeader(
    document.getElementById('port-table-header'),
    _holdTableState.sort,
    (newState) => {
      setTableSort(_holdTableState, newState);
      renderHoldingsTable(pd, snaps);
    },
  );

  // Delegated on the static #port-table, so they survive the innerHTML re-render.
  const portTableEl = document.getElementById('port-table');
  bindChipGroup(document.getElementById('port-account-filter'), 'hold-account', (value) => {
    setTableFilter(_holdTableState, 'account', value, {
      rerender: () => renderHoldingsTable(pd, snaps),
    });
    const buttons = document.querySelectorAll<HTMLButtonElement>('#port-account-filter button');
    [...buttons].find((button) => button.dataset.holdAccount === value)?.focus();
  });
  _holdRender = () => renderHoldingsTable(pd, snaps);
  bindChipGroup(portTableEl, 'filter', (value) => {
    if (value === (getTableFilter(_holdTableState, 'status') || 'held')) return;
    setTableFilter(_holdTableState, 'status', value || 'held', {
      resetSort: true,
      rerender: () => _holdRender?.(),
    });
  });
  bindSearchClear(portTableEl);
  if (portTableEl && !portTableEl.dataset.holdClearBound) {
    portTableEl.dataset.holdClearBound = '1';
    portTableEl.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('[data-clear-hold-search]')) return;
      _holdTableState.filters.account = '';
      _holdTableState.filters.status = 'held';
      setTableFilter(_holdTableState, 'search', '', { rerender: () => _holdRender?.() });
      document.getElementById('port-holdings-search')?.focus();
    });
  }

  // Bind search input (re-bound each render since the element is recreated)
  const searchInput = document.getElementById('port-holdings-search') as HTMLInputElement | null;
  if (searchInput) {
    searchInput.addEventListener('input', (event) => {
      const input = event.currentTarget as HTMLInputElement;
      setTableFilter(_holdTableState, 'search', input.value, {
        rerender: () => renderHoldingsTable(pd, snaps),
      });
      const nextInput = document.getElementById('port-holdings-search') as HTMLInputElement | null;
      if (nextInput) {
        nextInput.focus();
        const pos = getTableFilter(_holdTableState, 'search').length;
        nextInput.setSelectionRange(pos, pos);
      }
    });
  }

  // Row tap-to-expand detail panel (delegated on #port-table)
  const tbl = document.getElementById('port-table');
  bindExpandableRows({
    container: tbl,
    rowSelector: '.hold-row:not(.th)',
    detailSelector: '.hold-detail',
    getItem: (row) => {
      const etfKey = row.dataset.etfKey;
      return etfKey ? _pageItemsByKey.get(etfKey) : undefined;
    },
    createDetail: (_row, item) => _createHoldingDetail(item),
    onExpandedChange: (detailRow, expanded) => {
      const key = detailRow.dataset.etfKey;
      if (key) setCollapsed('hold:' + key, expanded);
    },
  });

  // Restore previously expanded hold row (if still on this page)
  restoreExpandableRows({
    container: tbl,
    rowSelector: '.hold-row:not(.th)',
    detailSelector: '.hold-detail',
    getItem: (row) => {
      const etfKey = row.dataset.etfKey;
      return etfKey ? _pageItemsByKey.get(etfKey) : undefined;
    },
    createDetail: (_row, item) => _createHoldingDetail(item),
    isExpanded: (row) => {
      const etfKey = row.dataset.etfKey;
      return !!etfKey && isCollapsed('hold:' + etfKey);
    },
  });

  // Holdings pagination controls
  renderHoldPagination(totalPages, defaultOrdered.length, pd, snaps);
}

function renderHoldPagination(
  totalPages: number,
  totalItems: number,
  pd: PortfolioData,
  snaps: Snapshot[],
): void {
  renderPagination(
    'port-pagination',
    _holdTableState.page,
    totalPages,
    (p) => {
      setTablePage(_holdTableState, p);
      renderHoldingsTable(pd, snaps);
    },
    {
      totalItems,
      pageSize: _holdPageSize.size,
      pageSizeOptions: _holdPageSize.options,
      itemLabel: 'holdings',
      onPageSizeChange: (size) => {
        _holdPageSize.set(size);
        setTablePage(_holdTableState, 1);
        renderHoldingsTable(pd, snaps);
      },
    },
  );
}

function _createHoldingDetail(e: HoldingRow): HTMLElement {
  const meta = getMETAMap()[e.isin] || {};
  const allocation = meta.active ? 'Active' : 'Inactive';
  const acc = e.acc ? 'Accumulating' : 'Distributing';
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
    <div><span class="hold-detail-label">Position</span><span class="hold-detail-value"${e.kind === 'valuation' ? ' title="No transaction data; only saved valuations are available."' : ''}>${e.kind === 'valuation' ? 'Valuation only' : isExitedRow(e) ? 'Closed' : 'Held'}</span></div>
    <div><span class="hold-detail-label">Allocation</span><span class="hold-detail-value">${allocation}</span></div>
    <div><span class="hold-detail-label">Type</span><span class="hold-detail-value">${acc}</span></div>
    ${detailColRows}
    ${
      scopedSnapshot(_holdingSnapshot)
        ? `<details class="hold-detail-accounts"><summary>Account values · ${fmtMon(_holdingSnapshot!.date)}</summary><div class="hold-account-heading"><span class="note">Values only; cost basis and P&amp;L remain portfolio-wide.</span></div>${getAccounts()
            .map((account) => {
              const id = account.id || account.key || '';
              const value = accountPositionValues(_holdingSnapshot!, id)[e.isin];
              if (value === undefined) return '';
              const selected = getTableFilter(_holdTableState, 'account') === id;
              const coverage = _holdingSnapshot![coverageKey(id)];
              const status =
                coverage === 1 ? '' : coverage === 0 ? ' · partial' : ' · coverage unknown';
              const closed = isAccountClosedInMonth(account, _holdingSnapshot!.date)
                ? ' · closed'
                : '';
              return `<div class="hold-account-row"><span>${esc(account.label)}${selected ? ' (selected)' : ''}${closed}<span class="hold-account-status">${status.replace(' · ', '')}</span></span><span class="hold-detail-value">${selected ? `<strong>${fmtEur2(value)}</strong>` : fmtEur2(value)}</span></div>`;
            })
            .join(
              '',
            )}<div class="hold-account-row hold-account-total"><span>Recorded subtotal${!hasCompletePositionCoverage(_holdingSnapshot, getAccounts()) ? '<span class="hold-account-status">Partial coverage</span>' : ''}</span><span class="hold-detail-value">${extractSnapEtfValues(_holdingSnapshot)[e.isin] === undefined ? '-' : fmtEur2(extractSnapEtfValues(_holdingSnapshot)[e.isin])}</span></div></details>`
        : ''
    }`;
  return panel;
}

/**
 * Renders the Portfolio tab: KPI row, holdings table, cost-basis donut/bar,
 * and the allocation-drift card. No-op (shows the empty state) if `pd` is null.
 */
export function renderPortfolio(pd: PortfolioData | null, snaps: Snapshot[]): void {
  const ISIN_ORDER = getISIN_ORDERList();
  const latest = snaps.length > 0 ? snaps[snaps.length - 1] : null;
  const has =
    (pd && Object.keys(pd.etfs).length > 0) || Object.keys(extractSnapEtfValues(latest)).length > 0;
  document.getElementById('port-empty')!.style.display = has ? 'none' : 'block';
  document.getElementById('port-content')!.style.display = has ? 'block' : 'none';
  if (!has) return;
  pd ??= {
    etfs: {},
    divHist: [],
    intHist: [],
    monthly: {},
    monthlyBy: {},
    months: [],
    totalInv: 0,
    totalDivNet: 0,
    totalTax: 0,
    totalFees: 0,
    totalInterest: 0,
    totalIntGross: 0,
    totalIntTax: 0,
    realizedPnL: 0,
    interestBySource: {},
    taxBySource: {},
  };

  setTablePage(_holdTableState, 1);
  _holdTableState.sort = { key: null, dir: null };
  _holdTableState.filters.status = 'held';
  _holdTableState.filters.search = '';
  const accountFilter = getTableFilter(_holdTableState, 'account');
  if (
    accountFilter &&
    accountFilter !== ':multiple' &&
    !getAccounts().some((account) => (account.id || account.key) === accountFilter)
  )
    _holdTableState.filters.account = '';

  const latSnap = snaps.length > 0 ? snaps[snaps.length - 1] : null;
  const snapEtfValues = extractSnapEtfValues(latSnap);
  const snapHasEtfValues = Object.keys(snapEtfValues).length > 0;
  const complete = !scopedSnapshot(latSnap) || hasCompletePositionCoverage(latSnap!, getAccounts());
  const driftValuation = getDriftValuationPolicy(pd, snaps);
  const allEtfs = ISIN_ORDER.map((s) => pd.etfs[s])
    .filter((e): e is EtfPosition => !!e)
    .concat(Object.values(pd.etfs).filter((e) => !ISIN_ORDER.includes(e.isin)));
  const { held } = splitHoldings(allEtfs as (EtfPosition & { [key: string]: unknown })[]);
  const heldWithMarket = held.filter((e) => snapEtfValues[e.isin] !== undefined);
  const marketValueKnown = heldWithMarket.reduce((sum, e) => sum + (snapEtfValues[e.isin] || 0), 0);
  const costKnown = heldWithMarket.reduce((sum, e) => sum + e.cost, 0);
  const hasValuationOnly = holdingRows(pd, latSnap).some((row) => row.kind === 'valuation');
  const hasKnownPositionValues = complete && !hasValuationOnly && heldWithMarket.length > 0;
  const hasPartialPositionValues =
    !complete || (heldWithMarket.length > 0 && heldWithMarket.length < held.length);
  const snapMarketValue = snapHasEtfValues
    ? Object.values(snapEtfValues).reduce((sum, val) => sum + val, 0)
    : null;
  const curVal = allInvestmentAccountsValue(latSnap, getAccounts());
  const marketValue = snapMarketValue !== null ? snapMarketValue : curVal;
  const gain = hasKnownPositionValues ? marketValueKnown - costKnown : null;
  const gainPct = gain !== null && costKnown > 0 ? (gain / costKnown) * 100 : null;
  const summaryGainBase = snapMarketValue !== null ? snapMarketValue : curVal;
  const summaryGain =
    complete && !hasValuationOnly && summaryGainBase !== null
      ? summaryGainBase - pd.totalInv
      : null;
  const summaryGainPct =
    summaryGain !== null && pd.totalInv > 0 ? (summaryGain / pd.totalInv) * 100 : null;
  const cashUnallocated =
    complete && curVal !== null && snapMarketValue !== null ? curVal - snapMarketValue : null;
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

  const feeDragValues =
    driftValuation.mode === 'market'
      ? snapEtfValues
      : Object.fromEntries(Object.values(pd.etfs).map((e) => [e.isin, e.cost]));
  const feeDrag = computeFeeDrag(Object.values(pd.etfs), getHoldings(), feeDragValues);

  document.getElementById('port-kpis')!.innerHTML = `
    ${kpiTile({
      label: 'Market value',
      lead: true,
      value: marketValue !== null ? fmtEur2(marketValue) : '-',
      sub:
        marketValue !== null
          ? 'from ' +
            fmtMon(latSnap!.date) +
            ' snapshot' +
            (!complete ? ' · partial position coverage' : '')
          : latSnap
            ? 'no primary investment account flagged'
            : 'add a snapshot',
    })}
    ${kpiGroup(
      'Costs and gains',
      [
        {
          label: `Total invested${infoTip('Cost basis: what you paid for the shares you still own. Sold shares are removed, so this is not the same as everything you have ever put in.')}`,
          value: fmtEur(pd.totalInv),
          sub: 'cost of shares still owned',
        },
        {
          label: `Unrealized P&amp;L${infoTip('Gain or loss on positions still held. Computed as market value minus invested capital (cost basis). Not locked in until you sell.')}`,
          value: gain !== null ? fmtEurNeg(gain, 2) : '-',
          valueClass: gain === null ? '' : gain >= 0 ? 'pos' : 'neg',
          sub:
            gainPct !== null
              ? `${fmtPctNeg(gainPct)}${hasPartialPositionValues ? ' · valued holdings only' : ''}`
              : hasPartialPositionValues
                ? 'valued holdings only'
                : '',
        },
        {
          label: `Realized P&amp;L${infoTip('Gain or loss already locked in from shares you have sold. Computed as sell proceeds minus the cost basis of those shares, including fees.')}`,
          value: fmtEurNeg(pd.realizedPnL, 2),
          valueClass: pd.realizedPnL >= 0 ? 'pos' : 'neg',
          sub: 'locked in from sales',
        },
        feeDrag !== null
          ? {
              label: `Annual fee drag${infoTip('Estimated annual cost of fund management fees (TER) across all held positions. These costs are deducted by the fund manager directly from the fund assets, so they are already reflected in the ETF price and your returns. This figure is informational only; no money is deducted from your balance. Computed as the sum of each position value multiplied by its configured TER. Add TER values in Settings to see this figure. Positions without a TER configured are excluded.')}`,
              value: fmtEur2(feeDrag.annualCost),
              valueClass: 'neg',
              sub: `${fmtPctVal(feeDrag.costPct * 100)}/yr · already in fund prices${feeDrag.coveredCount < Object.values(pd.etfs).filter((e) => !e.exited).length ? ' (partial)' : ''}`,
            }
          : {
              label: `Annual fee drag${infoTip('Estimated annual cost of fund management fees (TER) across all held positions. These costs are deducted by the fund manager directly from the fund assets, so they are already reflected in the ETF price and your returns. This figure is informational only; no money is deducted from your balance. Add TER values to your holdings in Settings to enable this calculation.')}`,
              value: '-',
              sub: 'add TER in Settings',
            },
      ],
      { result: false },
    )}
  `;

  // Attach info-tips in the KPI row
  const portKpis = document.getElementById('port-kpis');
  if (portKpis) attachInfoTips(portKpis);

  // Render holdings table (filter-dependent)
  renderHoldingsTable(pd, snaps);

  _renderCostBasisChart(
    held.filter((e) => e.cost > 0).sort((a, b) => b.cost - a.cost),
    pd.totalInv,
    (isin) => _revealHolding(pd, snaps, isin),
  );
  const mvRow =
    snapMarketValue !== null
      ? `<div class="row"><div class="row-label">Market value (positions)${!complete ? ' · partial recorded subtotal' : ''}</div><div class="row-val">${fmtEur2(snapMarketValue)}</div></div>`
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
      ? `<div class="row" style="border-top:1px solid var(--line-2);margin-top:4px"><div class="row-label" style="font-weight:600">Total return ${infoTip('Unrealized gain + realized gain + dividends and interest after tax withheld − fees. An amount over the whole history, not a yearly return.')}</div><div class="row-val ${totalReturn >= 0 ? 'pos' : 'neg'}" style="font-weight:600">${fmtEurNeg(totalReturn, 2)}</div></div>`
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
    <details class="inline-details port-income-details">
    <summary>Income &amp; costs<span class="inline-details-sub">dividends, interest, taxes, fees</span></summary>
    <div class="row"><div class="row-label">Dividends (gross)</div><div class="row-val ok">${fmtEur2(totalDivGross)}</div></div>
    <div class="row"><div class="row-label">Tax withheld on dividends</div><div class="row-val ${pd.totalTax > 0 ? 'neg' : 'ok'}">${fmtEur2(pd.totalTax)}</div></div>
    <div class="row"><div class="row-label">Interest received (gross)</div><div class="row-val ok">${fmtEur2(totalInterestGross)}</div></div>
    ${renderSourceBreakdown(interestGrossBySource)}
    <div class="row"><div class="row-label">Tax on savings</div><div class="row-val ${pd.totalIntTax > 0 ? 'neg' : 'ok'}">${fmtEur2(pd.totalIntTax)}</div></div>
    <div class="row"><div class="row-label">Fees</div><div class="row-val">${fmtEur2(pd.totalFees)}</div></div>
    </details>
    ${totalReturnRow}
    <p class="note">Cost basis exact from CSV. ${valueNote} Non-EUR transactions are converted to EUR using the imported FX rate.</p>
  `;
  const portSummary = document.getElementById('port-summary');
  if (portSummary) attachInfoTips(portSummary);

  _renderDriftCard(pd, snaps);
}

// ── Drift / rebalance card ──

/** Cadence labels for the rebalance picker. */
const REBALANCE_INTERVAL_LABEL: Record<string, string> = {
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
};

/** Cadence suffix labels for the rebalance table (e.g. "/wk"). */
const REBALANCE_INTERVAL_SUFFIX: Record<string, string> = {
  weekly: '/wk',
  biweekly: '/2wk',
  monthly: '/mo',
  quarterly: '/qtr',
};

/** Stored callback so the picker can re-render the drift card after a month or interval selection. */
let _redrawDrift: ((keepRebalanceOpen?: boolean) => void) | null = null;

const REBALANCE_MONTH_OPTIONS = [1, 2, 3, 6, 12];

function _renderDriftCard(pd: PortfolioData, snaps: Snapshot[], keepRebalanceOpen = false): void {
  const driftEl = document.getElementById('port-drift');
  if (!driftEl) return;

  // Store a redraw callback so the month picker can trigger a re-render.
  _redrawDrift = (keepOpen = false) => _renderDriftCard(pd, snaps, keepOpen);

  // Extract per-ETF market values from the latest snapshot when available.
  const valuation = getDriftValuationPolicy(pd, snaps);
  const latSnap = valuation.latestSnapshot;
  const hasSnapValues = valuation.hasAnySnapshotEtfValues;
  const totalValue = valuation.totalValue;

  const drift = portfolioDrift(pd, valuation);

  if (drift.length === 0) {
    disposeChart('c-port-drift');
    driftEl.innerHTML = '';
    return;
  }

  const max = maxDrift(drift);
  const status = driftStatus(max, getAlertSettings().driftThresholdPct);
  const noteSource =
    valuation.mode === 'market'
      ? `Actual from market values (snapshot: ${fmtMon(latSnap!.date)}). Legacy = inactive positions still held.`
      : hasSnapValues
        ? `Actual from cost basis (partial ETF snapshot coverage). Legacy = inactive positions still held.`
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
  const rawCalibrationInterval =
    localStorage.getItem('drift-calibration-interval') || getCalibrationInterval();
  const calibrationInterval: import('../types').ContribInterval =
    rawCalibrationInterval === 'weekly' ||
    rawCalibrationInterval === 'biweekly' ||
    rawCalibrationInterval === 'monthly' ||
    rawCalibrationInterval === 'quarterly'
      ? rawCalibrationInterval
      : 'monthly';
  const monthlyBudget = getAccounts().some(
    (account) =>
      account.isPrimaryInvestment &&
      account.moneyType?.toLowerCase() === 'investment' &&
      isAccountOpenNow(account),
  )
    ? getMonthlyContribBudget()
    : 0;

  const plan = computeRebalancePlan(
    drift,
    monthlyBudget,
    totalValue,
    selectedMonths,
    calibrationInterval,
  );

  // Check whether any holding remains overweight even at a 12-month horizon.
  const plan12 = computeRebalancePlan(drift, monthlyBudget, totalValue, 12, calibrationInterval);
  const needsSell = plan12.some((e) => e.projectedDriftPct > 0.05);

  let rebalanceSection = '';
  // Only show the rebalance plan when market values are available for held positions.
  // Cost-basis drift figures are not reliable enough to base contribution decisions on.
  // When there are no held positions (all cash / re-entry), cost mode is irrelevant and
  // the plan is shown since it is purely contribution-target-based.
  if (plan.length >= 2 && monthlyBudget > 0 && !(hasCostMode && valuation.hasHeldPositions)) {
    // Same scale as the drift chart: suggested once drift is high for the alert threshold.
    const isRebalanceRecommended = status.level === 'high';
    // Collapsed by default so the drift chart stays the focus; the summary flags
    // when the what-if is suggested and the open state survives picker re-renders.
    const shouldOpenRebalance = keepRebalanceOpen;
    const pickerBtns = REBALANCE_MONTH_OPTIONS.map((m) => {
      const active = m === selectedMonths;
      const label = m === 12 ? '1 yr' : `${m} mo`;
      return `<button type="button" class="btn btn-sm btn-ghost ${active ? 'active' : ''}" data-rebalance-months="${m}" aria-pressed="${active ? 'true' : 'false'}">${label}</button>`;
    }).join('');

    const cadenceOptions = (['weekly', 'biweekly', 'monthly', 'quarterly'] as const)
      .map(
        (iv) =>
          `<option value="${iv}"${iv === calibrationInterval ? ' selected' : ''}>${esc(REBALANCE_INTERVAL_LABEL[iv])}</option>`,
      )
      .join('');

    const suffix = esc(REBALANCE_INTERVAL_SUFFIX[calibrationInterval] ?? '');
    const activeCurrentMax = maxDrift(drift.filter((d) => d.targetPct > 0));
    const projectedActiveMax =
      Math.round(Math.max(...plan.map((e) => Math.abs(e.projectedDriftPct))) * 10) / 10;
    const hasLegacyDrift = drift.some((d) => d.targetPct === 0 && Math.abs(d.driftPct) > 0);
    const periodLabel = selectedMonths === 1 ? '1 month' : `${selectedMonths} months`;
    const horizonShort = selectedMonths === 12 ? '1 yr' : `${selectedMonths} mo`;
    const legacyScopeNote = hasLegacyDrift
      ? ' Projection covers active-target holdings only; legacy positions are unchanged.'
      : '';

    const stateLabel: Record<string, string> = {
      overweight: 'Overweight',
      'on-target': 'On target',
      underweight: 'Underweight',
    };
    const rowHtml = (e: (typeof plan)[number]) => {
      const zero = e.suggestedAmt < 0.005;
      return `
        <div class="tbl-row rebalance-plan-row${zero ? ' is-zero' : ''}" role="row" data-rebalance-state="${esc(e.state)}">
          <div role="cell" class="rebalance-etf-cell"><span class="rebalance-name"><span class="rebalance-dot" style="background:${safeColor(e.color)}"></span>${esc(e.shortName)}</span><span class="rebalance-meta"><span class="rebalance-state-${esc(e.state)}">${stateLabel[e.state]}</span> · usual ${fmtEur2(e.targetAmt)}${suffix}</span></div>
          <div role="cell" class="rebalance-amount-cell"><span class="rebalance-amount-primary">${fmtEur2(zero ? 0 : e.suggestedAmt)}<span class="rebalance-amount-suffix">${suffix}</span></span></div>
          <div role="cell" class="rebalance-drift-cell">${fmtPctSigned(e.projectedDriftPct)}</div>
        </div>`;
    };
    const funded = plan.filter((e) => e.suggestedAmt >= 0.005);
    const unfunded = plan.filter((e) => e.suggestedAmt < 0.005);
    // Fold the €0 rows only when there are several; a single one reads fine inline.
    const foldZero = unfunded.length > 1 && funded.length > 0;
    const zeroRows = foldZero
      ? `<details class="rebalance-zero"><summary class="rebalance-zero-summary">${unfunded.length} holdings get ${fmtEur2(0)} this period</summary>${unfunded.map(rowHtml).join('')}</details>`
      : unfunded.map(rowHtml).join('');

    const disclaimer = `What-if for new contributions only: routing the suggested amounts for ${periodLabel} with a ${fmtEur(monthlyBudget)}/mo budget. It assumes no selling and no market movement, so actual results will vary. It is not buy or sell advice.${legacyScopeNote}`;
    const sellNote = needsSell
      ? `<p class="rebalance-sell-note">Some holdings stay above target after 12 months at this <span class="rebalance-nowrap">budget.&nbsp;${infoTip('A partial sell could rebalance faster. Account for taxes and trading fees before acting; this is not buy or sell advice.')}</span></p>`
      : '';

    rebalanceSection = `
      <details class="rebalance-collapsible" ${shouldOpenRebalance ? 'open' : ''}>
        <summary class="rebalance-summary">
          Rebalance with contributions
          <span class="rebalance-summary-note${isRebalanceRecommended ? ' is-suggested' : ''}">${isRebalanceRecommended ? 'Suggested · high drift' : 'Drift is moderate or low'}</span>
        </summary>
        <div class="rebalance-body">
          <div class="filter-bar rebalance-controls">
            <div class="range-toggle filter-chips rebalance-range-toggle" role="group" aria-label="Rebalance timeline">
              ${pickerBtns}
            </div>
            <select class="form-input form-input-sm" data-rebalance-interval aria-label="Contribution cadence">${cadenceOptions}</select>
          </div>
          <p class="rebalance-result">Max drift <strong>${fmtPctVal(activeCurrentMax)} → ${fmtPctVal(projectedActiveMax)}</strong> after ${periodLabel} <span class="rebalance-result-meta">· ${fmtEur(monthlyBudget)}/mo budget&nbsp;${infoTip(disclaimer)}</span></p>
          <div class="tbl rebalance-plan" role="table" aria-label="Contribution rebalance plan">
            <div class="tbl-row th rebalance-plan-row" role="row">
              <div role="columnheader">Holding</div>
              <div role="columnheader" style="text-align:right">Suggested</div>
              <div role="columnheader" style="text-align:right">After ${horizonShort}</div>
            </div>
            ${funded.map(rowHtml).join('')}
            ${zeroRows}
          </div>
          <p class="note rebalance-note">Estimate for new contributions only: no selling, no market moves.</p>
          ${sellNote}
        </div>
      </details>`;
  } else if (plan.length >= 2 && monthlyBudget <= 0) {
    rebalanceSection = `<p class="note" style="margin-top:.5rem">Set your contribution amount and cadence in Settings to see the rebalance plan.</p>`;
  }
  const driftTip = `${noteSource} Drift = actual minus target share, in percentage points. The shaded band is your alert threshold (±${fmtPctVal(status.threshold, 'auto')}, set in Settings). Hover or tap a bar for target, actual and the euro gap; click it to open the holding.`;
  const keptWrap = document.getElementById('c-port-drift')?.parentElement ?? null;
  driftEl.innerHTML = `
    <div class="card">
      <div class="card-title drift-title">Allocation drift ${infoTip(driftTip)}<span class="drift-title-status" style="color:${status.color}">${status.label} · max ${fmtPctVal(max)}</span></div>
      ${costModeBanner}
      <div class="chart-wrap chart-h-fit"><div id="c-port-drift" class="chart-host" role="img" aria-label="Allocation drift per holding: ${esc(status.label)}, max ${esc(fmtPctVal(max))}"></div></div>
      ${rebalanceSection}
    </div>`;
  // Reuse the live chart host so re-renders (e.g. rebalance picker) update it in place.
  const freshHost = document.getElementById('c-port-drift');
  if (keptWrap && freshHost) {
    freshHost.parentElement!.replaceWith(keptWrap);
    keptWrap.firstElementChild!.setAttribute('aria-label', freshHost.getAttribute('aria-label')!);
  }
  _renderDriftChart(drift, status.threshold, (isin) => _revealHolding(pd, snaps, isin));

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

  driftEl.querySelectorAll<HTMLSelectElement>('[data-rebalance-interval]').forEach((sel) => {
    sel.addEventListener('change', () => {
      const details = sel.closest('.rebalance-collapsible') as HTMLDetailsElement | null;
      const keepOpen = details?.open ?? false;
      const iv = sel.value || 'monthly';
      localStorage.setItem('drift-calibration-interval', iv);
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
  const valuation = getDriftValuationPolicy(pd, snaps);
  const drift = portfolioDrift(pd, valuation);
  if (drift.length === 0) return null;
  return maxDrift(drift);
}

// ── Drift chart ──

/** Diverging bars: drift in pp per holding, largest gap first, alert band around zero. */
function _renderDriftChart(
  drift: DriftEntry[],
  threshold: number,
  onSelect: (isin: string) => void,
): void {
  const rows = [...drift].sort(
    (a, b) => Math.abs(b.driftPct) - Math.abs(a.driftPct) || a.shortName.localeCompare(b.shortName),
  );
  const host = document.getElementById('c-port-drift');
  const wrap = host?.parentElement;
  if (wrap) {
    const fitH = Math.min(560, Math.max(150, rows.length * 36 + 30));
    wrap.style.setProperty('--chart-fit-h', `${fitH}px`);
  }
  const maxAbs = Math.max(threshold * 1.5, ...rows.map((d) => Math.abs(d.driftPct)));
  // Symmetric axis with room for the value labels outside the bars; ticks at ±ext/2 and ±ext.
  const step = [1, 2, 2.5, 5, 10, 20, 25, 50].find((s) => s * 2 >= maxAbs * 1.3) ?? 50;
  const ext = step * 2;
  const isLegacy = (d: DriftEntry) => d.targetPct === 0;
  const levelColor = (t: ChartTokens, d: DriftEntry) => {
    const level = driftStatus(d.driftPct, threshold).level;
    return level === 'high' ? t.neg : level === 'moderate' ? t.warn : t.pos;
  };
  const sub = (d: DriftEntry) =>
    isLegacy(d)
      ? `${fmtPctVal(d.actualPct)} · legacy`
      : `${fmtPctVal(d.actualPct)} of ${fmtPctVal(d.targetPct)}`;

  renderChart(
    'c-port-drift',
    ({ tokens: t, width, touch }) => ({
      tooltip: {
        trigger: 'item',
        confine: true,
        formatter: (p: unknown) => {
          const d = rows[(p as { dataIndex: number }).dataIndex];
          if (!d) return '';
          const row = (name: string, val: string, color?: string) =>
            `<div class="ec-tt-row"><span class="ec-tt-name">${name}</span><span class="ec-tt-val"${
              color ? ` style="color:${color}"` : ''
            }>${esc(val)}</span></div>`;
          return `<div class="ec-tt"><div class="ec-tt-title">${esc(d.shortName)}</div>${
            d.name
              ? `<div class="ec-tt-note" style="font-style:normal;margin:0 0 4px">${esc(d.name)}</div>`
              : ''
          }${row('Target', isLegacy(d) ? 'Legacy (0%)' : fmtPctVal(d.targetPct))}${row(
            'Actual',
            fmtPctVal(d.actualPct) + (d.valuationMode === 'cost' ? ' (cost)' : ''),
          )}${row('Drift', fmtPctSigned(d.driftPct), levelColor(t, d))}${row(
            d.deltaValue >= 0 ? 'Above target' : 'Below target',
            fmtEurSigned(d.deltaValue),
          )}${tooltipHint(drillHint({ touch }, 'show it in Holdings'))}</div>`;
        },
      },
      grid: { left: 4, right: 8, bottom: 4, containLabel: true },
      xAxis: {
        type: 'value',
        min: -ext,
        max: ext,
        interval: ext / 2,
        axisLabel: { formatter: (v: number) => fmtPctSigned(v, 0) },
      },
      yAxis: {
        type: 'category',
        inverse: true,
        data: rows.map((d) => d.shortName),
        axisLine: { show: false, onZero: false },
        axisTick: { show: false },
        axisLabel: {
          width: width > 0 ? Math.max(76, Math.round(width * 0.28)) : 120,
          overflow: 'truncate',
          formatter: (_: string, i: number) => {
            const d = rows[i];
            return d ? `{n|${d.shortName}}\n{s|${sub(d)}}` : '';
          },
          rich: {
            n: { color: t.ink2, fontSize: 12, fontWeight: 500, lineHeight: 15 },
            s: { color: t.ink3, fontSize: 10, lineHeight: 13 },
          },
        },
      },
      series: [
        {
          name: 'Drift',
          type: 'bar',
          barMaxWidth: 18,
          label: {
            show: true,
            fontSize: 11,
            fontWeight: 600,
            formatter: (p: { dataIndex: number }) => fmtPctSigned(rows[p.dataIndex]?.driftPct ?? 0),
          },
          markArea: {
            silent: true,
            itemStyle: { color: toRgba(t.pos, 0.08) },
            data: [[{ xAxis: -threshold }, { xAxis: threshold }]],
          },
          markLine: {
            silent: true,
            symbol: 'none',
            label: { show: false },
            lineStyle: { color: t.line2, type: 'solid', width: 1 },
            data: [{ xAxis: 0 }],
          },
          data: rows.map((d) => {
            const inside = Math.abs(d.driftPct) > ext * 0.6;
            const neg = d.driftPct < 0;
            return {
              value: d.driftPct,
              // Long bars carry their label inside so it never runs into the axis labels.
              label: inside
                ? { position: neg ? 'insideLeft' : 'insideRight', color: '#fff' }
                : { position: neg ? 'left' : 'right', color: levelColor(t, d) },
              itemStyle: {
                color: safeColor(d.color),
                opacity: isLegacy(d) ? 0.55 : 1,
                borderRadius: neg ? [4, 0, 0, 4] : [0, 4, 4, 0],
              },
            };
          }),
        },
      ],
    }),
    {
      valueFormatter: (v) => fmtPctSigned(v),
      drill: {
        axis: 'y',
        resolve: (v) => rows[Math.round(v)]?.isin ?? null,
        select: onSelect,
      },
    },
  );
}

// ── Cost basis chart ──

/** Cost-basis drill-down: narrow the holdings table to one ISIN and expand its row. */
function _revealHolding(pd: PortfolioData, snaps: Snapshot[], isin: string): void {
  setTableFilter(_holdTableState, 'account', '');
  if (getTableFilter(_holdTableState, 'status') === 'closed')
    setTableFilter(_holdTableState, 'status', 'held');
  setTableFilter(_holdTableState, 'search', isin);
  setCollapsed('hold:' + isin, true);
  renderHoldingsTable(pd, snaps);
  const row = [...document.querySelectorAll<HTMLElement>('#port-table .hold-row:not(.th)')].find(
    (r) => r.dataset.etfKey === isin,
  );
  revealElement(row ?? null);
}

function _renderCostBasisChart(
  rows: EtfPosition[],
  totalInv: number,
  onSelect: (isin: string) => void,
): void {
  const host = document.getElementById('c-port-donut');
  if (!host) return;
  if (rows.length === 0) {
    disposeChart('c-port-donut');
    host.innerHTML = '<div class="chart-empty">No open positions with a cost basis yet.</div>';
    return;
  }
  host.querySelector('.chart-empty')?.remove();
  // Size the bar chart to its rows so a few holdings don't leave a tall, mostly empty chart.
  const wrap = host.parentElement;
  if (wrap) {
    const fitH = Math.min(380, Math.max(140, rows.length * 28 + 52));
    wrap.style.setProperty('--chart-fit-h', `${fitH}px`);
  }
  const share = (cost: number) => (totalInv > 0 ? fmtPctVal((cost / totalInv) * 100) : '0%');
  const fullName = (e: EtfPosition) =>
    getHoldings().find((x) => x.isin === e.isin)?.name || e.name || '';

  renderChart(
    'c-port-donut',
    ({ tokens: t, width, touch }) => ({
      tooltip: {
        trigger: 'item',
        confine: true,
        formatter: (p: unknown) => {
          const e = rows[(p as { dataIndex: number }).dataIndex];
          if (!e) return '';
          const name = fullName(e);
          return `<div class="ec-tt"><div class="ec-tt-title">${esc(e.shortName)}</div>${
            name
              ? `<div class="ec-tt-note" style="font-style:normal;margin:0 0 4px">${esc(name)}</div>`
              : ''
          }<div class="ec-tt-row"><span class="ec-tt-name">Cost basis</span><span class="ec-tt-val">${esc(
            fmtEur2(e.cost),
          )}</span></div><div class="ec-tt-row"><span class="ec-tt-name">Share</span><span class="ec-tt-val">${esc(
            share(e.cost),
          )}</span></div><div class="ec-tt-row ec-tt-foot"><span class="ec-tt-name">ISIN</span><span class="ec-tt-val">${esc(
            e.isin,
          )}</span></div>${tooltipHint(drillHint({ touch }, 'show it in Holdings'))}</div>`;
        },
      },
      grid: { left: 4, right: 48, bottom: 4, containLabel: true },
      xAxis: {
        type: 'value',
        splitNumber: 3,
        axisLabel: { formatter: fmtEurCompact },
      },
      yAxis: {
        type: 'category',
        inverse: true,
        data: rows.map((e) => e.shortName),
        axisTick: { show: false },
        axisLabel: {
          color: t.ink2,
          fontSize: 12,
          width: width > 0 ? Math.max(80, Math.round(width * 0.32)) : 140,
          overflow: 'truncate',
        },
      },
      series: [
        {
          name: 'Cost basis',
          type: 'bar',
          barMaxWidth: 22,
          label: {
            show: true,
            position: 'right',
            color: t.ink3,
            fontSize: 11,
            formatter: (p: { dataIndex: number }) => share(rows[p.dataIndex]?.cost ?? 0),
          },
          data: rows.map((e) => ({
            value: e.cost,
            itemStyle: { color: safeColor(e.color), borderRadius: [0, 4, 4, 0] },
          })),
        },
      ],
    }),
    {
      valueFormatter: fmtEur2,
      drill: {
        axis: 'y',
        resolve: (v) => rows[Math.round(v)]?.isin ?? null,
        select: onSelect,
      },
    },
  );
}
