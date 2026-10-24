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
  kpiGroup,
} from '../utils';
import {
  cagr,
  findYoYSnapshot,
  twrFromMonthlyReturns,
  xirr,
  annualizedVolatilityFromMonthlyReturns,
  drawdownFromMonthlyReturns,
  totalReturn,
  ytdReturn,
  absoluteGain,
  avgDrawdown,
  drawdownDuration,
  downsideDeviation,
  sharpeRatio,
  sortinoRatio,
  calmarRatio,
  rollingAnnualizedReturnFromMonthlyReturns,
  annualReturnsFromMonthlyReturns,
  weightedMonthlyReturns,
  dividendMetrics,
  type MonthlyGrowthPoint,
  buildInvestmentPerformanceData,
  annualizedReturnFromMonthlyReturns,
  monthEndDate,
} from '../model/insights';
import { getAccounts, getHoldings, getNumberSetting } from '../store/config';
import { allInvestmentAccountsValue } from '../model/accounts';
import { infoTip, attachInfoTips } from '../ui/infoTip';
import { T, R, resolvedT } from '../theme';
import {
  axisTooltip,
  disposeChart,
  drillHint,
  fmtEurCompact,
  fmtPctAxis,
  monthTimeAxis,
  monthToTime,
  nearestMonth,
  renderChart,
  toRgba,
} from './charts';
import { drillToSnapshot, drillToTransactions } from './drill';
import type { Snapshot, PortfolioData, Transaction, Holding } from '../types';

let _lastSnaps: Snapshot[] = [];
let _lastPd: PortfolioData | null = null;
let _lastTxs: Transaction[] = [];

// Heatmap paging: page 0 = most recent 3 years
let _heatmapPage = 0;

// Allocation toggle state: 'active' | 'all'
const _allocMode: Record<string, 'active' | 'all'> = {
  acct: 'active',
  class: 'active',
  region: 'active',
  country: 'active',
};

// Account donut group dimension: 'acct' | 'country' | 'type' | 'group'
let _acctGroupDim: 'acct' | 'country' | 'type' | 'group' = 'acct';

function _getCountrySlices(
  snaps: Snapshot[],
  mode: 'active' | 'all',
): { label: string; value: number; color: string }[] {
  if (snaps.length === 0) return [];
  const s = snaps[snaps.length - 1];
  const accounts = getAccounts();
  const buckets = new Map<string, { value: number; color: string }>();
  for (const a of accounts) {
    const value = (s[a.id || ''] as number) || 0;
    if (value <= 0 && mode === 'active') continue;
    const label = (a.country || '').trim() || 'Unspecified';
    const existing = buckets.get(label);
    if (existing) {
      existing.value += value;
    } else {
      buckets.set(label, { value, color: a.color || '#888' });
    }
  }
  return Array.from(buckets.entries())
    .map(([label, { value, color }]) => ({ label, value, color }))
    .sort((a, b) => b.value - a.value);
}

function _getAccountGroupSlices(
  snaps: Snapshot[],
  mode: 'active' | 'all',
): { label: string; value: number; color: string }[] {
  if (snaps.length === 0) return [];
  const s = snaps[snaps.length - 1];
  const accounts = getAccounts();
  const buckets = new Map<string, { value: number; color: string }>();
  for (const a of accounts) {
    const value = (s[a.id || ''] as number) || 0;
    if (value <= 0 && mode === 'active') continue;
    const label = (a.group || '').trim() || 'Unspecified';
    const existing = buckets.get(label);
    if (existing) {
      existing.value += value;
    } else {
      buckets.set(label, { value, color: a.color || '#888' });
    }
  }
  return Array.from(buckets.entries())
    .map(([label, { value, color }]) => ({ label, value, color }))
    .sort((a, b) => b.value - a.value);
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
  const riskFreeRate = getNumberSetting('riskFreeRate', 2) / 100;

  const s = snaps[snaps.length - 1];
  const total = snapTotal(s);
  const firstTotal = snapTotal(snaps[0]);
  const firstDate = snaps[0]?.date || '';
  const latestDate = s.date || '';
  const monthsSpan = _monthsDiff(firstDate, latestDate);

  const perfData = buildInvestmentPerformanceData(snaps, txs, accounts);
  const investmentReturnCount = perfData.monthlyReturns.length;
  const sufficientInvestmentHistory =
    investmentReturnCount >= 24 &&
    perfData.skippedGapPeriods === 0 &&
    perfData.skippedMissingValuePeriods === 0;

  // Compute investment-side value once (used for both absolute gain and IRR)
  const latestInvestmentValue =
    perfData.latestInvestmentValue ?? allInvestmentAccountsValue(s, accounts);

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
  const twrVal = twrFromMonthlyReturns(perfData.monthlyReturns);
  const terminalDate = monthEndDate(s.date) || s.date;
  const investmentFlows = perfData.externalCashFlows.map((cf) => ({
    date: cf.date,
    amount: cf.amount,
  }));
  if (latestInvestmentValue !== null) {
    investmentFlows.push({ date: terminalDate, amount: latestInvestmentValue });
  }
  const irrVal = latestInvestmentValue !== null ? xirr(investmentFlows) : null;

  // Net worth absolute gain (always available once we have 2+ snapshots)
  const netWorthGainVal = snaps.length >= 2 ? total - firstTotal : null;

  document.getElementById('an-kpis-l1')!.innerHTML = `
    ${kpiTile({
      label: `Net worth change${infoTip('Total net worth at the latest snapshot minus the first snapshot. Includes all tracked accounts and money added or withdrawn.')}`,
      value: netWorthGainVal !== null ? fmtEurNeg(netWorthGainVal, 2) : '-',
      valueClass: netWorthGainVal === null ? '' : netWorthGainVal >= 0 ? 'pos' : 'neg',
      sub: netWorthGainVal !== null ? `since ${fmtMon(firstDate)}` : 'needs 2 snapshots',
      lead: true,
    })}
    ${kpiGroup(
      'Investment value and returns',
      [
        {
          label: `Value minus purchase cost${infoTip('Investment account value minus remaining purchase cost basis. Covers investment-type accounts only, may include account cash, and is not total investment profit.')}`,
          value: absoluteGainVal !== null ? fmtEurNeg(absoluteGainVal, 2) : '-',
          valueClass: absoluteGainVal === null ? '' : absoluteGainVal >= 0 ? 'pos' : 'neg',
          sub:
            absoluteGainVal !== null
              ? `${fmtEur(pd!.totalInv)} cost basis`
              : 'import transactions to calculate',
        },
        {
          label: `Cumulative return (TWR)${infoTip('Time-weighted return across investment-account snapshots, adjusting for recorded external deposits and withdrawals. This is cumulative, not an annual rate.')}`,
          value: twrVal !== null ? fmtPctNeg(twrVal * 100) : '-',
          valueClass: twrVal === null ? '' : twrVal >= 0 ? 'pos' : 'neg',
          sub:
            twrVal !== null
              ? `${investmentReturnCount} monthly periods, not annualized${investmentReturnCount < 24 ? ' (early data)' : ''}`
              : 'insufficient investment history',
        },
        {
          label: `Annualized return (IRR)${infoTip('Money-weighted annual return (XIRR). Reflects amounts and dates of recorded external deposits and withdrawals plus terminal investment value. Internal buys and sells are not external flows.')}`,
          value: irrVal !== null ? fmtPctNeg(irrVal * 100) : '-',
          valueClass: irrVal === null ? '' : irrVal >= 0 ? 'pos' : 'neg',
          sub:
            irrVal !== null
              ? `XIRR, annualized${monthsSpan < 24 ? ' (early data)' : ''}`
              : 'needs external cash flows and terminal value',
        },
      ],
      { result: false },
    )}
  `;

  document.getElementById('an-kpis-l2')!.innerHTML = kpiGroup(
    'Net worth growth',
    [
      {
        label: `Net worth growth${infoTip('Percentage balance change from first to latest snapshot. Includes deposits and withdrawals; not cash-flow-adjusted investment performance.')}`,
        value: totalReturnVal !== null ? fmtPctNeg(totalReturnVal * 100) : '-',
        valueClass: totalReturnVal === null ? '' : totalReturnVal >= 0 ? 'pos' : 'neg',
        sub: totalReturnVal !== null ? `since ${fmtMon(firstDate)}` : 'needs 2 snapshots',
      },
      {
        label: `Year-to-date growth${infoTip('Net worth balance growth since the prior year end, including money added or withdrawn.')}`,
        value: ytdVal !== null ? fmtPctNeg(ytdVal * 100) : '-',
        valueClass: ytdVal === null ? '' : ytdVal >= 0 ? 'pos' : 'neg',
        sub:
          ytdVal !== null ? `since Jan ${new Date().getFullYear()}` : 'needs prior-year snapshot',
      },
      {
        label: `Annualized growth (CAGR)${infoTip('Compound annual growth of total net worth, including deposits and withdrawals. Short histories can produce unusually large rates.')}`,
        value: cagrVal !== null ? fmtPctNeg(cagrVal * 100) : '-',
        valueClass: cagrVal === null ? '' : cagrVal >= 0 ? 'pos' : 'neg',
        sub:
          cagrVal !== null
            ? `${monthsSpan} months${monthsSpan < 24 ? ' (early data)' : ''}`
            : `${monthsSpan}/12 months recorded`,
      },
      ...(yoyAbs !== null
        ? [
            {
              label: `Year-over-year change${infoTip('Change in total net worth compared with the matching prior-year snapshot, including external money flows.')}`,
              value: fmtEurSigned(yoyAbs, 2),
              valueClass: yoyAbs >= 0 ? 'pos' : 'neg',
              sub: `${yoyPct !== null ? fmtPctSigned(yoyPct) : '-'} vs ${fmtMon(yoyData!.snap.date)}`,
            },
          ]
        : []),
    ],
    { result: false },
  );

  // ── Portfolio growth chart ────────────────────────────────
  _renderGrowthChart(snaps);

  // ── Level 2 content ───────────────────────────────────────
  const level2 = document.getElementById('an-level2');
  if (level2) level2.style.display = snaps.length >= 2 ? '' : 'none';

  if (snaps.length >= 2) {
    // Contributions vs market chart
    const growthPoints = perfData.monthlyReturns.map((point) => ({
      month: point.date,
      contributed: point.externalFlow,
      market: point.endValue - point.startValue - point.externalFlow,
      total: point.endValue - point.startValue,
    }));
    _renderContribChart(growthPoints);

    // Heatmap
    _heatmapPage = 0;
    _renderHeatmap(perfData.monthlyReturns);
    _attachHeatmapPager(perfData.monthlyReturns);

    // Annual returns table
    _renderAnnualTable(perfData.monthlyReturns);

    // Allocation donuts
    _renderAllocationDonuts(holdings, pd);
  }

  // ── Level 3: Advanced (collapsible) ──────────────────────
  const volResult = annualizedVolatilityFromMonthlyReturns(perfData.monthlyReturns);
  const ddResult = drawdownFromMonthlyReturns(perfData.monthlyReturns);
  const cagrForRisk = annualizedReturnFromMonthlyReturns(perfData.monthlyReturns);
  const dd = ddResult.max;
  const advancedContent = document.getElementById('an-advanced-content');
  const riskMetricsNoteCardEl = document.getElementById('an-risk-metrics-note-card');
  const riskMetricsNoteEl = document.getElementById('an-risk-metrics-note');

  const riskMetricsReady = sufficientInvestmentHistory;

  if (riskMetricsNoteEl) {
    if (riskMetricsReady) {
      if (riskMetricsNoteCardEl) riskMetricsNoteCardEl.style.display = 'none';
    } else {
      const reasons = [];
      if (investmentReturnCount < 24)
        reasons.push(`${investmentReturnCount}/24 monthly investment periods`);
      if (perfData.skippedMissingValuePeriods > 0)
        reasons.push(`${perfData.skippedMissingValuePeriods} period(s) missing investment values`);
      if (perfData.skippedGapPeriods > 0)
        reasons.push(`${perfData.skippedGapPeriods} gap period(s) in snapshot history`);
      riskMetricsNoteEl.textContent = `Insufficient data for investment risk metrics: ${reasons.join(', ')}. At least 24 valid monthly return periods are required, with no skipped gaps or unavailable investment values in the recorded history. Check snapshot months and investment balances.`;
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
        ${kpiGroup(
          'Investment risk',
          [
            {
              label: `Volatility${infoTip('Annualized standard deviation of monthly investment returns after neutralising external cash flows. Higher volatility means a bumpier investment ride.')}`,
              value: volResult.annualized !== null ? fmtPctNeg(volResult.annualized * 100) : '-',
              valueClass: '',
              sub: volResult.annualized !== null ? 'annualized, all history' : 'needs more data',
            },
            {
              label: `Max Drawdown${infoTip('Largest peak-to-trough decline in the linked investment return series. Uses investment performance only, not net worth growth.')}`,
              value: dd !== null ? (dd === 0 ? '0%' : fmtPctNeg(dd * 100)) : '-',
              valueClass: dd === null ? '' : dd < 0 ? 'neg' : '',
              sub: dd !== null ? 'all history' : 'needs more data',
            },
            {
              label: `Calmar${infoTip('Annualized investment return divided by absolute max drawdown. Higher is better.')}`,
              value: calmar !== null ? calmar.toFixed(2) : '-',
              valueClass: calmar === null ? '' : calmar >= 0 ? 'pos' : 'neg',
              sub: calmar !== null ? 'CAGR / |Max DD|' : 'needs more data',
            },
            {
              label: `Sharpe${infoTip('(Annualized investment return minus risk-free rate) divided by annualized volatility. Measures return per unit of investment risk. A negative value means the portfolio return is below the risk-free rate; this is financially correct, not a data error.')}`,
              value: sharpe !== null ? sharpe.toFixed(2) : '-',
              valueClass: '',
              sub: sharpe !== null ? `rf = ${(riskFreeRate * 100).toFixed(2)}%` : 'needs more data',
            },
            {
              label: `Sortino${infoTip('Like Sharpe, but uses only downside volatility from negative investment months.')}`,
              value: sortino !== null ? sortino.toFixed(2) : '-',
              valueClass: '',
              sub: sortino !== null ? 'downside risk only' : 'needs more data',
            },
            {
              label: `Avg Drawdown${infoTip('Average of all monthly investment drawdowns in the linked performance series.')}`,
              value:
                avgDD !== null && avgDD < 0 ? fmtPctNeg(avgDD * 100) : avgDD === 0 ? '0%' : '-',
              valueClass: avgDD !== null && avgDD < 0 ? 'neg' : '',
              sub: avgDD !== null ? 'mean of all drawdown months' : 'needs more data',
            },
            {
              label: `DD Duration${infoTip('Maximum number of consecutive monthly investment periods spent below the prior peak.')}`,
              value: ddDur > 0 ? `${ddDur} mo` : ddResult.series.length > 0 ? '0 mo' : '-',
              valueClass: '',
              sub: ddDur > 0 ? 'longest underwater streak' : 'no drawdown in history',
            },
          ],
          { result: false },
        )}
    `
        : '';
    }

    if (riskKpisEl) riskKpisEl.style.display = riskMetricsReady ? '' : 'none';
    if (explainerEl) explainerEl.style.display = riskMetricsReady ? '' : 'none';
    if (drawdownCardEl) drawdownCardEl.style.display = riskMetricsReady ? '' : 'none';

    if (riskMetricsReady) _renderDrawdownChart(ddResult.series);
    else disposeChart('c-an-drawdown');

    // Rolling CAGR
    _renderRollingCagrChart(perfData.monthlyReturns);

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

/** Growth, drawdown and rolling CAGR share a month axis: zoom, presets and hover move together. */
const TIMELINE_GROUP = 'an-timeline';

function _renderGrowthChart(snaps: Snapshot[]): void {
  if (snaps.length < 2) {
    disposeChart('c-an-growth');
    return;
  }

  const points = snaps.map((s) => [monthToTime(s.date), snapTotal(s)] as [number, number]);
  const last = points[points.length - 1][0];
  const months = snaps.map((s) => s.date);

  renderChart(
    'c-an-growth',
    ({ tokens: t, touch }) => ({
      tooltip: {
        trigger: 'axis',
        confine: true,
        formatter: axisTooltip({
          value: (v) => fmtEur2(v),
          hint: drillHint({ touch }, 'open this snapshot'),
        }),
      },
      xAxis: monthTimeAxis(),
      yAxis: {
        type: 'value',
        scale: true,
        axisLabel: { formatter: fmtEurCompact },
      },
      series: [
        {
          name: 'Total net worth',
          type: 'line',
          data: points,
          showSymbol: points.length <= 24,
          symbolSize: 5,
          smooth: 0.3,
          lineStyle: { width: 2, color: t.brand },
          itemStyle: { color: t.brand },
          areaStyle: {
            origin: 'start',
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: toRgba(t.brand, 0.22) },
                { offset: 1, color: toRgba(t.brand, 0.02) },
              ],
            },
          },
        },
      ],
    }),
    {
      zoom: true,
      xAxisType: 'time',
      group: TIMELINE_GROUP,
      drill: { resolve: (v) => nearestMonth(v, months), select: drillToSnapshot },
    },
  );
}

// ── Contributions vs market chart ──────────────────────────

function _renderContribChart(points: MonthlyGrowthPoint[]): void {
  const el = document.getElementById('c-an-contrib');
  if (!el) return;
  const card = el.closest('.card') as HTMLElement | null;
  if (points.length === 0) {
    disposeChart('c-an-contrib');
    if (card) card.style.display = 'none';
    return;
  }
  if (card) card.style.display = '';

  const months = points.map((p) => fmtMon(p.month));
  const n = months.length;

  renderChart(
    'c-an-contrib',
    ({ tokens: t }) => ({
      legend: { data: ['Contributed', 'Market movement'] },
      tooltip: {
        trigger: 'axis',
        confine: true,
        axisPointer: { type: 'shadow' },
        formatter: axisTooltip({
          value: (v, name) => (name === 'Contributed' ? fmtEur2(v) : fmtEurSigned(v, 2)),
          footer: (vals) => ({
            label: 'Total',
            value: fmtEurSigned(
              vals.reduce((s, v) => s + v, 0),
              2,
            ),
          }),
        }),
      },
      xAxis: { type: 'category', data: months, axisTick: { show: false } },
      yAxis: { type: 'value', axisLabel: { formatter: fmtEurCompact } },
      series: [
        {
          name: 'Contributed',
          type: 'bar',
          stack: 'contrib',
          data: points.map((p) => p.contributed),
          itemStyle: { color: t.brand },
          emphasis: { focus: 'series' },
        },
        {
          name: 'Market movement',
          type: 'bar',
          stack: 'contrib',
          // Per-bar sign colour; the series colour (legend swatch) stays the positive one.
          itemStyle: { color: t.pos },
          data: points.map((p) => ({
            value: p.market,
            itemStyle: { color: p.market >= 0 ? t.pos : t.neg },
          })),
          emphasis: { focus: 'series' },
        },
      ],
    }),
    {
      zoom: true,
      xAxisType: 'category',
    },
  );
}

// ── Monthly return heatmap ─────────────────────────────────

const HEATMAP_PAGE_SIZE = 3;
const HEATMAP_MIN_MONTHS = 24;

function _renderHeatmap(
  monthlyReturns: { date: string; startValue: number; return: number }[],
): void {
  const heatmapEl = document.getElementById('an-heatmap');
  const noteEl = document.getElementById('an-heatmap-note');
  const footerEl = document.getElementById('an-heatmap-footer');
  if (!heatmapEl) return;

  const weighted = weightedMonthlyReturns(monthlyReturns);
  const annualData = annualReturnsFromMonthlyReturns(monthlyReturns);

  if (weighted.length === 0) {
    heatmapEl.innerHTML =
      '<p class="note">Add more consecutive monthly investment snapshots to see the return heatmap.</p>';
    if (footerEl)
      footerEl.textContent =
        'Heatmap colors are descriptive only and should not be used for short-term timing decisions.';
    return;
  }

  const monthsCount = weighted.length;
  if (monthsCount < HEATMAP_MIN_MONTHS) {
    heatmapEl.innerHTML =
      '<p class="note">Heatmap unlocks after 24 valid monthly investment-return periods are available.</p>';
    if (noteEl) noteEl.style.display = 'none';
    if (footerEl)
      footerEl.textContent =
        'Heatmap colors are descriptive only and should not be used for short-term timing decisions.';
    return;
  }

  if (noteEl) {
    noteEl.textContent =
      'Cells show cash-flow-adjusted monthly returns. Color strength also weights starting investment value.';
    noteEl.style.display = '';
  }
  if (footerEl)
    footerEl.textContent =
      'Blank = unknown, not 0%. Year totals compound available returns; * = partial year. Colors are descriptive, not trading signals.';

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
  const annualLookup = new Map<number, { return: number; isPartial: boolean }>();
  for (const a of annualData) {
    annualLookup.set(a.year, { return: a.return, isPartial: a.isPartial });
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
      const annPct = annualRet.return * 100;
      const annSign = annPct > 0 ? '+' : '';
      const annCls = annPct >= 0 ? C.pos : C.neg;
      html += `<td style="padding:2px 4px;text-align:right;font-weight:600;color:${annCls};white-space:nowrap" title="${annualRet.isPartial ? 'Partial year return (fewer than 12 months of data)' : 'Full-year return'}">${annSign}${annPct.toFixed(1)}%${annualRet.isPartial ? ' *' : ''}</td>`;
    } else {
      html += `<td style="padding:2px 4px;text-align:right;color:var(--ink-3)">-</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  heatmapEl.innerHTML = html;
}

function _attachHeatmapPager(
  monthlyReturns: { date: string; startValue: number; return: number }[],
): void {
  const prevBtn = document.getElementById('an-heatmap-prev');
  const nextBtn = document.getElementById('an-heatmap-next');
  if (prevBtn) {
    prevBtn.onclick = () => {
      _heatmapPage++;
      _renderHeatmap(monthlyReturns);
    };
  }
  if (nextBtn) {
    nextBtn.onclick = () => {
      _heatmapPage = Math.max(0, _heatmapPage - 1);
      _renderHeatmap(monthlyReturns);
    };
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
function _renderAnnualTable(
  monthlyReturns: { date: string; startValue: number; return: number }[],
): void {
  const el = document.getElementById('an-annual-table');
  const card = document.getElementById('an-annual-table-card');
  if (!el || !card) return;

  const data = annualReturnsFromMonthlyReturns(monthlyReturns);
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
        deltaCell = `<td style="color:${dColor}">${dSign}${delta.toFixed(1)} pp</td>`;
      }

      const sparkline = `<svg width="32" height="${MAX_BAR_H + 4}" viewBox="0 0 32 ${MAX_BAR_H + 4}" aria-hidden="true" style="display:block;margin:auto">
        <rect x="8" y="${barY + 2}" width="16" height="${barH}" rx="2" fill="${color}" opacity="0.85"/>
      </svg>`;

      return `<tr>
        <td style="font-weight:500;color:var(--ink)">${row.year}</td>
        <td style="color:${color};font-weight:600">${sign}${pct.toFixed(1)}%${row.isPartial ? ' *' : ''}</td>
        <td style="text-align:center">${sparkline}</td>
        ${deltaCell}
      </tr>`;
    })
    .join('');

  el.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:12px">
    <thead>
      <tr style="border-bottom:1px solid var(--line);color:var(--ink-3);font-weight:500">
        <th style="text-align:left;padding:4px 6px">Year</th>
        <th style="text-align:left;padding:4px 6px">Return${infoTip('Rows marked with * are partial-year returns (fewer than 12 months of investment-return data).')}</th>
        <th style="text-align:center;padding:4px 6px">Bar${infoTip('Relative bar height scaled to the largest absolute annual return shown in this table.')}</th>
        <th style="text-align:left;padding:4px 6px">Change (pp)${infoTip('Difference in percentage points from the previous listed year. Partial-year returns cover fewer months, so they are not directly comparable with full-year results.')}</th>
      </tr>
    </thead>
    <tbody style="color:var(--ink-2)">${tableRows}</tbody>
  </table>`;
}

// ── Allocation donuts ──────────────────────────────────────

type AllocDim = 'class' | 'acct' | 'region' | 'country';

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
  dim: Exclude<AllocDim, 'acct' | 'country'>,
  mode: 'active' | 'all',
): { label: string; value: number; color: string }[] {
  if (!pd) return [];
  const filtered = mode === 'active' ? holdings.filter((h) => h.active) : holdings;
  const buckets = new Map<string, { value: number; color: string }>();

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
      return true;
    })
    .map((a) => {
      const currency = (a.currency || 'EUR').trim().toUpperCase();
      const label =
        currency !== 'EUR' ? `${a.label || a.id || ''} (${currency})` : a.label || a.id || '';
      return {
        label,
        value: (s[a.id || ''] as number) || 0,
        color: a.color || '#888',
      };
    })
    .sort((a, b) => b.value - a.value);
}

function _getTypeSlices(snaps: Snapshot[]): { label: string; value: number; color: string }[] {
  if (snaps.length === 0) return [];
  const s = snaps[snaps.length - 1];
  const accounts = getAccounts();
  const buckets = new Map<string, { value: number; color: string }>();
  for (const a of accounts) {
    const value = (s[a.id || ''] as number) || 0;
    const raw = (a.moneyType || '').trim();
    const label = raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : 'Unspecified';
    const existing = buckets.get(label);
    if (existing) {
      existing.value += value;
    } else {
      buckets.set(label, { value, color: a.color || '#888' });
    }
  }
  return Array.from(buckets.entries())
    .map(([label, { value, color }]) => ({ label, value, color }))
    .sort((a, b) => b.value - a.value);
}

function _renderAllocDonut(dim: AllocDim, holdings: Holding[], pd: PortfolioData | null): void {
  const mode = _allocMode[dim] ?? 'active';
  let slices: { label: string; value: number; color: string }[] = [];

  if (dim === 'acct') {
    if (_acctGroupDim === 'country') {
      slices = _getCountrySlices(_lastSnaps, 'all');
    } else if (_acctGroupDim === 'group') {
      slices = _getAccountGroupSlices(_lastSnaps, 'all');
    } else if (_acctGroupDim === 'type') {
      slices = _getTypeSlices(_lastSnaps);
    } else {
      slices = _getAccountSlices(_lastSnaps, 'all');
    }
  } else if (dim === 'country') {
    slices = _getCountrySlices(_lastSnaps, mode);
  } else {
    slices = _getHoldingSlices(holdings, pd, dim as Exclude<AllocDim, 'acct' | 'country'>, mode);
  }

  const canvasId = `c-an-alloc-${dim}`;

  // No data: dispose any previous chart to avoid a stale display
  if (slices.length === 0) {
    disposeChart(canvasId);
    return;
  }

  const total = slices.reduce((s, x) => s + x.value, 0);
  const dimLabel =
    dim === 'acct'
      ? _acctGroupDim === 'country'
        ? 'country'
        : _acctGroupDim === 'group'
          ? 'group'
          : _acctGroupDim === 'type'
            ? 'type'
            : 'account'
      : dim === 'class'
        ? 'asset class'
        : dim === 'region'
          ? 'region'
          : 'country';

  // Single slice renders as a full ring natively; the hint nudges to the broader mode when useful.
  const hintEl = document.getElementById(`an-alloc-${dim}-hint`);
  if (hintEl) {
    let otherModeHasMore = false;
    if (slices.length === 1 && dim !== 'acct' && mode === 'active') {
      const other =
        dim === 'country'
          ? _getCountrySlices(_lastSnaps, 'all')
          : _getHoldingSlices(holdings, pd, dim as Exclude<AllocDim, 'acct' | 'country'>, 'all');
      otherModeHasMore = other.length > 1;
    }
    hintEl.style.display = otherModeHasMore ? '' : 'none';
  }

  renderChart(
    canvasId,
    ({ tokens: t, compact, width }) => {
      const legendW = Math.max(90, Math.round(width * (compact ? 0.5 : 0.52)) - 16);
      const share = (v: number) => (total > 0 ? fmtPctVal((v / total) * 100) : '0%');
      const byName = new Map(slices.map((s) => [s.label, s.value]));
      const centreLabel = {
        show: true,
        position: 'center' as const,
        formatter: `{v|${fmtEurCompact(total)}}\n{l|total}`,
        rich: {
          v: { fontSize: 13, fontWeight: 600, color: t.ink, lineHeight: 18 },
          l: { fontSize: 10, color: t.ink4 },
        },
      };
      return {
        tooltip: {
          trigger: 'item',
          confine: true,
          formatter: (p: unknown) => {
            const it = p as { marker?: string; name?: string; value?: number };
            return `<div class="ec-tt"><div class="ec-tt-row">${it.marker ?? ''}<span class="ec-tt-name">${esc(it.name ?? '')}</span><span class="ec-tt-val">${esc(fmtEur(Number(it.value)))}</span></div><div class="ec-tt-row"><span class="ec-tt-name">Share</span><span class="ec-tt-val">${esc(share(Number(it.value)))}</span></div></div>`;
          },
        },
        legend: {
          orient: 'vertical',
          right: 0,
          top: 'middle',
          width: legendW,
          itemGap: 8,
          formatter: (name: string) => `${name}  {share|${share(byName.get(name) ?? 0)}}`,
          textStyle: {
            width: legendW - 20,
            overflow: 'truncate',
            rich: { share: { color: t.ink4, fontSize: 11 } },
          },
        },
        series: [
          {
            name: `Allocation by ${dimLabel}`,
            type: 'pie',
            radius: ['55%', '82%'],
            center: [`${compact ? 26 : 25}%`, '54%'],
            avoidLabelOverlap: true,
            padAngle: slices.length > 1 ? 1 : 0,
            itemStyle: { borderColor: t.surface, borderWidth: slices.length > 1 ? 2 : 0 },
            label: { show: false },
            emphasis: { scale: true, scaleSize: 4 },
            labelLine: { show: false },
            // Centre total: a label on the first slice only, so it is drawn once.
            data: slices.map((s, i) => ({
              name: s.label,
              value: s.value,
              itemStyle: { color: safeColor(s.color) },
              ...(i === 0 ? { label: centreLabel, emphasis: { label: centreLabel } } : {}),
            })),
          },
        ],
      };
    },
    { valueFormatter: fmtEur2 },
  );

  _renderAllocToggleBtn(dim);
}

function _renderAllocToggleBtn(dim: AllocDim): void {
  const wrapId = `an-alloc-${dim}-toggle-wrap`;
  const wrapEl = document.getElementById(wrapId);
  if (!wrapEl) return;

  if (dim === 'acct') {
    const groupDim = _acctGroupDim;
    wrapEl.innerHTML = `
      <div class="range-toggle" style="font-size:11px">
        <button class="btn btn-sm btn-ghost${groupDim === 'acct' ? ' active' : ''}" data-acct-group="acct">By account</button>
        <button class="btn btn-sm btn-ghost${groupDim === 'country' ? ' active' : ''}" data-acct-group="country">Account country</button>
        <button class="btn btn-sm btn-ghost${groupDim === 'group' ? ' active' : ''}" data-acct-group="group">By group</button>
        <button class="btn btn-sm btn-ghost${groupDim === 'type' ? ' active' : ''}" data-acct-group="type">By type</button>
      </div>`;
    if (!(wrapEl as HTMLElement & { _acctBound?: boolean })._acctBound) {
      (wrapEl as HTMLElement & { _acctBound?: boolean })._acctBound = true;
      wrapEl.addEventListener('click', (e) => {
        const btn = e.target as HTMLElement;
        const groupBtn = btn.closest('[data-acct-group]') as HTMLElement | null;
        const holdings = getHoldings();
        const pd = _lastPd;
        if (groupBtn) {
          const newGroup = groupBtn.dataset.acctGroup as 'acct' | 'country' | 'type' | 'group';
          if (_acctGroupDim === newGroup) return;
          _acctGroupDim = newGroup;
          _renderAllocDonut('acct', holdings, pd);
        }
      });
    }
    return;
  }

  const mode = _allocMode[dim] ?? 'active';
  wrapEl.innerHTML = `<div class="range-toggle" style="font-size:11px">
    <button class="btn btn-sm btn-ghost${mode === 'all' ? ' active' : ''}" data-alloc-mode="all" data-alloc-dim="${dim}">All configured holdings</button>
    <button class="btn btn-sm btn-ghost${mode === 'active' ? ' active' : ''}" data-alloc-mode="active" data-alloc-dim="${dim}">Active holdings only</button>
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
  _renderAllocToggleBtn(dim);
}

// ── Drawdown chart ─────────────────────────────────────────

function _renderDrawdownChart(series: { date: string; drawdown: number }[]): void {
  const card = document.getElementById('an-drawdown-card');
  if (!document.getElementById('c-an-drawdown') || !card) return;
  if (series.length < 2) {
    disposeChart('c-an-drawdown');
    card.style.display = 'none';
    return;
  }
  card.style.display = '';

  const points = series.map((p) => [monthToTime(p.date), p.drawdown * 100] as [number, number]);
  const last = points[points.length - 1][0];
  const pct = (v: number) => `${v.toFixed(1)}%`;
  const hasDrawdown = points.some((p) => p[1] < 0);

  renderChart(
    'c-an-drawdown',
    ({ tokens: t }) => ({
      tooltip: { trigger: 'axis', confine: true, valueFormatter: (v) => pct(Number(v)) },
      xAxis: monthTimeAxis(),
      yAxis: {
        type: 'value',
        max: 0,
        // Without any drawdown keep a negative scale instead of ECharts' default 0..1 range.
        min: hasDrawdown ? undefined : -1,
        axisLabel: { formatter: (v: number) => fmtPctAxis(v) },
      },
      series: [
        {
          name: 'Drawdown',
          type: 'line',
          data: points,
          showSymbol: false,
          smooth: 0.3,
          lineStyle: { width: 1.5, color: t.neg },
          itemStyle: { color: t.neg },
          areaStyle: { color: toRgba(t.neg, 0.2) },
          markPoint: hasDrawdown
            ? {
                symbol: 'pin',
                symbolSize: 34,
                itemStyle: { color: t.neg },
                label: {
                  color: '#fff',
                  fontSize: 9,
                  formatter: (p) => fmtPctAxis(Number(p.value)),
                },
                data: [{ type: 'min', name: 'Deepest drawdown' }],
              }
            : undefined,
        },
      ],
    }),
    {
      zoom: true,
      xAxisType: 'time',
      valueFormatter: pct,
      group: TIMELINE_GROUP,
    },
  );
}

// ── Rolling CAGR chart ─────────────────────────────────────

function _renderRollingCagrChart(
  monthlyReturns: { date: string; startValue: number; return: number }[],
): void {
  const card = document.getElementById('an-rolling-cagr-card');
  const noteEl = document.getElementById('an-rolling-cagr-note');
  const host = document.getElementById('c-an-rolling-cagr');
  if (!host || !card) return;

  const WINDOW = 36;
  const points: Array<{ month: string; cagr: number }> = rollingAnnualizedReturnFromMonthlyReturns(
    monthlyReturns,
    WINDOW,
  );

  if (noteEl) {
    if (monthlyReturns.length < WINDOW) {
      const cur = monthlyReturns.length;
      noteEl.textContent = `${cur}/${WINDOW} monthly investment periods recorded. Rolling 3-year investment CAGR requires 36 periods of consecutive return history.`;
      noteEl.style.display = '';
    } else {
      noteEl.style.display = 'none';
    }
  }

  const wrap = host.closest('.chart-wrap') as HTMLElement | null;
  if (points.length === 0) {
    disposeChart('c-an-rolling-cagr');
    if (wrap) wrap.style.display = 'none';
    return;
  }
  if (wrap) wrap.style.display = '';

  const data = points.map((p) => [monthToTime(p.month), p.cagr * 100] as [number, number]);
  const last = data[data.length - 1][0];
  const pct = (v: number) => `${v.toFixed(1)}%`;

  renderChart(
    'c-an-rolling-cagr',
    ({ tokens: t }) => ({
      tooltip: { trigger: 'axis', confine: true, valueFormatter: (v) => pct(Number(v)) },
      xAxis: monthTimeAxis(),
      yAxis: { type: 'value', scale: true, axisLabel: { formatter: (v: number) => fmtPctAxis(v) } },
      series: [
        {
          name: 'Rolling 3Y CAGR',
          type: 'line',
          data,
          showSymbol: data.length <= 24,
          symbolSize: 4,
          smooth: 0.3,
          lineStyle: { width: 2, color: t.brand },
          itemStyle: { color: t.brand },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { type: 'dashed', color: t.line2 },
            label: { show: false },
            data: [{ yAxis: 0 }],
          },
        },
      ],
    }),
    {
      zoom: data.length > 12,
      xAxisType: 'time',
      valueFormatter: pct,
      group: TIMELINE_GROUP,
    },
  );
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

  document.getElementById('an-kpis-income')!.innerHTML = kpiGroup(
    'Recorded income',
    [
      {
        label: `Trailing 12M Income${infoTip('Sum of all DIVIDEND and INTEREST transactions received in the trailing 12-month window anchored to your latest imported transaction month.')}`,
        value: fmtEur2(metrics.trailing12m),
        sub: throughLabel,
      },
      ...(metrics.yieldPct !== null
        ? [
            {
              label: `Recorded income / investment value${infoTip('Trailing 12-month recorded dividend and interest income divided by latest investment-account value. Income can include interest outside investment accounts, so the numerator and denominator may cover different accounts.')}`,
              value: fmtPctNeg(metrics.yieldPct * 100),
              sub: metrics.asOfMonth
                ? `trailing 12M as of ${fmtMon(metrics.asOfMonth)} / investment value`
                : 'trailing 12M / investment value',
            },
          ]
        : []),
      ...(metrics.yieldOnCost !== null
        ? [
            {
              label: `Recorded income / purchase cost${infoTip('Trailing 12-month recorded dividend and interest income divided by remaining purchase cost basis, not lifetime contributions.')}`,
              value: fmtPctNeg(metrics.yieldOnCost * 100),
              sub: 'trailing 12M / cost basis',
            },
          ]
        : []),
      ...(metrics.yoyGrowth !== null
        ? [
            {
              label: `Income Growth (YoY)${infoTip('Trailing 12-month income compared with the prior trailing 12 months, anchored to your latest imported transaction month.')}`,
              value: fmtPctSigned(metrics.yoyGrowth * 100),
              valueClass: metrics.yoyGrowth >= 0 ? 'pos' : 'neg',
              sub: yoyWindowLabel,
            },
          ]
        : []),
      ...(metrics.dividendCagr !== null
        ? [
            {
              label: `Income CAGR${infoTip('Annualized change between first and latest recorded calendar-year income totals. Either year may be partial, materially distorting the rate. This is not a forecast.')}`,
              value: fmtPctNeg(metrics.dividendCagr * 100),
              valueClass: metrics.dividendCagr >= 0 ? 'pos' : 'neg',
              sub: 'annual income growth rate',
            },
          ]
        : []),
    ],
    { result: false },
  );

  _renderIncomeChart(metrics.monthlyBreakdown);
}

function _renderIncomeChart(monthlyBreakdown: { month: string; amount: number }[]): void {
  if (!document.getElementById('c-an-income')) return;
  if (monthlyBreakdown.length === 0) {
    disposeChart('c-an-income');
    return;
  }
  const months = monthlyBreakdown.map((p) => fmtMon(p.month));
  const n = months.length;

  renderChart(
    'c-an-income',
    ({ tokens: t, touch }) => ({
      tooltip: {
        trigger: 'axis',
        confine: true,
        axisPointer: { type: 'shadow' },
        formatter: axisTooltip({
          value: (v) => fmtEur2(v),
          hint: drillHint({ touch }, "see this month's transactions"),
        }),
      },
      xAxis: { type: 'category', data: months, axisTick: { show: false } },
      yAxis: { type: 'value', axisLabel: { formatter: fmtEurCompact } },
      series: [
        {
          name: 'Income',
          type: 'bar',
          data: monthlyBreakdown.map((p) => p.amount),
          itemStyle: { color: t.pos, borderRadius: [3, 3, 0, 0] },
          barMaxWidth: 28,
        },
      ],
    }),
    {
      zoom: n > 12,
      xAxisType: 'category',
      // Opens on the last year; zoom out (slider / pinch) for the full history.
      window: n > 12 ? { startValue: n - 12, endValue: n - 1 } : undefined,
      drill: {
        resolve: (v) => monthlyBreakdown[Math.round(v)]?.month ?? null,
        select: (month) => drillToTransactions(month),
      },
    },
  );
}
