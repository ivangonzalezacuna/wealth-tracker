import { fmtEur, fmtEur2, fmtMon, esc, safeColor, kpiTile } from '../utils';
import { getISIN_ORDERList, getISIN, getMETAMap } from '../constants';
import { getMonthlyContribBudget, getAccounts } from '../store/config';
import { annualizeContrib, INTERVAL_LABELS } from '../model/contributions';
import type { PortfolioData, Snapshot, Account } from '../types';
import { bindSortedTableHeader, renderTableSection } from './tableView';
import type { ColumnDef } from './tableColumns';
import { renderPagination } from './pagination';
import { infoTip, attachInfoTips } from '../ui/infoTip';
import { populateYearFilterOptions } from './yearFilter';
import {
  bindTableYearFilter,
  createTableState,
  getTableFilter,
  setTablePage,
  setTableSort,
} from './tableState';
import {
  addMonths,
  axisTooltip,
  drillHint,
  fmtEurCompact,
  horizonLabel,
  horizonMonths,
  monthTimeAxis,
  monthToTime,
  renderChart,
  toRgba,
} from './charts';
import { drillToTransactions } from './drill';
import { TxType } from '../types';

const DCA_PAGE_SIZE = 12;
const _dcaTableState = createTableState({ sort: { key: null, dir: null }, filters: { year: '' } });
let _lastPd: PortfolioData | null = null;
let _dcaFcMonths = 60; // visible forecast horizon (follows the chart zoom)

/**
 * Renders the Contributions (DCA) tab: monthly-total KPI tiles, the
 * per-ETF stacked contribution chart, and the month-by-month table.
 */
export function renderDCA(pd: PortfolioData | null, snaps: Snapshot[]): void {
  const ISIN_ORDER = getISIN_ORDERList();
  const ISIN = getISIN();
  const META = getMETAMap();
  const has = pd && pd.months.length > 0;
  document.getElementById('dca-empty')!.style.display = has ? 'none' : 'block';
  document.getElementById('dca-content')!.style.display = has ? 'block' : 'none';
  if (!has) return;

  _lastPd = pd;

  const total = pd.totalInv;
  const n = pd.months.length;
  const avg = n > 0 ? total / n : 0;
  const lastM = pd.months[n - 1];
  const lastAmt = pd.monthly[lastM] || 0;

  document.getElementById('dca-kpis')!.innerHTML = `
    ${kpiTile({ label: `Current cost basis${infoTip('The sum of purchase costs for all current open positions, net of any sold shares. Does not include positions fully exited.')}`, value: fmtEur(total), sub: 'shares still owned' })}
    ${kpiTile({ label: 'Active months', value: String(n), sub: `${fmtMon(pd.months[0])} \u2192 ${fmtMon(lastM)}` })}
    ${kpiTile({ label: `Avg / month${infoTip('Current cost basis divided by the number of active months. Sold shares are excluded, so this is not your lifetime average contribution.')}`, value: fmtEur(avg), sub: 'cost basis ÷ active months' })}
    ${kpiTile({ label: 'Latest month', value: fmtEur(lastAmt), sub: `purchases in ${fmtMon(lastM)}` })}
  `;
  attachInfoTips(document.getElementById('dca-kpis')!);

  const allSyms = [...new Set(pd.months.flatMap((m) => Object.keys(pd.monthlyBy[m] || {})))];
  const ordSyms = ISIN_ORDER.filter((s) => allSyms.includes(s)).concat(
    allSyms.filter((s) => !ISIN_ORDER.includes(s)),
  );

  renderDCAChart(pd, ordSyms, ISIN, META);

  // DCA table with filtering + pagination
  populateYearFilterOptions(
    'dca-year-filter',
    pd.months.map((date) => ({ date })),
  );
  attachDCAFilterListeners(pd);
  renderDCATable(pd);

  // Contributions forecast (cumulative cash invested)
  const accounts = getAccounts();
  _renderDCAForecast(pd, accounts);
}

// ── Forecast helpers ──────────────────────────────────────

function _renderDCAForecast(pd: PortfolioData, accounts: Account[]): void {
  const projCard = document.getElementById('dca-proj-card');
  if (!projCard) return;

  // Filter to investment + pension accounts only
  const forecastAccounts = accounts.filter((a) => {
    const type = (a.moneyType || '').toLowerCase();
    return type === 'investment' || type === 'pension' || type === 'avd';
  });

  // Monthly contribution rate: sum of all investment + pension contributions (personal + extra)
  const monthlyContrib = forecastAccounts.reduce((sum, a) => {
    if (a.isPrimaryInvestment && (a.moneyType || '').toLowerCase() === 'investment') {
      return sum + getMonthlyContribBudget();
    }
    const personal = annualizeContrib(a.contribAmount || 0, a.contribInterval || 'monthly') / 12;
    const extra = annualizeContrib(a.extraContrib || 0, a.contribInterval || 'monthly') / 12;
    return sum + personal + extra;
  }, 0);

  if (forecastAccounts.length === 0 || monthlyContrib <= 0) {
    projCard.innerHTML = '';
    return;
  }

  // Historical: cumulative monthly contributions from CSV
  const histMonths = pd.months; // already sorted chronologically
  const histCumulative: number[] = [];
  let cumSum = 0;
  for (const m of histMonths) {
    cumSum += pd.monthly[m] || 0;
    histCumulative.push(cumSum);
  }

  // Base cash: use the authoritative total invested from CSV (pd.totalInv).
  // This accounts for all BUY transactions. Falls back to 0 if no data.
  const baseCash = pd.totalInv || 0;

  // Ensure the last historical point matches the authoritative total
  if (histCumulative.length > 0) {
    histCumulative[histCumulative.length - 1] = baseCash;
  }

  // Forecast starts from the last CSV month
  const lastMonth = histMonths.length > 0 ? histMonths[histMonths.length - 1] : null;
  if (!lastMonth) {
    projCard.innerHTML = '';
    return;
  }

  // Project the longest horizon once; zooming only moves the window (5 years by default).
  const lastTime = monthToTime(lastMonth);
  const histPoints: [number, number][] = histMonths.map((m, i) => [
    monthToTime(m),
    histCumulative[i],
  ]);
  const fcPoints: [number, number][] = [[lastTime, baseCash]];
  let runningTotal = baseCash;
  for (let i = 1; i <= 360; i++) {
    runningTotal += monthlyContrib;
    fcPoints.push([addMonths(lastTime, i), Math.round(runningTotal)]);
  }
  const histStart = histPoints[0][0];
  const horizonEnd = fcPoints[fcPoints.length - 1][0];

  // Per-account contribution summary
  const acctSummaryLines = forecastAccounts
    .map((a) => {
      let contribStr: string;
      if (a.isPrimaryInvestment && (a.moneyType || '').toLowerCase() === 'investment') {
        const monthly = getMonthlyContribBudget();
        contribStr =
          monthly > 0
            ? `${fmtEur(Math.round(monthly))}/mo (from Settings → Contributions)`
            : 'no monthly budget configured';
      } else {
        const amt = a.contribAmount ?? 0;
        const empAmt = a.extraContrib ?? 0;
        const interval = a.contribInterval || 'monthly';
        const personalStr =
          amt > 0
            ? `${fmtEur(amt)} ${esc((INTERVAL_LABELS[interval] || interval).toLowerCase())}`
            : 'no contributions';
        contribStr = empAmt > 0 ? `${personalStr} + ${fmtEur(empAmt)} extra` : personalStr;
      }
      return `<span style="color:var(--ink-2)">${esc(a.label || 'Account')}: ${contribStr}</span>`;
    })
    .join('<br>');

  projCard.innerHTML = `
    <div class="card">
      <div class="card-title">Cumulative contributions: <span id="dca-proj-range">${horizonLabel(_dcaFcMonths)}</span></div>
      <div class="chart-wrap chart-h-md"><div id="c-dca-proj" class="chart-host" role="img" aria-label="Cumulative contributions forecast chart"></div></div>
      <div class="note" style="line-height:1.6">
        <div style="margin-bottom:4px">Projected monthly contributions (Settings \u2192 Accounts):</div>
        ${acctSummaryLines}
        <div style="margin-top:6px;color:var(--ink-4)">Shows cash moved into investments &amp; pensions. Returns are reflected in the Net Worth forecast.</div>
      </div>
    </div>`;

  renderChart(
    'c-dca-proj',
    ({ tokens: t }) => ({
      legend: {},
      tooltip: {
        trigger: 'axis',
        confine: true,
        formatter: axisTooltip({ value: (v) => fmtEur(v) }),
      },
      xAxis: monthTimeAxis(),
      yAxis: {
        type: 'value',
        scale: true,
        axisLabel: { formatter: fmtEurCompact },
      },
      series: [
        {
          name: 'Actual',
          type: 'line',
          z: 4,
          data: histPoints,
          showSymbol: histPoints.length === 1,
          smooth: 0.3,
          lineStyle: { width: 2.5, color: t.brand },
          itemStyle: { color: t.brand },
        },
        {
          name: 'Projected',
          type: 'line',
          z: 3,
          data: fcPoints,
          showSymbol: false,
          smooth: 0.3,
          lineStyle: { width: 2, type: [5, 3], color: t.brand },
          itemStyle: { color: t.brand },
          areaStyle: { origin: 'start', color: toRgba(t.brand, 0.07) },
          markArea: {
            silent: true,
            itemStyle: { color: toRgba(t.brand, 0.03) },
            label: { show: true, position: 'insideTopLeft', color: t.ink4, fontSize: 10 },
            data: [[{ name: 'Projected', xAxis: lastTime }, { xAxis: horizonEnd }]],
          },
        },
      ],
    }),
    {
      zoom: true,
      xAxisType: 'time',
      window: { startValue: histStart, endValue: addMonths(lastTime, _dcaFcMonths) },
      valueFormatter: fmtEur2,
      // The title follows the zoom window: "Cumulative contributions: 12 years".
      onZoom: ({ endValue }) => {
        _dcaFcMonths = horizonMonths(lastTime, endValue, 360);
        const titleEl = document.getElementById('dca-proj-range');
        if (titleEl) titleEl.textContent = horizonLabel(_dcaFcMonths);
      },
    },
  );
}

// ── Chart with range toggle ──────────────────────────────

function renderDCAChart(
  pd: PortfolioData,
  ordSyms: string[],
  ISIN: Record<string, string>,
  META: Record<string, { color: string }>,
): void {
  const months = pd.months;
  const n = months.length;
  const values = ordSyms.map((sym) => months.map((mo) => (pd.monthlyBy[mo] || {})[sym] || 0));
  // Only the topmost non-zero segment of each stack gets rounded corners.
  const topIdx = months.map((_, j) => {
    for (let i = ordSyms.length - 1; i >= 0; i--) if (values[i][j] > 0) return i;
    return -1;
  });

  renderChart(
    'c-dca-bar',
    ({ tokens: t, touch }) => ({
      legend: {},
      tooltip: {
        trigger: 'axis',
        confine: true,
        axisPointer: { type: 'shadow' },
        formatter: axisTooltip({
          value: (v) => fmtEur2(v),
          hideZero: true,
          footer: (vals) =>
            vals.filter((v) => v > 0).length > 1
              ? { label: 'Total', value: fmtEur2(vals.reduce((s, v) => s + v, 0)) }
              : null,
          hint: drillHint({ touch }, "see this month's purchases"),
        }),
      },
      xAxis: { type: 'category', data: months.map(fmtMon), axisTick: { show: false } },
      yAxis: { type: 'value', axisLabel: { formatter: fmtEurCompact } },
      series: ordSyms.map((sym, i) => {
        const color = META[sym]?.color ? safeColor(META[sym].color) : t.ink4;
        return {
          name: ISIN[sym] || sym,
          type: 'bar' as const,
          stack: 'dca',
          barMaxWidth: 28,
          itemStyle: { color },
          emphasis: { focus: 'series' as const },
          data: values[i].map((v, j) => ({
            value: v,
            itemStyle: { borderRadius: topIdx[j] === i ? [3, 3, 0, 0] : 0 },
          })),
        };
      }),
    }),
    {
      zoom: true,
      xAxisType: 'category',
      // Opens on the last year; zoom out (slider / pinch) for the full history.
      window: n > 12 ? { startValue: n - 12, endValue: n - 1 } : undefined,
      valueFormatter: fmtEur2,
      drill: {
        resolve: (v) => months[Math.round(v)] ?? null,
        select: (month) => drillToTransactions(month, TxType.BUY),
      },
    },
  );
}

// ── DCA table with filtering + pagination ────────────────

function attachDCAFilterListeners(pd: PortfolioData): void {
  bindTableYearFilter({
    elementId: 'dca-year-filter',
    state: _dcaTableState,
    filterKey: 'year',
    rerender: () => renderDCATable(pd),
  });
}

function dcaColumns(pd: PortfolioData): ColumnDef<string>[] {
  return [
    {
      key: 'month',
      label: 'Month',
      sortValue: (m) => m,
      cell: (m) => `<span style="color:var(--ink-2)">${fmtMon(m)}</span>`,
    },
    {
      key: 'invested',
      label: 'Invested',
      align: 'right',
      sortValue: (m) => pd.monthly[m] || 0,
      cell: (m) => `<span style="font-weight:500">${fmtEur(pd.monthly[m])}</span>`,
    },
  ];
}

function renderDCATable(pd: PortfolioData): void {
  const el = document.getElementById('dca-table');
  if (!el) return;

  // Filter months
  let months = [...pd.months].reverse();
  const selectedYear = getTableFilter(_dcaTableState, 'year');
  if (selectedYear) {
    months = months.filter((m) => m.startsWith(selectedYear));
  }

  // Column definitions
  const columns = dcaColumns(pd);

  // Apply sort (before pagination)
  // Calculate filtered total
  const filteredTotal = months.reduce((sum, m) => sum + (pd.monthly[m] || 0), 0);

  const { page, totalPages } = renderTableSection({
    container: el,
    items: months,
    columns,
    sortState: _dcaTableState.sort,
    page: _dcaTableState.page,
    pageSize: DCA_PAGE_SIZE,
    rowClassName: 'tbl-row dca-row',
    headerId: 'dca-table-header',
    emptyHtml: '',
    footerHtml: `<div class="tbl-row dca-row" role="row" style="border-top:1px solid var(--line-2);margin-top:4px">
      <div style="font-weight:500">${selectedYear ? 'Year total' : 'Total'}</div>
      <div style="font-weight:500;text-align:right">${fmtEur(filteredTotal)}</div>
    </div>`,
  });
  setTablePage(_dcaTableState, page);

  // Bind sort handler on header row
  bindSortedTableHeader(
    document.getElementById('dca-table-header'),
    _dcaTableState.sort,
    (newState) => {
      setTableSort(_dcaTableState, newState);
      renderDCATable(pd);
    },
  );

  // Pagination controls
  renderDCAPagination(totalPages, months.length, pd);
}

function renderDCAPagination(totalPages: number, totalItems: number, pd: PortfolioData): void {
  renderPagination(
    'dca-pagination',
    _dcaTableState.page,
    totalPages,
    (p) => {
      setTablePage(_dcaTableState, p);
      renderDCATable(pd);
    },
    { totalItems, pageSize: DCA_PAGE_SIZE },
  );
}
