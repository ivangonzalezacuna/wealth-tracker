// @ts-nocheck - DOM-heavy view; full strict typing deferred to framework migration
import { fmtEur, fmtMon, esc, safeColor } from '../utils';
import { getISIN_ORDERList, getISIN, getMETAMap } from '../constants';
import { getTotalAnnualContrib, getAccounts } from '../store/config';
import { annualizeContrib, INTERVAL_LABELS } from '../model/contributions';
import type { PortfolioData, Snapshot, Account } from '../types';
import Chart from 'chart.js/auto';
import { T, resolvedT } from '../theme';
import { bindLegendToggle, renderLegendHtml } from './chartLegend';
import type { SortState } from './tableSort';
import { applySort, bindSortableHeader } from './tableSort';
import type { ColumnDef } from './tableColumns';
import { renderTableHeader, renderTableRow, getSortGetters } from './tableColumns';
import { renderPagination } from './pagination';

const CH: Record<string, Chart> = {};
const DCA_PAGE_SIZE = 12;
let _dcaPage = 1;
let _dcaYear = '';
let _dcaRange = 'all'; // '12', '36', 'all'
let _dcaTblSort: SortState = { key: null, dir: null };
let _lastPd: PortfolioData | null = null;
let _dcaFcRange: '60' | '120' | '240' = '60'; // 5y / 10y / 20y forecast horizon

export function renderDCA(pd: PortfolioData | null, snaps: Snapshot[]): void {
  const ISIN_ORDER = getISIN_ORDERList();
  const ISIN = getISIN();
  const META = getMETAMap();
  const has = pd && pd.months.length > 0;
  document.getElementById('dca-empty').style.display = has ? 'none' : 'block';
  document.getElementById('dca-content').style.display = has ? 'block' : 'none';
  if (!has) return;

  _lastPd = pd;

  const total = pd.totalInv;
  const n = pd.months.length;
  const avg = n > 0 ? total / n : 0;
  const lastM = pd.months[n - 1];
  const lastAmt = pd.monthly[lastM] || 0;

  document.getElementById('dca-kpis').innerHTML = `
    <div class="kpi"><div class="kpi-label">Total invested</div><div class="kpi-val">${fmtEur(total)}</div><div class="kpi-sub">all savings plans</div></div>
    <div class="kpi"><div class="kpi-label">Active months</div><div class="kpi-val">${n}</div><div class="kpi-sub">${fmtMon(pd.months[0])} → ${fmtMon(lastM)}</div></div>
    <div class="kpi"><div class="kpi-label">Avg / month</div><div class="kpi-val">${fmtEur(avg)}</div></div>
    <div class="kpi"><div class="kpi-label">Latest month</div><div class="kpi-val">${fmtEur(lastAmt)}</div><div class="kpi-sub">${fmtMon(lastM)}</div></div>
  `;

  const allSyms = [...new Set(pd.months.flatMap((m) => Object.keys(pd.monthlyBy[m] || {})))];
  const ordSyms = ISIN_ORDER.filter((s) => allSyms.includes(s)).concat(
    allSyms.filter((s) => !ISIN_ORDER.includes(s)),
  );

  // Chart with range toggle
  renderDCAChart(pd, ordSyms, ISIN, META);
  attachRangeToggle(pd, ordSyms, ISIN, META);

  _rebuildDCALegend(ordSyms, ISIN, META);

  // DCA table with filtering + pagination
  populateDCAYearFilter(pd.months);
  attachDCAFilterListeners(pd);
  renderDCATable(pd);

  // ── Contributions forecast (cumulative cash invested) ──
  const accounts = getAccounts();
  _renderDCAForecast(pd, accounts);
}

// ── Forecast helpers ──────────────────────────────────────

const DCA_FC_LABELS: Record<string, string> = {
  '60': '5 years',
  '120': '10 years',
  '240': '20 years',
};

function _renderDCAForecast(pd: PortfolioData, accounts: Account[]): void {
  const projCard = document.getElementById('dca-proj-card');
  if (!projCard) return;

  // Filter to investment + pension accounts only
  const forecastAccounts = accounts.filter((a) => {
    const type = (a.moneyType || '').toLowerCase();
    return type === 'investment' || type === 'pension';
  });

  // Monthly contribution rate: sum of all investment + pension contributions
  const monthlyContrib = forecastAccounts.reduce((sum, a) => {
    if (a.isPrimaryInvestment && (a.moneyType || '').toLowerCase() === 'investment') {
      return sum + getTotalAnnualContrib() / 12;
    }
    return sum + annualizeContrib(a.contribAmount || 0, a.contribInterval || 'monthly') / 12;
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

  // Forecast: project forward from the last CSV month
  const forecastMonths = parseInt(_dcaFcRange);
  const fcLabels: string[] = [];
  const fcValues: number[] = [];
  let [year, mon] = lastMonth.split('-').map(Number);
  let runningTotal = baseCash;
  for (let i = 0; i < forecastMonths; i++) {
    mon++;
    if (mon > 12) {
      mon = 1;
      year++;
    }
    runningTotal += monthlyContrib;
    fcLabels.push(fmtMon(`${year}-${String(mon).padStart(2, '0')}`));
    fcValues.push(Math.round(runningTotal));
  }

  // Combined chart: history (actual) + forecast (projected)
  // The actual line ends at the last CSV month; the forecast starts from the next month.
  // For visual continuity, the forecast's first point connects from baseCash.
  const histLabels = histMonths.map((m) => fmtMon(m));
  const labels = [...histLabels, ...fcLabels];
  const histDataFull = [...histCumulative, ...new Array(fcValues.length).fill(null)];
  const fcDataFull = [...new Array(histCumulative.length).fill(null), ...fcValues];

  // Per-account contribution summary
  const acctSummaryLines = forecastAccounts
    .map((a) => {
      let contribStr: string;
      if (a.isPrimaryInvestment && (a.moneyType || '').toLowerCase() === 'investment') {
        const annual = getTotalAnnualContrib();
        contribStr =
          annual > 0
            ? `${fmtEur(Math.round(annual))}/yr (from Holdings)`
            : 'no contributions configured';
      } else {
        const amt = a.contribAmount ?? 0;
        const interval = a.contribInterval || 'monthly';
        contribStr =
          amt > 0
            ? `${fmtEur(amt)} ${esc((INTERVAL_LABELS[interval] || interval).toLowerCase())}`
            : 'no contributions';
      }
      return `<span style="color:var(--ink-2)">${esc(a.label || 'Account')}: ${contribStr}</span>`;
    })
    .join('<br>');

  projCard.innerHTML = `
    <div class="card">
      <div class="card-title">Cumulative contributions: ${DCA_FC_LABELS[_dcaFcRange]}</div>
      <div class="chart-controls">
        <div id="dca-forecast-legend" class="legend"></div>
        <div class="range-toggle" id="dca-forecast-range-toggle">
          <button class="btn btn-sm btn-ghost ${_dcaFcRange === '60' ? 'active' : ''}" data-range="60">5Y</button>
          <button class="btn btn-sm btn-ghost ${_dcaFcRange === '120' ? 'active' : ''}" data-range="120">10Y</button>
          <button class="btn btn-sm btn-ghost ${_dcaFcRange === '240' ? 'active' : ''}" data-range="240">20Y</button>
        </div>
      </div>
      <div class="chart-wrap chart-h-md"><canvas id="c-dca-proj"></canvas></div>
      <div class="note" style="line-height:1.6">
        <div style="margin-bottom:4px">Projected monthly contributions (Settings \u2192 Accounts):</div>
        ${acctSummaryLines}
        <div style="margin-top:6px;color:var(--ink-4)">Shows cash moved into investments &amp; pensions. Returns are reflected in the Net Worth forecast.</div>
      </div>
    </div>`;

  const C2 = resolvedT();
  if (CH['c-dca-proj']) CH['c-dca-proj'].destroy();
  CH['c-dca-proj'] = new Chart(document.getElementById('c-dca-proj'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Actual',
          data: histDataFull,
          borderColor: C2.brand,
          backgroundColor: C2.brand,
          borderWidth: 2.5,
          pointRadius: 0,
          fill: false,
          tension: 0,
          spanGaps: false,
          order: 1,
        },
        {
          label: 'Projected',
          data: fcDataFull,
          borderColor: C2.brandChart,
          backgroundColor: 'rgba(42,120,214,0.07)',
          borderWidth: 2,
          borderDash: [5, 3],
          pointRadius: 0,
          fill: true,
          tension: 0.3,
          spanGaps: false,
          order: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: 'index',
          intersect: false,
          backgroundColor: C2.surface,
          borderColor: C2.line,
          borderWidth: 1,
          titleColor: C2.ink,
          bodyColor: C2.ink2,
          padding: 10,
          cornerRadius: 8,
          callbacks: {
            label: (ctx) =>
              ctx.raw != null ? ` ${ctx.dataset.label}: ${fmtEur(ctx.raw as number)}` : '',
          },
        },
      },
      scales: {
        y: {
          grid: { color: C2.line, drawBorder: false },
          ticks: {
            color: C2.ink4,
            callback: (v) =>
              (v as number) >= 1000
                ? '\u20AC' + Math.round((v as number) / 1000) + 'k'
                : '\u20AC' + v,
          },
        },
        x: {
          grid: { display: false },
          ticks: {
            color: C2.ink2,
            font: { size: 10 },
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 12,
          },
        },
      },
    },
  });

  // Build custom HTML legend for DCA forecast chart
  const dcaFcLegendEl = document.getElementById('dca-forecast-legend');
  if (dcaFcLegendEl) {
    const datasets = CH['c-dca-proj'].data.datasets;
    dcaFcLegendEl.innerHTML = renderLegendHtml(
      datasets.map((ds) => ({ label: ds.label as string, color: ds.borderColor as string })),
    );
    bindLegendToggle(dcaFcLegendEl, CH['c-dca-proj']);
  }

  _attachDCAForecastRangeToggle(pd, accounts);
}

function _attachDCAForecastRangeToggle(pd: PortfolioData, accounts: Account[]): void {
  const toggle = document.getElementById('dca-forecast-range-toggle') as
    (HTMLElement & { _bound?: boolean }) | null;
  if (!toggle || toggle._bound) return;
  toggle._bound = true;
  toggle.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-range]') as HTMLElement | null;
    if (!btn) return;
    const newRange = (btn.dataset.range as '60' | '120' | '240') || '60';
    if (newRange === _dcaFcRange) return;
    _dcaFcRange = newRange;
    _renderDCAForecast(pd, accounts);
  });
}

// ── Chart with range toggle ──────────────────────────────

function renderDCAChart(
  pd: PortfolioData,
  ordSyms: string[],
  ISIN: Record<string, string>,
  META: Record<string, { color: string }>,
): void {
  const C = resolvedT();
  // Apply range filter to months
  let months = pd.months;
  if (_dcaRange !== 'all') {
    const limit = parseInt(_dcaRange);
    months = months.slice(-limit);
  }

  const datasets = ordSyms.map((sym) => {
    const t = ISIN[sym] || sym;
    const m = META[t] || {};
    return {
      label: t,
      data: months.map((mo) => (pd.monthlyBy[mo] || {})[sym] || 0),
      backgroundColor: m.color || C.ink4,
      borderRadius: (ctx) => {
        const ds = ctx.chart.data.datasets,
          i = ctx.datasetIndex,
          j = ctx.dataIndex;
        const isTop = !ds.some((d, k) => k > i && ((d.data[j] as number) || 0) > 0);
        return isTop ? { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 } : 0;
      },
      borderSkipped: false,
    };
  });

  // Adaptive x-axis: show every Nth label to avoid crowding
  const maxLabels = 18;
  const step = Math.ceil(months.length / maxLabels);

  if (CH['c-dca-bar']) CH['c-dca-bar'].destroy();
  CH['c-dca-bar'] = new Chart(document.getElementById('c-dca-bar'), {
    type: 'bar',
    data: { labels: months.map(fmtMon), datasets },
    options: {
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
        },
      },
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          ticks: {
            color: C.ink2,
            font: { size: 10 },
            maxRotation: 45,
            autoSkip: false,
            callback: function (val, idx) {
              return idx % step === 0 ? this.getLabelForValue(val) : '';
            },
          },
        },
        y: {
          stacked: true,
          grid: { color: C.line, drawBorder: false },
          ticks: {
            color: C.ink4,
            callback: (v) =>
              (v as number) >= 1000
                ? ((v as number) / 1000).toFixed(0) + 'k\u00A0€'
                : v + '\u00A0€',
          },
        },
      },
    },
  });
}

function _rebuildDCALegend(
  ordSyms: string[],
  ISIN: Record<string, string>,
  META: Record<string, { color: string }>,
): void {
  const legendEl = document.getElementById('dca-legend');
  if (!legendEl) return;
  legendEl.innerHTML = renderLegendHtml(
    ordSyms.map((sym) => {
      const t = ISIN[sym] || sym;
      const m = META[t] || {};
      return { label: t, color: m.color || 'var(--ink-4)' };
    }),
  );
  _bindDCALegendToggle(ordSyms);
}

function _bindDCALegendToggle(ordSyms: string[]): void {
  const legend = document.getElementById('dca-legend');
  const chart = CH['c-dca-bar'];
  if (!legend || !chart) return;
  bindLegendToggle(legend, chart, { skipIndex: [] }); // no Total dataset in the DCA stack
}

function attachRangeToggle(
  pd: PortfolioData,
  ordSyms: string[],
  ISIN: Record<string, string>,
  META: Record<string, { color: string }>,
): void {
  const toggle = document.getElementById('dca-range-toggle') as
    (HTMLElement & { _bound?: boolean }) | null;
  if (!toggle || toggle._bound) return;
  toggle._bound = true;
  toggle.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-range]') as HTMLElement | null;
    if (!btn) return;
    const newRange = btn.dataset.range || 'all';
    if (newRange === _dcaRange) return; // already on this range - no-op
    _dcaRange = newRange;
    _dcaPage = 1;
    toggle.querySelectorAll('.btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    // Recompute ordSyms/ISIN/META from current data to avoid stale closures
    const currentPd = _lastPd || pd;
    const freshISIN = getISIN();
    const freshMETA = getMETAMap();
    const freshISIN_ORDER = getISIN_ORDERList();
    const allSyms = [
      ...new Set(currentPd.months.flatMap((m) => Object.keys(currentPd.monthlyBy[m] || {}))),
    ];
    const freshOrdSyms = freshISIN_ORDER
      .filter((s) => allSyms.includes(s))
      .concat(allSyms.filter((s) => !freshISIN_ORDER.includes(s)));
    renderDCAChart(currentPd, freshOrdSyms, freshISIN, freshMETA);
    _rebuildDCALegend(freshOrdSyms, freshISIN, freshMETA);
    renderDCATable(currentPd);
  });
}

// ── DCA table with filtering + pagination ────────────────

function populateDCAYearFilter(months: string[]): void {
  const select = document.getElementById('dca-year-filter');
  if (!select) return;
  const years = [...new Set(months.map((m) => m.slice(0, 4)))].sort().reverse();
  const current = select.value;
  select.innerHTML =
    '<option value="">All years</option>' +
    years
      .map((y) => `<option value="${y}" ${y === current ? 'selected' : ''}>${y}</option>`)
      .join('');
}

function attachDCAFilterListeners(pd: PortfolioData): void {
  const yearEl = document.getElementById('dca-year-filter') as
    (HTMLSelectElement & { _bound?: boolean }) | null;
  if (yearEl && !yearEl._bound) {
    yearEl._bound = true;
    yearEl.addEventListener('change', () => {
      _dcaYear = yearEl.value;
      _dcaPage = 1;
      renderDCATable(pd);
    });
  }
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
  if (_dcaYear) {
    months = months.filter((m) => m.startsWith(_dcaYear));
  }

  // Column definitions
  const columns = dcaColumns(pd);

  // Apply sort (before pagination)
  const sorted = applySort(months, _dcaTblSort, getSortGetters(columns));

  // Calculate filtered total
  const filteredTotal = months.reduce((sum, m) => sum + (pd.monthly[m] || 0), 0);

  // Pagination
  const totalPages = Math.ceil(sorted.length / DCA_PAGE_SIZE);
  if (_dcaPage > totalPages) _dcaPage = Math.max(1, totalPages);
  const start = (_dcaPage - 1) * DCA_PAGE_SIZE;
  const pageMonths = sorted.slice(start, start + DCA_PAGE_SIZE);

  const tRows = pageMonths
    .map(
      (m) =>
        `<div class="tbl-row dca-row" role="row">
      ${renderTableRow(columns, m)}
    </div>`,
    )
    .join('');

  el.innerHTML = `
    <div class="tbl-row th dca-row" role="row" id="dca-table-header">${renderTableHeader(columns, _dcaTblSort)}</div>
    ${tRows}
    <div class="tbl-row dca-row" role="row" style="border-top:1px solid var(--line-2);margin-top:4px">
      <div style="font-weight:500">${_dcaYear ? 'Year total' : 'Total'}</div>
      <div style="font-weight:500;text-align:right">${fmtEur(filteredTotal)}</div>
    </div>`;

  // Bind sort handler on header row
  const dcaHeaderEl = document.getElementById('dca-table-header');
  if (dcaHeaderEl) {
    bindSortableHeader(dcaHeaderEl, _dcaTblSort, (newState) => {
      _dcaTblSort = newState;
      _dcaPage = 1;
      renderDCATable(pd);
    });
  }

  // Pagination controls
  renderDCAPagination(totalPages, pd);
}

function renderDCAPagination(totalPages: number, pd: PortfolioData): void {
  renderPagination('dca-pagination', _dcaPage, totalPages, (p) => {
    _dcaPage = p;
    renderDCATable(pd);
  });
}
