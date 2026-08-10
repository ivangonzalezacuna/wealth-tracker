import {
  snapTotal,
  fmtEur,
  fmtEur2,
  fmtMon,
  fmtEurNeg,
  fmtPctNeg,
  fmtEurSigned,
  fmtPctSigned,
  fmtPctVal,
  esc,
  safeColor,
  kpiTile,
} from '../utils';
import {
  cagr,
  findYoYSnapshot,
  monthlyGrowthHistory,
  twr,
  xirr,
  annualizedVolatility,
  maxDrawdown,
  totalReturn,
  ytdReturn,
  absoluteGain,
  avgDrawdown,
  drawdownDuration,
  downsideDeviation,
  sharpeRatio,
  sortinoRatio,
  calmarRatio,
  rollingCagr,
  annualReturns,
  weightedMonthlyReturns,
  dividendMetrics,
  type MonthlyGrowthPoint,
} from '../model/insights';
import { getAccounts, getHoldings, getSettings } from '../store/config';
import { allInvestmentAccountsValue, primaryInvestmentValue } from '../model/accounts';
import { infoTip, attachInfoTips } from '../ui/infoTip';
import { bindLegendToggle, renderLegendHtml, TOOLTIP_BOX, tooltipSwatch } from './chartLegend';
import { T, R, resolvedT } from '../theme';
import Chart from 'chart.js/auto';
import type { Snapshot, PortfolioData, Transaction, Holding } from '../types';

const CH: Record<string, Chart> = {};
let _anGrowthRange: '12' | '36' | 'all' = 'all';
let _anContribRange: '12' | '36' | 'all' = 'all';
let _anIncomeRange: '12' | '36' | 'all' = '12';
let _lastSnaps: Snapshot[] = [];
let _lastPd: PortfolioData | null = null;
let _lastTxs: Transaction[] = [];

// Heatmap paging: page 0 = most recent 3 years
let _heatmapPage = 0;

// Allocation toggle state: 'active' | 'all'
const _allocMode: Record<string, 'active' | 'all'> = {
  class: 'active',
  region: 'active',
};

function _destroyChart(id: string): void {
  if (CH[id]) {
    CH[id].destroy();
    delete CH[id];
  }
}

function _attachRangeToggle(
  id: string,
  getRange: () => '12' | '36' | 'all',
  setRange: (r: '12' | '36' | 'all') => void,
  rerender: () => void,
): void {
  const toggle = document.getElementById(id) as (HTMLElement & { _bound?: boolean }) | null;
  if (!toggle || toggle._bound) return;
  toggle._bound = true;
  toggle.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-range]') as HTMLElement | null;
    if (!btn) return;
    const newRange = (btn.dataset.range as '12' | '36' | 'all') || 'all';
    if (newRange === getRange()) return;
    setRange(newRange);
    toggle.querySelectorAll('.btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    rerender();
  });
}

// ── Month diff helper ──────────────────────────────────────

function _monthsDiff(a: string, b: string): number {
  const pa = a.split('-');
  const pb = b.split('-');
  if (pa.length < 2 || pb.length < 2) return 0;
  return (
    (parseInt(pb[0], 10) - parseInt(pa[0], 10)) * 12 + (parseInt(pb[1], 10) - parseInt(pa[1], 10))
  );
}

function _shiftMonth(ym: string, deltaMonths: number): string | null {
  const parts = ym.split('-');
  if (parts.length < 2) return null;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  if (!isFinite(year) || !isFinite(month) || month < 1 || month > 12) return null;
  const d = new Date(Date.UTC(year, month - 1 + deltaMonths, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

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
  // Check whether the table is currently visible (persisted across re-renders)
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

// ── Main render ───────────────────────────────────────────

export function renderAnalytics(
  pd: PortfolioData | null,
  snaps: Snapshot[],
  txs: Transaction[],
): void {
  _lastSnaps = snaps;
  _lastPd = pd;
  _lastTxs = txs;

  const has = snaps.length > 0;
  document.getElementById('an-empty')!.style.display = has ? 'none' : 'block';
  document.getElementById('an-content')!.style.display = has ? 'block' : 'none';
  if (!has) return;

  const accounts = getAccounts();
  const holdings = getHoldings();
  const settings = getSettings();
  const riskFreeRate = parseFloat(settings.riskFreeRate || '2') / 100;

  const s = snaps[snaps.length - 1];
  const total = snapTotal(s);
  const firstTotal = snapTotal(snaps[0]);
  const firstDate = snaps[0]?.date || '';
  const latestDate = s.date || '';
  const monthsSpan = _monthsDiff(firstDate, latestDate);

  // Compute investment-side value once (used for both absolute gain and IRR)
  const latestInvestmentValue = allInvestmentAccountsValue(s, accounts);

  // ── Level 1 KPIs ─────────────────────────────────────────
  const totalReturnVal = totalReturn(firstTotal, total);
  const absoluteGainVal =
    pd && latestInvestmentValue !== null ? absoluteGain(latestInvestmentValue, pd.totalInv) : null;
  const ytdVal = ytdReturn(snaps);
  const cagrVal = cagr(firstTotal, total, monthsSpan);
  const yoyData = findYoYSnapshot(snaps);
  const yoyAbs = yoyData ? total - yoyData.total : null;
  const yoyPct =
    yoyData && yoyData.total > 0 ? ((total - yoyData.total) / yoyData.total) * 100 : null;

  // Level 2 performance KPIs (TWR + IRR)
  const twrVal = twr(snaps, pd?.monthly || {});
  const terminalDate = s.date && s.date.length === 7 ? `${s.date}-01` : s.date;
  const investmentFlows = txs
    .map((tx) => {
      const date = tx.date && tx.date.length === 7 ? `${tx.date}-01` : tx.date;
      if (!date) return null;
      if (tx.type === 'BUY')
        return { date, amount: -(Math.abs(tx.amount) + Math.abs(tx.fee || 0)) };
      return null;
    })
    .filter((cf): cf is { date: string; amount: number } => !!cf);
  if (latestInvestmentValue !== null) {
    investmentFlows.push({ date: terminalDate, amount: latestInvestmentValue });
  }
  const irrVal = latestInvestmentValue !== null ? xirr(investmentFlows) : null;

  // Net worth absolute gain (always available once we have 2+ snapshots)
  const netWorthGainVal = snaps.length >= 2 ? total - firstTotal : null;

  document.getElementById('an-kpis-l1')!.innerHTML = `
    ${kpiTile({
      label: `Total Return${infoTip('Total percentage gain or loss from your first snapshot to today. Measures balance growth, not investment performance. For a cash-flow adjusted return, see IRR.')}`,
      value: totalReturnVal !== null ? fmtPctNeg(totalReturnVal * 100) : '-',
      valueClass: totalReturnVal === null ? '' : totalReturnVal >= 0 ? 'pos' : 'neg',
      sub: totalReturnVal !== null ? `since ${fmtMon(firstDate)}` : 'needs 2 snapshots',
    })}
    ${
      netWorthGainVal !== null
        ? kpiTile({
            label: `Net Worth Gain${infoTip('Total net worth today minus total net worth at your first snapshot. Includes all accounts: investments, savings, and any other tracked balances.')}`,
            value: fmtEurNeg(netWorthGainVal, 2),
            valueClass: netWorthGainVal >= 0 ? 'pos' : 'neg',
            sub: `since ${fmtMon(firstDate)}`,
          })
        : kpiTile({ label: 'Net Worth Gain', value: '-', sub: 'needs 2 snapshots' })
    }
    ${
      absoluteGainVal !== null
        ? kpiTile({
            label: `Investment Gain${infoTip('Investment account value minus total purchase cost basis (buy transactions). Covers investment-type accounts only, not savings or cash accounts.')}`,
            value: fmtEurNeg(absoluteGainVal, 2),
            valueClass: absoluteGainVal >= 0 ? 'pos' : 'neg',
            sub: `of ${fmtEur(pd!.totalInv)} invested (cost basis)`,
          })
        : kpiTile({
            label: 'Investment Gain',
            value: '-',
            sub: 'import transactions to calculate',
          })
    }
    ${
      ytdVal !== null
        ? kpiTile({
            label: `YTD Return${infoTip('Return from the start of this calendar year to today. Falls back to return from inception when the portfolio started in the current year.')}`,
            value: fmtPctNeg(ytdVal * 100),
            valueClass: ytdVal >= 0 ? 'pos' : 'neg',
            sub: `since Jan ${new Date().getFullYear()}`,
          })
        : kpiTile({
            label: `YTD Return${infoTip('Return from the start of this calendar year to today.')}`,
            value: '-',
            sub: 'needs prior-year snapshot',
          })
    }
    ${
      cagrVal !== null
        ? kpiTile({
            label: `CAGR (balance)${infoTip('Compound annual growth rate of your total net worth from first to latest snapshot. Treat this with caution until you have at least 2-3 years of history.')}`,
            value: fmtPctNeg(cagrVal * 100),
            valueClass: cagrVal >= 0 ? 'pos' : 'neg',
            sub: `${monthsSpan} months${monthsSpan < 24 ? ' (early data)' : ''}`,
          })
        : kpiTile({
            label: `CAGR${infoTip('Compound annual growth rate. Requires 12 months of history.')}`,
            value: '-',
            sub: `${monthsSpan}/12 months recorded`,
          })
    }
    ${
      yoyAbs !== null
        ? kpiTile({
            label: `YoY${infoTip('Year-over-Year change in total net worth compared to the same month last year.')}`,
            value: fmtEurSigned(yoyAbs, 2),
            valueClass: yoyAbs >= 0 ? 'pos' : 'neg',
            sub: `${yoyPct !== null ? fmtPctSigned(yoyPct) : '-'} vs ${fmtMon(yoyData!.snap.date)}`,
          })
        : ''
    }
  `;

  const perfHeading = document.getElementById('an-perf-detail-heading');
  if (perfHeading) perfHeading.style.display = '';

  document.getElementById('an-kpis-l2')!.innerHTML = `
    ${kpiTile({
      label: `TWR${infoTip('Time-weighted return, linked across snapshot periods and net of contributions. Measures investment performance per period, independently of how much money was contributed or when.')}`,
      value: twrVal !== null ? fmtPctNeg(twrVal * 100) : '-',
      valueClass: twrVal === null ? '' : twrVal >= 0 ? 'pos' : 'neg',
      sub:
        twrVal !== null
          ? `${monthsSpan} months, not annualized${monthsSpan < 24 ? ' (early data)' : ''}`
          : 'needs 2 snapshots',
    })}
    ${kpiTile({
      label: `IRR (investments)${infoTip('Money-weighted annual return on invested capital (XIRR). Influenced by the size and timing of your contributions. Unstable with under 2 years of history. Uses BUY cash outflows plus current investment value.')}`,
      value: irrVal !== null ? fmtPctNeg(irrVal * 100) : '-',
      valueClass: irrVal === null ? '' : irrVal >= 0 ? 'pos' : 'neg',
      sub:
        irrVal !== null
          ? `XIRR, annualized${monthsSpan < 24 ? ' (early data)' : ''}`
          : 'needs complete cash-flow series',
    })}
  `;

  // ── Portfolio growth chart ────────────────────────────────
  _renderGrowthChart(snaps);
  _attachGrowthRangeToggle(snaps);

  // ── Level 2 content ───────────────────────────────────────
  const level2 = document.getElementById('an-level2');
  if (level2) level2.style.display = snaps.length >= 2 ? '' : 'none';

  if (snaps.length >= 2) {
    // Contributions vs market chart
    const growthPoints = pd
      ? monthlyGrowthHistory(snaps, accounts, pd.monthly, primaryInvestmentValue)
      : [];
    _renderContribChart(growthPoints);
    _attachContribRangeToggle(growthPoints);

    // Heatmap
    _heatmapPage = 0;
    _renderHeatmap(snaps);
    _attachHeatmapPager(snaps);

    // Annual returns table
    _renderAnnualTable(snaps);

    // Allocation donuts
    _renderAllocationDonuts(holdings, pd);
  }

  // ── Level 3: Advanced (collapsible) ──────────────────────
  const volResult = annualizedVolatility(snaps);
  const ddResult = maxDrawdown(snaps);
  const cagrForRisk = cagrVal;
  const dd = ddResult.max;
  const advancedContent = document.getElementById('an-advanced-content');
  const riskMetricsNoteCardEl = document.getElementById('an-risk-metrics-note-card');
  const riskMetricsNoteEl = document.getElementById('an-risk-metrics-note');

  const riskMetricsReady = monthsSpan >= 24;

  if (riskMetricsNoteEl) {
    if (riskMetricsReady) {
      if (riskMetricsNoteCardEl) riskMetricsNoteCardEl.style.display = 'none';
    } else {
      riskMetricsNoteEl.textContent = `${Math.max(monthsSpan, 0)}/24 months recorded. Risk metrics require 24 months of history.`;
      if (riskMetricsNoteCardEl) riskMetricsNoteCardEl.style.display = '';
    }
  }

  if (advancedContent) {
    const riskKpisEl = document.getElementById('an-kpis-risk');
    const explainerEl = document.getElementById('an-metrics-explainer') as HTMLElement | null;
    const drawdownCardEl = document.getElementById('an-drawdown-card') as HTMLElement | null;

    // Risk KPIs
    const downDev = downsideDeviation(volResult.monthlyReturns);
    const sharpe =
      cagrForRisk !== null && volResult.annualized !== null
        ? sharpeRatio(cagrForRisk, volResult.annualized, riskFreeRate)
        : null;
    const sortino =
      cagrForRisk !== null && downDev !== null
        ? sortinoRatio(cagrForRisk, downDev, riskFreeRate)
        : null;
    const calmar = cagrForRisk !== null && dd !== null ? calmarRatio(cagrForRisk, dd) : null;
    const avgDD = avgDrawdown(ddResult.series);
    const ddDur = drawdownDuration(ddResult.series);

    if (riskKpisEl) {
      riskKpisEl.innerHTML = riskMetricsReady
        ? `
      ${kpiTile({
        label: `Volatility${infoTip('Annualized standard deviation of monthly net-worth percentage changes. Higher volatility means a bumpier ride. Unlocked after 24 months of snapshot history.')}`,
        value: volResult.annualized !== null ? fmtPctNeg(volResult.annualized * 100) : '-',
        valueClass: '',
        sub: volResult.annualized !== null ? 'annualized, all history' : 'needs more data',
      })}
      ${kpiTile({
        label: `Max Drawdown${infoTip('Largest peak-to-trough decline as a percentage of the prior peak. Risk metrics unlock after 24 months of snapshot history.')}`,
        value: dd !== null ? (dd === 0 ? '0%' : fmtPctNeg(dd * 100)) : '-',
        valueClass: dd === null ? '' : dd < 0 ? 'neg' : '',
        sub: dd !== null ? 'all history' : 'needs more data',
      })}
      ${kpiTile({
        label: `Calmar${infoTip('CAGR divided by absolute max drawdown. Higher is better. Unlocked after 24 months of snapshot history.')}`,
        value: calmar !== null ? calmar.toFixed(2) : '-',
        valueClass: calmar === null ? '' : calmar >= 0 ? 'pos' : 'neg',
        sub: calmar !== null ? 'CAGR / |Max DD|' : 'needs more data',
      })}
      ${kpiTile({
        label: `Sharpe${infoTip('(CAGR minus risk-free rate) divided by annualized volatility. Measures return per unit of total risk. Unlocked after 24 months of snapshot history.')}`,
        value: sharpe !== null ? sharpe.toFixed(2) : '-',
        valueClass: '',
        sub: sharpe !== null ? `rf = ${(riskFreeRate * 100).toFixed(2)}%` : 'needs more data',
      })}
      ${kpiTile({
        label: `Sortino${infoTip('Like Sharpe, but uses only downside volatility (negative months). Unlocked after 24 months of snapshot history.')}`,
        value: sortino !== null ? sortino.toFixed(2) : '-',
        valueClass: '',
        sub: sortino !== null ? 'downside risk only' : 'needs more data',
      })}
      ${kpiTile({
        label: `Avg Drawdown${infoTip('Average of all per-month drawdown fractions. Risk metrics unlock after 24 months of snapshot history.')}`,
        value: avgDD !== null && avgDD < 0 ? fmtPctNeg(avgDD * 100) : avgDD === 0 ? '0%' : '-',
        valueClass: avgDD !== null && avgDD < 0 ? 'neg' : '',
        sub: avgDD !== null ? 'mean of all drawdown months' : 'needs more data',
      })}
      ${kpiTile({
        label: `DD Duration${infoTip('Maximum number of consecutive months where the portfolio was below its prior peak. Risk metrics unlock after 24 months of snapshot history.')}`,
        value: ddDur > 0 ? `${ddDur} mo` : ddResult.series.length > 0 ? '0 mo' : '-',
        valueClass: '',
        sub: ddDur > 0 ? 'longest underwater streak' : 'no drawdown in history',
      })}
    `
        : '';
    }

    if (riskKpisEl) riskKpisEl.style.display = riskMetricsReady ? '' : 'none';
    if (explainerEl) explainerEl.style.display = riskMetricsReady ? '' : 'none';
    if (drawdownCardEl) drawdownCardEl.style.display = riskMetricsReady ? '' : 'none';

    if (riskMetricsReady) _renderDrawdownChart(ddResult.series);
    else _destroyChart('c-an-drawdown');

    // Rolling CAGR
    _renderRollingCagrChart(snaps);

    // Income analytics
    _renderIncomeAnalytics(txs, latestInvestmentValue || 0, pd?.totalInv || 0);
  }

  // Bind advanced section open/close arrow via CSS class
  const advancedEl = document.getElementById('an-advanced') as HTMLDetailsElement | null;
  if (advancedEl && !(advancedEl as HTMLDetailsElement & { _arrowBound?: boolean })._arrowBound) {
    (advancedEl as HTMLDetailsElement & { _arrowBound?: boolean })._arrowBound = true;
    advancedEl.addEventListener('toggle', () => {
      advancedEl.classList.toggle('collapsed', !advancedEl.open);
    });
    // Sync initial state
    advancedEl.classList.toggle('collapsed', !advancedEl.open);
  }

  attachInfoTips(document.getElementById('analytics')!);
}

// ── Portfolio growth chart ─────────────────────────────────

function _renderGrowthChart(snaps: Snapshot[]): void {
  const C = resolvedT();

  const view = _anGrowthRange === 'all' ? snaps : snaps.slice(-parseInt(_anGrowthRange));

  _destroyChart('c-an-growth');
  document.getElementById('an-growth-legend')!.innerHTML = '';
  if (view.length < 2) {
    return;
  }

  const totalData = view.map((s) => snapTotal(s));

  CH['c-an-growth'] = new Chart(document.getElementById('c-an-growth') as HTMLCanvasElement, {
    type: 'line',
    data: {
      labels: view.map((s) => fmtMon(s.date)),
      datasets: [
        {
          label: 'Total net worth',
          data: totalData,
          borderColor: C.brand,
          backgroundColor: C.brandWeak,
          borderWidth: 2,
          pointRadius: view.length > 24 ? 0 : 3,
          fill: true,
          tension: 0.3,
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
            callback: (v) => ((v as number) / 1000).toFixed(0) + 'k\u00A0\u20AC',
          },
        },
        x: {
          grid: { display: false },
          ticks: { color: C.ink2, font: { size: 10 }, maxRotation: 0, autoSkip: true },
        },
      },
    },
  });

  _writeChartTable(
    'c-an-growth-table-wrap',
    'Portfolio growth over time data',
    ['Month', 'Net Worth (€)'],
    view.map((s) => [fmtMon(s.date), fmtEur2(snapTotal(s))]),
  );
}

function _attachGrowthRangeToggle(snaps: Snapshot[]): void {
  _attachRangeToggle(
    'an-growth-range-toggle',
    () => _anGrowthRange,
    (r) => {
      _anGrowthRange = r;
    },
    () => _renderGrowthChart(snaps),
  );
}

// ── Contributions vs market chart ──────────────────────────

let _growthPoints: MonthlyGrowthPoint[] = [];

function _renderContribChart(points: MonthlyGrowthPoint[]): void {
  _growthPoints = points;
  const C = resolvedT();
  const el = document.getElementById('c-an-contrib');
  if (!el) return;
  _destroyChart('c-an-contrib');

  if (points.length === 0) {
    const card = el.closest('.card') as HTMLElement | null;
    if (card) card.style.display = 'none';
    return;
  }
  const card = el.closest('.card') as HTMLElement | null;
  if (card) card.style.display = '';

  const view = _anContribRange === 'all' ? points : points.slice(-parseInt(_anContribRange));

  CH['c-an-contrib'] = new Chart(el as HTMLCanvasElement, {
    type: 'bar',
    data: {
      labels: view.map((p) => fmtMon(p.month)),
      datasets: [
        {
          label: 'Contributed',
          data: view.map((p) => p.contributed),
          backgroundColor: C.brand,
          stack: 'contrib',
        },
        {
          label: 'Market movement',
          data: view.map((p) => p.market),
          backgroundColor: view.map((p) => (p.market >= 0 ? C.pos : C.neg)),
          stack: 'contrib',
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
          ...TOOLTIP_BOX,
          borderColor: C.line,
          borderWidth: 1,
          titleColor: C.ink,
          bodyColor: C.ink2,
          padding: 10,
          cornerRadius: 8,
          callbacks: {
            label: (ctx) =>
              ` ${ctx.dataset.label}: ${ctx.dataset.label === 'Contributed' ? fmtEur2(ctx.raw as number) : fmtEurSigned(ctx.raw as number, 2)}`,
            labelColor: tooltipSwatch(C.surface),
            footer: (items) =>
              ` Total: ${fmtEurSigned(
                items.reduce((s, i) => s + (i.raw as number), 0),
                2,
              )}`,
          },
          footerFont: { weight: 'bold' },
        },
      },
      scales: {
        y: {
          stacked: true,
          grid: { color: C.line },
          ticks: { color: C.ink4, callback: (v) => '\u20AC' + (v as number).toFixed(0) },
        },
        x: {
          stacked: true,
          grid: { display: false },
          ticks: { color: C.ink2, font: { size: 10 }, maxRotation: 0, autoSkip: true },
        },
      },
    },
  });

  const legendEl = document.getElementById('an-contrib-legend');
  if (legendEl) {
    legendEl.innerHTML = renderLegendHtml([
      { label: 'Contributed', color: C.brand },
      { label: 'Market movement', color: C.pos, color2: C.neg },
    ]);
    bindLegendToggle(legendEl, CH['c-an-contrib'], { skipIndex: [] });
  }
}

function _attachContribRangeToggle(points: MonthlyGrowthPoint[]): void {
  _attachRangeToggle(
    'an-contrib-range-toggle',
    () => _anContribRange,
    (r) => {
      _anContribRange = r;
    },
    () => _renderContribChart(points),
  );
}

// ── Monthly return heatmap ─────────────────────────────────

const HEATMAP_PAGE_SIZE = 3;

function _renderHeatmap(snaps: Snapshot[]): void {
  const heatmapEl = document.getElementById('an-heatmap');
  const noteEl = document.getElementById('an-heatmap-note');
  if (!heatmapEl) return;

  const volResult = annualizedVolatility(snaps);
  const weighted = weightedMonthlyReturns(volResult.monthlyReturns);
  const annualData = annualReturns(snaps);

  if (weighted.length === 0) {
    heatmapEl.innerHTML = '<p class="note">Add more snapshots to see the return heatmap.</p>';
    return;
  }

  const monthsCount = weighted.length;
  if (noteEl) {
    noteEl.textContent =
      monthsCount < 12 ? 'Seasonal patterns emerge after 12 months of data.' : '';
    noteEl.style.display = monthsCount < 12 ? '' : 'none';
  }

  // Find extremes for color scale (use weightedReturn for color intensity)
  const maxAbs = Math.max(...weighted.map((m) => Math.abs(m.weightedReturn)), 0.001);

  // Get year list (oldest first)
  const allYears = Array.from(new Set(weighted.map((m) => m.year))).sort((a, b) => a - b);

  // Paging: page 0 = most recent page
  const totalPages = Math.max(1, Math.ceil(allYears.length / HEATMAP_PAGE_SIZE));
  // Clamp page index
  if (_heatmapPage >= totalPages) _heatmapPage = totalPages - 1;
  if (_heatmapPage < 0) _heatmapPage = 0;

  // Page 0 = last 3 years, page 1 = prior 3, etc. (reverse order so newest is page 0)
  const reversedPages = [];
  for (let p = 0; p < totalPages; p++) {
    const start = allYears.length - (p + 1) * HEATMAP_PAGE_SIZE;
    const end = allYears.length - p * HEATMAP_PAGE_SIZE;
    reversedPages.push(allYears.slice(Math.max(0, start), end));
  }
  const years = reversedPages[_heatmapPage] || [];

  // Update pager UI
  const pagerEl = document.getElementById('an-heatmap-pager');
  const prevBtn = document.getElementById('an-heatmap-prev') as HTMLButtonElement | null;
  const nextBtn = document.getElementById('an-heatmap-next') as HTMLButtonElement | null;
  const pageLabelEl = document.getElementById('an-heatmap-page-label');
  if (pagerEl) pagerEl.style.display = totalPages > 1 ? 'flex' : 'none';
  if (pageLabelEl && years.length > 0) {
    pageLabelEl.textContent =
      years.length === 1 ? String(years[0]) : `${years[0]}\u2013${years[years.length - 1]}`;
  }
  if (prevBtn) prevBtn.disabled = _heatmapPage >= totalPages - 1;
  if (nextBtn) nextBtn.disabled = _heatmapPage <= 0;

  const MONTH_LABELS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];

  const C = resolvedT();
  const isDark = C.bg !== T.bg;

  // Build lookup
  const lookup = new Map<string, (typeof weighted)[0]>();
  for (const m of weighted) {
    lookup.set(`${m.year}-${m.month}`, m);
  }
  const annualLookup = new Map<number, number>();
  for (const a of annualData) {
    annualLookup.set(a.year, a.return);
  }

  const CELL_W = 42;
  const minW = 12 * CELL_W + 56 + 64;
  let html = `<table class="an-heatmap-table" style="border-collapse:collapse;font-size:11px;min-width:${minW}px">`;
  // Header row
  html += `<thead><tr><th style="width:52px;text-align:left;padding:2px 4px;color:var(--ink-3)"></th>`;
  for (const ml of MONTH_LABELS) {
    html += `<th style="width:${CELL_W}px;text-align:center;padding:2px;color:var(--ink-3);font-weight:normal">${ml}</th>`;
  }
  html += `<th style="width:60px;text-align:right;padding:2px 4px;color:var(--ink-3);font-weight:normal">Year</th>`;
  html += '</tr></thead><tbody>';

  for (const year of [...years].reverse()) {
    html += `<tr><td style="padding:2px 4px;color:var(--ink-2);font-weight:500">${year}</td>`;
    for (let mo = 1; mo <= 12; mo++) {
      const entry = lookup.get(`${year}-${mo}`);
      if (!entry) {
        html += `<td style="padding:1px 2px;text-align:center"><div style="width:${CELL_W - 2}px;height:28px;border-radius:${R.xs}px;background:var(--line)"></div></td>`;
        continue;
      }
      const intensity = Math.min(Math.abs(entry.weightedReturn) / maxAbs, 1);
      const rawPct = entry.return * 100;
      const color = _heatmapColor(entry.weightedReturn, intensity, isDark);
      const textColor = _heatmapTextColor(intensity, entry.weightedReturn);
      const sign = rawPct > 0 ? '+' : '';
      html += `<td style="padding:1px 2px;text-align:center" title="${year}-${String(mo).padStart(2, '0')}: ${sign}${rawPct.toFixed(1)}%">
        <div style="width:${CELL_W - 2}px;height:28px;border-radius:${R.xs}px;background:${color};display:flex;align-items:center;justify-content:center">
          <span style="color:${textColor};font-size:10px;font-weight:500">${sign}${rawPct.toFixed(1)}%</span>
        </div>
      </td>`;
    }
    // Annual total column
    const annualRet = annualLookup.get(year);
    if (annualRet !== undefined) {
      const annPct = annualRet * 100;
      const annSign = annPct > 0 ? '+' : '';
      const annCls = annPct >= 0 ? C.pos : C.neg;
      html += `<td style="padding:2px 4px;text-align:right;font-weight:600;color:${annCls};white-space:nowrap">${annSign}${annPct.toFixed(1)}%</td>`;
    } else {
      html += `<td style="padding:2px 4px;text-align:right;color:var(--ink-3)">-</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  heatmapEl.innerHTML = html;
}

function _attachHeatmapPager(snaps: Snapshot[]): void {
  const prevBtn = document.getElementById('an-heatmap-prev') as
    (HTMLElement & { _bound?: boolean }) | null;
  const nextBtn = document.getElementById('an-heatmap-next') as
    (HTMLElement & { _bound?: boolean }) | null;
  if (prevBtn && !prevBtn._bound) {
    prevBtn._bound = true;
    prevBtn.addEventListener('click', () => {
      _heatmapPage++;
      _renderHeatmap(snaps);
    });
  }
  if (nextBtn && !nextBtn._bound) {
    nextBtn._bound = true;
    nextBtn.addEventListener('click', () => {
      _heatmapPage = Math.max(0, _heatmapPage - 1);
      _renderHeatmap(snaps);
    });
  }
}

function _heatmapColor(weightedReturn: number, intensity: number, isDark: boolean): string {
  if (weightedReturn > 0) {
    // Green scale
    const g = isDark ? Math.round(100 + 110 * intensity) : Math.round(200 - 80 * intensity);
    const r = isDark ? Math.round(10 + 30 * (1 - intensity)) : Math.round(230 - 100 * intensity);
    const b = isDark ? Math.round(10 + 30 * (1 - intensity)) : Math.round(230 - 100 * intensity);
    return `rgb(${r},${g},${b})`;
  } else if (weightedReturn < 0) {
    // Red scale
    const r = isDark ? Math.round(100 + 110 * intensity) : Math.round(200 - 80 * intensity);
    const gb = isDark ? Math.round(10 + 30 * (1 - intensity)) : Math.round(230 - 100 * intensity);
    return `rgb(${r},${gb},${gb})`;
  }
  return 'var(--line)';
}

function _heatmapTextColor(intensity: number, weightedReturn: number): string {
  // Use white text on saturated backgrounds, dark text on light ones
  if (intensity > 0.5) return '#fff';
  return weightedReturn !== 0 ? 'var(--ink)' : 'var(--ink-3)';
}

// ── Annual returns table ───────────────────────────────────

/**
 * Render a structured annual-returns table with a small inline SVG sparkline bar
 * for each year. Requires at least 2 annual data points (so a prior-year delta can
 * be shown). If fewer years are available, shows the data without the delta column.
 */
function _renderAnnualTable(snaps: Snapshot[]): void {
  const el = document.getElementById('an-annual-table');
  const card = document.getElementById('an-annual-table-card');
  if (!el || !card) return;

  const data = annualReturns(snaps);
  if (data.length === 0) {
    card.style.display = 'none';
    return;
  }
  card.style.display = '';

  // Show newest year first
  const rows = [...data].reverse();
  const MAX_BAR_H = 28; // px — maximum bar height

  // Compute max abs return for scaling sparkline bars
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.return)), 0.001);

  const C = resolvedT();

  const tableRows = rows
    .map((row, i) => {
      const pct = row.return * 100;
      const sign = pct >= 0 ? '+' : '';
      const color = pct >= 0 ? C.pos : C.neg;
      const barH = Math.round((Math.abs(row.return) / maxAbs) * MAX_BAR_H);
      const barY = MAX_BAR_H - barH;

      // vs prior year delta (prior year = next item since list is newest-first)
      const prior = rows[i + 1];
      let deltaCell = '<td style="color:var(--ink-3)">—</td>';
      if (prior !== undefined) {
        const delta = (row.return - prior.return) * 100;
        const dSign = delta >= 0 ? '+' : '';
        const dColor = delta >= 0 ? C.pos : C.neg;
        deltaCell = `<td style="color:${dColor}">${dSign}${delta.toFixed(1)}%</td>`;
      }

      const sparkline = `<svg width="32" height="${MAX_BAR_H + 4}" viewBox="0 0 32 ${MAX_BAR_H + 4}" aria-hidden="true" style="display:block;margin:auto">
        <rect x="8" y="${barY + 2}" width="16" height="${barH}" rx="2" fill="${color}" opacity="0.85"/>
      </svg>`;

      return `<tr>
        <td style="font-weight:500;color:var(--ink)">${row.year}</td>
        <td style="color:${color};font-weight:600">${sign}${pct.toFixed(1)}%</td>
        <td style="text-align:center">${sparkline}</td>
        ${deltaCell}
      </tr>`;
    })
    .join('');

  el.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:12px">
    <thead>
      <tr style="border-bottom:1px solid var(--line);color:var(--ink-3);font-weight:500">
        <th style="text-align:left;padding:4px 6px">Year</th>
        <th style="text-align:left;padding:4px 6px">Return</th>
        <th style="text-align:center;padding:4px 6px">Bar${infoTip('Relative bar height scaled to the largest absolute annual return shown in this table.')}</th>
        <th style="text-align:left;padding:4px 6px">vs prior year</th>
      </tr>
    </thead>
    <tbody style="color:var(--ink-2)">${tableRows}</tbody>
  </table>`;
}

// ── Allocation donuts ──────────────────────────────────────

type AllocDim = 'class' | 'acct' | 'region';

function _renderAllocationDonuts(holdings: Holding[], pd: PortfolioData | null): void {
  const dims: AllocDim[] = ['acct', 'class', 'region'];
  for (const dim of dims) {
    _renderAllocDonut(dim, holdings, pd);
    _attachAllocToggle(dim);
  }
}

function _getHoldingSlices(
  holdings: Holding[],
  pd: PortfolioData | null,
  dim: Exclude<AllocDim, 'acct'>,
  mode: 'active' | 'all',
): { label: string; value: number; color: string }[] {
  if (!pd) return [];
  const filtered = mode === 'active' ? holdings.filter((h) => h.active) : holdings;
  const buckets = new Map<string, { value: number; color: string }>();
  const colorMap = new Map<string, string>();

  for (const h of filtered) {
    const pos = pd.etfs[h.isin];
    if (!pos) continue;
    const value = pos.cost || 0;
    if (value <= 0) continue;
    const key = dim === 'class' ? h.assetClass || 'Other' : h.region || 'Other';
    const normalized = key.charAt(0).toUpperCase() + key.slice(1);
    const existing = buckets.get(normalized);
    if (existing) {
      existing.value += value;
    } else {
      buckets.set(normalized, { value, color: h.color || '#888' });
      colorMap.set(normalized, h.color || '#888');
    }
  }

  return Array.from(buckets.entries())
    .map(([label, { value, color }]) => ({ label, value, color }))
    .sort((a, b) => b.value - a.value);
}

function _getAccountSlices(
  snaps: Snapshot[],
  mode: 'active' | 'all',
): { label: string; value: number; color: string }[] {
  if (snaps.length === 0) return [];
  const s = snaps[snaps.length - 1];
  const accounts = getAccounts();
  return accounts
    .filter((a) => {
      const val = (s[a.id || ''] as number) || 0;
      if (val <= 0 && mode === 'active') return false;
      if (val <= 0) return false;
      return true;
    })
    .map((a) => ({
      label: a.label || a.id || '',
      value: (s[a.id || ''] as number) || 0,
      color: a.color || '#888',
    }))
    .sort((a, b) => b.value - a.value);
}

function _renderAllocDonut(dim: AllocDim, holdings: Holding[], pd: PortfolioData | null): void {
  const mode = _allocMode[dim];
  let slices: { label: string; value: number; color: string }[] = [];

  if (dim === 'acct') {
    slices = _getAccountSlices(_lastSnaps, mode);
  } else {
    slices = _getHoldingSlices(holdings, pd, dim as Exclude<AllocDim, 'acct'>, mode);
  }

  const canvasId = `c-an-alloc-${dim}`;
  const legendId = `an-alloc-${dim}-legend`;

  // Hide card if no data; destroy any previous chart to avoid stale display
  if (slices.length === 0) {
    _destroyChart(canvasId);
    return;
  }

  const total = slices.reduce((s, x) => s + x.value, 0);

  // When there is only one slice the donut chart conveys no additional
  // information beyond the label itself. Destroy any previous chart and
  // replace it with a clear full-concentration block instead.
  _destroyChart(canvasId);
  const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
  if (!canvas) return;

  if (slices.length === 1) {
    const slice = slices[0];
    // Hide the canvas and its fixed-height wrapper; we render a compact text block in their place.
    canvas.style.display = 'none';
    const canvasWrap = canvas.closest('.chart-wrap') as HTMLElement | null;
    if (canvasWrap) canvasWrap.style.display = 'none';

    const legendEl = document.getElementById(legendId);
    if (legendEl) {
      // Check whether the other mode (all vs active) would yield more slices so
      // we can show a helpful hint nudging the user to switch.
      let otherModeHasMore = false;
      if (dim !== 'acct') {
        const otherMode = mode === 'active' ? 'all' : 'active';
        const otherSlices = _getHoldingSlices(
          holdings,
          pd,
          dim as Exclude<AllocDim, 'acct'>,
          otherMode,
        );
        otherModeHasMore = otherSlices.length > 1;
      }

      const hint =
        mode === 'active' && otherModeHasMore
          ? `<p class="note" style="margin-top:6px">Switch to <em>All assets</em> to see the full breakdown.</p>`
          : '';

      legendEl.style.flexWrap = 'wrap';
      legendEl.style.maxWidth = '100%';
      legendEl.innerHTML = `
        <div class="alloc-full-concentration" style="
          display:flex;align-items:center;gap:10px;
          background:${esc(safeColor(slice.color))}1a;
          border-left:4px solid ${esc(safeColor(slice.color))};
          border-radius:6px;padding:10px 14px;margin-top:4px
        ">
          <span style="
            display:inline-block;width:12px;height:12px;border-radius:50%;flex-shrink:0;
            background:${esc(safeColor(slice.color))}
          "></span>
          <span style="font-weight:600;font-size:13px">${esc(slice.label)}</span>
          <span style="margin-left:auto;font-size:13px;font-weight:600">100%</span>
          <span style="font-size:12px;color:var(--ink-2)">${fmtEur(slice.value)}</span>
        </div>
        ${hint}`;
    }

    // Render toggle button so the user can switch to the other mode.
    if (dim !== 'acct') {
      _renderAllocToggleBtn(dim);
    }
    return;
  }

  // Multi-slice: restore canvas and its wrapper visibility (they may have been hidden on a prior single-slice render).
  canvas.style.display = '';
  const canvasWrap = canvas.closest('.chart-wrap') as HTMLElement | null;
  if (canvasWrap) canvasWrap.style.display = '';

  const C = resolvedT();

  CH[canvasId] = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: slices.map((s) => s.label),
      datasets: [
        {
          data: slices.map((s) => s.value),
          backgroundColor: slices.map((s) => safeColor(s.color)),
          borderColor: C.surface,
          borderWidth: 2,
          hoverBorderWidth: 2,
        },
      ],
    },
    options: {
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
    },
  });

  const legendEl = document.getElementById(legendId);
  if (legendEl) {
    legendEl.style.flexWrap = 'wrap';
    legendEl.style.maxWidth = '100%';
    legendEl.innerHTML = renderLegendHtml(
      slices.map((s) => ({
        label: s.label,
        meta: total > 0 ? fmtPctVal((s.value / total) * 100) : '0%',
        color: s.color,
      })),
    );
  }

  // Render toggle button (not applicable for account dimension)
  if (dim !== 'acct') {
    _renderAllocToggleBtn(dim);
  }
}

function _renderAllocToggleBtn(dim: AllocDim): void {
  if (dim === 'acct') return;
  const wrapId = `an-alloc-${dim}-toggle-wrap`;
  const wrapEl = document.getElementById(wrapId);
  if (!wrapEl) return;
  const mode = _allocMode[dim] ?? 'active';
  wrapEl.innerHTML = `<div class="range-toggle" style="font-size:11px">
    <button class="btn btn-sm btn-ghost${mode === 'all' ? ' active' : ''}" data-alloc-mode="all" data-alloc-dim="${dim}">All assets</button>
    <button class="btn btn-sm btn-ghost${mode === 'active' ? ' active' : ''}" data-alloc-mode="active" data-alloc-dim="${dim}">Active only</button>
  </div>`;
  if (!(wrapEl as HTMLElement & { _dimBound?: boolean })._dimBound) {
    (wrapEl as HTMLElement & { _dimBound?: boolean })._dimBound = true;
    wrapEl.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-alloc-mode]') as HTMLElement | null;
      if (!btn) return;
      const newMode = btn.dataset.allocMode as 'active' | 'all';
      const dimKey = btn.dataset.allocDim as AllocDim;
      if (!dimKey || _allocMode[dimKey] === newMode) return;
      _allocMode[dimKey] = newMode;
      const holdings = getHoldings();
      const pd = _lastPd;
      _renderAllocDonut(dimKey, holdings, pd);
    });
  }
}

function _attachAllocToggle(dim: AllocDim): void {
  if (dim !== 'acct') {
    _renderAllocToggleBtn(dim);
  }
}

// ── Drawdown chart ─────────────────────────────────────────

function _renderDrawdownChart(series: { date: string; drawdown: number }[]): void {
  const card = document.getElementById('an-drawdown-card');
  const canvas = document.getElementById('c-an-drawdown') as HTMLCanvasElement | null;
  if (!canvas || !card) return;
  _destroyChart('c-an-drawdown');

  if (series.length < 2) {
    card.style.display = 'none';
    return;
  }
  card.style.display = '';

  const C = resolvedT();
  CH['c-an-drawdown'] = new Chart(canvas, {
    type: 'line',
    data: {
      labels: series.map((p) => fmtMon(p.date)),
      datasets: [
        {
          label: 'Drawdown',
          data: series.map((p) => p.drawdown * 100),
          borderColor: C.neg,
          backgroundColor: C.neg + '33',
          borderWidth: 1.5,
          pointRadius: 0,
          fill: true,
          tension: 0.2,
        },
      ],
    },
    options: {
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
            label: (ctx) => ` Drawdown: ${(ctx.raw as number).toFixed(1)}%`,
            labelColor: tooltipSwatch(C.surface),
          },
        },
      },
      scales: {
        y: {
          grid: { color: C.line },
          ticks: {
            color: C.ink4,
            callback: (v) => (v as number).toFixed(0) + '%',
          },
        },
        x: {
          grid: { display: false },
          ticks: { color: C.ink2, font: { size: 10 }, maxRotation: 0, autoSkip: true },
        },
      },
    },
  });

  _writeChartTable(
    'c-an-drawdown-table-wrap',
    'Drawdown history data',
    ['Month', 'Drawdown (%)'],
    series.map((p) => [fmtMon(p.date), (p.drawdown * 100).toFixed(1) + '%']),
  );
}

// ── Rolling CAGR chart ─────────────────────────────────────

function _renderRollingCagrChart(snaps: Snapshot[]): void {
  const card = document.getElementById('an-rolling-cagr-card');
  const noteEl = document.getElementById('an-rolling-cagr-note');
  const canvas = document.getElementById('c-an-rolling-cagr') as HTMLCanvasElement | null;
  if (!canvas || !card) return;
  _destroyChart('c-an-rolling-cagr');

  const WINDOW = 36;
  const points = rollingCagr(snaps, WINDOW);

  if (noteEl) {
    if (snaps.length <= WINDOW) {
      const cur = snaps.length - 1;
      noteEl.textContent = `${cur}/${WINDOW} months recorded. Rolling 3-year CAGR requires 36 months of history.`;
      noteEl.style.display = '';
    } else {
      noteEl.style.display = 'none';
    }
  }

  if (points.length === 0) {
    const canvasWrap = canvas.closest('.chart-wrap') as HTMLElement | null;
    if (canvasWrap) canvasWrap.style.display = 'none';
    return;
  }
  const canvasWrap = canvas.closest('.chart-wrap') as HTMLElement | null;
  if (canvasWrap) canvasWrap.style.display = '';

  const C = resolvedT();
  CH['c-an-rolling-cagr'] = new Chart(canvas, {
    type: 'line',
    data: {
      labels: points.map((p) => fmtMon(p.month)),
      datasets: [
        {
          label: 'Rolling 3Y CAGR',
          data: points.map((p) => p.cagr * 100),
          borderColor: C.brand,
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.3,
        },
      ],
    },
    options: {
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
            label: (ctx) => ` 3Y CAGR: ${(ctx.raw as number).toFixed(1)}%`,
            labelColor: tooltipSwatch(C.surface),
          },
        },
      },
      scales: {
        y: {
          grid: { color: C.line },
          ticks: { color: C.ink4, callback: (v) => (v as number).toFixed(0) + '%' },
        },
        x: {
          grid: { display: false },
          ticks: { color: C.ink2, font: { size: 10 }, maxRotation: 0, autoSkip: true },
        },
      },
    },
  });
}

// ── Income analytics ───────────────────────────────────────

function _renderIncomeAnalytics(
  txs: Transaction[],
  currentPortfolioValue: number,
  totalCostBasis: number,
): void {
  const incomeEl = document.getElementById('an-income');
  if (!incomeEl) return;

  const hasIncome = txs.some((t) => t.type === 'DIVIDEND' || t.type === 'INTEREST');
  incomeEl.style.display = hasIncome ? '' : 'none';
  if (!hasIncome) return;

  const metrics = dividendMetrics(txs, currentPortfolioValue, totalCostBasis);
  const throughLabel = metrics.asOfMonth
    ? `through ${fmtMon(metrics.asOfMonth)}`
    : 'latest import window';
  const priorWindowMonth = metrics.asOfMonth ? _shiftMonth(metrics.asOfMonth, -12) : null;
  const yoyWindowLabel =
    metrics.asOfMonth && priorWindowMonth
      ? `${fmtMon(metrics.asOfMonth)} vs ${fmtMon(priorWindowMonth)} (12M windows)`
      : `${throughLabel} vs prior 12M`;

  document.getElementById('an-kpis-income')!.innerHTML = `
    ${kpiTile({
      label: `Trailing 12M Income${infoTip('Sum of all DIVIDEND and INTEREST transactions received in the trailing 12-month window anchored to your latest imported transaction month.')}`,
      value: fmtEur2(metrics.trailing12m),
      sub: throughLabel,
    })}
    ${
      metrics.yieldPct !== null
        ? kpiTile({
            label: `Dividend Yield${infoTip('Trailing 12-month income divided by the current value of your investment accounts. Excludes cash, savings, pension, and other non-investment balances.')}`,
            value: fmtPctNeg(metrics.yieldPct * 100),
            sub: 'trailing 12M / investment value',
          })
        : ''
    }
    ${
      metrics.yieldOnCost !== null
        ? kpiTile({
            label: `Yield on Cost${infoTip('Trailing 12-month income divided by total invested capital (cost basis). Shows income as a percentage of your original investment. More stable than current yield.')}`,
            value: fmtPctNeg(metrics.yieldOnCost * 100),
            sub: 'trailing 12M / cost basis',
          })
        : ''
    }
    ${
      metrics.yoyGrowth !== null
        ? kpiTile({
            label: `Income Growth (YoY)${infoTip('Trailing 12-month income compared with the prior trailing 12 months, anchored to your latest imported transaction month.')}`,
            value: fmtPctSigned(metrics.yoyGrowth * 100),
            valueClass: metrics.yoyGrowth >= 0 ? 'pos' : 'neg',
            sub: yoyWindowLabel,
          })
        : ''
    }
    ${
      metrics.dividendCagr !== null
        ? kpiTile({
            label: `Income CAGR${infoTip('Compound annual growth rate of income from year to year. Shows how fast your income stream is growing.')}`,
            value: fmtPctNeg(metrics.dividendCagr * 100),
            valueClass: metrics.dividendCagr >= 0 ? 'pos' : 'neg',
            sub: 'annual income growth rate',
          })
        : ''
    }
  `;

  _renderIncomeChart(metrics.monthlyBreakdown);
  _attachIncomeRangeToggle(metrics.monthlyBreakdown);
}

let _lastIncomeBreakdown: { month: string; amount: number }[] = [];

function _renderIncomeChart(monthlyBreakdown: { month: string; amount: number }[]): void {
  _lastIncomeBreakdown = monthlyBreakdown;
  const canvas = document.getElementById('c-an-income') as HTMLCanvasElement | null;
  if (!canvas) return;
  _destroyChart('c-an-income');

  const view =
    _anIncomeRange === 'all' ? monthlyBreakdown : monthlyBreakdown.slice(-parseInt(_anIncomeRange));
  if (view.length === 0) return;

  const C = resolvedT();
  CH['c-an-income'] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: view.map((p) => fmtMon(p.month)),
      datasets: [
        {
          label: 'Income',
          data: view.map((p) => p.amount),
          backgroundColor: C.pos,
          borderRadius: R.xs,
          borderSkipped: false,
        },
      ],
    },
    options: {
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
            label: (ctx) => ` Income: ${fmtEur2(ctx.raw as number)}`,
            labelColor: tooltipSwatch(C.surface),
          },
        },
      },
      scales: {
        y: {
          grid: { color: C.line },
          ticks: { color: C.ink4, callback: (v) => '\u20AC' + (v as number).toFixed(0) },
        },
        x: {
          grid: { display: false },
          ticks: { color: C.ink2, font: { size: 10 }, maxRotation: 0, autoSkip: true },
        },
      },
    },
  });

  _writeChartTable(
    'c-an-income-table-wrap',
    'Income by month data',
    ['Month', 'Income (€)'],
    view.map((p) => [fmtMon(p.month), fmtEur2(p.amount)]),
  );
}

function _attachIncomeRangeToggle(monthlyBreakdown: { month: string; amount: number }[]): void {
  _attachRangeToggle(
    'an-income-range-toggle',
    () => _anIncomeRange,
    (r) => {
      _anIncomeRange = r;
    },
    () => _renderIncomeChart(monthlyBreakdown),
  );
}
