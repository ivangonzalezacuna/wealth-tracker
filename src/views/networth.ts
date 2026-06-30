// @ts-nocheck — DOM-heavy view; full strict typing deferred to framework migration
import { snapTotal, fmtEur, fmtEur2, fmtMon, esc, safeColor } from '../utils';
import { getACCTSList } from '../constants';
import {
  getAccounts,
  getTotalAnnualContrib,
  getAnnualReturnPct,
  getTargetNetWorth,
  getTargetDate,
} from '../store/config';
import { primaryInvestmentValue } from '../model/accounts';
import { monthlyGrowthSplit, cagr, findYoYSnapshot } from '../model/insights';
import { forecastMonthsToTarget, formatMonthsEta, forecastSeries } from '../model/forecast';
import type { Snapshot, PortfolioData } from '../types';
import Chart from 'chart.js/auto';
import { T, resolvedT } from '../theme';
import { bindLegendToggle } from './chartLegend';
import { infoTip, attachInfoTips } from '../ui/infoTip';

const CH: Record<string, Chart> = {};
let _nwRange: '12' | '36' | 'all' = 'all';

export function renderNW(pd: PortfolioData | null, snaps: Snapshot[]): void {
  const ACCTS = getACCTSList();
  const has = snaps.length > 0;
  document.getElementById('nw-empty').style.display = has ? 'none' : 'block';
  document.getElementById('nw-content').style.display = has ? 'block' : 'none';
  if (!has) return;

  const s = snaps[snaps.length - 1];
  const total = snapTotal(s);
  const prev = snaps.length > 1 ? snaps[snaps.length - 2] : null;
  const prevT = prev ? snapTotal(prev) : null;
  const chg = prevT !== null ? total - prevT : null;
  const chgPct = chg !== null && prevT && prevT > 0 ? (chg / prevT) * 100 : null;
  const activeA = ACCTS.filter((a) => (s[a.key] || 0) > 0);

  // ── Extra KPIs: YoY + CAGR ──
  const firstTotal = snaps.length > 0 ? snapTotal(snaps[0]) : 0;
  const firstDate = snaps[0]?.date || '';
  const latestDate = s.date || '';
  const monthsSpan = _monthsDiff(firstDate, latestDate);

  const yoyData = findYoYSnapshot(snaps);
  const yoyAbs = yoyData ? total - yoyData.total : null;
  const yoyPct =
    yoyData && yoyData.total > 0 ? ((total - yoyData.total) / yoyData.total) * 100 : null;

  const cagrVal = cagr(firstTotal, total, monthsSpan);

  // ── Growth split (contributions vs market) ──
  let growthSplitHtml = '';
  const accounts = getAccounts();
  const primaryNow = primaryInvestmentValue(s, accounts);
  const primaryPrev = prev ? primaryInvestmentValue(prev, accounts) : null;
  if (primaryNow !== null && primaryPrev !== null && pd) {
    const latestMonth = s.date;
    const contribThisMonth = _buyContribForMonth(pd, latestMonth);
    const split = monthlyGrowthSplit(primaryNow, primaryPrev, contribThisMonth);
    growthSplitHtml = `
      <div class="card">
        <div class="card-title">This month's change</div>
        <div class="row"><div class="row-label">Total change</div><div class="row-val ${primaryNow - primaryPrev >= 0 ? 'pos' : 'neg'}">${primaryNow - primaryPrev >= 0 ? '+' : ''}${fmtEur2(primaryNow - primaryPrev)}</div></div>
        <div class="row"><div class="row-label">Contributed</div><div class="row-val">${fmtEur2(split.contributed)}</div></div>
        <div class="row"><div class="row-label">Market movement</div><div class="row-val ${split.market >= 0 ? 'pos' : 'neg'}">${split.market >= 0 ? '+' : ''}${fmtEur2(split.market)}</div></div>
      </div>`;
  }

  document.getElementById('nw-kpis').innerHTML = `
    <div class="kpi kpi-lead">
      <div class="kpi-label">Net worth</div>
      <div class="kpi-val">${fmtEur2(total)}</div>
      <div class="kpi-sub">${
        chg !== null
          ? (chg >= 0 ? '+' : '') +
            fmtEur2(chg) +
            (chgPct !== null ? ' (' + (chgPct >= 0 ? '+' : '') + chgPct.toFixed(1) + '%)' : '') +
            ' vs ' +
            fmtMon(prev.date)
          : fmtMon(s.date)
      }</div>
    </div>
    ${activeA
      .map(
        (a) => `
      <div class="kpi">
        <div class="kpi-label">${esc(a.label)}</div>
        <div class="kpi-val">${fmtEur2(s[a.key] || 0)}</div>
        <div class="kpi-sub">${total > 0 ? Math.round(((s[a.key] || 0) / total) * 100) : 0}% of total</div>
      </div>`,
      )
      .join('')}
    ${
      yoyAbs !== null
        ? `
      <div class="kpi">
        <div class="kpi-label">YoY${infoTip('Year-over-Year: Change in total net worth compared to the same month one year ago.')}</div>
        <div class="kpi-val ${yoyAbs >= 0 ? 'pos' : 'neg'}">${yoyAbs >= 0 ? '+' : ''}${fmtEur2(yoyAbs)}</div>
        <div class="kpi-sub">${yoyPct !== null ? (yoyPct >= 0 ? '+' : '') + yoyPct.toFixed(1) + '%' : '—'} vs ${fmtMon(yoyData.snap.date)}</div>
      </div>`
        : ''
    }
    ${
      cagrVal !== null
        ? `
      <div class="kpi">
        <div class="kpi-label">CAGR${infoTip('Compound Annual Growth Rate: Annualized average return over the full tracking period.')}</div>
        <div class="kpi-val ${cagrVal >= 0 ? 'pos' : 'neg'}">${(cagrVal >= 0 ? '+' : '') + (cagrVal * 100).toFixed(1)}%</div>
        <div class="kpi-sub">${monthsSpan} months</div>
      </div>`
        : ''
    }
  `;

  const chartA = ACCTS.filter((a) => snaps.some((sn) => (sn[a.key] || 0) > 0));

  // Range-sliced view for the history chart
  const view = _nwRange === 'all' ? snaps : snaps.slice(-parseInt(_nwRange));

  // Chart title + legend + history chart
  document.getElementById('nw-chart-title').textContent =
    snaps.length === 1
      ? 'Account breakdown — ' +
        fmtMon(snaps[0].date) +
        ' (add more snapshots to see growth over time)'
      : 'Net worth over time — total + per account';

  const C = resolvedT();
  _destroyChart('c-nw-hist');
  if (snaps.length === 1) {
    // Legend for single-snapshot: per-account only
    document.getElementById('nw-chart-legend').innerHTML = chartA
      .map(
        (a) =>
          `<span class="leg-item"><span class="leg-sq" style="background:${safeColor(a.color)}"></span>${esc(a.label)}</span>`,
      )
      .join('');

    CH['c-nw-hist'] = new Chart(document.getElementById('c-nw-hist'), {
      type: 'bar',
      data: {
        labels: chartA.map((a) => a.label),
        datasets: [
          {
            data: chartA.map((a) => s[a.key] || 0),
            backgroundColor: chartA.map((a) => safeColor(a.color)),
            borderColor: chartA.map((a) => safeColor(a.color)),
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
  } else {
    _renderNWHistChart(view, chartA);
  }

  // Bind range toggle once
  _attachNWRangeToggle(snaps, chartA);

  const bkA = ACCTS.filter((a) => (s[a.key] || 0) > 0);

  let det = bkA
    .map(
      (a) =>
        `<div class="row"><div class="row-label">${esc(a.label)}</div><div class="row-val">${fmtEur2(s[a.key] || 0)}</div></div>`,
    )
    .join('');
  det += `<div class="row" style="border-top:1px solid var(--line-2);margin-top:4px">
    <div class="row-label" style="font-weight:500">Total</div>
    <div class="row-val" style="font-weight:500">${fmtEur2(total)}</div></div>`;
  if (prev) {
    const c = total - prevT;
    det += `<div class="row"><div class="row-label" style="color:var(--ink-3);font-size:12px">vs ${fmtMon(prev.date)}</div>
      <div class="row-val ${c >= 0 ? 'pos' : 'neg'}">${c >= 0 ? '+' : ''}${fmtEur2(c)}</div></div>`;
  }
  if (s.notes) det += `<p class="note" style="margin-top:.5rem">${esc(s.notes)}</p>`;
  document.getElementById('nw-detail').innerHTML = det;

  // Growth split card
  const growthEl = document.getElementById('nw-growth-split');
  if (growthEl) growthEl.innerHTML = growthSplitHtml;

  // ── Goal progress card ──
  const goalEl = document.getElementById('nw-goal');
  if (goalEl) {
    const target = getTargetNetWorth();
    if (target !== null) {
      const pctComplete = Math.min(100, Math.round((total / target) * 100));
      const remaining = Math.max(0, target - total);
      const annualContrib = getTotalAnnualContrib();
      const annualReturn = getAnnualReturnPct();
      const etaMonths = forecastMonthsToTarget(total, target, annualContrib, annualReturn);
      const targetDate = getTargetDate();

      let etaText = '';
      if (total >= target) {
        etaText = '<span class="pos" style="font-weight:500">Goal reached!</span>';
      } else if (etaMonths !== null) {
        const etaFormatted = formatMonthsEta(etaMonths);
        // Calculate target date from ETA
        const now = new Date();
        const etaDate = new Date(now.getFullYear(), now.getMonth() + etaMonths, 1);
        const etaDateStr = `${etaDate.getFullYear()}-${String(etaDate.getMonth() + 1).padStart(2, '0')}`;
        const etaDateFmt = fmtMon(etaDateStr);

        if (targetDate) {
          // Compare ETA with target date
          const isOnTrack = etaDateStr <= targetDate;
          etaText = isOnTrack
            ? `<span class="pos">On track for ${fmtMon(targetDate)}</span> (ETA ${etaFormatted} \u2014 ${etaDateFmt})`
            : `<span class="neg">Behind schedule</span> (ETA ${etaFormatted} \u2014 ${etaDateFmt}, target was ${fmtMon(targetDate)})`;
        } else {
          etaText = `ETA ${etaFormatted} (${etaDateFmt})`;
        }
      } else {
        etaText = 'Unable to estimate (set contributions or return rate)';
      }

      goalEl.innerHTML = `
        <div class="card">
          <div class="card-title">Goal</div>
          <div class="row"><div class="row-label">Target</div><div class="row-val">${fmtEur(target)}</div></div>
          <div class="row"><div class="row-label">Current</div><div class="row-val">${fmtEur(total)}</div></div>
          <div class="row"><div class="row-label">Remaining</div><div class="row-val">${fmtEur(remaining)}</div></div>
          <div style="margin:.75rem 0">
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
              <span>${pctComplete}% complete</span>
              <span>${fmtEur(total)} / ${fmtEur(target)}</span>
            </div>
            <div style="height:8px;background:var(--surface-3);border-radius:4px;overflow:hidden">
              <div style="width:${pctComplete}%;height:100%;background:${pctComplete >= 100 ? 'var(--pos)' : 'var(--brand)'};border-radius:4px;transition:width .3s"></div>
            </div>
          </div>
          <div class="row"><div class="row-label">ETA</div><div class="row-val" style="font-size:12px">${etaText}</div></div>
        </div>`;
    } else {
      goalEl.innerHTML = '';
    }
  }

  // ── Forecast chart ──
  _renderForecastChart(snaps, total);

  attachInfoTips(document.getElementById('networth')!);
}

// ── History chart helper (lines + dots, total line) ──

function _renderNWHistChart(
  view: Snapshot[],
  chartA: Array<{ key: string; label: string; color: string }>,
): void {
  if (view.length < 2) {
    _destroyChart('c-nw-hist');
    const parent = document.getElementById('c-nw-hist')?.parentElement;
    if (parent && !parent.querySelector('.chart-no-data')) {
      const msg = document.createElement('div');
      msg.className = 'chart-no-data';
      msg.style.cssText =
        'display:flex;align-items:center;justify-content:center;height:100%;font-size:13px;color:var(--ink-3)';
      msg.textContent = 'Not enough data for this range';
      parent.appendChild(msg);
    }
    return;
  }
  document.getElementById('c-nw-hist')?.parentElement?.querySelector('.chart-no-data')?.remove();

  const C = resolvedT();
  const labels = view.map((sn) => fmtMon(sn.date));
  const totalSeries = view.map((sn) => snapTotal(sn));

  const accountDatasets = chartA.map((a) => ({
    label: a.label,
    data: view.map((sn) => (sn[a.key] as number) || 0),
    borderColor: a.color,
    backgroundColor: a.color,
    borderWidth: 1,
    fill: false,
    tension: 0,
    pointRadius: 2.5,
    pointHoverRadius: 5,
    pointBackgroundColor: a.color,
    order: 2,
    hidden: false, // all lines visible by default; legend allows toggling
  }));
  const totalDataset = {
    label: 'Total net worth',
    data: totalSeries,
    borderColor: C.brand,
    backgroundColor: C.brand,
    borderWidth: 2.5,
    fill: false,
    tension: 0,
    pointRadius: 5,
    pointHoverRadius: 6,
    pointBackgroundColor: C.brand,
    order: 0, // drawn on top
  };

  // Legend: Total swatch first, then per-account swatches
  document.getElementById('nw-chart-legend').innerHTML =
    `<span class="leg-item"><span class="leg-sq" style="background:${C.brand}"></span>Total net worth</span>` +
    chartA
      .map(
        (a) =>
          `<span class="leg-item"><span class="leg-sq" style="background:${safeColor(a.color)}"></span>${esc(a.label)}</span>`,
      )
      .join('');

  _destroyChart('c-nw-hist');
  const chart = new Chart(document.getElementById('c-nw-hist'), {
    type: 'line',
    data: { labels, datasets: [totalDataset, ...accountDatasets] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: 'index',
          intersect: false,
          backgroundColor: C.surface,
          borderColor: C.line,
          borderWidth: 1,
          titleColor: C.ink,
          bodyColor: C.ink2,
          padding: 10,
          cornerRadius: 8,
          callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${fmtEur2(ctx.raw as number)}` },
        },
      },
      scales: {
        y: {
          grid: { color: C.line, drawBorder: false },
          ticks: {
            color: C.ink4,
            callback: (v) =>
              (v as number) >= 1000 ? '€' + ((v as number) / 1000).toFixed(0) + 'k' : '€' + v,
          },
        },
        x: {
          grid: { display: false },
          ticks: { color: C.ink2, font: { size: 10 }, maxRotation: 0, autoSkip: true },
        },
      },
    },
  });
  CH['c-nw-hist'] = chart;

  // Make legend swatches clickable to toggle datasets
  _bindLegendToggle(chart);
}

// ── Legend click toggle for many-account mode ──

function _bindLegendToggle(chart: Chart): void {
  const legendEl = document.getElementById('nw-chart-legend');
  if (!legendEl) return;
  // Index 0 = Total — always visible, never togglable (matches Phase 25's rule
  // that Total must never be hideable).
  bindLegendToggle(legendEl, chart, { skipIndex: [0] });
}

// ── Range toggle binding ──

function _attachNWRangeToggle(
  snaps: Snapshot[],
  chartA: Array<{ key: string; label: string; color: string }>,
): void {
  const toggle = document.getElementById('nw-range-toggle') as
    (HTMLElement & { _bound?: boolean }) | null;
  if (!toggle || toggle._bound) return;
  toggle._bound = true;
  toggle.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-range]') as HTMLElement | null;
    if (!btn) return;
    const newRange = (btn.dataset.range as '12' | '36' | 'all') || 'all';
    if (newRange === _nwRange) return; // already on this range — no-op
    _nwRange = newRange;
    toggle.querySelectorAll('.btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const view = _nwRange === 'all' ? snaps : snaps.slice(-parseInt(_nwRange));
    _renderNWHistChart(view, chartA);
  });
}

// ── Forecast chart ──

function _renderForecastChart(snaps: Snapshot[], currentTotal: number): void {
  const C = resolvedT();
  const forecastEl = document.getElementById('nw-forecast');
  if (!forecastEl) return;

  const annualContrib = getTotalAnnualContrib();
  const annualReturn = getAnnualReturnPct();

  // Need at least some data and positive contributions/return to show forecast
  if (snaps.length === 0 || (annualContrib <= 0 && annualReturn <= 0)) {
    forecastEl.innerHTML = '';
    return;
  }

  const latestDate = snaps[snaps.length - 1].date;
  const forecastMonths = 60; // 5-year forecast
  const series = forecastSeries(
    currentTotal,
    annualContrib,
    annualReturn,
    forecastMonths,
    latestDate,
  );

  // Build combined history + forecast for a seamless line chart
  const historySlice = snaps.slice(-12); // last 12 months of actual data
  const histLabels = historySlice.map((sn) => fmtMon(sn.date));
  const histValues = historySlice.map((sn) => snapTotal(sn));

  const fcLabels = series.map((p) => fmtMon(p.month));
  const fcValues = series.map((p) => p.value);

  // Combined labels: history + forecast
  const labels = [...histLabels, ...fcLabels];
  const histDataFull = [...histValues, ...new Array(fcValues.length).fill(null)];
  const fcDataFull = [
    ...new Array(histValues.length - 1).fill(null),
    histValues[histValues.length - 1],
    ...fcValues,
  ];

  // Target line (horizontal) if goal is set
  const target = getTargetNetWorth();
  const targetLine =
    target !== null
      ? [
          {
            label: 'Target',
            data: labels.map(() => target),
            borderColor: C.pos,
            borderWidth: 1.5,
            borderDash: [6, 4],
            pointRadius: 0,
            fill: false,
            order: 3,
          },
        ]
      : [];

  const weeklyEquiv = Math.round(annualContrib / 52);

  forecastEl.innerHTML = `
    <div class="card">
      <div class="card-title">Forecast \u2014 5 years (${annualReturn}% return, \u20AC${weeklyEquiv}/wk equiv.)</div>
      <div class="chart-wrap chart-h-lg"><canvas id="c-nw-forecast"></canvas></div>
      <p class="note">Projection assumes constant contributions and ${annualReturn}% annual return. Does not account for taxes, fees, or FX.</p>
    </div>`;

  _destroyChart('c-nw-forecast');
  CH['c-nw-forecast'] = new Chart(document.getElementById('c-nw-forecast'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Actual',
          data: histDataFull,
          borderColor: C.brand,
          backgroundColor: C.brand,
          borderWidth: 2.5,
          pointRadius: 3,
          pointBackgroundColor: C.brand,
          fill: false,
          tension: 0,
          spanGaps: false,
          order: 1,
        },
        {
          label: 'Forecast',
          data: fcDataFull,
          borderColor: C.brandChart,
          backgroundColor: 'rgba(42,120,214,0.07)',
          borderWidth: 2,
          borderDash: [5, 3],
          pointRadius: 0,
          fill: true,
          tension: 0.3,
          spanGaps: false,
          order: 2,
        },
        ...targetLine,
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: {
          mode: 'index',
          intersect: false,
          backgroundColor: C.surface,
          borderColor: C.line,
          borderWidth: 1,
          titleColor: C.ink,
          bodyColor: C.ink2,
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
          grid: { color: C.line, drawBorder: false },
          ticks: {
            color: C.ink4,
            callback: (v) =>
              (v as number) >= 1000
                ? '\u20AC' + ((v as number) / 1000).toFixed(0) + 'k'
                : '\u20AC' + v,
          },
        },
        x: {
          grid: { display: false },
          ticks: {
            color: C.ink2,
            font: { size: 10 },
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 12,
          },
        },
      },
    },
  });
}

// ── Helpers ──

function _destroyChart(id: string): void {
  if (CH[id]) {
    CH[id].destroy();
    delete CH[id];
  }
}

/** Months between two YYYY-MM date strings. */
function _monthsDiff(a: string, b: string): number {
  if (!a || !b) return 0;
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
}

/** Sum of BUY amounts for a given month from PortfolioData. */
function _buyContribForMonth(pd: PortfolioData, month: string): number {
  return pd.monthly[month] || 0;
}
