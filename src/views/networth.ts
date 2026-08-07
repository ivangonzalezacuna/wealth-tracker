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
import { getACCTSList, FORECAST_RANGE_LABELS } from '../constants';
import {
  getAccounts,
  getTotalAnnualContrib,
  getGoals,
  getSettings,
  getHoldings,
} from '../store/config';
import { primaryInvestmentValue, allInvestmentAccountsValue } from '../model/accounts';
import { annualizeContrib, INTERVAL_LABELS } from '../model/contributions';
import {
  cagr,
  findYoYSnapshot,
  monthlyGrowthHistory,
  twr,
  xirr,
  annualizedVolatility,
  maxDrawdownFull,
  cagrPerAccount,
  totalReturn,
  absoluteGain,
  ytdReturn,
  downsideDeviation,
  sharpeRatio,
  sortinoRatio,
  calmarRatio,
  averageDrawdown,
  drawdownDuration,
  rollingCagrSeries,
  rollingVolatilitySeries,
  annualReturns,
  monthlyReturns,
  monthlyReturnSeries,
  trailing12mIncome,
  dividendYieldPct,
  dividendGrowthYoY,
  dividendCagr,
  incomeByMonth,
} from '../model/insights';
import type { MonthlyGrowthPoint, DrawdownPoint } from '../model/insights';
import {
  formatMonthsEta,
  forecastMultiAccountSeries,
  forecastMonthsToTargetMulti,
} from '../model/forecast';
import type { AccountForecastInput } from '../model/forecast';
import type { Snapshot, PortfolioData, Account, Transaction } from '../types';
import Chart from 'chart.js/auto';
import { T, R, resolvedT, HUE, DATA_PALETTE } from '../theme';
import { bindLegendToggle, renderLegendHtml, TOOLTIP_BOX, tooltipSwatch } from './chartLegend';
import { infoTip, attachInfoTips } from '../ui/infoTip';

const CH: Record<string, Chart> = {};
let _nwRange: '12' | '36' | 'all' = 'all';
let _nwGrowthRange: '12' | '36' | 'all' = 'all';
let _nwGrowthPoints: MonthlyGrowthPoint[] = [];
let _fcRange: '60' | '120' | '240' = '60'; // 5y / 10y / 20y forecast horizon
let _inflationRate = 0; // annual inflation % for real-return forecast overlay
let _lastSnaps: Snapshot[] = [];
let _lastAccounts: Account[] = [];
let _activeGoalIdx = 0; // which goal tab is selected in the consolidated goals card

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
  const total = snapTotal(s);
  const accountInputs = _buildAccountForecastInputs(s, accounts);

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
    if (total >= target) continue;

    const pctComplete = Math.min(100, Math.round((total / target) * 100));
    const remaining = Math.max(0, target - total);
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
    const panelHtml = `
      <div class="row"><div class="row-label">Target</div><div class="row-val">${fmtEur(target)}</div></div>
      <div class="row"><div class="row-label">Current</div><div class="row-val">${fmtEur(total)}</div></div>
      <div class="row"><div class="row-label">Remaining</div><div class="row-val">${fmtEur(remaining)}</div></div>
      <div style="margin:.75rem 0">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
          <span>${fmtPctVal(Math.min(100, (total / target) * 100))} complete</span>
          <span>${fmtEur(total)} / ${fmtEur(target)}</span>
        </div>
        <div style="height:8px;background:var(--surface-3);border-radius:var(--radius-xs);overflow:hidden">
          <div style="width:${pctComplete}%;height:100%;background:${pctComplete >= 100 ? 'var(--pos)' : isOnTrack === false ? 'var(--warn)' : 'var(--brand)'};border-radius:var(--radius-xs);transition:width .3s"></div>
        </div>
      </div>
      <div class="row" style="align-items:flex-start"><div class="row-label">ETA</div><div class="row-val" style="font-size:12px;text-align:left;flex-shrink:1;overflow-wrap:break-word;word-break:break-word;min-width:0">${etaText}${_inflationRate > 0 ? '<br><span class="note" style="font-size:11px">ETA is in nominal terms; inflation is not factored in.</span>' : ''}</div></div>`;
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
export function renderNW(
  pd: PortfolioData | null,
  snaps: Snapshot[],
  txs: Transaction[] = [],
): void {
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

  // Extra KPIs: YoY + CAGR
  const firstTotal = snaps.length > 0 ? snapTotal(snaps[0]) : 0;
  const firstDate = snaps[0]?.date || '';
  const latestDate = s.date || '';
  const monthsSpan = _monthsDiff(firstDate, latestDate);

  const yoyData = findYoYSnapshot(snaps);
  const yoyAbs = yoyData ? total - yoyData.total : null;
  const yoyPct =
    yoyData && yoyData.total > 0 ? ((total - yoyData.total) / yoyData.total) * 100 : null;

  const cagrVal = cagr(firstTotal, total, monthsSpan);
  const twrVal = twr(snaps, pd?.monthly || {});
  // Use all investment-type accounts for the IRR terminal value so multi-account
  // portfolios are not understated. Falls back to null (IRR hidden) when no
  // investment account has a snapshot value.
  const latestInvestmentValue = allInvestmentAccountsValue(s, accounts);
  const terminalDate = s.date && s.date.length === 7 ? `${s.date}-01` : s.date;
  const investmentFlows = txs
    .map((tx) => {
      const date = tx.date && tx.date.length === 7 ? `${tx.date}-01` : tx.date;
      if (!date) return null;
      // Only BUY cash outflows are included. The current portfolio value (snapshot)
      // already reflects the state after sells, so SELL proceeds must NOT be added
      // here or they would be double-counted against the terminal value.
      if (tx.type === 'BUY')
        return { date, amount: -(Math.abs(tx.amount) + Math.abs(tx.fee || 0)) };
      return null;
    })
    .filter((cf): cf is { date: string; amount: number } => !!cf);
  if (latestInvestmentValue !== null) {
    investmentFlows.push({ date: terminalDate, amount: latestInvestmentValue });
  }
  const irrVal = latestInvestmentValue !== null ? xirr(investmentFlows) : null;
  // Keep primaryInvestmentValue for the growth breakdown chart (contribution tracking
  // still targets only the primary investment account).
  const latestPrimaryValue = primaryInvestmentValue(s, accounts);

  // Analytics: total return, absolute gain, YTD
  const totalReturnVal = totalReturn(firstTotal, total);
  const absGainVal = absoluteGain(total, firstTotal);
  const ytdReturnVal = ytdReturn(snaps);

  // Growth split (contributions vs market)
  const growthPoints = pd
    ? monthlyGrowthHistory(snaps, accounts, pd.monthly, primaryInvestmentValue)
    : [];
  _nwGrowthPoints = growthPoints;

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
        <div class="kpi-label"><span class="kpi-label-text">Liquid</span>${infoTip('Net worth accessible now, excluding pension and retirement accounts marked as locked.')}</div>
        <div class="kpi-val">${fmtEur2(liquid)}</div>
        <div class="kpi-sub">${fmtPctVal(total > 0 ? (liquid / total) * 100 : 0)} of total</div>
      </div>
      <div class="kpi">
        <div class="kpi-label"><span class="kpi-label-text">Locked</span>${infoTip('Funds in pension/retirement accounts not accessible until retirement age.')}</div>
        <div class="kpi-val">${fmtEur2(locked)}</div>
        <div class="kpi-sub">${lockedSub}</div>
      </div>`;
    })()}
    ${
      yoyAbs !== null
        ? `
      ${kpiTile({
        label: 'YoY',
        tip: 'Year-over-Year: Change in total net worth compared to the same month one year ago.',
        value: fmtEurSigned(yoyAbs, 2),
        valueClass: yoyAbs >= 0 ? 'pos' : 'neg',
        sub: `${yoyPct !== null ? fmtPctSigned(yoyPct) : '-'} vs ${fmtMon(yoyData!.snap.date)}`,
      })}`
        : ''
    }
    ${
      cagrVal !== null
        ? `
      ${kpiTile({
        label: 'CAGR (balance)',
        tip: 'Compound annual growth rate of your total tracked net worth from your first recorded snapshot to today. This is a balance-growth metric, not a return on invested capital. See IRR for the investment return. Treat this number with caution until you have at least 2-3 years of history.',
        value: fmtPctNeg(cagrVal * 100),
        valueClass: cagrVal >= 0 ? 'pos' : 'neg',
        sub: `${monthsSpan} months${monthsSpan < 24 ? ' (early data)' : ''}`,
      })}`
        : ''
    }
    ${kpiTile({
      label: 'TWR',
      tip: 'Time-weighted return, linked across snapshot periods and net of recorded contributions. Measures investment performance per period, independently of how much money was contributed or when. TWR can be negative even when your total balance is positive: this happens when you made large deposits just before a recovery, so the gains came from your timing, not from the assets themselves performing well.',
      value: twrVal !== null ? fmtPctNeg(twrVal * 100) : '-',
      valueClass: twrVal === null ? '' : twrVal >= 0 ? 'pos' : 'neg',
      sub:
        twrVal !== null
          ? `${monthsSpan} months, not annualized${monthsSpan < 24 ? ' (early data)' : ''}`
          : 'needs 2 snapshots and valid starting value',
    })}
    ${kpiTile({
      label: 'IRR (investments)',
      tip: 'Money-weighted annual return on invested capital (XIRR). Heavily influenced by the size and timing of your contributions: large deposits just before a good period inflate this number, while large deposits before a bad period deflate it. This figure is unstable and can swing wildly when history is under 2 years. Uses BUY cash outflows plus current primary investment value. SELL and dividend cash movements stay inside the account value and are not counted separately. If you sold positions and withdrew the proceeds from your tracked accounts, those cash flows are not modelled as inflows, and this figure may overstate your actual investment performance.',
      value: irrVal !== null ? fmtPctNeg(irrVal * 100) : '-',
      valueClass: irrVal === null ? '' : irrVal >= 0 ? 'pos' : 'neg',
      sub:
        irrVal !== null
          ? `XIRR, annualized${monthsSpan < 24 ? ' (early data, interpret with caution)' : ''}`
          : 'needs complete cash-flow series',
    })}
    ${
      totalReturnVal !== null
        ? kpiTile({
            label: 'Total return',
            tip: 'Total gain as a percentage of your first recorded net worth. Shows how much your net worth has grown since you started tracking.',
            value: fmtPctNeg(totalReturnVal * 100),
            valueClass: totalReturnVal >= 0 ? 'pos' : 'neg',
            sub: fmtEurSigned(absGainVal, 2) + ' since ' + fmtMon(snaps[0].date),
          })
        : ''
    }
    ${
      ytdReturnVal !== null
        ? kpiTile({
            label: 'YTD',
            tip: 'Year-to-date return: change in total net worth from the snapshot nearest to January 1 of the current year.',
            value: fmtPctNeg(ytdReturnVal * 100),
            valueClass: ytdReturnVal >= 0 ? 'pos' : 'neg',
            sub: 'since start of year',
          })
        : ''
    }
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

  // Growth breakdown chart
  _renderGrowthChart();

  // Bind growth range toggle once
  _attachNWGrowthRangeToggle();

  // Goal progress cards (one per named goal)
  _renderGoalCards();

  // Forecast chart
  _renderForecastChart(snaps, accounts);

  // Level 2 + 3 analytics cards
  _renderAnalyticsCards(snaps, txs);

  // Allocation card
  _renderAllocationCard(snaps, accounts, pd);

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
    legendEl.innerHTML = renderLegendHtml([
      { label: 'Contributed', color: C.brand },
      { label: 'Market movement', color: C.pos, color2: C.neg },
    ]);
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
    const newRange = (btn.dataset.range as '60' | '120' | '240') || '60';
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

/** Months between two YYYY-MM date strings. */
function _monthsDiff(a: string, b: string): number {
  if (!a || !b) return 0;
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
}

// ── Level 2 + 3 analytics cards ───────────────────────────────────

function _renderAnalyticsCards(snaps: Snapshot[], txs: Transaction[]): void {
  const el = document.getElementById('nw-analytics');
  if (!el) return;

  const months = snaps.length >= 2 ? _monthsDiff(snaps[0].date, snaps[snaps.length - 1].date) : 0;
  const settings = getSettings();
  const rfRaw = parseFloat(settings.riskFreeRate ?? '2');
  const riskFreeRate = isFinite(rfRaw) ? rfRaw / 100 : 0.02;
  const hasEnough12 = months >= 12;
  const hasEnough24 = months >= 24;

  // Annual returns table (always shown when there is multi-year data)
  const annualRets = annualReturns(snaps);

  // Monthly return series for heatmap
  const returnSeries = monthlyReturnSeries(snaps);

  // Full drawdown series
  const ddFull = maxDrawdownFull(snaps);
  const ddSeries: DrawdownPoint[] = ddFull?.series ?? [];

  // Risk-adjusted metrics (require 12+ months)
  const volatility = annualizedVolatility(snaps);
  const maxDd = maxDrawdownFull(snaps)?.scalar ?? null;
  const cagrSnaps =
    snaps.length >= 2
      ? cagr(
          snapTotal(snaps[0]),
          snapTotal(snaps[snaps.length - 1]),
          _monthsDiff(snaps[0].date, snaps[snaps.length - 1].date),
        )
      : null;
  const monthlyRets = snaps.length >= 2 ? (monthlyReturns(snaps) ?? []) : [];
  const downsideDev = downsideDeviation(monthlyRets);
  const avgDd = averageDrawdown(ddSeries);
  const ddDuration = drawdownDuration(ddSeries);
  const calmar = cagrSnaps !== null && maxDd !== null ? calmarRatio(cagrSnaps, maxDd) : null;
  const sharpe =
    cagrSnaps !== null && volatility !== null
      ? sharpeRatio(cagrSnaps, volatility, riskFreeRate)
      : null;
  const sortino =
    cagrSnaps !== null && downsideDev !== null
      ? sortinoRatio(cagrSnaps, downsideDev, riskFreeRate)
      : null;

  // Rolling CAGR (36+ months)
  const rollingCagr36 = months >= 36 ? rollingCagrSeries(snaps, 36) : [];

  // Rolling volatility (24+ months)
  const rollingVol24 = months >= 24 ? rollingVolatilitySeries(snaps, 12) : [];

  // Income analytics
  const incomeTransactions = txs.filter((tx) => tx.type === 'DIVIDEND' || tx.type === 'INTEREST');
  const hasIncome = incomeTransactions.length > 0;
  const trailing12 = hasIncome ? trailing12mIncome(txs) : 0;
  const latestTotal = snaps.length > 0 ? snapTotal(snaps[snaps.length - 1]) : 0;
  const divYield = hasIncome && latestTotal > 0 ? dividendYieldPct(trailing12, latestTotal) : null;
  const divGrowth = hasIncome ? dividendGrowthYoY(txs) : null;
  const divCagr = hasIncome ? dividendCagr(txs) : null;
  const incomeByMonthData = hasIncome ? incomeByMonth(txs, 12) : [];

  // ── Level 2: Performance Details card ──
  const noDataMsg = (req: string) =>
    `<p class="note" style="margin:.5rem 0">Need at least ${req} of history.</p>`;

  const annualRetTableHtml =
    annualRets.length > 0
      ? `<table class="tbl-simple" style="width:100%;font-size:13px;border-collapse:collapse;margin-top:.5rem">
          <thead><tr style="color:var(--ink-3);font-size:11px;text-align:left">
            <th style="padding:4px 8px">Year</th>
            <th style="padding:4px 8px">Return</th>
            <th style="padding:4px 8px;width:120px"></th>
          </tr></thead>
          <tbody>
            ${annualRets
              .map((r) => {
                const barW = Math.min(100, Math.abs(r.return) * 300);
                const barColor = r.return >= 0 ? 'var(--pos)' : 'var(--neg)';
                return `<tr style="border-top:1px solid var(--line-2)">
                  <td style="padding:4px 8px">${r.year}</td>
                  <td style="padding:4px 8px;font-weight:500" class="${r.return >= 0 ? 'pos' : 'neg'}">${fmtPctNeg(r.return * 100)}</td>
                  <td style="padding:4px 8px">
                    <div style="height:10px;background:var(--line-2);border-radius:3px;overflow:hidden">
                      <div style="height:100%;width:${barW}%;background:${barColor};border-radius:3px"></div>
                    </div>
                  </td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>`
      : noDataMsg('2 years');

  const heatmapHtml = (() => {
    if (!hasEnough12 || returnSeries.length === 0) return noDataMsg('12 months');
    const C = resolvedT();
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    const years = [...new Set(returnSeries.map((r) => r.year))].sort((a, b) => a - b);
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
    const byKey = new Map(returnSeries.map((r) => [`${r.year}-${r.month}`, r.ret]));
    const annualByYear = new Map(annualRets.map((r) => [r.year, r.return]));

    // For years without a full-year comparison (e.g. the first year in the series),
    // compute the compounded return from available monthly data as a fallback total.
    const compoundedByYear = new Map<number, number>();
    for (const y of years) {
      if (annualByYear.has(y)) continue;
      const monthsForYear = returnSeries.filter((r) => r.year === y);
      if (monthsForYear.length === 0) continue;
      compoundedByYear.set(
        y,
        monthsForYear.reduce((prod, r) => prod * (1 + r.ret), 1) - 1,
      );
    }

    const cellStyle = (ret: number | undefined, isAnnual = false): string => {
      if (ret === undefined) {
        return [
          `background:${C.surface3}`,
          `color:transparent`,
          `border-radius:var(--radius-xs)`,
        ].join(';');
      }
      const intensity = Math.min(1, Math.abs(ret) * 10);
      const hue = ret >= 0 ? HUE.pos : HUE.neg;
      let bg: string;
      let text: string;
      if (isDark) {
        const lightness = 10 + intensity * 40;
        const sat = 10 + intensity * 75;
        bg = `hsl(${hue},${sat.toFixed(0)}%,${lightness.toFixed(0)}%)`;
        text = intensity > 0.35 ? C.white : C.ink3;
      } else {
        const lightness = 97 - intensity * 47;
        const sat = intensity * 88;
        bg = `hsl(${hue},${sat.toFixed(0)}%,${lightness.toFixed(0)}%)`;
        text = lightness <= 62 ? C.white : C.ink;
      }
      const fw = isAnnual ? 'font-weight:600;' : '';
      return [`background:${bg}`, `color:${text}`, `border-radius:var(--radius-xs)`, fw]
        .filter(Boolean)
        .join(';');
    };

    const gridCols = `grid-template-columns:44px repeat(12,40px) 62px`;

    const header = `<div style="display:grid;${gridCols};gap:2px;align-items:end;margin-bottom:3px;padding:0 2px">
      <div style="font-size:10px;color:${C.ink3};font-weight:500;padding-bottom:2px">Year</div>
      ${MONTH_LABELS.map((m) => `<div style="font-size:9px;color:${C.ink3};font-weight:500;text-align:center;padding-bottom:2px">${m}</div>`).join('')}
      <div style="font-size:9px;color:${C.ink3};font-weight:600;text-align:center;padding-bottom:2px">Total</div>
    </div>`;

    const rows = years
      .map((y) => {
        const cells = Array.from({ length: 12 }, (_, i) => {
          const ret = byKey.get(`${y}-${i + 1}`);
          const style = cellStyle(ret);
          const txt = ret !== undefined ? fmtPctNeg(ret * 100) : '';
          return `<div style="padding:4px 1px;font-size:10px;text-align:center;${style};font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden">${txt}</div>`;
        });
        const annualRet = annualByYear.get(y) ?? compoundedByYear.get(y);
        const annualStyle = cellStyle(annualRet, true);
        const annualTxt = annualRet !== undefined ? fmtPctNeg(annualRet * 100) : '';
        return `<div style="display:grid;${gridCols};gap:2px;align-items:stretch;margin-bottom:2px;padding:0 2px">
          <div style="font-size:11px;color:${C.ink2};font-weight:500;display:flex;align-items:center">${y}</div>
          ${cells.join('')}
          <div style="padding:4px 3px;font-size:10px;text-align:center;${annualStyle};font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden">${annualTxt}</div>
        </div>`;
      })
      .join('');

    const legendSteps = 6;
    const buildLegendSwatches = (hue: number): string =>
      Array.from({ length: legendSteps }, (_, i) => {
        const intensity = (i + 1) / legendSteps;
        let bg: string;
        if (isDark) {
          const lightness = 10 + intensity * 40;
          const sat = 10 + intensity * 75;
          bg = `hsl(${hue},${sat.toFixed(0)}%,${lightness.toFixed(0)}%)`;
        } else {
          const lightness = 97 - intensity * 47;
          const sat = intensity * 88;
          bg = `hsl(${hue},${sat.toFixed(0)}%,${lightness.toFixed(0)}%)`;
        }
        return `<div style="width:14px;height:14px;border-radius:3px;background:${bg}"></div>`;
      }).join('');

    const legend = `<div style="display:flex;align-items:center;gap:5px;margin-top:10px;padding:0 2px">
      <span style="font-size:10px;color:${C.ink3}">loss</span>
      ${buildLegendSwatches(HUE.neg)}
      <div style="width:14px;height:14px;border-radius:3px;background:${C.surface3}"></div>
      ${buildLegendSwatches(HUE.pos)}
      <span style="font-size:10px;color:${C.ink3}">gain</span>
    </div>`;

    return `<div style="overflow-x:auto;margin-top:.5rem;padding-bottom:.25rem"><div style="min-width:586px">${header}${rows}${legend}</div></div>`;
  })();

  // ── Level 3: Advanced Analytics card ──
  const rfNote = settings.riskFreeRate
    ? `using ${rfRaw}% risk-free rate`
    : `using default 2% risk-free rate, <a href="#settings" style="color:var(--accent)">configure in Settings</a>`;

  const advancedBody = `
    <div style="margin-bottom:1rem">
      <div style="font-size:12px;font-weight:600;color:var(--ink-2);text-transform:uppercase;letter-spacing:.04em;margin-bottom:.5rem">Risk</div>
      <div class="kpi-row" style="margin-bottom:.75rem">
        ${kpiTile({
          label: 'Volatility',
          tip: 'Annualized standard deviation of monthly net-worth returns. Higher means more month-to-month variation.',
          value: volatility !== null ? fmtPctNeg(volatility * 100) : '-',
          sub: volatility !== null ? 'annualized' : 'needs 3 snapshots',
        })}
        ${kpiTile({
          label: 'Max drawdown',
          tip: 'Largest peak-to-trough decline across all history.',
          value: maxDd !== null ? (maxDd === 0 ? '0%' : fmtPctNeg(maxDd * 100)) : '-',
          valueClass: maxDd !== null && maxDd < 0 ? 'neg' : '',
          sub: maxDd !== null ? 'all history' : 'needs 2 snapshots',
        })}
        ${kpiTile({
          label: 'Avg drawdown',
          tip: 'Average of all per-month drawdown values. A less extreme version of max drawdown, showing the typical depth when underwater.',
          value: avgDd !== null ? fmtPctNeg(avgDd * 100) : '-',
          valueClass: avgDd !== null && avgDd < 0 ? 'neg' : '',
          sub: avgDd !== null ? 'all history' : 'needs 2 snapshots',
        })}
        ${kpiTile({
          label: 'Drawdown duration',
          tip: 'Longest consecutive run of months where net worth was below a prior peak.',
          value: ddSeries.length > 0 ? `${ddDuration} mo` : '-',
          sub: ddSeries.length > 0 ? 'max consecutive months below peak' : 'needs 2 snapshots',
        })}
      </div>
      ${
        ddSeries.length >= 2
          ? `<div class="chart-wrap chart-h-sm" style="margin-bottom:.5rem"><canvas id="c-nw-drawdown"></canvas></div>`
          : ''
      }
    </div>

    <div style="margin-bottom:1rem">
      <div style="font-size:12px;font-weight:600;color:var(--ink-2);text-transform:uppercase;letter-spacing:.04em;margin-bottom:.25rem">Risk-Adjusted Performance</div>
      <p class="note" style="margin-bottom:.5rem">${rfNote}</p>
      <div class="kpi-row">
        ${kpiTile({
          label: 'Sharpe',
          tip: '(CAGR - risk-free rate) / volatility. Measures return per unit of total risk. Values above 1 are generally good, above 2 are excellent. Higher is always better.',
          value: sharpe !== null ? sharpe.toFixed(2) : hasEnough12 ? '-' : '-',
          sub:
            sharpe !== null
              ? `rf ${rfRaw}%`
              : hasEnough12
                ? 'needs positive volatility'
                : 'needs 12 months',
        })}
        ${kpiTile({
          label: 'Sortino',
          tip: '(CAGR - risk-free rate) / downside deviation. Like Sharpe but only penalizes downside moves, not upside swings. Values above 1 are generally good. A higher Sortino than Sharpe means most of your volatility is upside.',
          value: sortino !== null ? sortino.toFixed(2) : '-',
          sub:
            sortino !== null
              ? `rf ${rfRaw}%`
              : hasEnough12
                ? 'needs downside moves'
                : 'needs 12 months',
        })}
        ${kpiTile({
          label: 'Calmar',
          tip: 'CAGR / |max drawdown|. Measures return relative to worst loss. A value above 1 means CAGR exceeds max drawdown magnitude. Values above 0.5 are generally acceptable; above 1 is strong.',
          value: calmar !== null ? calmar.toFixed(2) : '-',
          sub: calmar !== null ? 'CAGR / |max DD|' : 'needs CAGR and drawdown',
        })}
      </div>
    </div>

    ${
      rollingCagr36.length > 0
        ? `<div style="margin-bottom:1rem">
          <div style="font-size:12px;font-weight:600;color:var(--ink-2);text-transform:uppercase;letter-spacing:.04em;margin-bottom:.5rem">Rolling 3-Year CAGR</div>
          <div class="chart-wrap chart-h-sm"><canvas id="c-nw-rolling-cagr"></canvas></div>
        </div>`
        : ''
    }

    ${
      rollingVol24.length > 0
        ? `<div style="margin-bottom:1rem">
          <div style="font-size:12px;font-weight:600;color:var(--ink-2);text-transform:uppercase;letter-spacing:.04em;margin-bottom:.5rem">Rolling 12-Month Volatility</div>
          <p class="note" style="margin-bottom:.4rem">Annualized volatility computed over a trailing 12-month window at each point.</p>
          <div class="chart-wrap chart-h-sm"><canvas id="c-nw-rolling-vol"></canvas></div>
        </div>`
        : ''
    }

    ${
      hasIncome
        ? `<div>
          <div style="font-size:12px;font-weight:600;color:var(--ink-2);text-transform:uppercase;letter-spacing:.04em;margin-bottom:.5rem">Income</div>
          <div class="kpi-row" style="margin-bottom:.75rem">
            ${kpiTile({
              label: 'Trailing 12M income',
              tip: 'Total dividends and interest received in the last 12 months.',
              value: fmtEur2(trailing12),
              sub: 'DIVIDEND + INTEREST',
            })}
            ${
              divYield !== null
                ? kpiTile({
                    label: 'Dividend yield',
                    tip: 'Trailing 12-month income divided by current total portfolio value. Represents the income return rate of your portfolio.',
                    value: fmtPctNeg(divYield * 100),
                    sub: 'trailing 12M / portfolio value',
                  })
                : ''
            }
            ${
              divGrowth !== null
                ? kpiTile({
                    label: 'Income growth YoY',
                    tip: "This year's total income vs last year's as a percentage change. Positive means your income stream is growing.",
                    value: fmtPctNeg(divGrowth * 100),
                    valueClass: divGrowth >= 0 ? 'pos' : 'neg',
                    sub: 'vs prior year',
                  })
                : ''
            }
            ${
              divCagr !== null
                ? kpiTile({
                    label: 'Income CAGR',
                    tip: 'Compound annual growth rate of your yearly income from dividends and interest. Measures how consistently your income stream grows over time.',
                    value: fmtPctNeg(divCagr * 100),
                    valueClass: divCagr >= 0 ? 'pos' : 'neg',
                    sub: 'annual income growth',
                  })
                : ''
            }
          </div>
          <p class="note" style="margin-bottom:.4rem">Monthly income (dividends + interest received) over the last 12 months. Bar height represents the total income received in that calendar month.</p>
          <div class="chart-wrap chart-h-sm"><canvas id="c-nw-income-month"></canvas></div>
        </div>`
        : ''
    }
  `;

  el.innerHTML = `
    <div class="card">
      <div class="card-title">Performance Details</div>
      <div style="font-size:12px;font-weight:600;color:var(--ink-2);text-transform:uppercase;letter-spacing:.04em;margin-top:.75rem;margin-bottom:.25rem">Annual Returns</div>
      ${annualRetTableHtml}
      ${
        hasEnough12
          ? `<div style="font-size:12px;font-weight:600;color:var(--ink-2);text-transform:uppercase;letter-spacing:.04em;margin-top:1rem;margin-bottom:.15rem">Monthly Return Heatmap</div>
           <p class="note" style="margin-bottom:.25rem">Each cell shows the net-worth return for that month. The rightmost column shows the compounded annual total.</p>
           ${heatmapHtml}`
          : ''
      }
    </div>
    <div class="card card-collapsible collapsed" id="nw-advanced-analytics-card">
      <div class="card-header js-card-toggle">
        <div class="card-title">Advanced Analytics</div>
        <span class="card-chevron"></span>
      </div>
      <div class="card-body">
        ${
          hasEnough12
            ? advancedBody
            : `<p class="note">Advanced analytics are available after ${12 - months} more months of history (need 12 months, have ${months}).</p>`
        }
      </div>
    </div>
  `;

  // Attach collapse toggle for the advanced analytics card
  const advCard = document.getElementById('nw-advanced-analytics-card');
  if (advCard) {
    const header = advCard.querySelector('.card-header');
    header?.addEventListener('click', () => {
      advCard.classList.toggle('collapsed');
      // Render charts when card is first opened
      if (!advCard.classList.contains('collapsed')) {
        _renderDrawdownChart(ddSeries);
        if (rollingCagr36.length > 0) _renderRollingCagrChart(rollingCagr36);
        if (rollingVol24.length > 0) _renderRollingVolChart(rollingVol24);
        if (hasIncome) _renderIncomeByMonthChart(incomeByMonthData);
      }
    });
  }
}

function _renderDrawdownChart(series: DrawdownPoint[]): void {
  const el = document.getElementById('c-nw-drawdown') as HTMLCanvasElement | null;
  if (!el || series.length < 2) return;
  _destroyChart('c-nw-drawdown');
  const C = resolvedT();
  const labels = series.map((p) => p.date);
  const data = series.map((p) => p.drawdown * 100);
  CH['c-nw-drawdown'] = new Chart(el, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Drawdown',
          data,
          fill: true,
          borderColor: 'rgba(220,53,69,0.8)',
          backgroundColor: 'rgba(220,53,69,0.15)',
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0.2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          reverse: false,
          ticks: {
            callback: (v) => `${Number(v).toFixed(1)}%`,
            font: { size: 10 },
            color: C.ink3,
          },
          grid: { color: C.line },
          max: 0,
        },
        x: {
          ticks: { font: { size: 10 }, color: C.ink3, maxTicksLimit: 8 },
          grid: { display: false },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...TOOLTIP_BOX,
          callbacks: {
            label: (ctx) => ` ${(ctx.parsed.y ?? 0).toFixed(2)}%`,
          },
        },
      },
    },
  });
}

function _renderRollingCagrChart(series: { month: string; cagr: number }[]): void {
  const el = document.getElementById('c-nw-rolling-cagr') as HTMLCanvasElement | null;
  if (!el || series.length === 0) return;
  _destroyChart('c-nw-rolling-cagr');
  const C = resolvedT();
  CH['c-nw-rolling-cagr'] = new Chart(el, {
    type: 'line',
    data: {
      labels: series.map((p) => p.month),
      datasets: [
        {
          label: '3Y Rolling CAGR',
          data: series.map((p) => p.cagr * 100),
          fill: false,
          borderColor: C.brandChart,
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          ticks: {
            callback: (v) => `${Number(v).toFixed(1)}%`,
            font: { size: 10 },
            color: C.ink3,
          },
          grid: { color: C.line },
        },
        x: {
          ticks: { font: { size: 10 }, color: C.ink3, maxTicksLimit: 8 },
          grid: { display: false },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...TOOLTIP_BOX,
          callbacks: { label: (ctx) => ` ${(ctx.parsed.y ?? 0).toFixed(2)}%` },
        },
      },
    },
  });
}

function _renderRollingVolChart(series: { month: string; volatility: number }[]): void {
  const el = document.getElementById('c-nw-rolling-vol') as HTMLCanvasElement | null;
  if (!el || series.length === 0) return;
  _destroyChart('c-nw-rolling-vol');
  const C = resolvedT();
  CH['c-nw-rolling-vol'] = new Chart(el, {
    type: 'line',
    data: {
      labels: series.map((p) => p.month),
      datasets: [
        {
          label: 'Rolling 12M Volatility',
          data: series.map((p) => p.volatility * 100),
          fill: true,
          borderColor: C.brandChart,
          backgroundColor: C.brandChart + '22',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          min: 0,
          ticks: {
            callback: (v) => `${Number(v).toFixed(1)}%`,
            font: { size: 10 },
            color: C.ink3,
          },
          grid: { color: C.line },
        },
        x: {
          ticks: { font: { size: 10 }, color: C.ink3, maxTicksLimit: 8 },
          grid: { display: false },
        },
      },
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
          callbacks: { label: (ctx) => ` ${(ctx.parsed.y ?? 0).toFixed(2)}%` },
        },
      },
    },
  });
}

function _renderIncomeByMonthChart(data: { month: string; amount: number }[]): void {
  const el = document.getElementById('c-nw-income-month') as HTMLCanvasElement | null;
  if (!el) return;
  _destroyChart('c-nw-income-month');
  const hasAny = data.some((d) => d.amount > 0);
  if (!hasAny) return;
  const C = resolvedT();
  CH['c-nw-income-month'] = new Chart(el, {
    type: 'bar',
    data: {
      labels: data.map((d) => d.month),
      datasets: [
        {
          label: 'Income',
          data: data.map((d) => d.amount),
          backgroundColor: C.brandChart + '99',
          borderColor: C.brandChart,
          borderWidth: 1,
          borderRadius: 3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          ticks: {
            callback: (v) => fmtEur(Number(v)),
            font: { size: 10 },
            color: C.ink3,
          },
          grid: { color: C.line },
        },
        x: {
          ticks: { font: { size: 10 }, color: C.ink3 },
          grid: { display: false },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...TOOLTIP_BOX,
          callbacks: { label: (ctx) => ` ${fmtEur2(Number(ctx.raw))}` },
        },
      },
    },
  });
}

// ── Allocation card ───────────────────────────────────────────────

const ASSET_CLASS_LABELS: Record<string, string> = {
  equity: 'Equity',
  bond: 'Bond',
  reit: 'REIT',
  commodity: 'Commodity',
  cash: 'Cash',
  other: 'Other',
};

const REGION_LABELS: Record<string, string> = {
  developed: 'Developed',
  emerging: 'Emerging',
  global: 'Global',
  europe: 'Europe',
  us: 'US',
  other: 'Other',
};

function _renderAllocationCard(
  snaps: Snapshot[],
  accounts: Account[],
  pd: PortfolioData | null,
): void {
  const el = document.getElementById('nw-allocation');
  if (!el) return;

  if (snaps.length === 0) {
    el.innerHTML = '';
    return;
  }

  const s = snaps[snaps.length - 1];
  const holdings = getHoldings();

  // Account allocation (always available from snapshot)
  const acctData = accounts
    .filter((a) => {
      const key = a.id || a.key || '';
      return key && ((s[key] as number) || 0) > 0;
    })
    .map((a) => {
      const key = a.id || a.key || '';
      return { label: a.label || key, value: (s[key] as number) || 0, color: a.color || '#888' };
    });

  // Asset class allocation (from holdings metadata, valued by cost basis when available)
  const assetClassMap: Record<string, number> = {};
  const regionMap: Record<string, number> = {};
  for (const h of holdings) {
    if (!h.isin || !h.active) continue;
    const cls = h.assetClass || 'other';
    const reg = h.region || 'other';
    // Prefer actual cost basis so holdings with zero contribAmount still appear
    const value = pd?.etfs[h.isin]?.cost ?? h.contribAmount;
    if (value <= 0) continue;
    assetClassMap[cls] = (assetClassMap[cls] || 0) + value;
    regionMap[reg] = (regionMap[reg] || 0) + value;
  }

  const hasAssetClass = Object.keys(assetClassMap).length > 1;
  const hasRegion = Object.keys(regionMap).length > 1;

  el.innerHTML = `
    <div class="card">
      <div class="card-title">Allocation</div>
      <div class="two-col" style="margin-top:.75rem">
        <div>
          <div style="font-size:12px;font-weight:600;color:var(--ink-2);text-transform:uppercase;letter-spacing:.04em;margin-bottom:.5rem">By Account</div>
          <div id="nw-alloc-acct-legend" class="legend" style="margin-bottom:.5rem"></div>
          <div class="chart-wrap chart-h-sm"><canvas id="c-nw-alloc-acct"></canvas></div>
        </div>
        ${
          hasAssetClass
            ? `<div>
              <div style="font-size:12px;font-weight:600;color:var(--ink-2);text-transform:uppercase;letter-spacing:.04em;margin-bottom:.5rem">By Asset Class${infoTip('Weighted by cost basis (amount invested). Falls back to configured contribution amounts when no transactions are recorded.')}</div>
              <div id="nw-alloc-class-legend" class="legend" style="margin-bottom:.5rem"></div>
              <div class="chart-wrap chart-h-sm"><canvas id="c-nw-alloc-class"></canvas></div>
            </div>`
            : '<div></div>'
        }
        ${
          hasRegion
            ? `<div>
              <div style="font-size:12px;font-weight:600;color:var(--ink-2);text-transform:uppercase;letter-spacing:.04em;margin-bottom:.5rem">By Region${infoTip('Weighted by cost basis (amount invested). Falls back to configured contribution amounts when no transactions are recorded.')}</div>
              <div id="nw-alloc-region-legend" class="legend" style="margin-bottom:.5rem"></div>
              <div class="chart-wrap chart-h-sm"><canvas id="c-nw-alloc-region"></canvas></div>
            </div>`
            : ''
        }
      </div>
    </div>
  `;

  // Render account allocation donut (static legend with percentage)
  if (acctData.length > 0) {
    _destroyChart('c-nw-alloc-acct');
    const acctTotal = acctData.reduce((s, d) => s + d.value, 0);
    const legendEl = document.getElementById('nw-alloc-acct-legend');
    if (legendEl) {
      legendEl.innerHTML = renderLegendHtml(
        acctData.map((d) => ({
          label: d.label,
          color: d.color,
          meta: acctTotal > 0 ? ((d.value / acctTotal) * 100).toFixed(1) + '%' : '0%',
        })),
      );
    }
    const C = resolvedT();
    CH['c-nw-alloc-acct'] = new Chart(
      document.getElementById('c-nw-alloc-acct') as HTMLCanvasElement,
      {
        type: 'doughnut',
        data: {
          labels: acctData.map((d) => d.label),
          datasets: [
            {
              data: acctData.map((d) => d.value),
              backgroundColor: acctData.map((d) => safeColor(d.color)),
              borderWidth: 2,
              borderColor: C.bg,
              hoverOffset: 4,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '62%',
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
                  return ` ${esc(String(ctx.label))}: ${fmtEur(Number(ctx.raw))}`;
                },
              },
            },
          },
        },
      },
    );
  }

  // Render asset class donut
  if (hasAssetClass) {
    _renderAllocationDonut(
      'c-nw-alloc-class',
      'nw-alloc-class-legend',
      assetClassMap,
      ASSET_CLASS_LABELS,
    );
  }

  // Render region donut
  if (hasRegion) {
    _renderAllocationDonut('c-nw-alloc-region', 'nw-alloc-region-legend', regionMap, REGION_LABELS);
  }
}

/** Render a simple donut chart from a label -> value map, with auto-generated colors. */
function _renderAllocationDonut(
  canvasId: string,
  legendId: string,
  dataMap: Record<string, number>,
  labelMap?: Record<string, string>,
): void {
  const el = document.getElementById(canvasId) as HTMLCanvasElement | null;
  if (!el) return;
  _destroyChart(canvasId);

  const total = Object.values(dataMap).reduce((s, v) => s + v, 0);
  if (total <= 0) return;

  const entries = Object.entries(dataMap).sort((a, b) => b[1] - a[1]);
  const colors = entries.map((_, i) => DATA_PALETTE[i % DATA_PALETTE.length]);

  const normalizeLabel = (key: string): string => (labelMap && labelMap[key]) || key;

  const legendEl = document.getElementById(legendId);
  if (legendEl) {
    legendEl.innerHTML = renderLegendHtml(
      entries.map(([label], i) => ({
        label: normalizeLabel(label),
        color: colors[i],
        meta: total > 0 ? ((entries[i][1] / total) * 100).toFixed(1) + '%' : '0%',
      })),
    );
  }

  const C = resolvedT();
  CH[canvasId] = new Chart(el, {
    type: 'doughnut',
    data: {
      labels: entries.map(([k]) => normalizeLabel(k)),
      datasets: [
        {
          data: entries.map(([, v]) => v),
          backgroundColor: colors,
          borderWidth: 2,
          borderColor: C.bg,
          hoverOffset: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
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
              return ` ${esc(String(ctx.label))}: ${fmtEur(Number(ctx.raw))}`;
            },
          },
        },
      },
    },
  });
}
