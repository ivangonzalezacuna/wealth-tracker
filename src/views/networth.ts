// @ts-nocheck — DOM-heavy view; full strict typing deferred to framework migration
import { snapTotal, fmtEur, fmtEur2, fmtMon, esc, safeColor } from '../utils';
import { getACCTSList } from '../constants';
import {
  getAccounts,
  getTotalAnnualContrib,
  getTargetNetWorth,
  getTargetDate,
} from '../store/config';
import { primaryInvestmentValue } from '../model/accounts';
import { annualizeContrib, INTERVAL_LABELS } from '../model/contributions';
import { cagr, findYoYSnapshot, monthlyGrowthHistory } from '../model/insights';
import type { MonthlyGrowthPoint } from '../model/insights';
import {
  formatMonthsEta,
  forecastMultiAccountSeries,
  forecastMonthsToTargetMulti,
} from '../model/forecast';
import type { AccountForecastInput } from '../model/forecast';
import type { Snapshot, PortfolioData, Account } from '../types';
import Chart from 'chart.js/auto';
import { T, resolvedT } from '../theme';
import { bindLegendToggle } from './chartLegend';
import { infoTip, attachInfoTips } from '../ui/infoTip';

const CH: Record<string, Chart> = {};
let _nwRange: '12' | '36' | 'all' = 'all';
let _nwGrowthRange: '12' | '36' | 'all' = 'all';
let _nwGrowthPoints: MonthlyGrowthPoint[] = [];
let _fcRange: '60' | '120' | '240' = '60'; // 5y / 10y / 20y forecast horizon

function _buildAccountForecastInputs(snap: Snapshot, accounts: Account[]): AccountForecastInput[] {
  return accounts.map((a) => {
    const current = (snap[a.id || ''] as number) || 0;
    const annualReturnPct = a.annualReturnPct || 0;
    const annualContrib =
      a.isPrimaryInvestment && (a.moneyType || '').toLowerCase() === 'investment'
        ? getTotalAnnualContrib()
        : annualizeContrib(a.contribAmount || 0, a.contribInterval || 'monthly');
    return { current, annualContrib, annualReturnPct };
  });
}

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
  const accounts = getAccounts();
  const growthPoints = pd
    ? monthlyGrowthHistory(snaps, accounts, pd.monthly, primaryInvestmentValue)
    : [];
  _nwGrowthPoints = growthPoints;

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

  // Growth breakdown chart
  _renderGrowthChart();

  // Bind growth range toggle once
  _attachNWGrowthRangeToggle();

  // ── Goal progress card ──
  const goalEl = document.getElementById('nw-goal');
  if (goalEl) {
    const target = getTargetNetWorth();
    if (target !== null) {
      const pctComplete = Math.min(100, Math.round((total / target) * 100));
      const remaining = Math.max(0, target - total);
      const accountInputs = _buildAccountForecastInputs(s, accounts);
      const etaMonths = forecastMonthsToTargetMulti(accountInputs, target);
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
  _renderForecastChart(snaps, accounts);

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

// ── Growth breakdown chart (contributed vs market) ──

function _renderGrowthChart(): void {
  const C = resolvedT();
  const el = document.getElementById('c-nw-growth');
  if (!el) return;
  _destroyChart('c-nw-growth');

  if (_nwGrowthPoints.length === 0) {
    // No resolvable history yet (e.g. no primary-investment account set, or <2 snapshots).
    // Hide the parent card rather than render an empty chart.
    const card = el.closest('.card') as HTMLElement | null;
    if (card) card.style.display = 'none';
    return;
  }
  const card = el.closest('.card') as HTMLElement | null;
  if (card) card.style.display = '';

  const view =
    _nwGrowthRange === 'all' ? _nwGrowthPoints : _nwGrowthPoints.slice(-parseInt(_nwGrowthRange));

  CH['c-nw-growth'] = new Chart(el as HTMLCanvasElement, {
    type: 'bar',
    data: {
      labels: view.map((p) => fmtMon(p.month)),
      datasets: [
        {
          label: 'Contributed',
          data: view.map((p) => p.contributed),
          backgroundColor: C.brand,
          stack: 'growth',
        },
        {
          label: 'Market movement',
          data: view.map((p) => p.market),
          backgroundColor: view.map((p) => (p.market >= 0 ? C.pos : C.neg)),
          stack: 'growth',
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
          backgroundColor: C.surface,
          borderColor: C.line,
          borderWidth: 1,
          titleColor: C.ink,
          bodyColor: C.ink2,
          padding: 10,
          cornerRadius: 8,
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: ${fmtEur2(ctx.raw as number)}`,
            footer: (items) =>
              ` Total: ${fmtEur2(items.reduce((s, i) => s + (i.raw as number), 0))}`,
          },
          footerFont: { weight: 'bold' },
        },
      },
      scales: {
        y: {
          stacked: true,
          grid: { color: C.line, drawBorder: false },
          ticks: {
            color: C.ink4,
            callback: (v) => '\u20AC' + (v as number).toFixed(0),
          },
        },
        x: {
          stacked: true,
          grid: { display: false },
          ticks: { color: C.ink2, font: { size: 10 }, maxRotation: 0, autoSkip: true },
        },
      },
    },
  });

  // Build custom HTML legend and bind toggle
  const legendEl = document.getElementById('nw-growth-legend');
  if (legendEl) {
    legendEl.innerHTML =
      `<span class="leg-item"><span class="leg-sq" style="background:${C.brand}"></span>Contributed</span>` +
      `<span class="leg-item"><span class="leg-sq" style="background:${C.pos}"></span>Market movement</span>`;
    bindLegendToggle(legendEl, CH['c-nw-growth'], { skipIndex: [] });
  }
}

// ── Growth range toggle binding ──

function _attachNWGrowthRangeToggle(): void {
  const toggle = document.getElementById('nw-growth-range-toggle') as
    (HTMLElement & { _bound?: boolean }) | null;
  if (!toggle || toggle._bound) return;
  toggle._bound = true;
  toggle.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-range]') as HTMLElement | null;
    if (!btn) return;
    const newRange = (btn.dataset.range as '12' | '36' | 'all') || 'all';
    if (newRange === _nwGrowthRange) return;
    _nwGrowthRange = newRange;
    toggle.querySelectorAll('.btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    _renderGrowthChart();
  });
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

// ── Forecast range toggle binding ──

function _attachForecastRangeToggle(snaps: Snapshot[], accounts: Account[]): void {
  const toggle = document.getElementById('nw-forecast-range-toggle') as
    (HTMLElement & { _bound?: boolean }) | null;
  if (!toggle || toggle._bound) return;
  toggle._bound = true;
  toggle.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-range]') as HTMLElement | null;
    if (!btn) return;
    const newRange = (btn.dataset.range as '60' | '120' | '240') || '60';
    if (newRange === _fcRange) return;
    _fcRange = newRange;
    _renderForecastChart(snaps, accounts);
  });
}

// ── Forecast chart ──

const FC_LABELS: Record<string, string> = { '60': '5 years', '120': '10 years', '240': '20 years' };

function _renderForecastChart(snaps: Snapshot[], accounts: Account[]): void {
  const C = resolvedT();
  const forecastEl = document.getElementById('nw-forecast');
  if (!forecastEl) return;

  if (snaps.length === 0) {
    forecastEl.innerHTML = '';
    return;
  }
  const latestSnap = snaps[snaps.length - 1];
  const accountInputs = _buildAccountForecastInputs(latestSnap, accounts);
  const hasGrowthPotential = accountInputs.some(
    (a) => a.annualContrib > 0 || a.annualReturnPct > 0,
  );
  if (!hasGrowthPotential) {
    forecastEl.innerHTML = '';
    return;
  }

  const latestDate = latestSnap.date;
  const forecastMonths = parseInt(_fcRange);
  const series = forecastMultiAccountSeries(accountInputs, forecastMonths, latestDate);

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

  // Build per-account configuration summary
  const acctSummaryLines = accounts
    .map((a, idx) => {
      const inp = accountInputs[idx];
      const retStr = `${a.annualReturnPct ?? 0}% return`;
      let contribStr: string;
      if (a.isPrimaryInvestment && (a.moneyType || '').toLowerCase() === 'investment') {
        contribStr =
          inp.annualContrib > 0
            ? `${fmtEur(Math.round(inp.annualContrib))}/yr (from Holdings)`
            : 'no contributions configured';
      } else {
        const amt = a.contribAmount ?? 0;
        const interval = a.contribInterval || 'monthly';
        contribStr =
          amt > 0
            ? `${fmtEur(amt)} ${esc((INTERVAL_LABELS[interval] || interval).toLowerCase())}`
            : 'no contributions';
      }
      return `<span style="color:var(--ink-2)">${esc(a.label || 'Account')}: ${retStr}, ${contribStr}</span>`;
    })
    .join('<br>');

  forecastEl.innerHTML = `
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <div class="card-title" style="margin:0">Forecast \u2014 ${FC_LABELS[_fcRange]}</div>
        <div class="chart-controls">
          <div class="range-toggle" id="nw-forecast-range-toggle">
            <button class="btn btn-sm btn-ghost ${_fcRange === '60' ? 'active' : ''}" data-range="60">5Y</button>
            <button class="btn btn-sm btn-ghost ${_fcRange === '120' ? 'active' : ''}" data-range="120">10Y</button>
            <button class="btn btn-sm btn-ghost ${_fcRange === '240' ? 'active' : ''}" data-range="240">20Y</button>
          </div>
        </div>
      </div>
      <div class="chart-wrap chart-h-lg"><canvas id="c-nw-forecast"></canvas></div>
      <div class="note" style="line-height:1.6">
        <div style="margin-bottom:4px">Assumptions per account (Settings \u2192 Accounts):</div>
        ${acctSummaryLines}
        <div style="margin-top:6px;color:var(--ink-4)">Does not account for taxes, fees, or FX.</div>
      </div>
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

  _attachForecastRangeToggle(snaps, accounts);
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
