import {
  snapTotal,
  fmtEur,
  fmtEur2,
  fmtMon,
  fmtPctNeg,
  fmtEurSigned,
  fmtPctSigned,
  fmtPctVal,
  esc,
  safeColor,
  kpiTile,
} from '../utils';
import { getACCTSList, FORECAST_RANGE_LABELS } from '../constants';
import { getAccounts, getTotalAnnualContrib, getGoals } from '../store/config';
import { annualizeContrib, INTERVAL_LABELS } from '../model/contributions';
import { cagrPerAccount } from '../model/insights';
import {
  formatMonthsEta,
  forecastMultiAccountSeries,
  forecastMonthsToTargetMulti,
} from '../model/forecast';
import type { AccountForecastInput } from '../model/forecast';
import type { Snapshot, PortfolioData, Account } from '../types';
import Chart from 'chart.js/auto';
import { T, R, resolvedT } from '../theme';
import { bindLegendToggle, renderLegendHtml, TOOLTIP_BOX, tooltipSwatch } from './chartLegend';
import { infoTip, attachInfoTips } from '../ui/infoTip';

const CH: Record<string, Chart> = {};
let _nwRange: '12' | '36' | 'all' = 'all';
let _fcRange: '60' | '120' | '240' | '360' = '60'; // 5y / 10y / 20y / 30y forecast horizon
let _inflationRate = 0; // annual inflation % for real-return forecast overlay
let _lastSnaps: Snapshot[] = [];
let _lastAccounts: Account[] = [];
let _activeGoalIdx = 0; // which goal tab is selected in the consolidated goals card

/**
 * Populate (or refresh) an accessible data-table mirror inside a `.chart-data-table-wrap`.
 * The table is always present in the DOM for screen readers; a toggle button lets sighted
 * users show or hide it. Re-calling this function updates the content in place.
 * Tables with more than PAGE_SIZE rows show pagination controls. The scroll wrapper allows
 * wide tables to scroll horizontally without overflowing the page.
 */
const _CHART_TABLE_PAGE_SIZE = 25;

function _writeChartTable(
  wrapId: string,
  ariaLabel: string,
  headers: string[],
  rows: (string | number)[][],
): void {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  const existingTable = wrap.querySelector('.chart-data-table') as HTMLTableElement | null;
  const wasVisible = existingTable ? !existingTable.hidden : false;

  const totalPages = Math.max(1, Math.ceil(rows.length / _CHART_TABLE_PAGE_SIZE));
  let currentPage = 0;

  const thCells = headers.map((h) => `<th scope="col">${esc(String(h))}</th>`).join('');
  const renderBodyRows = (page: number): string =>
    rows
      .slice(page * _CHART_TABLE_PAGE_SIZE, (page + 1) * _CHART_TABLE_PAGE_SIZE)
      .map((r) => `<tr>${r.map((c) => `<td>${esc(String(c))}</td>`).join('')}</tr>`)
      .join('');

  const paginationHtml =
    totalPages > 1
      ? `<div class="chart-data-table-pagination">
        <button class="chart-data-table-prev" type="button" aria-label="Previous page" disabled>&#8249;</button>
        <span class="chart-data-table-page-info">1 / ${totalPages}</span>
        <button class="chart-data-table-next" type="button" aria-label="Next page">&#8250;</button>
      </div>`
      : '';

  const tableHtml = `<div class="chart-data-table-scroll"><table class="chart-data-table" role="table" aria-label="${esc(ariaLabel)}"${wasVisible ? '' : ' hidden'}>
    <thead><tr>${thCells}</tr></thead>
    <tbody>${renderBodyRows(0)}</tbody>
  </table></div>${paginationHtml}`;

  const toggleLabel = wasVisible ? 'Hide data table' : 'Show data table';
  wrap.innerHTML = `<button class="chart-data-table-toggle" type="button" aria-expanded="${wasVisible}">${toggleLabel}</button>${tableHtml}`;

  const btn = wrap.querySelector('.chart-data-table-toggle') as HTMLButtonElement;
  const table = wrap.querySelector('.chart-data-table') as HTMLTableElement;
  btn.addEventListener('click', () => {
    const visible = !table.hidden;
    table.hidden = visible;
    btn.textContent = visible ? 'Show data table' : 'Hide data table';
    btn.setAttribute('aria-expanded', String(!visible));
  });

  if (totalPages > 1) {
    const prevBtn = wrap.querySelector('.chart-data-table-prev') as HTMLButtonElement;
    const nextBtn = wrap.querySelector('.chart-data-table-next') as HTMLButtonElement;
    const pageInfo = wrap.querySelector('.chart-data-table-page-info') as HTMLSpanElement;
    const goToPage = (page: number): void => {
      currentPage = page;
      table.querySelector('tbody')!.innerHTML = renderBodyRows(currentPage);
      pageInfo.textContent = `${currentPage + 1} / ${totalPages}`;
      prevBtn.disabled = currentPage === 0;
      nextBtn.disabled = currentPage === totalPages - 1;
    };
    prevBtn.addEventListener('click', () => goToPage(currentPage - 1));
    nextBtn.addEventListener('click', () => goToPage(currentPage + 1));
  }

  wrap.removeAttribute('hidden');
}

/** Apply annual inflation to convert a nominal forecast series to real values. */
function _deflateByInflation(
  series: Array<{ month: string; value: number }>,
  inflationPct: number,
): Array<{ month: string; value: number }> {
  if (inflationPct === 0) return series;
  return series.map((p, i) => ({
    month: p.month,
    value: Math.round(p.value / Math.pow(1 + inflationPct / 100, (i + 1) / 12)),
  }));
}

function _buildAccountForecastInputs(snap: Snapshot, accounts: Account[]): AccountForecastInput[] {
  return accounts.map((a) => {
    const current = (snap[a.id || ''] as number) || 0;
    const annualReturnPct = a.annualReturnPct || 0;
    const personalContrib =
      a.isPrimaryInvestment && (a.moneyType || '').toLowerCase() === 'investment'
        ? getTotalAnnualContrib()
        : annualizeContrib(a.contribAmount || 0, a.contribInterval || 'monthly');
    const extraContrib = annualizeContrib(a.extraContrib || 0, a.contribInterval || 'monthly');
    const annualContrib = personalContrib + extraContrib;
    return { current, annualContrib, annualReturnPct };
  });
}

/** Re-renders only the goal progress cards using latest cached state. */
function _renderGoalCards(): void {
  const snaps = _lastSnaps;
  const accounts = _lastAccounts;
  if (snaps.length === 0) return;
  const s = snaps[snaps.length - 1];

  // Exclude accounts that are locked and whose unlock year is still in the future.
  // Locked pension/AVD funds cannot be used to meet a near-term liquid goal.
  const currentYear = new Date().getFullYear();
  const liquidAccounts = accounts.filter(
    (a) => !a.locked || (a.lockedUntil ? parseInt(a.lockedUntil, 10) <= currentYear : false),
  );
  const liquidTotal = liquidAccounts.reduce((sum, a) => sum + ((s[a.id || ''] as number) || 0), 0);
  const allTotal = snapTotal(s);
  const lockedTotal = allTotal - liquidTotal;
  const accountInputs = _buildAccountForecastInputs(s, liquidAccounts);

  const goalEl = document.getElementById('nw-goal');
  if (!goalEl) return;
  const goals = getGoals();
  if (goals.length === 0) {
    goalEl.innerHTML = '';
    return;
  }

  // Build per-goal panel HTML; skip reached or invalid goals.
  const panels: Array<{ title: string; html: string }> = [];

  for (const goal of goals) {
    const rawNW = (goal.targetNetWorth || '').replace(/\./g, '').replace(',', '.');
    const target = parseFloat(rawNW);
    if (isNaN(target) || target <= 0) continue;
    if (liquidTotal >= target) continue;

    const pctComplete = Math.min(100, Math.round((liquidTotal / target) * 100));
    const remaining = Math.max(0, target - liquidTotal);
    const etaMonths = forecastMonthsToTargetMulti(accountInputs, target);
    const targetDate = (goal.targetDate || '').trim();
    const validTargetDate = /^\d{4}-\d{2}$/.test(targetDate) ? targetDate : null;

    let etaText = '';
    let isOnTrack: boolean | null = null;
    if (etaMonths !== null) {
      const etaFormatted = formatMonthsEta(etaMonths);
      const etaDate = new Date();
      etaDate.setMonth(etaDate.getMonth() + etaMonths, 1);
      const etaDateStr = `${etaDate.getFullYear()}-${String(etaDate.getMonth() + 1).padStart(2, '0')}`;
      const etaDateFmt = fmtMon(etaDateStr);
      if (validTargetDate) {
        isOnTrack = etaDateStr <= validTargetDate;
        etaText = isOnTrack
          ? `<span class="pos">On track for ${fmtMon(validTargetDate)}</span> (ETA ${etaFormatted}, ${etaDateFmt})`
          : `<span class="neg">Behind schedule</span> (ETA ${etaFormatted}, ${etaDateFmt}; target was ${fmtMon(validTargetDate)})`;
      } else {
        etaText = `ETA ${etaFormatted} (${etaDateFmt})`;
      }
    } else {
      const hasGrowthPotential = accountInputs.some(
        (a) => a.annualContrib > 0 || a.annualReturnPct > 0,
      );
      etaText = hasGrowthPotential
        ? '<span class="neg">Target not reachable within the 100-year forecast horizon. Consider increasing contributions or return rate.</span>'
        : 'Unable to estimate (set contributions or return rate)';
    }

    const title = goal.label ? esc(goal.label) : 'Goal';
    const lockedNote =
      lockedTotal > 0
        ? `<p class="note" style="margin-top:4px">Excludes ${fmtEur(lockedTotal)} in locked (pension/retirement) accounts — those funds are not accessible for this goal.</p>`
        : '';
    const panelHtml = `
      <div class="row"><div class="row-label">Target</div><div class="row-val">${fmtEur(target)}</div></div>
      <div class="row"><div class="row-label">Current (liquid)</div><div class="row-val">${fmtEur(liquidTotal)}</div></div>
      <div class="row"><div class="row-label">Remaining</div><div class="row-val">${fmtEur(remaining)}</div></div>
      <div style="margin:.75rem 0">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
          <span>${fmtPctVal(Math.min(100, (liquidTotal / target) * 100))} complete</span>
          <span>${fmtEur(liquidTotal)} / ${fmtEur(target)}</span>
        </div>
        <div style="height:8px;background:var(--surface-3);border-radius:var(--radius-xs);overflow:hidden">
          <div style="width:${pctComplete}%;height:100%;background:${pctComplete >= 100 ? 'var(--pos)' : isOnTrack === false ? 'var(--warn)' : 'var(--brand)'};border-radius:var(--radius-xs);transition:width .3s"></div>
        </div>
      </div>
      <div class="row" style="align-items:flex-start"><div class="row-label">ETA</div><div class="row-val" style="font-size:12px;text-align:left;flex-shrink:1;overflow-wrap:break-word;word-break:break-word;min-width:0">${etaText}${_inflationRate > 0 ? '<br><span class="note" style="font-size:11px">ETA is in nominal terms; inflation is not factored in.</span>' : ''}</div></div>
      ${lockedNote}`;
    panels.push({ title, html: panelHtml });
  }

  if (panels.length === 0) {
    goalEl.innerHTML = '';
    return;
  }

  // Clamp active index in case goals were added/removed.
  _activeGoalIdx = Math.min(_activeGoalIdx, panels.length - 1);

  if (panels.length === 1) {
    // Single goal: plain card, no tab strip.
    goalEl.innerHTML = `
      <div class="card" style="margin-bottom:.75rem">
        <div class="card-title">${panels[0].title}</div>
        ${panels[0].html}
      </div>`;
  } else {
    // Multiple goals: single card with a tab strip at the top.
    const tabs = panels
      .map(
        (p, i) =>
          `<button class="btn btn-sm btn-ghost${i === _activeGoalIdx ? ' active' : ''}" data-goal-tab="${i}">${p.title}</button>`,
      )
      .join('');
    goalEl.innerHTML = `
      <div class="card" style="margin-bottom:.75rem" id="nw-goal-card">
        <div class="card-title">Goals</div>
        <div class="range-toggle" id="nw-goal-tabs" style="margin-bottom:.75rem;flex-wrap:wrap">${tabs}</div>
        <div id="nw-goal-panel">${panels[_activeGoalIdx].html}</div>
      </div>`;

    document.getElementById('nw-goal-tabs')?.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-goal-tab]') as HTMLElement | null;
      if (!btn) return;
      _activeGoalIdx = parseInt(btn.dataset.goalTab!);
      _renderGoalCards();
    });
  }
}

/**
 * Renders the Net Worth tab: lead KPI (with MoM delta), per-account KPI tiles,
 * YoY/CAGR tiles, the history chart, growth-breakdown chart, and goal progress.
 */
export function renderNW(pd: PortfolioData | null, snaps: Snapshot[]): void {
  const ACCTS = getACCTSList();
  const has = snaps.length > 0;
  document.getElementById('nw-empty')!.style.display = has ? 'none' : 'block';
  document.getElementById('nw-content')!.style.display = has ? 'block' : 'none';
  if (!has) return;

  const s = snaps[snaps.length - 1];
  const total = snapTotal(s);
  _lastSnaps = snaps;
  const prev = snaps.length > 1 ? snaps[snaps.length - 2] : null;
  const prevT = prev ? snapTotal(prev) : null;
  const chg = prevT !== null ? total - prevT : null;
  const chgPct = chg !== null && prevT && prevT > 0 ? (chg / prevT) * 100 : null;
  const activeA = ACCTS.filter((a) => ((s[a.key] as number) || 0) > 0);
  const accounts = getAccounts();
  _lastAccounts = accounts;

  // Per-account CAGR map (keyed by accountId)
  const acctCagrMap = new Map(cagrPerAccount(snaps, accounts).map((r) => [r.accountId, r]));

  document.getElementById('nw-kpis')!.innerHTML = `
    <div class="kpi kpi-lead">
      <div class="kpi-label">Net worth</div>
      <div class="kpi-val">${fmtEur2(total)}</div>
      <div class="kpi-sub">${
        chg !== null
          ? fmtEurSigned(chg, 2) +
            (chgPct !== null ? ' (' + fmtPctSigned(chgPct) + ')' : '') +
            ' vs ' +
            fmtMon(prev!.date)
          : fmtMon(s.date)
      }</div>
    </div>
    ${activeA
      .map((a) => {
        const acctCagr = acctCagrMap.get(a.key);
        const cagrSub =
          acctCagr && acctCagr.cagrValue !== null
            ? `<div class="kpi-sub ${acctCagr.cagrValue >= 0 ? 'pos' : 'neg'}">CAGR ${fmtPctNeg(acctCagr.cagrValue * 100)} (${acctCagr.monthsSpan}m)</div>`
            : '';
        return `
      <div class="kpi">
        <div class="kpi-label">${esc(a.label)}</div>
        <div class="kpi-val">${fmtEur2((s[a.key] as number) || 0)}</div>
        <div class="kpi-sub">${fmtPctVal(total > 0 ? (((s[a.key] as number) || 0) / total) * 100 : 0)} of total</div>
        ${cagrSub}
      </div>`;
      })
      .join('')}
    ${(() => {
      const accts = getAccounts();
      const locked = activeA.reduce((sum, a) => {
        const acc = accts.find((x) => x.id === a.key);
        return sum + (acc?.locked ? (s[a.key] as number) || 0 : 0);
      }, 0);
      if (locked <= 0) return '';
      const liquid = total - locked;
      const lockedYears = accts
        .filter((x) => x.locked && x.lockedUntil)
        .map((x) => x.lockedUntil!)
        .sort();
      const firstUnlock = lockedYears[0];
      const lastUnlock = lockedYears[lockedYears.length - 1];
      const lockedSub = firstUnlock
        ? firstUnlock === lastUnlock
          ? `unlocks ${firstUnlock}`
          : `unlocks ${firstUnlock}-${lastUnlock}`
        : `${fmtPctVal(total > 0 ? (locked / total) * 100 : 0)} of total`;
      return `
      <div class="kpi">
        <div class="kpi-label">Liquid${infoTip('Net worth accessible now, excluding pension and retirement accounts marked as locked.')}</div>
        <div class="kpi-val">${fmtEur2(liquid)}</div>
        <div class="kpi-sub">${fmtPctVal(total > 0 ? (liquid / total) * 100 : 0)} of total</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Locked${infoTip('Funds in pension/retirement accounts not accessible until retirement age.')}</div>
        <div class="kpi-val">${fmtEur2(locked)}</div>
        <div class="kpi-sub">${lockedSub}</div>
      </div>`;
    })()}
  `;

  const chartA = ACCTS.filter((a) => snaps.some((sn) => ((sn[a.key] as number) || 0) > 0));

  // Range-sliced view for the history chart
  const view = _nwRange === 'all' ? snaps : snaps.slice(-parseInt(_nwRange));

  // Chart title + legend + history chart
  document.getElementById('nw-chart-title')!.textContent =
    snaps.length === 1
      ? 'Account breakdown: ' +
        fmtMon(snaps[0].date) +
        ' (add more snapshots to see growth over time)'
      : 'Net worth over time: total + per account';

  const C = resolvedT();
  _destroyChart('c-nw-hist');
  if (snaps.length === 1) {
    // Legend for single-snapshot: per-account only
    document.getElementById('nw-chart-legend')!.innerHTML = renderLegendHtml(
      chartA.map((a) => ({ label: a.label, color: a.color })),
    );

    CH['c-nw-hist'] = new Chart(document.getElementById('c-nw-hist') as HTMLCanvasElement, {
      type: 'bar',
      data: {
        labels: chartA.map((a) => a.label),
        datasets: [
          {
            data: chartA.map((a) => (s[a.key] as number) || 0),
            backgroundColor: chartA.map((a) => safeColor(a.color)),
            borderColor: chartA.map((a) => safeColor(a.color)),
            borderWidth: 1,
            borderRadius: R.xs,
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
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              label: (ctx) => ` ${fmtEur(ctx.raw as number)}`,
              labelColor: tooltipSwatch(C.surface),
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

    _writeChartTable(
      'c-nw-hist-table-wrap',
      'Account breakdown data',
      ['Account', 'Value (€)'],
      chartA.map((a) => [a.label, fmtEur2((s[a.key] as number) || 0)]),
    );
  } else {
    _renderNWHistChart(view, chartA);
  }

  // Bind range toggle once
  _attachNWRangeToggle(snaps, chartA);

  const bkA = ACCTS.filter((a) => ((s[a.key] as number) || 0) > 0);

  let det = bkA
    .map(
      (a) =>
        `<div class="row"><div class="row-label">${esc(a.label)}</div><div class="row-val">${fmtEur2((s[a.key] as number) || 0)}</div></div>`,
    )
    .join('');
  det += `<div class="row" style="border-top:1px solid var(--line-2);margin-top:4px">
    <div class="row-label" style="font-weight:500">Total</div>
    <div class="row-val" style="font-weight:500">${fmtEur2(total)}</div></div>`;
  if (prev) {
    const c = total - prevT!;
    det += `<div class="row"><div class="row-label" style="color:var(--ink-3);font-size:12px">vs ${fmtMon(prev.date)}</div>
      <div class="row-val ${c >= 0 ? 'pos' : 'neg'}">${fmtEurSigned(c, 2)}</div></div>`;
  }
  if (s.notes) det += `<p class="note" style="margin-top:.5rem">${esc(s.notes)}</p>`;
  document.getElementById('nw-detail')!.innerHTML = det;

  // Goal progress cards (one per named goal)
  _renderGoalCards();

  // Forecast chart
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
    pointRadius: 0,
    pointHoverRadius: 4,
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
    pointRadius: 0,
    pointHoverRadius: 5,
    pointBackgroundColor: C.brand,
    order: 0, // drawn on top
  };

  // Legend: Total swatch first, then per-account swatches
  document.getElementById('nw-chart-legend')!.innerHTML = renderLegendHtml([
    { label: 'Total net worth', color: C.brand },
    ...chartA.map((a) => ({ label: a.label, color: a.color })),
  ]);

  _destroyChart('c-nw-hist');
  const chart = new Chart(document.getElementById('c-nw-hist') as HTMLCanvasElement, {
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
          ...TOOLTIP_BOX,
          borderColor: C.line,
          borderWidth: 1,
          titleColor: C.ink,
          bodyColor: C.ink2,
          padding: 10,
          cornerRadius: 8,
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: ${fmtEur2(ctx.raw as number)}`,
            labelColor: tooltipSwatch(C.surface),
          },
        },
      },
      scales: {
        y: {
          grid: { color: C.line },
          ticks: {
            color: C.ink4,
            callback: (v) =>
              (v as number) >= 1000
                ? ((v as number) / 1000).toFixed(0) + 'k\u00A0€'
                : v + '\u00A0€',
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

  // Write accessible data table for screen readers / keyboard users
  _writeChartTable(
    'c-nw-hist-table-wrap',
    'Net worth history data',
    ['Month', 'Total Net Worth (€)', ...chartA.map((a) => a.label + ' (€)')],
    view.map((sn) => [
      fmtMon(sn.date),
      fmtEur2(snapTotal(sn)),
      ...chartA.map((a) => fmtEur2((sn[a.key] as number) || 0)),
    ]),
  );

  // Make legend swatches clickable to toggle datasets
  _bindLegendToggle(chart);
}

// ── Legend click toggle for many-account mode ──

function _bindLegendToggle(chart: Chart): void {
  const legendEl = document.getElementById('nw-chart-legend');
  if (!legendEl) return;
  // Index 0 = Total - always visible, never togglable.
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
    if (newRange === _nwRange) return; // already on this range - no-op
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
    const newRange = (btn.dataset.range as '60' | '120' | '240' | '360') || '60';
    if (newRange === _fcRange) return;
    _fcRange = newRange;
    _renderForecastChart(snaps, accounts);
  });
}

// ── Forecast chart ──

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

  // Inflation-adjusted (real) series
  const realSeries = _deflateByInflation(series, _inflationRate);
  const showReal = _inflationRate > 0;

  // Build combined history + forecast for a seamless line chart
  const historySlice = snaps.slice(-12); // last 12 months of actual data
  const histLabels = historySlice.map((sn) => fmtMon(sn.date));
  const histValues = historySlice.map((sn) => snapTotal(sn));

  const fcLabels = series.map((p) => fmtMon(p.month));
  const fcValues = series.map((p) => p.value);
  const realValues = realSeries.map((p) => p.value);

  // Combined labels: history + forecast
  const labels = [...histLabels, ...fcLabels];
  const histDataFull = [...histValues, ...new Array(fcValues.length).fill(null)];
  const fcDataFull = [
    ...new Array(histValues.length - 1).fill(null),
    histValues[histValues.length - 1],
    ...fcValues,
  ];
  const realDataFull = showReal
    ? [
        ...new Array(histValues.length - 1).fill(null),
        histValues[histValues.length - 1],
        ...realValues,
      ]
    : null;

  const _allGoals = getGoals();
  const DEADLINE_COLORS = [
    'rgba(255,160,30,0.9)',
    'rgba(200,80,200,0.9)',
    'rgba(30,190,180,0.9)',
    'rgba(220,60,60,0.9)',
  ];

  // Deadline markers: vertical line + dot per goal that has a targetDate in the chart range.
  const goalDeadlines: Array<{
    title: string;
    labelIndex: number;
    color: string;
    targetNW: number | null;
  }> = [];
  _allGoals.forEach((g, gi) => {
    const dl = (g.targetDate || '').trim();
    if (!/^\d{4}-\d{2}$/.test(dl)) return;
    const rawNW = (g.targetNetWorth || '').replace(/\./g, '').replace(',', '.');
    const targetNW = parseFloat(rawNW);
    // Skip goals already reached
    if (!isNaN(targetNW) && targetNW > 0 && snapTotal(latestSnap) >= targetNW) return;
    const dlLabel = fmtMon(dl);
    const idx = labels.indexOf(dlLabel);
    if (idx === -1) return;
    goalDeadlines.push({
      title: g.label ? esc(g.label) : `Goal ${gi + 1}`,
      labelIndex: idx,
      color: DEADLINE_COLORS[gi % DEADLINE_COLORS.length],
      targetNW: isNaN(targetNW) || targetNW <= 0 ? null : targetNW,
    });
  });

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
        const extra = a.extraContrib ?? 0;
        const interval = a.contribInterval || 'monthly';
        const personalStr =
          amt > 0
            ? `${fmtEur(amt)} ${esc((INTERVAL_LABELS[interval] || interval).toLowerCase())}`
            : 'no contributions';
        contribStr = extra > 0 ? `${personalStr} + ${fmtEur(extra)} extra` : personalStr;
      }
      return `<span style="color:var(--ink-2)">${esc(a.label || 'Account')}: ${retStr}, ${contribStr}</span>`;
    })
    .join('<br>');

  forecastEl.innerHTML = `
    <div class="card">
      <div class="card-title">Forecast: ${FORECAST_RANGE_LABELS[_fcRange]} (per-account return assumptions)</div>
      <div class="chart-controls">
        <div id="nw-forecast-legend" class="legend"></div>
        <div class="range-toggle" id="nw-forecast-range-toggle">
          <button class="btn btn-sm btn-ghost ${_fcRange === '60' ? 'active' : ''}" data-range="60">5Y</button>
          <button class="btn btn-sm btn-ghost ${_fcRange === '120' ? 'active' : ''}" data-range="120">10Y</button>
          <button class="btn btn-sm btn-ghost ${_fcRange === '240' ? 'active' : ''}" data-range="240">20Y</button>
          <button class="btn btn-sm btn-ghost ${_fcRange === '360' ? 'active' : ''}" data-range="360">30Y</button>
        </div>
      </div>
      <div class="chart-wrap chart-h-lg"><canvas id="c-nw-forecast"></canvas></div>
      <div class="note" style="line-height:1.6">
        <div style="margin-bottom:4px">Assumptions per account (Settings \u2192 Accounts):</div>
        ${acctSummaryLines}
        <div class="forecast-inflation">
          <div class="forecast-inflation-row">
            <label for="nw-forecast-inflation" class="forecast-inflation-label">Annual inflation</label>
            <div class="forecast-inflation-input-wrap">
              <input id="nw-forecast-inflation" class="forecast-inflation-input" type="number" inputmode="decimal" min="0" max="20" step="0.1"
                     value="${_inflationRate}"
                     aria-label="Annual inflation rate for real-return forecast">
              <span class="forecast-inflation-unit">% / yr</span>
            </div>
          </div>
          <div class="forecast-inflation-hint">
            ${
              showReal
                ? 'Dashed line shows the inflation-adjusted projection in today’s purchasing power.'
                : 'Set above 0 to overlay an inflation-adjusted projection.'
            }
          </div>
        </div>
        <div style="margin-top:4px;color:var(--ink-4)">Does not account for taxes, fees, or FX.${goalDeadlines.length > 0 ? ' Goal deadlines and target amounts are shown as markers on the chart.' : ''}</div>
      </div>
    </div>`;

  _destroyChart('c-nw-forecast');

  // Inline plugin: draw vertical deadline markers for each goal
  const deadlinePlugin =
    goalDeadlines.length > 0
      ? {
          id: 'goalDeadlines',
          afterDraw(chart: import('chart.js').Chart) {
            const { ctx, chartArea, scales } = chart;
            if (!chartArea) return;
            ctx.save();
            goalDeadlines.forEach((d) => {
              const x = scales['x'].getPixelForValue(d.labelIndex);
              if (x < chartArea.left || x > chartArea.right) return;
              ctx.strokeStyle = d.color;
              ctx.lineWidth = 1.5;
              ctx.setLineDash([4, 3]);
              ctx.beginPath();
              ctx.moveTo(x, chartArea.top);
              ctx.lineTo(x, chartArea.bottom);
              ctx.stroke();
              ctx.setLineDash([]);
              ctx.fillStyle = d.color;
              ctx.font = '10px sans-serif';
              ctx.textAlign = 'left';
              ctx.fillText(d.title, x + 3, chartArea.top + 12);
              if (d.targetNW !== null && scales['y']) {
                const y = scales['y'].getPixelForValue(d.targetNW);
                if (y >= chartArea.top && y <= chartArea.bottom) {
                  ctx.beginPath();
                  ctx.arc(x, y, 5, 0, Math.PI * 2);
                  ctx.fillStyle = d.color;
                  ctx.fill();
                  ctx.strokeStyle = 'var(--surface-1)';
                  ctx.lineWidth = 1.5;
                  ctx.stroke();
                }
              }
            });
            ctx.restore();
          },
        }
      : null;

  CH['c-nw-forecast'] = new Chart(document.getElementById('c-nw-forecast') as HTMLCanvasElement, {
    type: 'line',
    plugins: deadlinePlugin ? [deadlinePlugin] : [],
    data: {
      labels,
      datasets: [
        {
          label: 'Actual',
          data: histDataFull,
          borderColor: C.brand,
          backgroundColor: C.brand,
          borderWidth: 2.5,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointBackgroundColor: C.brand,
          fill: false,
          tension: 0,
          spanGaps: false,
          order: 1,
        },
        {
          label: 'Forecast (nominal)',
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
        ...(realDataFull
          ? [
              {
                label: `Real (${_inflationRate}% inflation)`,
                data: realDataFull,
                borderColor: C.ink4 || 'rgba(150,150,150,0.9)',
                backgroundColor: 'transparent',
                borderWidth: 1.5,
                borderDash: [3, 3],
                pointRadius: 0,
                fill: false,
                tension: 0.3,
                spanGaps: false,
                order: 3,
              },
            ]
          : []),
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
          ...TOOLTIP_BOX,
          borderColor: C.line,
          borderWidth: 1,
          titleColor: C.ink,
          bodyColor: C.ink2,
          padding: 10,
          cornerRadius: 8,
          callbacks: {
            label: (ctx) =>
              ctx.raw != null ? ` ${ctx.dataset.label}: ${fmtEur(ctx.raw as number)}` : '',
            labelColor: tooltipSwatch(C.surface),
          },
        },
      },
      scales: {
        y: {
          grid: { color: C.line },
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

  // Build custom HTML legend for forecast chart
  const fcLegendEl = document.getElementById('nw-forecast-legend');
  if (fcLegendEl) {
    const datasets = CH['c-nw-forecast'].data.datasets;
    fcLegendEl.innerHTML = renderLegendHtml(
      datasets.map((ds) => ({
        label: ds.label as string,
        color: ds.borderColor as string,
        dashed: Array.isArray((ds as any).borderDash) && (ds as any).borderDash.length > 0,
      })),
    );
    bindLegendToggle(fcLegendEl, CH['c-nw-forecast'], { rescaleX: true });
  }

  // Bind inflation input: on change, update state and re-render the forecast card
  const inflInput = document.getElementById('nw-forecast-inflation') as HTMLInputElement | null;
  if (inflInput) {
    inflInput.addEventListener('change', () => {
      const v = parseFloat(inflInput.value);
      _inflationRate = isFinite(v) && v >= 0 ? Math.min(v, 20) : 0;
      _renderGoalCards();
      _renderForecastChart(snaps, accounts);
    });
  }

  _attachForecastRangeToggle(snaps, accounts);
}

// ── Helpers ──

function _destroyChart(id: string): void {
  if (CH[id]) {
    CH[id].destroy();
    delete CH[id];
  }
}
