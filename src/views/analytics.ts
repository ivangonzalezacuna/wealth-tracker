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
import { computeDrift } from '../model/drift';
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
let _lastSnaps: Snapshot[] = [];
let _lastPd: PortfolioData | null = null;
let _lastTxs: Transaction[] = [];

// Allocation toggle state: 'active' | 'all'
const _allocMode: Record<string, 'active' | 'all'> = {
  class: 'active',
  acct: 'active',
  region: 'active',
  sector: 'active',
  currency: 'active',
};

function _destroyChart(id: string): void {
  if (CH[id]) {
    CH[id].destroy();
    delete CH[id];
  }
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

  // ── Level 1 KPIs ─────────────────────────────────────────
  const totalReturnVal = totalReturn(firstTotal, total);
  const absoluteGainVal = pd ? absoluteGain(total, pd.totalInv) : null;
  const ytdVal = ytdReturn(snaps);
  const cagrVal = cagr(firstTotal, total, monthsSpan);
  const yoyData = findYoYSnapshot(snaps);
  const yoyAbs = yoyData ? total - yoyData.total : null;
  const yoyPct =
    yoyData && yoyData.total > 0 ? ((total - yoyData.total) / yoyData.total) * 100 : null;

  // Level 2 performance KPIs (TWR + IRR)
  const twrVal = twr(snaps, pd?.monthly || {});
  const latestInvestmentValue = allInvestmentAccountsValue(s, accounts);
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

  document.getElementById('an-kpis-l1')!.innerHTML = `
    ${kpiTile({
      label: `Total Return${infoTip('Total percentage gain or loss from your first snapshot to today. Measures balance growth, not investment performance. For a cash-flow adjusted return, see IRR.')}`,
      value: totalReturnVal !== null ? fmtPctNeg(totalReturnVal * 100) : '-',
      valueClass: totalReturnVal === null ? '' : totalReturnVal >= 0 ? 'pos' : 'neg',
      sub: totalReturnVal !== null ? `since ${fmtMon(firstDate)}` : 'needs 2 snapshots',
    })}
    ${
      absoluteGainVal !== null
        ? kpiTile({
            label: `Absolute Gain${infoTip('Portfolio value minus total amount invested (cost basis). Shows the actual euro gain or loss in your account.')}`,
            value: fmtEurNeg(absoluteGainVal, 2),
            valueClass: absoluteGainVal >= 0 ? 'pos' : 'neg',
            sub: `of ${fmtEur(pd!.totalInv)} invested`,
          })
        : kpiTile({ label: 'Absolute Gain', value: '-', sub: 'import transactions to calculate' })
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

  document.getElementById('an-kpis-l2')!.innerHTML = `
    <div style="width:100%;padding:.25rem 0 .4rem;font-size:11px;color:var(--ink-3);font-weight:500;text-transform:uppercase;letter-spacing:.04em">Performance Detail</div>
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
    _renderHeatmap(snaps);

    // Annual return table
    _renderAnnualTable(snaps);

    // Allocation donuts
    _renderAllocationDonuts(holdings, pd);

    // Drift
    _renderDrift(holdings, pd, s);
  }

  // ── Level 3: Advanced (collapsible) ──────────────────────
  const volResult = annualizedVolatility(snaps);
  const ddResult = maxDrawdown(snaps);
  const cagrForRisk = cagrVal;
  const dd = ddResult.max;
  const advancedGate = document.getElementById('an-advanced-gate');
  const advancedContent = document.getElementById('an-advanced-content');

  if (advancedGate) {
    advancedGate.textContent =
      monthsSpan < 12 ? `(${monthsSpan}/12 months for full analytics)` : '';
  }

  if (advancedContent) {
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

    document.getElementById('an-kpis-risk')!.innerHTML = `
      ${kpiTile({
        label: `Volatility${infoTip('Annualized standard deviation of monthly net-worth percentage changes. Higher volatility means a bumpier ride. Meaningful after 12+ months of data.')}`,
        value: volResult.annualized !== null ? fmtPctNeg(volResult.annualized * 100) : '-',
        valueClass: '',
        sub: volResult.annualized !== null ? 'annualized, all history' : 'needs 3 snapshots',
      })}
      ${kpiTile({
        label: `Max Drawdown${infoTip('Largest peak-to-trough decline as a percentage of the prior peak. A value of -20% means your net worth fell 20% from a high point at some stage.')}`,
        value: dd !== null ? (dd === 0 ? '0%' : fmtPctNeg(dd * 100)) : '-',
        valueClass: dd === null ? '' : dd < 0 ? 'neg' : '',
        sub: dd !== null ? 'all history' : 'needs 2 snapshots',
      })}
      ${kpiTile({
        label: `Calmar${infoTip('CAGR divided by absolute max drawdown. Higher is better. Valued by FIRE investors evaluating sequence-of-returns risk. Requires 12+ months of CAGR and a drawdown.')}`,
        value: calmar !== null ? calmar.toFixed(2) : '-',
        valueClass: calmar === null ? '' : calmar >= 0 ? 'pos' : 'neg',
        sub: calmar !== null ? 'CAGR / |Max DD|' : 'needs CAGR and drawdown',
      })}
      ${kpiTile({
        label: `Sharpe${infoTip('(CAGR minus risk-free rate) divided by annualized volatility. Measures return per unit of total risk. Configure the risk-free rate in Settings.')}`,
        value: sharpe !== null ? sharpe.toFixed(2) : '-',
        valueClass: '',
        sub: sharpe !== null ? `rf = ${(riskFreeRate * 100).toFixed(1)}%` : 'needs 12+ months',
      })}
      ${kpiTile({
        label: `Sortino${infoTip('Like Sharpe, but uses only downside volatility (negative months). Higher Sortino than Sharpe means your losses are smaller than your gains. For quant and FIRE investors.')}`,
        value: sortino !== null ? sortino.toFixed(2) : '-',
        valueClass: '',
        sub: sortino !== null ? 'downside risk only' : 'needs 12+ months',
      })}
      ${kpiTile({
        label: `Avg Drawdown${infoTip('Average of all per-month drawdown fractions. Less extreme than max drawdown; shows typical underwater depth.')}`,
        value: avgDD !== null && avgDD < 0 ? fmtPctNeg(avgDD * 100) : avgDD === 0 ? '0%' : '-',
        valueClass: avgDD !== null && avgDD < 0 ? 'neg' : '',
        sub: avgDD !== null ? 'mean of all drawdown months' : 'needs 2 snapshots',
      })}
      ${kpiTile({
        label: `DD Duration${infoTip('Maximum number of consecutive months where the portfolio was below its prior peak. Shorter is better. For FIRE investors concerned with sequence of returns.')}`,
        value: ddDur > 0 ? `${ddDur} mo` : ddResult.series.length > 0 ? '0 mo' : '-',
        valueClass: '',
        sub: ddDur > 0 ? 'longest underwater streak' : 'no drawdown in history',
      })}
    `;

    // Drawdown chart
    _renderDrawdownChart(ddResult.series);

    // Rolling CAGR
    _renderRollingCagrChart(snaps);

    // Income analytics
    _renderIncomeAnalytics(txs, total, pd?.totalInv || 0);
  }

  // Bind advanced section open/close arrow
  const advancedEl = document.getElementById('an-advanced') as HTMLDetailsElement | null;
  if (advancedEl && !(advancedEl as HTMLDetailsElement & { _arrowBound?: boolean })._arrowBound) {
    (advancedEl as HTMLDetailsElement & { _arrowBound?: boolean })._arrowBound = true;
    advancedEl.addEventListener('toggle', () => {
      const arrow = document.getElementById('an-advanced-arrow');
      if (arrow) arrow.style.transform = advancedEl.open ? 'rotate(90deg)' : '';
    });
  }

  attachInfoTips(document.getElementById('analytics')!);
}

// ── Portfolio growth chart ─────────────────────────────────

function _renderGrowthChart(snaps: Snapshot[]): void {
  const C = resolvedT();
  const accounts = getAccounts();
  const chartA = accounts
    .filter((a) => snaps.some((sn) => ((sn[a.id || ''] as number) || 0) > 0))
    .map((a) => ({ key: a.id || '', label: a.label || '', color: a.color || '#888' }));

  const view = _anGrowthRange === 'all' ? snaps : snaps.slice(-parseInt(_anGrowthRange));

  _destroyChart('c-an-growth');
  if (view.length < 2) {
    document.getElementById('an-growth-legend')!.innerHTML = '';
    return;
  }

  const totalData = view.map((s) => snapTotal(s));

  document.getElementById('an-growth-legend')!.innerHTML = renderLegendHtml([
    { label: 'Total', color: C.brand, dashed: false },
    ...chartA.map((a) => ({ label: a.label, color: a.color })),
  ]);

  CH['c-an-growth'] = new Chart(document.getElementById('c-an-growth') as HTMLCanvasElement, {
    type: 'line',
    data: {
      labels: view.map((s) => fmtMon(s.date)),
      datasets: [
        {
          label: 'Total',
          data: totalData,
          borderColor: C.brand,
          backgroundColor: C.brandWeak,
          borderWidth: 2,
          pointRadius: view.length > 24 ? 0 : 3,
          fill: true,
          tension: 0.3,
          order: 0,
        },
        ...chartA.map((a) => ({
          label: a.label,
          data: view.map((sn) => (sn[a.key] as number) || 0),
          borderColor: safeColor(a.color),
          backgroundColor: 'transparent',
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false,
          tension: 0.3,
          order: 1,
        })),
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

  bindLegendToggle(document.getElementById('an-growth-legend')!, CH['c-an-growth'], {
    skipIndex: [0],
  });
}

function _attachGrowthRangeToggle(snaps: Snapshot[]): void {
  const toggle = document.getElementById('an-growth-range-toggle') as
    (HTMLElement & { _bound?: boolean }) | null;
  if (!toggle || toggle._bound) return;
  toggle._bound = true;
  toggle.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-range]') as HTMLElement | null;
    if (!btn) return;
    const newRange = (btn.dataset.range as '12' | '36' | 'all') || 'all';
    if (newRange === _anGrowthRange) return;
    _anGrowthRange = newRange;
    toggle.querySelectorAll('.btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    _renderGrowthChart(snaps);
  });
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
  const toggle = document.getElementById('an-contrib-range-toggle') as
    (HTMLElement & { _bound?: boolean }) | null;
  if (!toggle || toggle._bound) return;
  toggle._bound = true;
  toggle.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-range]') as HTMLElement | null;
    if (!btn) return;
    const newRange = (btn.dataset.range as '12' | '36' | 'all') || 'all';
    if (newRange === _anContribRange) return;
    _anContribRange = newRange;
    toggle.querySelectorAll('.btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    _renderContribChart(points);
  });
}

// ── Monthly return heatmap ─────────────────────────────────

function _renderHeatmap(snaps: Snapshot[]): void {
  const heatmapEl = document.getElementById('an-heatmap');
  const noteEl = document.getElementById('an-heatmap-note');
  if (!heatmapEl) return;

  const volResult = annualizedVolatility(snaps);
  const weighted = weightedMonthlyReturns(volResult.monthlyReturns);

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

  // Get year range
  const years = Array.from(new Set(weighted.map((m) => m.year))).sort((a, b) => a - b);
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

  let html = `<table class="an-heatmap-table" style="border-collapse:collapse;font-size:11px;min-width:${12 * 46 + 60}px">`;
  // Header row
  html +=
    '<thead><tr><th style="width:52px;text-align:left;padding:2px 4px;color:var(--ink-3)"></th>';
  for (const ml of MONTH_LABELS) {
    html += `<th style="width:42px;text-align:center;padding:2px 2px;color:var(--ink-3);font-weight:normal">${ml}</th>`;
  }
  html += '</tr></thead><tbody>';

  for (const year of years) {
    html += `<tr><td style="padding:2px 4px;color:var(--ink-2);font-weight:500">${year}</td>`;
    for (let mo = 1; mo <= 12; mo++) {
      const entry = lookup.get(`${year}-${mo}`);
      if (!entry) {
        html += `<td style="padding:1px 2px"><div style="width:40px;height:28px;border-radius:${R.xs}px;background:var(--line)"></div></td>`;
        continue;
      }
      const intensity = Math.min(Math.abs(entry.weightedReturn) / maxAbs, 1);
      const rawPct = entry.return * 100;
      const color = _heatmapColor(entry.weightedReturn, intensity, isDark);
      const textColor = _heatmapTextColor(intensity, entry.weightedReturn);
      const sign = rawPct > 0 ? '+' : '';
      html += `<td style="padding:1px 2px" title="${year}-${String(mo).padStart(2, '0')}: ${sign}${rawPct.toFixed(1)}%">
        <div style="width:40px;height:28px;border-radius:${R.xs}px;background:${color};display:flex;align-items:center;justify-content:center">
          <span style="color:${textColor};font-size:10px;font-weight:500">${sign}${rawPct.toFixed(0)}%</span>
        </div>
      </td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  heatmapEl.innerHTML = html;
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

// ── Annual return table ────────────────────────────────────

function _renderAnnualTable(snaps: Snapshot[]): void {
  const card = document.getElementById('an-annual-table-card');
  const el = document.getElementById('an-annual-table');
  if (!el) return;

  const rows = annualReturns(snaps);
  if (rows.length === 0) {
    if (card) card.style.display = 'none';
    return;
  }
  if (card) card.style.display = '';

  // Find max abs return for bar scale
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.return)), 0.001);

  const C = resolvedT();
  let html = `<div class="tbl" role="table" aria-label="Annual returns">
    <div role="row" class="tbl-head" style="display:grid;grid-template-columns:60px 100px 1fr;gap:8px;padding:4px 8px;font-size:11px;color:var(--ink-3)">
      <div role="columnheader">Year</div>
      <div role="columnheader">Return</div>
      <div role="columnheader"></div>
    </div>`;
  for (const row of rows.slice().reverse()) {
    const pct = row.return * 100;
    const barWidth = Math.round((Math.abs(row.return) / maxAbs) * 80);
    const barColor = pct >= 0 ? C.pos : C.neg;
    const cls = pct >= 0 ? 'pos' : 'neg';
    html += `<div role="row" style="display:grid;grid-template-columns:60px 100px 1fr;gap:8px;padding:5px 8px;align-items:center;border-top:1px solid var(--line)">
      <div role="cell" style="font-weight:500">${row.year}</div>
      <div role="cell" class="${cls}" style="font-weight:500">${pct > 0 ? '+' : ''}${pct.toFixed(1)}%</div>
      <div role="cell">
        <div style="height:10px;width:${barWidth}%;min-width:2px;background:${barColor};border-radius:${R.xs}px"></div>
      </div>
    </div>`;
  }
  html += '</div>';
  el.innerHTML = html;
}

// ── Allocation donuts ──────────────────────────────────────

type AllocDim = 'class' | 'acct' | 'region' | 'sector' | 'currency';

function _renderAllocationDonuts(holdings: Holding[], pd: PortfolioData | null): void {
  const dims: AllocDim[] = ['class', 'acct', 'region', 'sector', 'currency'];
  for (const dim of dims) {
    _renderAllocDonut(dim, holdings, pd);
    _attachAllocToggle(dim);
  }
}

function _getHoldingSlices(
  holdings: Holding[],
  pd: PortfolioData | null,
  dim: Exclude<AllocDim, 'acct' | 'currency'>,
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

function _getCurrencySlices(
  txs: Transaction[],
  mode: 'active' | 'all',
  holdings: Holding[],
): { label: string; value: number; color: string }[] {
  const activeIsins =
    mode === 'active' ? new Set(holdings.filter((h) => h.active).map((h) => h.isin)) : null;
  const buckets = new Map<string, number>();
  for (const tx of txs) {
    if (tx.type !== 'BUY') continue;
    if (activeIsins && !activeIsins.has(tx.isin)) continue;
    const cur = tx.currency || 'EUR';
    buckets.set(cur, (buckets.get(cur) || 0) + Math.abs(tx.amount));
  }
  const CURRENCY_COLORS: Record<string, string> = {
    EUR: '#2a78d6',
    USD: '#1baf7a',
    GBP: '#9b59b6',
    CHF: '#e67e22',
    JPY: '#e74c3c',
    SEK: '#3498db',
    DKK: '#27ae60',
    NOK: '#8e44ad',
  };
  return Array.from(buckets.entries())
    .map(([label, value], i) => ({
      label,
      value,
      color: CURRENCY_COLORS[label] || `hsl(${(i * 60) % 360}, 60%, 50%)`,
    }))
    .sort((a, b) => b.value - a.value);
}

function _renderAllocDonut(dim: AllocDim, holdings: Holding[], pd: PortfolioData | null): void {
  const mode = _allocMode[dim];
  let slices: { label: string; value: number; color: string }[] = [];

  if (dim === 'acct') {
    slices = _getAccountSlices(_lastSnaps, mode);
  } else if (dim === 'currency') {
    slices = _getCurrencySlices(_lastTxs, mode, holdings);
  } else {
    slices = _getHoldingSlices(holdings, pd, dim as Exclude<AllocDim, 'acct' | 'currency'>, mode);
  }

  const canvasId = `c-an-alloc-${dim}`;
  const legendId = `an-alloc-${dim}-legend`;
  const cardId =
    dim === 'sector'
      ? 'an-alloc-sector-card'
      : dim === 'currency'
        ? 'an-alloc-currency-card'
        : null;

  // Hide card if no data
  if (slices.length === 0) {
    if (cardId) {
      const cardEl = document.getElementById(cardId);
      if (cardEl) cardEl.style.display = 'none';
    }
    return;
  }
  if (cardId) {
    const cardEl = document.getElementById(cardId);
    if (cardEl) cardEl.style.display = '';
  }

  const total = slices.reduce((s, x) => s + x.value, 0);
  const C = resolvedT();

  _destroyChart(canvasId);
  const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
  if (!canvas) return;

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
            label: (ctx) => {
              const val = ctx.raw as number;
              const pct = total > 0 ? (val / total) * 100 : 0;
              return ` ${fmtEur(val)} (${fmtPctVal(pct)})`;
            },
            labelColor: tooltipSwatch(C.surface),
          },
        },
      },
    },
  });

  const legendEl = document.getElementById(legendId);
  if (legendEl) {
    legendEl.innerHTML = renderLegendHtml(
      slices.map((s) => ({
        label: s.label,
        meta: total > 0 ? fmtPctVal((s.value / total) * 100) : '0%',
        color: s.color,
      })),
    );
  }

  // Render toggle button
  _renderAllocToggleBtn(dim);
}

function _renderAllocToggleBtn(dim: AllocDim): void {
  const wrapId = `an-alloc-${dim}-toggle-wrap`;
  const wrapEl = document.getElementById(wrapId);
  if (!wrapEl) return;
  const mode = _allocMode[dim];
  wrapEl.innerHTML = `<button class="btn btn-ghost btn-sm" data-alloc-dim="${dim}" style="font-size:11px;padding:2px 6px">${mode === 'active' ? 'Active only' : 'All assets'}</button>`;
  if (!(wrapEl as HTMLElement & { _dimBound?: boolean })._dimBound) {
    (wrapEl as HTMLElement & { _dimBound?: boolean })._dimBound = true;
    wrapEl.addEventListener('click', () => {
      const holdings = getHoldings();
      const pd = _lastPd;
      _allocMode[dim] = _allocMode[dim] === 'active' ? 'all' : 'active';
      _renderAllocDonut(dim, holdings, pd);
    });
  }
}

function _attachAllocToggle(dim: AllocDim): void {
  _renderAllocToggleBtn(dim);
}

// ── Drift from target ──────────────────────────────────────

function _renderDrift(holdings: Holding[], pd: PortfolioData | null, latestSnap: Snapshot): void {
  const driftCard = document.getElementById('an-drift-card');
  const driftEl = document.getElementById('an-drift');
  if (!driftEl || !driftCard) return;

  if (!pd || holdings.length === 0) {
    driftCard.style.display = 'none';
    return;
  }

  const total = snapTotal(latestSnap);
  const entries = computeDrift(holdings, pd.etfs, total);

  if (entries.length === 0) {
    driftCard.style.display = 'none';
    return;
  }
  driftCard.style.display = '';

  // Find max abs drift for bar scale
  const maxAbs = Math.max(...entries.map((e) => Math.abs(e.driftPct)), 1);

  let html = `<div class="tbl" role="table" aria-label="Drift from target allocation">
    <div role="row" style="display:grid;grid-template-columns:100px 80px 80px 1fr;gap:8px;padding:4px 8px;font-size:11px;color:var(--ink-3)">
      <div role="columnheader">Holding</div>
      <div role="columnheader" style="text-align:right">Target</div>
      <div role="columnheader" style="text-align:right">Actual</div>
      <div role="columnheader">Drift</div>
    </div>`;

  for (const e of entries) {
    const driftCls = e.driftPct > 0 ? 'neg' : e.driftPct < 0 ? 'pos' : '';
    const barWidth = Math.round((Math.abs(e.driftPct) / maxAbs) * 80);
    const barColor = e.driftPct > 0 ? 'var(--neg)' : 'var(--pos)';
    const sign = e.driftPct > 0 ? '+' : '';
    html += `<div role="row" style="display:grid;grid-template-columns:100px 80px 80px 1fr;gap:8px;padding:5px 8px;align-items:center;border-top:1px solid var(--line)">
      <div role="cell" style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(e.name || e.shortName)}">${esc(e.shortName)}</div>
      <div role="cell" style="text-align:right">${fmtPctVal(e.targetPct)}</div>
      <div role="cell" style="text-align:right">${fmtPctVal(e.actualPct)}</div>
      <div role="cell" style="display:flex;align-items:center;gap:6px">
        <span class="${driftCls}" style="font-weight:500;min-width:44px">${sign}${fmtPctVal(e.driftPct)}</span>
        <div style="height:8px;width:${barWidth}%;min-width:2px;background:${barColor};border-radius:${R.xs}px"></div>
      </div>
    </div>`;
  }
  html += '</div>';
  driftEl.innerHTML = html;
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
          reverse: true,
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

  document.getElementById('an-kpis-income')!.innerHTML = `
    <div style="width:100%;padding:.25rem 0 .4rem;font-size:11px;color:var(--ink-3);font-weight:500;text-transform:uppercase;letter-spacing:.04em">Income (Dividends and Interest)</div>
    ${kpiTile({
      label: `Trailing 12M Income${infoTip('Sum of all DIVIDEND and INTEREST transactions received in the last 12 months.')}`,
      value: fmtEur2(metrics.trailing12m),
      sub: 'last 12 months',
    })}
    ${
      metrics.yieldPct !== null
        ? kpiTile({
            label: `Dividend Yield${infoTip('Trailing 12-month income divided by current portfolio value. Shows income as a percentage of your investment.')}`,
            value: fmtPctNeg(metrics.yieldPct * 100),
            sub: 'trailing 12M / portfolio value',
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
            label: `Income Growth (YoY)${infoTip('Year-over-year change in total income. Positive growth means your income stream is expanding. Relevant for dividend growth investors and FIRE planning.')}`,
            value: fmtPctSigned(metrics.yoyGrowth * 100),
            valueClass: metrics.yoyGrowth >= 0 ? 'pos' : 'neg',
            sub: 'this year vs last year',
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
}

function _renderIncomeChart(monthlyBreakdown: { month: string; amount: number }[]): void {
  const canvas = document.getElementById('c-an-income') as HTMLCanvasElement | null;
  if (!canvas) return;
  _destroyChart('c-an-income');

  // Show last 12 months
  const last12 = monthlyBreakdown.slice(-12);
  if (last12.length === 0) return;

  const C = resolvedT();
  CH['c-an-income'] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: last12.map((p) => fmtMon(p.month)),
      datasets: [
        {
          label: 'Income',
          data: last12.map((p) => p.amount),
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
}
