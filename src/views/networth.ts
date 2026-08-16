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
import {
  getAccounts,
  getContributionBudgetAmount,
  getContributionInterval,
  getGoals,
  getSettings,
  getNumberSetting,
  setSetting,
  setSettings,
} from '../store/config';
import { annualizeContrib, INTERVAL_LABELS } from '../model/contributions';
import { cagrPerAccount } from '../model/insights';
import {
  formatMonthsEta,
  forecastMultiAccountSeries,
  forecastMonthsToTargetMulti,
  decumulationSeries,
  decumulationDuration,
} from '../model/forecast';
import type { AccountForecastInput, DecumulationStrategy } from '../model/forecast';
import type { Snapshot, Account, GoalMilestone } from '../types';
import Chart from 'chart.js/auto';
import { T, R, resolvedT } from '../theme';
import { bindLegendToggle, renderLegendHtml, TOOLTIP_BOX, tooltipSwatch } from './chartLegend';
import { writeChartTable } from './chartTable';
import { infoTip, attachInfoTips } from '../ui/infoTip';
import { createChartRegistry } from './chartRegistry';
import { formatEuroCompactPrefix, formatEuroCompactSuffix } from './chartOptions';

const { CH, destroyChart: _destroyChart } = createChartRegistry();
let _nwRange: '12' | '36' | 'all' = 'all';
let _fcRange: '60' | '120' | '240' | '360' | '480' | '600' = '60'; // 5y / 10y / 20y / 30y / 40y / 50y forecast horizon
let _inflationRate = 0; // annual inflation % for real-return forecast overlay
let _lastSnaps: Snapshot[] = [];
let _lastAccounts: Account[] = [];
let _activeGoalIdx = 0; // which goal tab is selected in the consolidated goals card

// ── Decumulation card state ──────────────────────────────
let _ddRetirementDate = ''; // e.g. "2060-01"; empty = not set
let _ddStrategy: DecumulationStrategy = 'fixed';
let _ddWithdrawalParam = 0; // €/month for fixed/four-pct; annual % for pct
let _ddReturnPct = 0; // annual return % during retirement; 0 = derive from accounts on each render
let _ddReturnPctManual = false; // true once user has edited the return-rate input
let _stateLoaded = false; // tracks whether persisted settings have been loaded into module state
let _planningTab: 'forecast' | 'drawdown' = 'forecast'; // active tab in the combined planning card

/** Load persisted drawdown + inflation settings from the Settings store (runs once). */
function _loadPersistedState(): void {
  if (_stateLoaded) return;
  _stateLoaded = true;
  const s = getSettings();
  const infl = getNumberSetting('nw_inflation_rate', NaN);
  if (isFinite(infl) && infl >= 0) _inflationRate = Math.min(infl, 20);
  const ddDate = (s['dd_retirement_date'] || '').trim();
  if (/^\d{4}-\d{2}$/.test(ddDate)) _ddRetirementDate = ddDate;
  const ddStrat = (s['dd_strategy'] || '').trim() as DecumulationStrategy;
  if (ddStrat === 'fixed' || ddStrat === 'four-pct' || ddStrat === 'pct') _ddStrategy = ddStrat;
  const ddWith = getNumberSetting('dd_withdrawal_param', NaN);
  if (isFinite(ddWith) && ddWith >= 0) _ddWithdrawalParam = ddWith;
  const ddRet = getNumberSetting('dd_return_pct', NaN);
  if (isFinite(ddRet) && ddRet > 0) {
    _ddReturnPct = Math.min(ddRet, 20);
    _ddReturnPctManual = true;
  }
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

function _isPrimaryInvestmentAccount(a: Account): boolean {
  return !!a.isPrimaryInvestment && (a.moneyType || '').toLowerCase() === 'investment';
}

function _buildAccountForecastInputs(snap: Snapshot, accounts: Account[]): AccountForecastInput[] {
  const globalContribInterval = getContributionInterval();
  const globalContribAmount = getContributionBudgetAmount();
  return accounts.map((a) => {
    const current = (snap[a.id || ''] as number) || 0;
    const annualReturnPct = a.annualReturnPct || 0;
    const accountContribInterval = a.contribInterval || 'monthly';
    const isPrimaryInvestment = _isPrimaryInvestmentAccount(a);
    const personalContribAnnual = isPrimaryInvestment
      ? annualizeContrib(globalContribAmount, globalContribInterval)
      : annualizeContrib(a.contribAmount || 0, accountContribInterval);
    const extraContribAnnual = annualizeContrib(a.extraContrib || 0, accountContribInterval);
    const annualContrib = personalContribAnnual + extraContribAnnual;
    const contribInterval = isPrimaryInvestment ? globalContribInterval : accountContribInterval;
    return { current, annualContrib, annualReturnPct, contribInterval };
  });
}

/** Renders milestones section for a goal progress card using infoTip for note icons. */
function _renderMilestonesSection(
  milestones: GoalMilestone[],
  liquidTotal: number,
  target: number,
  accountInputs: AccountForecastInput[],
): string {
  const valid = [...milestones]
    .filter((ms) => {
      const amt = parseFloat((ms.targetAmount || '').replace(/\./g, '').replace(',', '.'));
      return isFinite(amt) && amt > 0 && amt < target;
    })
    .sort((a, b) => {
      const na = parseFloat(a.targetAmount.replace(/\./g, '').replace(',', '.'));
      const nb = parseFloat(b.targetAmount.replace(/\./g, '').replace(',', '.'));
      return na - nb;
    });
  if (valid.length === 0) return '';

  const rows = valid
    .map((ms) => {
      const msAmt = parseFloat((ms.targetAmount || '').replace(/\./g, '').replace(',', '.'));
      const reached = liquidTotal >= msAmt;
      const validDate = ms.targetDate && /^\d{4}-\d{2}$/.test(ms.targetDate) ? ms.targetDate : null;
      let etaOrStatus: string;
      if (reached) {
        etaOrStatus = `<span class="pos">Reached</span>`;
      } else {
        const etaMonths = forecastMonthsToTargetMulti(accountInputs, msAmt);
        if (etaMonths !== null) {
          const d = new Date();
          d.setMonth(d.getMonth() + etaMonths, 1);
          const etaStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          if (validDate) {
            etaOrStatus =
              etaStr <= validDate
                ? `<span class="pos">On track</span> (ETA ${fmtMon(etaStr)})`
                : `<span class="neg">Behind</span> (ETA ${fmtMon(etaStr)})`;
          } else {
            etaOrStatus = `ETA ${fmtMon(etaStr)}`;
          }
        } else {
          etaOrStatus = `<span class="note">No ETA</span>`;
        }
      }
      return `<div class="row ms-row">
        <div class="row-label ms-label">${fmtEur(msAmt)}${validDate ? ` · ${fmtMon(validDate)}` : ''}${ms.label ? infoTip(ms.label) : ''}</div>
        <div class="row-val ms-val"><span class="ms-status">${etaOrStatus}</span></div>
      </div>`;
    })
    .join('');

  return `<div style="margin-bottom:.5rem">
    <div style="font-size:11px;font-weight:600;color:var(--ink-3);text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px">Milestones</div>
    ${rows}
  </div>`;
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
        <div style="position:relative;height:8px;background:var(--surface-3);border-radius:var(--radius-xs);overflow:hidden">
          <div style="width:${pctComplete}%;height:100%;background:${pctComplete >= 100 ? 'var(--pos)' : isOnTrack === false ? 'var(--warn)' : 'var(--brand)'};border-radius:var(--radius-xs);transition:width .3s"></div>
          ${(goal.milestones ?? [])
            .map((ms) => {
              const msAmt = parseFloat(
                (ms.targetAmount || '').replace(/\./g, '').replace(',', '.'),
              );
              if (!isFinite(msAmt) || msAmt <= 0 || msAmt >= target) return '';
              const msPos = Math.min(100, Math.round((msAmt / target) * 100));
              return `<div style="position:absolute;top:0;left:${msPos}%;width:2px;height:100%;background:var(--ink-3);transform:translateX(-50%)" title="${esc(ms.label || fmtEur(msAmt))}"></div>`;
            })
            .join('')}
        </div>
      </div>
      ${_renderMilestonesSection(goal.milestones ?? [], liquidTotal, target, accountInputs)}
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
  attachInfoTips(goalEl);
}

/**
 * Renders the Net Worth tab: lead KPI (with MoM delta), per-account KPI tiles,
 * YoY/CAGR tiles, the history chart, growth-breakdown chart, and goal progress.
 */
/** Resets module-level tab state. Exposed only for unit test teardown. */
export function _resetPlanningTabForTest(): void {
  _planningTab = 'forecast';
}

export function renderNW(snaps: Snapshot[]): void {
  _loadPersistedState();
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
              callback: (v) => formatEuroCompactSuffix(v),
            },
          },
          y: { grid: { display: false }, ticks: { color: C.ink2, font: { size: 12 } } },
        },
      },
    });

    writeChartTable(
      'c-nw-hist-table-wrap',
      'Account breakdown data',
      ['Account', 'Value (€)'],
      chartA.map((a) => [a.label, fmtEur2((s[a.key] as number) || 0)]),
    );
  } else {
    _renderNWHistChart(view, chartA);
  }

  // Bind range toggle once
  _attachNWRangeToggle(chartA);

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

  // Forecast + retirement planning card (tabbed)
  _renderPlanningCard(snaps, accounts);

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
  const noteMarkerRadius = view.map((sn) => (String(sn.notes || '').trim() ? 3 : 0));

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
    pointRadius: noteMarkerRadius,
    pointHoverRadius: 5,
    pointBackgroundColor: noteMarkerRadius.map((r) => (r > 0 ? C.brand : 'transparent')),
    pointBorderColor: noteMarkerRadius.map((r) => (r > 0 ? C.surface : 'transparent')),
    pointBorderWidth: noteMarkerRadius.map((r) => (r > 0 ? 1 : 0)),
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
            afterBody: (items) => {
              const idx = items[0]?.dataIndex;
              if (idx == null) return '';
              const note = String(view[idx]?.notes || '').trim();
              return note ? `Note: ${note}` : '';
            },
            labelColor: tooltipSwatch(C.surface),
          },
        },
      },
      scales: {
        y: {
          grid: { color: C.line },
          ticks: {
            color: C.ink4,
            callback: (v) => formatEuroCompactSuffix(v),
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
  writeChartTable(
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

function _attachNWRangeToggle(chartA: Array<{ key: string; label: string; color: string }>): void {
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
    // Read current snaps from module state so re-renders after nav don't use a stale closure.
    const snaps = _lastSnaps;
    const view = _nwRange === 'all' ? snaps : snaps.slice(-parseInt(_nwRange));
    _renderNWHistChart(view, chartA);
  });
}

// ── Combined planning card (Forecast + Retirement drawdown) ──

function _renderPlanningCard(snaps: Snapshot[], accounts: Account[]): void {
  const el = document.getElementById('nw-planning');
  if (!el) return;

  if (snaps.length === 0) {
    el.innerHTML = '';
    return;
  }

  const inflHint =
    _inflationRate > 0
      ? 'Inflation-adjusted projection shown as dashed line on charts.'
      : 'Set above 0 to overlay an inflation-adjusted projection on all charts.';

  el.innerHTML = `
    <div class="card" id="nw-planning-card">
      <div class="card-title">Projections</div>
      <div class="forecast-inflation" style="margin-bottom:1rem">
        <label for="nw-forecast-inflation" class="forecast-inflation-label">Annual inflation (%/yr)</label>
        <div class="forecast-inflation-input-wrap">
          <input id="nw-forecast-inflation" class="forecast-inflation-input" type="number" inputmode="decimal" min="0" max="20" step="0.1"
                 value="${_inflationRate}"
                 aria-label="Annual inflation rate for real-return projection">
        </div>
        <div class="forecast-inflation-hint">${inflHint} Applies to both Forecast and Drawdown.</div>
      </div>
      <div class="range-toggle" id="nw-planning-tabs" role="tablist" aria-label="Projections" style="margin-bottom:1rem">
        <button class="btn btn-sm btn-ghost${_planningTab === 'forecast' ? ' active' : ''}" role="tab" aria-selected="${_planningTab === 'forecast'}" aria-controls="nw-fc-panel" data-planning-tab="forecast">Forecast</button>
        <button class="btn btn-sm btn-ghost${_planningTab === 'drawdown' ? ' active' : ''}" role="tab" aria-selected="${_planningTab === 'drawdown'}" aria-controls="nw-dd-panel" data-planning-tab="drawdown">Drawdown</button>
      </div>
      <div id="nw-fc-panel" role="tabpanel"${_planningTab !== 'forecast' ? ' hidden' : ''}></div>
      <div id="nw-dd-panel" role="tabpanel"${_planningTab !== 'drawdown' ? ' hidden' : ''}></div>
    </div>`;

  if (_planningTab === 'forecast') {
    _renderForecastChart(snaps, accounts);
  } else {
    _renderDecumulationCard(snaps, accounts);
  }

  // Bind shared inflation input: on change, update state and re-render the active tab
  const inflInput = document.getElementById('nw-forecast-inflation') as HTMLInputElement | null;
  if (inflInput) {
    inflInput.addEventListener('change', () => {
      const v = parseFloat(inflInput.value);
      _inflationRate = isFinite(v) && v >= 0 ? Math.min(v, 20) : 0;
      void setSetting('nw_inflation_rate', String(_inflationRate));
      _renderGoalCards();
      _renderPlanningCard(_lastSnaps, _lastAccounts);
    });
  }

  document.getElementById('nw-planning-tabs')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-planning-tab]') as HTMLElement | null;
    if (!btn) return;
    const tab = btn.dataset.planningTab as 'forecast' | 'drawdown';
    if (tab === _planningTab) return;
    _planningTab = tab;
    _renderPlanningCard(_lastSnaps, _lastAccounts);
  });
}

// ── Forecast range toggle binding ──

function _attachForecastRangeToggle(): void {
  const toggle = document.getElementById('nw-forecast-range-toggle') as
    (HTMLElement & { _bound?: boolean }) | null;
  if (!toggle || toggle._bound) return;
  toggle._bound = true;
  toggle.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-range]') as HTMLElement | null;
    if (!btn) return;
    const newRange = (btn.dataset.range as '60' | '120' | '240' | '360' | '480' | '600') || '60';
    if (newRange === _fcRange) return;
    _fcRange = newRange;
    // Read current state from module variables so re-renders after nav use fresh data.
    _renderForecastChart(_lastSnaps, _lastAccounts);
  });
}

// ── Forecast chart ──

function _renderForecastChart(snaps: Snapshot[], accounts: Account[]): void {
  const C = resolvedT();
  const forecastEl = document.getElementById('nw-fc-panel');
  if (!forecastEl) return;

  if (snaps.length === 0) {
    forecastEl.innerHTML = '';
    return;
  }
  const latestSnap = snaps[snaps.length - 1];
  const accountInputs = _buildAccountForecastInputs(latestSnap, accounts);
  const globalContribAmount = getContributionBudgetAmount();
  const globalContribInterval = getContributionInterval();
  const globalContribIntervalLabel = (
    INTERVAL_LABELS[globalContribInterval] || globalContribInterval
  ).toLowerCase();
  const hasGrowthPotential = accountInputs.some(
    (a) => a.annualContrib > 0 || a.annualReturnPct > 0,
  );
  if (!hasGrowthPotential) {
    forecastEl.innerHTML =
      '<p class="note" style="color:var(--ink-3)">Configure return rates or contributions in Settings \u2192 Accounts to see a forecast.</p>';
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
      if (_isPrimaryInvestmentAccount(a)) {
        contribStr =
          inp.annualContrib > 0
            ? `${fmtEur(globalContribAmount)} ${esc(globalContribIntervalLabel)} (from Holdings)`
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
      <div class="chart-controls">
        <div id="nw-forecast-legend" class="legend"></div>
        <div class="range-toggle" id="nw-forecast-range-toggle" role="group" aria-label="Forecast range">
          <button class="btn btn-sm btn-ghost ${_fcRange === '60' ? 'active' : ''}" data-range="60" aria-pressed="${_fcRange === '60'}">5Y</button>
          <button class="btn btn-sm btn-ghost ${_fcRange === '120' ? 'active' : ''}" data-range="120" aria-pressed="${_fcRange === '120'}">10Y</button>
          <button class="btn btn-sm btn-ghost ${_fcRange === '240' ? 'active' : ''}" data-range="240" aria-pressed="${_fcRange === '240'}">20Y</button>
          <button class="btn btn-sm btn-ghost ${_fcRange === '360' ? 'active' : ''}" data-range="360" aria-pressed="${_fcRange === '360'}">30Y</button>
          <button class="btn btn-sm btn-ghost ${_fcRange === '480' ? 'active' : ''}" data-range="480" aria-pressed="${_fcRange === '480'}">40Y</button>
          <button class="btn btn-sm btn-ghost ${_fcRange === '600' ? 'active' : ''}" data-range="600" aria-pressed="${_fcRange === '600'}">50Y</button>
        </div>
      </div>
      <div class="chart-wrap chart-h-lg"><canvas id="c-nw-forecast" role="img" aria-label="Net worth forecast chart" aria-describedby="c-nw-forecast-table-wrap"></canvas></div>
      <div class="chart-data-table-wrap sr-only" id="c-nw-forecast-table-wrap"></div>
      <div class="note" style="line-height:1.6">
        <div style="margin-bottom:4px">Per-account return &amp; contribution assumptions (Settings \u2192 Accounts):</div>
        ${acctSummaryLines}
        <div style="margin-top:4px;color:var(--ink-4)">Contribution timing follows each configured cadence (weekly, every 2 weeks, monthly, quarterly) and is bucketed month-by-month in the projection.</div>
        <div style="margin-top:4px;color:var(--ink-4)">Does not account for taxes, fees, or FX. Assumes zero rebalancing costs; spreads, commissions, and capital-gains tax from rebalancing can reduce long-horizon returns.${goalDeadlines.length > 0 ? ' Goal deadlines and target amounts are shown as markers on the chart.' : ''}</div>
        <div style="margin-top:4px;color:var(--ink-4)">Projection uses a single fixed return per account. A market downturn in the years approaching your target could reduce the actual balance by 30–40% compared with the deterministic figure. Consider re-running the forecast with a more conservative return to see the lower bound.</div>
      </div>
    `;

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
                  ctx.strokeStyle = 'var(--surface)';
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
            callback: (v) => formatEuroCompactPrefix(v),
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

  // Write accessible data table for screen readers / keyboard users
  const fcFmt = (v: number | null) => (v != null ? fmtEur2(v) : '—');
  const fcTableHeaders = showReal
    ? ['Month', 'Actual (€)', 'Forecast nominal (€)', `Forecast real (€)`]
    : ['Month', 'Actual (€)', 'Forecast (€)'];
  writeChartTable(
    'c-nw-forecast-table-wrap',
    'Forecast data',
    fcTableHeaders,
    labels.map((lbl, i) =>
      showReal && realDataFull
        ? [lbl, fcFmt(histDataFull[i]), fcFmt(fcDataFull[i]), fcFmt(realDataFull[i])]
        : [lbl, fcFmt(histDataFull[i]), fcFmt(fcDataFull[i])],
    ),
  );

  _attachForecastRangeToggle();
}

// ── Decumulation chart ──

/**
 * Builds the projected balance at the given retirement month by running the
 * accumulation forecast forward from the latest snapshot date to retirementDate.
 * Splits accounts into liquid (accessible at retirement) and still-locked ones.
 */
function _buildCorpusAtRetirement(
  snaps: Snapshot[],
  accounts: Account[],
  retirementDate: string,
): {
  liquidCorpus: number;
  lockedCorpus: number;
  lockedGroups: Array<{ unlockYear: string; corpus: number }>;
} | null {
  if (snaps.length === 0) return null;
  const latestSnap = snaps[snaps.length - 1];
  const latestDate = latestSnap.date;

  // retirementDate must be strictly after latest snapshot (compare month-only to handle YYYY-MM-DD dates)
  if (retirementDate <= latestDate.substring(0, 7)) return null;

  const retirementYear = parseInt(retirementDate.split('-')[0], 10);

  // Partition accounts
  const liquidAccounts = accounts.filter(
    (a) => !a.locked || (a.lockedUntil ? parseInt(a.lockedUntil, 10) <= retirementYear : true),
  );
  const stillLockedAccounts = accounts.filter(
    (a) => a.locked && a.lockedUntil && parseInt(a.lockedUntil, 10) > retirementYear,
  );

  // Count months from latestDate to retirementDate
  const [ly, lm] = latestDate.split('-').map(Number);
  const [ry, rm] = retirementDate.split('-').map(Number);
  const monthsToRetirement = (ry - ly) * 12 + (rm - lm);
  if (monthsToRetirement <= 0) return null;

  // Project liquid accounts forward
  const liquidInputs = _buildAccountForecastInputs(latestSnap, liquidAccounts);
  const liquidSeries = forecastMultiAccountSeries(liquidInputs, monthsToRetirement, latestDate);
  const liquidCorpus = liquidSeries.length > 0 ? liquidSeries[liquidSeries.length - 1].value : 0;

  // Project still-locked accounts forward (so user can see the future total)
  const lockedInputs = _buildAccountForecastInputs(latestSnap, stillLockedAccounts);
  const lockedSeries =
    lockedInputs.length > 0
      ? forecastMultiAccountSeries(lockedInputs, monthsToRetirement, latestDate)
      : [];
  const lockedCorpus = lockedSeries.length > 0 ? lockedSeries[lockedSeries.length - 1].value : 0;

  // Group still-locked by unlock year
  const unlockYears = [
    ...new Set(stillLockedAccounts.map((a) => a.lockedUntil!).filter(Boolean)),
  ].sort();
  const lockedGroups = unlockYears.map((yr) => {
    const grpAccounts = stillLockedAccounts.filter((a) => a.lockedUntil === yr);
    const grpInputs = _buildAccountForecastInputs(latestSnap, grpAccounts);
    const grpSeries =
      grpInputs.length > 0
        ? forecastMultiAccountSeries(grpInputs, monthsToRetirement, latestDate)
        : [];
    const corpus = grpSeries.length > 0 ? grpSeries[grpSeries.length - 1].value : 0;
    return { unlockYear: yr, corpus };
  });

  return { liquidCorpus, lockedCorpus, lockedGroups };
}

function _renderDecumulationCard(snaps: Snapshot[], accounts: Account[]): void {
  const C = resolvedT();
  const el = document.getElementById('nw-dd-panel');
  if (!el) return;

  if (snaps.length === 0) {
    el.innerHTML = '';
    return;
  }

  const latestSnap = snaps[snaps.length - 1];
  // Default retirement date: 20 years from the latest snapshot
  if (!_ddRetirementDate) {
    const [ly, lm] = latestSnap.date.split('-').map(Number);
    const defaultYear = ly + 20;
    _ddRetirementDate = `${defaultYear}-${String(lm).padStart(2, '0')}`;
  }

  // Derive return % from the value-weighted average of configured account returns,
  // unless the user has manually edited the field.
  if (!_ddReturnPctManual) {
    let totalValue = 0;
    let weightedReturn = 0;
    for (const a of accounts) {
      const val = (latestSnap[a.id || ''] as number) || 0;
      totalValue += val;
      weightedReturn += val * (a.annualReturnPct || 0);
    }
    const derived = totalValue > 0 ? Math.round((weightedReturn / totalValue) * 10) / 10 : 0;
    _ddReturnPct = derived > 0 ? derived : 4; // fall back to 4% if no return configured
  }

  const corpus = _buildCorpusAtRetirement(snaps, accounts, _ddRetirementDate);

  // Auto-init withdrawal param once we have a corpus
  if (_ddWithdrawalParam === 0 && corpus && corpus.liquidCorpus > 0) {
    if (_ddStrategy === 'four-pct') {
      _ddWithdrawalParam = Math.round((corpus.liquidCorpus * 0.04) / 12);
    } else if (_ddStrategy === 'pct') {
      _ddWithdrawalParam = 4; // 4% annual
    } else {
      _ddWithdrawalParam = Math.round((corpus.liquidCorpus * 0.04) / 12);
    }
  }

  // Horizon: simulate up to 40 years after retirement (480 months)
  const DD_MONTHS = 480;

  let ddSeries: ReturnType<typeof decumulationSeries> = [];
  let endMonth: string | null = null;
  let lastsText = '';

  if (corpus && corpus.liquidCorpus > 0 && _ddWithdrawalParam > 0) {
    // Simulate with the nominal return. The chart's real-value overlay (ddRealSeries below)
    // is produced by _deflateByInflation — applying inflation twice (once here and once there)
    // would incorrectly double-count it.
    // For 'four-pct' (SWR), pass inflation so withdrawals are indexed annually.
    ddSeries = decumulationSeries(
      corpus.liquidCorpus,
      _ddStrategy,
      _ddWithdrawalParam,
      _ddReturnPct,
      DD_MONTHS,
      _ddRetirementDate,
      _inflationRate,
    );
    endMonth = decumulationDuration(ddSeries);
    if (endMonth) {
      const [ey, em] = endMonth.split('-').map(Number);
      const [ry, rm] = _ddRetirementDate.split('-').map(Number);
      const totalMonths = (ey - ry) * 12 + (em - rm);
      lastsText = `Depletes ${fmtMon(endMonth)} (${Math.floor(totalMonths / 12)}y ${totalMonths % 12}m after retirement)`;
    } else {
      lastsText = 'Never runs out within 40-year horizon';
    }
  }

  // Monthly income text for pct strategy
  const firstMonthWithdrawal = ddSeries.length > 0 ? ddSeries[0].withdrawal : 0;
  const monthlyIncomeText =
    _ddStrategy === 'pct'
      ? `${fmtEur(firstMonthWithdrawal)}/mo`
      : `${fmtEur(_ddWithdrawalParam)}/mo`;

  // Inflation-adjusted (real) drawdown series
  const ddShowReal = _inflationRate > 0 && ddSeries.length > 0;
  const ddRealSeries = ddShowReal ? _deflateByInflation(ddSeries, _inflationRate) : null;

  // Break-even (sustainable) monthly withdrawal: the amount where growth exactly offsets withdrawals.
  // Above this level the balance declines; near this level small changes have an outsized effect.
  const breakEvenMonthly =
    corpus && corpus.liquidCorpus > 0 && _ddReturnPct > 0
      ? Math.round(corpus.liquidCorpus * (Math.pow(1 + _ddReturnPct / 100, 1 / 12) - 1))
      : 0;

  // Corpus summary note
  const corpusNote =
    corpus && corpus.lockedCorpus > 0
      ? `Starting corpus: ${fmtEur(corpus.liquidCorpus)} liquid` +
        corpus.lockedGroups
          .map((g) => ` + ${fmtEur(g.corpus)} locked (unlocks ${g.unlockYear})`)
          .join('') +
        `. Chart uses liquid portion only.`
      : corpus
        ? `Starting corpus: ${fmtEur(corpus.liquidCorpus)} (projected at ${fmtMon(_ddRetirementDate)}).`
        : '';

  const withdrawalLabel =
    _ddStrategy === 'pct' ? 'Annual withdrawal rate (%/yr)' : 'Monthly withdrawal (€)';
  const withdrawalStep = _ddStrategy === 'pct' ? '0.1' : '100';
  const withdrawalMin = _ddStrategy === 'pct' ? '0.1' : '0';
  const withdrawalMax = _ddStrategy === 'pct' ? '100' : '';

  // Warn when within ±20% of break-even — in this zone, €/month changes cause nonlinear outcomes.
  const nearBreakEven =
    _ddStrategy !== 'pct' &&
    breakEvenMonthly > 0 &&
    _ddWithdrawalParam > 0 &&
    Math.abs(_ddWithdrawalParam - breakEvenMonthly) / breakEvenMonthly < 0.2;

  el.innerHTML = `
      <div class="dd-inputs-grid">
        <div>
          <label class="planning-label" for="dd-retirement-date">Retirement date</label>
          <div class="planning-input-wrap">
            <input id="dd-retirement-date" class="planning-input" type="month"
                   value="${_ddRetirementDate}" min="${latestSnap.date.substring(0, 7)}"
                   style="width:9rem;text-align:left" aria-label="Retirement start date">
          </div>
        </div>
        <div>
          <label class="planning-label" for="dd-strategy">Withdrawal strategy</label>
          <div class="range-toggle" id="dd-strategy-toggle" style="margin-top:2px" role="group" aria-label="Withdrawal strategy">
            <button class="btn btn-sm btn-ghost${_ddStrategy === 'fixed' ? ' active' : ''}" data-dd-strategy="fixed" aria-pressed="${_ddStrategy === 'fixed'}">Fixed</button>
            <button class="btn btn-sm btn-ghost${_ddStrategy === 'four-pct' ? ' active' : ''}" data-dd-strategy="four-pct" aria-pressed="${_ddStrategy === 'four-pct'}">4% rule</button>
            <button class="btn btn-sm btn-ghost${_ddStrategy === 'pct' ? ' active' : ''}" data-dd-strategy="pct" aria-pressed="${_ddStrategy === 'pct'}">% of portfolio</button>
          </div>
        </div>
        <div>
          <label class="planning-label" for="dd-withdrawal">${withdrawalLabel}</label>
          <div class="planning-input-wrap">
            <input id="dd-withdrawal" class="planning-input" type="number" inputmode="decimal"
                   min="${withdrawalMin}"${withdrawalMax ? ` max="${withdrawalMax}"` : ''} step="${withdrawalStep}" value="${_ddWithdrawalParam}"
                   style="width:7rem" aria-label="${withdrawalLabel}">
          </div>
        </div>
        <div>
          <label class="planning-label" for="dd-return">Expected annual return in retirement (%/yr)</label>
          <div class="planning-input-wrap" style="display:flex;align-items:center;gap:.5rem">
            <input id="dd-return" class="planning-input" type="number" inputmode="decimal"
                   min="0" max="20" step="0.1" value="${_ddReturnPct}"
                   style="width:5rem" aria-label="Expected annual return in retirement">
            ${_ddReturnPctManual ? '<span class="badge badge-info" style="font-size:.7rem;padding:2px 6px;white-space:nowrap">⚙ Manual</span><button id="dd-return-reset" class="btn btn-sm btn-ghost" type="button" style="font-size:.75rem;padding:2px 8px" title="Reset to auto-derived value from account configuration">Reset to auto</button>' : ''}
          </div>
        </div>
      </div>
      ${
        corpus && corpus.liquidCorpus > 0 && _ddWithdrawalParam > 0
          ? `<div class="kpi-row" style="margin-bottom:.75rem">
              ${kpiTile({
                label: `Portfolio lasts until${infoTip('When the liquid portfolio balance reaches zero. "Never" means it does not deplete within 40 years.')}`,
                value: endMonth ? fmtMon(endMonth) : '40+ years',
                sub: lastsText,
              })}
              ${kpiTile({
                label: `Monthly withdrawal${infoTip('Actual monthly withdrawal amount. For % of portfolio strategy this is the first-year implied amount.')}`,
                value: monthlyIncomeText,
                sub:
                  _ddStrategy === 'pct'
                    ? 'first year; shrinks as balance falls'
                    : 'constant amount',
              })}
              ${
                breakEvenMonthly > 0 && _ddStrategy !== 'pct'
                  ? kpiTile({
                      label: `Estimated sustainable withdrawal${infoTip('The monthly amount where portfolio growth exactly offsets withdrawals. Above this the balance declines; below it, the balance grows. Results are highly sensitive to changes near this threshold.')}`,
                      value: `${fmtEur(breakEvenMonthly)}/mo`,
                      sub:
                        _ddWithdrawalParam > breakEvenMonthly
                          ? 'withdrawing above sustainable rate'
                          : 'withdrawing below sustainable rate',
                    })
                  : ''
              }
            </div>
            ${
              nearBreakEven
                ? `<div class="status-bar status-info" style="margin-bottom:.75rem">
                    ℹ️ Your withdrawal is near the sustainable rate (${fmtEur(breakEvenMonthly)}/mo). In this zone, small changes (e.g. ${fmtEur(1000)}/mo) cause large differences over 40 years due to compounding.
                  </div>`
                : ''
            }
            <div class="chart-wrap chart-h-lg"><canvas id="c-nw-decumulation" role="img" aria-label="Retirement drawdown chart" aria-describedby="c-nw-decumulation-table-wrap"></canvas></div>
            <div class="chart-data-table-wrap sr-only" id="c-nw-decumulation-table-wrap"></div>`
          : `<p class="note" style="color:var(--ink-3)">
              ${
                !corpus || corpus.liquidCorpus <= 0
                  ? 'Set a retirement date that is after your latest snapshot to project the starting corpus.'
                  : 'Enter a withdrawal amount to see the drawdown projection.'
              }
             </p>`
      }
      <div class="note" style="margin-top:.5rem;line-height:1.5">
        ${corpusNote ? `<div>${corpusNote}</div>` : ''}
        <div style="color:var(--ink-4);margin-top:2px">Withdrawal amounts are pre-tax, so actual spendable income will be lower depending on your tax situation. Projection uses a fixed annual return and does not model sequence-of-returns risk (an early-retirement market decline would deplete the portfolio faster than shown).${_inflationRate > 0 ? ` Chart shows real (inflation-adjusted) values at ${_inflationRate}% annual inflation.` : ' Return during retirement defaults to the value-weighted average of your configured account returns.'}</div>
      </div>
    `;

  // Render chart if we have data
  _destroyChart('c-nw-decumulation');
  if (ddSeries.length > 0 && corpus && corpus.liquidCorpus > 0) {
    const canvas = document.getElementById('c-nw-decumulation') as HTMLCanvasElement | null;
    if (canvas) {
      const labels = ddSeries.map((p) => fmtMon(p.month));
      const nominalValues = ddSeries.map((p) => p.value);
      const displayValues = ddRealSeries ? ddRealSeries.map((p) => p.value) : nominalValues;
      const startingCorpus = corpus.liquidCorpus;

      CH['c-nw-decumulation'] = new Chart(canvas, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: ddShowReal
                ? `Portfolio balance (real, ${_inflationRate}% inflation)`
                : 'Portfolio balance',
              data: displayValues,
              borderColor: C.brand,
              backgroundColor: 'rgba(42,120,214,0.08)',
              borderWidth: 2,
              pointRadius: 0,
              fill: true,
              tension: 0.3,
              spanGaps: false,
            },
            {
              label: 'Starting corpus',
              data: new Array(displayValues.length).fill(startingCorpus),
              borderColor: C.ink4,
              borderWidth: 1,
              borderDash: [4, 4],
              pointRadius: 0,
              fill: false,
              tension: 0,
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
                  ctx.raw != null ? ` ${ctx.dataset.label}: ${fmtEur(ctx.raw as number)}` : '',
                labelColor: tooltipSwatch(C.surface),
              },
            },
          },
          scales: {
            y: {
              min: 0,
              grid: { color: C.line },
              ticks: {
                color: C.ink4,
                callback: (v) => formatEuroCompactPrefix(v),
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

      // Write accessible data table for screen readers / keyboard users
      const ddFmt = (v: number) => fmtEur2(v);
      const ddTableHeaders = ddShowReal
        ? ['Month', `Balance real (€)`, 'Balance nominal (€)', 'Withdrawal (€)']
        : ['Month', 'Balance (€)', 'Withdrawal (€)'];
      writeChartTable(
        'c-nw-decumulation-table-wrap',
        'Retirement drawdown data',
        ddTableHeaders,
        labels.map((lbl, i) =>
          ddShowReal
            ? [lbl, ddFmt(displayValues[i]), ddFmt(nominalValues[i]), ddFmt(ddSeries[i].withdrawal)]
            : [lbl, ddFmt(nominalValues[i]), ddFmt(ddSeries[i].withdrawal)],
        ),
      );
    }
  }

  // Bind controls (only once per render; old listeners are discarded with innerHTML replacement)
  const dateInput = document.getElementById('dd-retirement-date') as HTMLInputElement | null;
  const withdrawalInput = document.getElementById('dd-withdrawal') as HTMLInputElement | null;
  const returnInput = document.getElementById('dd-return') as HTMLInputElement | null;
  const strategyToggle = document.getElementById('dd-strategy-toggle') as HTMLElement | null;

  const rerender = () => _renderDecumulationCard(snaps, accounts);

  dateInput?.addEventListener('change', () => {
    const v = dateInput.value.trim();
    if (/^\d{4}-\d{2}$/.test(v) && v > latestSnap.date.substring(0, 7)) {
      _ddRetirementDate = v;
      _ddWithdrawalParam = 0; // reset so it's re-derived from new corpus
      void setSetting('dd_retirement_date', _ddRetirementDate);
      rerender();
    }
  });

  withdrawalInput?.addEventListener('change', () => {
    const v = parseFloat(withdrawalInput.value);
    if (isFinite(v) && v >= 0 && (_ddStrategy !== 'pct' || v <= 100)) {
      withdrawalInput.removeAttribute('aria-invalid');
      _ddWithdrawalParam = v;
      void setSetting('dd_withdrawal_param', String(_ddWithdrawalParam));
      rerender();
    } else {
      withdrawalInput.setAttribute('aria-invalid', 'true');
    }
  });

  returnInput?.addEventListener('change', () => {
    const v = parseFloat(returnInput.value);
    if (isFinite(v) && v >= 0) {
      returnInput.removeAttribute('aria-invalid');
      _ddReturnPct = Math.min(v, 20);
      _ddReturnPctManual = true;
      void setSetting('dd_return_pct', String(_ddReturnPct));
      rerender();
    } else {
      returnInput.setAttribute('aria-invalid', 'true');
    }
  });

  const resetReturnBtn = document.getElementById('dd-return-reset') as HTMLButtonElement | null;
  resetReturnBtn?.addEventListener('click', () => {
    _ddReturnPctManual = false;
    _ddReturnPct = 0; // will be re-derived on next render
    void setSettings({ dd_return_pct: null });
    rerender();
  });

  strategyToggle?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-dd-strategy]') as HTMLElement | null;
    if (!btn) return;
    const newStrategy = btn.dataset.ddStrategy as DecumulationStrategy;
    if (newStrategy === _ddStrategy) return;
    _ddStrategy = newStrategy;
    _ddWithdrawalParam = 0; // reset so it's re-derived for new strategy
    void setSetting('dd_strategy', _ddStrategy);
    rerender();
  });

  // Re-bind any infoTips rendered in this card (needed on every re-render)
  attachInfoTips(el);
}
