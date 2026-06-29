// @ts-nocheck — DOM-heavy view; full strict typing deferred to framework migration
import { snapTotal, fmt, fmtMon, esc, safeColor } from '../utils';
import { getACCTSList } from '../constants';
import { getAccounts } from '../store/config';
import { primaryInvestmentValue } from '../model/accounts';
import { monthlyGrowthSplit, cagr, findYoYSnapshot } from '../model/insights';
import type { Snapshot, PortfolioData } from '../types';
import Chart from 'chart.js/auto';
import { T } from '../theme';

const CH: Record<string, Chart> = {};
let _nwRange: '12' | '36' | 'all' = 'all';

export function renderNW(pd: PortfolioData | null, snaps: Snapshot[]): void {
  const ACCTS = getACCTSList();
  const has = snaps.length > 0;
  document.getElementById('nw-empty').style.display   = has ? 'none'  : 'block';
  document.getElementById('nw-content').style.display = has ? 'block' : 'none';
  if (!has) return;

  const s     = snaps[snaps.length - 1];
  const total = snapTotal(s);
  const prev  = snaps.length > 1 ? snaps[snaps.length - 2] : null;
  const prevT = prev ? snapTotal(prev) : null;
  const chg   = prevT !== null ? total - prevT : null;
  const chgPct = chg !== null && prevT && prevT > 0 ? chg / prevT * 100 : null;
  const activeA = ACCTS.filter(a => (s[a.key] || 0) > 0);

  // ── Extra KPIs: YoY + CAGR ──
  const firstTotal = snaps.length > 0 ? snapTotal(snaps[0]) : 0;
  const firstDate = snaps[0]?.date || '';
  const latestDate = s.date || '';
  const monthsSpan = _monthsDiff(firstDate, latestDate);

  const yoyData = findYoYSnapshot(snaps);
  const yoyAbs = yoyData ? total - yoyData.total : null;
  const yoyPct = yoyData && yoyData.total > 0 ? (total - yoyData.total) / yoyData.total * 100 : null;

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
        <div class="row"><div class="row-label">Total change</div><div class="row-val ${(primaryNow - primaryPrev) >= 0 ? 'pos' : 'neg'}">${(primaryNow - primaryPrev) >= 0 ? '+' : ''}${fmt(primaryNow - primaryPrev, 2)}</div></div>
        <div class="row"><div class="row-label">Contributed</div><div class="row-val">${fmt(split.contributed, 2)}</div></div>
        <div class="row"><div class="row-label">Market movement</div><div class="row-val ${split.market >= 0 ? 'pos' : 'neg'}">${split.market >= 0 ? '+' : ''}${fmt(split.market, 2)}</div></div>
      </div>`;
  }

  document.getElementById('nw-kpis').innerHTML = `
    <div class="kpi">
      <div class="kpi-label">Net worth</div>
      <div class="kpi-val">${fmt(total, 2)}</div>
      <div class="kpi-sub">${chg !== null
        ? (chg >= 0 ? '+' : '') + fmt(chg, 2) + (chgPct !== null ? ' (' + (chgPct >= 0 ? '+' : '') + chgPct.toFixed(1) + '%)' : '') + ' vs ' + fmtMon(prev.date)
        : fmtMon(s.date)}</div>
    </div>
    ${activeA.map(a => `
      <div class="kpi">
        <div class="kpi-label">${esc(a.label)}</div>
        <div class="kpi-val">${fmt(s[a.key] || 0, 2)}</div>
        <div class="kpi-sub">${total > 0 ? Math.round((s[a.key] || 0) / total * 100) : 0}% of total</div>
      </div>`).join('')}
    ${yoyAbs !== null ? `
      <div class="kpi">
        <div class="kpi-label">YoY</div>
        <div class="kpi-val ${yoyAbs >= 0 ? 'pos' : 'neg'}">${yoyAbs >= 0 ? '+' : ''}${fmt(yoyAbs, 2)}</div>
        <div class="kpi-sub">${yoyPct !== null ? (yoyPct >= 0 ? '+' : '') + yoyPct.toFixed(1) + '%' : '—'} vs ${fmtMon(yoyData.snap.date)}</div>
      </div>` : ''}
    ${cagrVal !== null ? `
      <div class="kpi">
        <div class="kpi-label">CAGR</div>
        <div class="kpi-val ${cagrVal >= 0 ? 'pos' : 'neg'}">${(cagrVal >= 0 ? '+' : '') + (cagrVal * 100).toFixed(1)}%</div>
        <div class="kpi-sub">${monthsSpan} months</div>
      </div>` : ''}
  `;

  const chartA = ACCTS.filter(a => snaps.some(sn => (sn[a.key] || 0) > 0));

  // Range-sliced view for the history chart
  const view = _nwRange === 'all' ? snaps : snaps.slice(-parseInt(_nwRange));

  // Chart title + legend + history chart
  document.getElementById('nw-chart-title').textContent = snaps.length === 1
    ? 'Account breakdown — ' + fmtMon(snaps[0].date) + ' (add more snapshots to see growth over time)'
    : 'Net worth over time — total + per account';

  _destroyChart('c-nw-hist');
  if (snaps.length === 1) {
    // Legend for single-snapshot: per-account only
    document.getElementById('nw-chart-legend').innerHTML =
      chartA.map(a => `<span class="leg-item"><span class="leg-sq" style="background:${safeColor(a.color)}"></span>${esc(a.label)}</span>`).join('');

    CH['c-nw-hist'] = new Chart(document.getElementById('c-nw-hist'), {
      type: 'bar',
      data: {
        labels: chartA.map(a => a.label),
        datasets: [{ data: chartA.map(a => s[a.key] || 0),
          backgroundColor: chartA.map(a => a.color + 'cc'),
          borderColor: chartA.map(a => a.color),
          borderWidth: 1, borderRadius: 5, borderSkipped: false }],
      },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false },
          tooltip: { callbacks: { label: ctx => ` ${fmt(ctx.raw)}` } } },
        scales: {
          x: { grid: { color: T.line }, ticks: { color: T.ink4, callback: v => '€' + (v / 1000).toFixed(0) + 'k' } },
          y: { grid: { display: false }, ticks: { color: T.ink2, font: { size: 12 } } },
        },
      },
    });
  } else {
    _renderNWHistChart(view, chartA);
  }

  // Bind range toggle once
  _attachNWRangeToggle(snaps, chartA);

  const bkA = ACCTS.filter(a => (s[a.key] || 0) > 0);
  _destroyChart('c-nw-donut');
  CH['c-nw-donut'] = new Chart(document.getElementById('c-nw-donut'), {
    type: 'doughnut',
    data: { labels: bkA.map(a => a.label), datasets: [{
      data: bkA.map(a => s[a.key] || 0), backgroundColor: bkA.map(a => a.color),
      borderWidth: 3, borderColor: T.white,
    }]},
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
  });

  document.getElementById('nw-donut-legend').innerHTML =
    bkA.map(a => `<span class="leg-item"><span class="leg-sq" style="background:${safeColor(a.color)}"></span>${esc(a.label)} ${total > 0 ? Math.round((s[a.key] || 0) / total * 100) : 0}%</span>`).join('');

  let det = bkA.map(a =>
    `<div class="row"><div class="row-label">${esc(a.label)}</div><div class="row-val">${fmt(s[a.key] || 0, 2)}</div></div>`
  ).join('');
  det += `<div class="row" style="border-top:1px solid ${T.line2};margin-top:4px">
    <div class="row-label" style="font-weight:500">Total</div>
    <div class="row-val" style="font-weight:500">${fmt(total, 2)}</div></div>`;
  if (prev) {
    const c = total - prevT;
    det += `<div class="row"><div class="row-label" style="color:${T.ink3};font-size:12px">vs ${fmtMon(prev.date)}</div>
      <div class="row-val ${c >= 0 ? 'pos' : 'neg'}">${c >= 0 ? '+' : ''}${fmt(c, 2)}</div></div>`;
  }
  if (s.notes) det += `<p class="note" style="margin-top:.5rem">${esc(s.notes)}</p>`;
  document.getElementById('nw-detail').innerHTML = det;

  // Growth split card
  const growthEl = document.getElementById('nw-growth-split');
  if (growthEl) growthEl.innerHTML = growthSplitHtml;
}

// ── History chart helper (lines + dots, total line) ──

function _renderNWHistChart(
  view: Snapshot[],
  chartA: Array<{ key: string; label: string; color: string }>,
): void {
  const labels = view.map(sn => fmtMon(sn.date));
  const totalSeries = view.map(sn => snapTotal(sn));
  const manyAccounts = chartA.length > 4;

  const accountDatasets = chartA.map(a => ({
    label: a.label,
    data: view.map(sn => (sn[a.key] as number) || 0),
    borderColor: a.color,
    backgroundColor: a.color,
    borderWidth: 1.5,
    fill: false,
    tension: 0,
    pointRadius: 2.5,
    pointHoverRadius: 5,
    pointBackgroundColor: a.color,
    order: 2,
    hidden: manyAccounts, // hide per-account lines when > 4 accounts
  }));
  const totalDataset = {
    label: 'Total net worth',
    data: totalSeries,
    borderColor: T.brand,
    backgroundColor: T.brand,
    borderWidth: 2.5,
    fill: false,
    tension: 0,
    pointRadius: 3.5,
    pointHoverRadius: 6,
    pointBackgroundColor: T.brand,
    order: 0, // drawn on top
  };

  // Legend: Total swatch first, then per-account swatches
  document.getElementById('nw-chart-legend').innerHTML =
    `<span class="leg-item"><span class="leg-sq" style="background:${T.brand}"></span>Total net worth</span>` +
    chartA.map(a => `<span class="leg-item"><span class="leg-sq" style="background:${safeColor(a.color)}"></span>${esc(a.label)}</span>`).join('');

  _destroyChart('c-nw-hist');
  const chart = new Chart(document.getElementById('c-nw-hist'), {
    type: 'line',
    data: { labels, datasets: [totalDataset, ...accountDatasets] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false },
        tooltip: { mode: 'index', intersect: false,
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.raw as number, 2)}` },
        },
      },
      scales: {
        y: { grid: { color: T.line },
             ticks: { color: T.ink4, callback: v => '€' + ((v as number) / 1000).toFixed(0) + 'k' } },
        x: { grid: { display: false }, ticks: { color: T.ink2, font: { size: 10 }, maxRotation: 0, autoSkip: true } },
      },
    },
  });
  CH['c-nw-hist'] = chart;

  // If many accounts, make legend swatches clickable to toggle datasets
  if (manyAccounts) {
    _bindLegendToggle(chart);
  }
}

// ── Legend click toggle for many-account mode ──

function _bindLegendToggle(chart: Chart): void {
  const legendEl = document.getElementById('nw-chart-legend');
  if (!legendEl) return;
  const items = legendEl.querySelectorAll('.leg-item');
  items.forEach((item, i) => {
    (item as HTMLElement).style.cursor = 'pointer';
    if (i === 0) return; // Total — always visible
    const dsIdx = i; // dataset index (0=total, 1..n=accounts)
    (item as HTMLElement).addEventListener('click', () => {
      const meta = chart.getDatasetMeta(dsIdx);
      meta.hidden = !meta.hidden;
      (item as HTMLElement).style.opacity = meta.hidden ? '0.4' : '1';
      chart.update();
    });
    // Initial dimmed state
    (item as HTMLElement).style.opacity = '0.4';
  });
}

// ── Range toggle binding ──

function _attachNWRangeToggle(
  snaps: Snapshot[],
  chartA: Array<{ key: string; label: string; color: string }>,
): void {
  const toggle = document.getElementById('nw-range-toggle') as HTMLElement & { _bound?: boolean } | null;
  if (!toggle || toggle._bound) return;
  toggle._bound = true;
  toggle.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-range]') as HTMLElement | null;
    if (!btn) return;
    _nwRange = btn.dataset.range as '12' | '36' | 'all' || 'all';
    toggle.querySelectorAll('.btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const view = _nwRange === 'all' ? snaps : snaps.slice(-parseInt(_nwRange));
    _renderNWHistChart(view, chartA);
  });
}

// ── Helpers ──

function _destroyChart(id: string): void {
  if (CH[id]) { CH[id].destroy(); delete CH[id]; }
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
