// @ts-nocheck — DOM-heavy view; full strict typing deferred to framework migration
import { fmtEur, fmtMon, esc, safeColor } from '../utils';
import { getISIN_ORDERList, getISIN, getMETAMap } from '../constants';
import {
  getTotalWeeklyTarget,
  getTotalAnnualContrib,
  getAnnualReturnPct,
  getAccounts,
} from '../store/config';
import { primaryInvestmentValue } from '../model/accounts';
import type { PortfolioData, Snapshot } from '../types';
import Chart from 'chart.js/auto';
import { T, resolvedT } from '../theme';
import { bindLegendToggle } from './chartLegend';

const CH: Record<string, Chart> = {};
const DCA_PAGE_SIZE = 12;
let _dcaPage = 1;
let _dcaYear = '';
let _dcaRange = 'all'; // '12', '24', 'all'
let _lastPd: PortfolioData | null = null;

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

  // 5-year projection using annualized contributions
  const latSnap = snaps.length > 0 ? snaps[snaps.length - 1] : null;
  const startV = primaryInvestmentValue(latSnap, getAccounts()) || pd.totalInv;
  const annualReturnPct = getAnnualReturnPct();
  const annualContrib = getTotalAnnualContrib() || 200 * 52;
  const annualRate = annualReturnPct / 100;
  let v = startV;
  const pts = [v];
  for (let yr = 1; yr <= 5; yr++) {
    v = Math.round((v + annualContrib) * (1 + annualRate));
    pts.push(v);
  }

  const weeklyEquiv = Math.round(annualContrib / 52);
  const C2 = resolvedT();
  if (CH['c-dca-proj']) CH['c-dca-proj'].destroy();
  const projTitle = document.getElementById('dca-proj-title');
  if (projTitle)
    projTitle.textContent = `5-year projection (${annualReturnPct}% return, €${weeklyEquiv}/wk equiv.)`;
  CH['c-dca-proj'] = new Chart(document.getElementById('c-dca-proj'), {
    type: 'line',
    data: {
      labels: ['Now', 'Yr 1', 'Yr 2', 'Yr 3', 'Yr 4', 'Yr 5'],
      datasets: [
        {
          label: 'Projected',
          data: pts,
          borderColor: C2.brandChart,
          backgroundColor: 'rgba(42,120,214,0.07)',
          borderWidth: 2,
          pointRadius: 4,
          pointBackgroundColor: C2.brandChart,
          fill: true,
          tension: 0.35,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: C2.surface,
          borderColor: C2.line,
          borderWidth: 1,
          titleColor: C2.ink,
          bodyColor: C2.ink2,
          padding: 10,
          cornerRadius: 8,
        },
      },
      scales: {
        y: {
          grid: { color: C2.line, drawBorder: false },
          ticks: {
            color: C2.ink4,
            callback: (v) =>
              (v as number) >= 1000 ? '€' + Math.round((v as number) / 1000) + 'k' : '€' + v,
          },
        },
        x: { grid: { display: false }, ticks: { color: C2.ink2 } },
      },
    },
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
              (v as number) >= 1000 ? '€' + ((v as number) / 1000).toFixed(0) + 'k' : '€' + v,
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
  legendEl.innerHTML = ordSyms
    .map((sym) => {
      const t = ISIN[sym] || sym;
      const m = META[t] || {};
      return `<span class="leg-item" data-sym="${esc(sym)}" style="cursor:pointer"><span class="leg-sq" style="background:${safeColor(m.color) || 'var(--ink-4)'}"></span>${esc(t)}</span>`;
    })
    .join('');
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
    if (newRange === _dcaRange) return; // already on this range — no-op
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

function renderDCATable(pd: PortfolioData): void {
  const el = document.getElementById('dca-table');
  if (!el) return;

  // Filter months
  let months = [...pd.months].reverse();
  if (_dcaYear) {
    months = months.filter((m) => m.startsWith(_dcaYear));
  }

  // Calculate filtered total
  const filteredTotal = months.reduce((sum, m) => sum + (pd.monthly[m] || 0), 0);

  // Pagination
  const totalPages = Math.ceil(months.length / DCA_PAGE_SIZE);
  if (_dcaPage > totalPages) _dcaPage = Math.max(1, totalPages);
  const start = (_dcaPage - 1) * DCA_PAGE_SIZE;
  const pageMonths = months.slice(start, start + DCA_PAGE_SIZE);

  const tRows = pageMonths
    .map(
      (m) =>
        `<div class="tbl-row" role="row" style="grid-template-columns:1fr 1fr">
      <div role="cell" style="color:var(--ink-2)">${fmtMon(m)}</div>
      <div role="cell" style="font-weight:500;text-align:right">${fmtEur(pd.monthly[m])}</div>
    </div>`,
    )
    .join('');

  el.innerHTML = `
    <div class="tbl-row th" role="row" style="grid-template-columns:1fr 1fr"><div role="columnheader">Month</div><div role="columnheader" style="text-align:right">Invested</div></div>
    ${tRows}
    <div class="tbl-row" role="row" style="grid-template-columns:1fr 1fr;border-top:1px solid var(--line-2);margin-top:4px">
      <div style="font-weight:500">${_dcaYear ? 'Year total' : 'Total'}</div>
      <div style="font-weight:500;text-align:right">${fmtEur(filteredTotal)}</div>
    </div>`;

  // Pagination controls
  renderDCAPagination(totalPages, pd);
}

function renderDCAPagination(totalPages: number, pd: PortfolioData): void {
  const el = document.getElementById('dca-pagination');
  if (!el) return;
  if (totalPages <= 1) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `
    <button class="btn btn-sm btn-ghost js-dca-prev" ${_dcaPage <= 1 ? 'disabled' : ''}>←</button>
    <span class="page-info">${_dcaPage} / ${totalPages}</span>
    <button class="btn btn-sm btn-ghost js-dca-next" ${_dcaPage >= totalPages ? 'disabled' : ''}>→</button>
  `;
  el.querySelector('.js-dca-prev')?.addEventListener('click', () => {
    if (_dcaPage > 1) {
      _dcaPage--;
      renderDCATable(pd);
    }
  });
  el.querySelector('.js-dca-next')?.addEventListener('click', () => {
    if (_dcaPage < totalPages) {
      _dcaPage++;
      renderDCATable(pd);
    }
  });
}
