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
import { SCENARIOS_ICON, SCENARIOS_OFF_ICON } from './icons';
import { infoTip, attachInfoTips } from '../ui/infoTip';
import {
  addMonths,
  axisTooltip,
  disposeChart,
  fmtEurCompact,
  monthPresets,
  monthTimeAxis,
  monthToTime,
  renderChart,
  timeToMonth,
  toRgba,
} from './charts';

type Pt = [number, number];
const FORECAST_RANGE_SHORT: Record<string, string> = {
  '60': '5Y',
  '120': '10Y',
  '240': '20Y',
  '360': '30Y',
  '480': '40Y',
  '600': '50Y',
};
let _fcRange: '60' | '120' | '240' | '360' | '480' | '600' = '60'; // 5y / 10y / 20y / 30y / 40y / 50y forecast horizon
let _inflationRate = 0; // annual inflation % for real-return forecast overlay
let _lastSnaps: Snapshot[] = [];
let _lastAccounts: Account[] = [];
let _activeGoalIdx = 0; // which goal tab is selected in the consolidated goals card
type ForecastScenario = {
  id: 'optimistic' | 'pessimistic';
  label: string;
  returnDeltaPct: number;
  contribDeltaAmt: number; // €/month at portfolio level
  color: string;
};
const _SCN_STORAGE_KEY: Record<'optimistic' | 'pessimistic', string> = {
  optimistic: 'wt_scn_optimistic',
  pessimistic: 'wt_scn_pessimistic',
};

function _loadScenarioFromStorage(
  id: 'optimistic' | 'pessimistic',
  defaults: { returnDeltaPct: number; contribDeltaAmt: number },
): { returnDeltaPct: number; contribDeltaAmt: number } {
  try {
    const raw = localStorage.getItem(_SCN_STORAGE_KEY[id]);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') {
      const p = parsed as Record<string, unknown>;
      const ret =
        typeof p['returnDeltaPct'] === 'number' ? p['returnDeltaPct'] : defaults.returnDeltaPct;
      const contrib =
        typeof p['contribDeltaAmt'] === 'number' ? p['contribDeltaAmt'] : defaults.contribDeltaAmt;
      return { returnDeltaPct: ret, contribDeltaAmt: contrib };
    }
  } catch {
    // ignore
  }
  return defaults;
}

function _saveScenarioToStorage(scenario: ForecastScenario): void {
  try {
    localStorage.setItem(
      _SCN_STORAGE_KEY[scenario.id],
      JSON.stringify({
        returnDeltaPct: scenario.returnDeltaPct,
        contribDeltaAmt: scenario.contribDeltaAmt,
      }),
    );
  } catch {
    // ignore
  }
}

function _defaultForecastScenarios(): ForecastScenario[] {
  const optDefaults = { returnDeltaPct: 2, contribDeltaAmt: 200 };
  const pesDefaults = { returnDeltaPct: -2, contribDeltaAmt: -200 };
  const opt = _loadScenarioFromStorage('optimistic', optDefaults);
  const pes = _loadScenarioFromStorage('pessimistic', pesDefaults);
  return [
    {
      id: 'optimistic',
      label: 'Optimistic',
      returnDeltaPct: opt.returnDeltaPct,
      contribDeltaAmt: opt.contribDeltaAmt,
      color: 'rgba(45,170,90,0.95)',
    },
    {
      id: 'pessimistic',
      label: 'Pessimistic',
      returnDeltaPct: pes.returnDeltaPct,
      contribDeltaAmt: pes.contribDeltaAmt,
      color: 'rgba(220,95,95,0.95)',
    },
  ];
}
let _scenarios: ForecastScenario[] = _defaultForecastScenarios();

// ── Decumulation card state ──────────────────────────────
let _ddRetirementDate = ''; // e.g. "2060-01"; empty = not set
let _ddStrategy: DecumulationStrategy = 'fixed';
let _ddWithdrawalParam = 0; // €/month for fixed/four-pct; annual % for pct
let _ddReturnPct = 0; // annual return % during retirement; 0 = derive from accounts on each render
let _ddReturnPctManual = false; // true once user has edited the return-rate input
let _stateLoaded = false; // tracks whether persisted settings have been loaded into module state
let _planningTab: 'forecast' | 'drawdown' = 'forecast'; // active tab in the combined planning card
let _showScenarioComparison = false; // forecast comparison panel + scenario lines visibility

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

function _accountGroupLabel(a: Account): string {
  return (a.group || '').trim() || 'Unspecified';
}

function _buildForecastGroupSummary(
  latestSnap: Snapshot,
  latestDate: string,
  forecastMonths: number,
  accounts: Account[],
  accountInputs: AccountForecastInput[],
): string {
  if (accounts.length === 0) return '';
  const grouped = new Map<string, { current: number; projected: number }>();
  const groups = [...new Set(accounts.map(_accountGroupLabel))];
  for (const group of groups) {
    const idxs = accounts
      .map((a, idx) => ({ a, idx }))
      .filter(({ a }) => _accountGroupLabel(a) === group)
      .map(({ idx }) => idx);
    const current = idxs.reduce((sum, idx) => {
      const key = accounts[idx]?.id || '';
      return sum + (((latestSnap[key] as number) || 0) ?? 0);
    }, 0);
    const grpInputs = idxs.map((idx) => accountInputs[idx]).filter(Boolean);
    const grpSeries =
      grpInputs.length > 0 ? forecastMultiAccountSeries(grpInputs, forecastMonths, latestDate) : [];
    const projected =
      grpSeries.length > 0 ? grpSeries[grpSeries.length - 1].value : Math.round(current);
    grouped.set(group, { current, projected });
  }
  return [...grouped.entries()]
    .sort((a, b) => b[1].projected - a[1].projected)
    .map(
      ([group, values]) =>
        `<span style="color:var(--ink-2)">${esc(group)}: ${fmtEur2(values.current)} now → ${fmtEur2(values.projected)} projected</span>`,
    )
    .join('<br>');
}

function _clampScenarioReturnDelta(v: number): number {
  if (!isFinite(v)) return 0;
  return Math.max(-30, Math.min(30, v));
}

function _clampScenarioContributionDelta(v: number): number {
  if (!isFinite(v)) return 0;
  return Math.max(-5000, Math.min(5000, v));
}

function _applyScenarioToAccountInputs(
  accountInputs: AccountForecastInput[],
  accounts: Account[],
  scenario: ForecastScenario,
): AccountForecastInput[] {
  const adjusted = accountInputs.map((a) => ({
    ...a,
    annualReturnPct: Math.max(-100, Math.min(100, a.annualReturnPct + scenario.returnDeltaPct)),
  }));

  if (adjusted.length === 0 || scenario.contribDeltaAmt === 0) return adjusted;

  const annualDelta = scenario.contribDeltaAmt * 12;
  const targetIdx = accounts.findIndex((a) => _isPrimaryInvestmentAccount(a));
  const idx = targetIdx >= 0 ? targetIdx : 0;
  adjusted[idx] = {
    ...adjusted[idx],
    annualContrib: Math.max(0, adjusted[idx].annualContrib + annualDelta),
  };
  return adjusted;
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

  const reachedCount = valid.filter(
    (ms) => liquidTotal >= parseFloat(ms.targetAmount.replace(/\./g, '').replace(',', '.')),
  ).length;
  return `<details class="inline-details goal-milestones">
    <summary>Milestones<span class="inline-details-sub">${reachedCount} of ${valid.length} reached</span></summary>
    ${rows}
  </details>`;
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
        ? `<p class="note" style="margin-top:4px">Counted now leaves out ${fmtEur(lockedTotal)} in locked accounts (such as pensions) until their unlock year.</p>`
        : '';
    const panelHtml = `
      <div class="goal-stats">
        <div class="goal-stat"><span class="goal-stat-label">Counted now</span><span class="goal-stat-val">${fmtEur(liquidTotal)}</span></div>
        <div class="goal-stat"><span class="goal-stat-label">Target</span><span class="goal-stat-val">${fmtEur(target)}</span></div>
        <div class="goal-stat"><span class="goal-stat-label">Remaining</span><span class="goal-stat-val">${fmtEur(remaining)}</span></div>
      </div>
      <div class="goal-progress">
        <div class="goal-progress-bar" style="position:relative;height:8px;background:var(--surface-3);border-radius:var(--radius-xs);overflow:hidden">
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
        <div class="goal-progress-label">${fmtPctVal(Math.min(100, (liquidTotal / target) * 100))} complete</div>
      </div>
      <p class="goal-eta"><span class="goal-stat-label">Estimated date${infoTip('Estimated dates assume your current return and contribution settings.')}</span> ${etaText}${_inflationRate > 0 ? ' <span class="note">ETA is in nominal terms; inflation is not factored in.</span>' : ''}</p>
      ${lockedNote}
      ${_renderMilestonesSection(goal.milestones ?? [], liquidTotal, target, accountInputs)}`;
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
  _scenarios = [
    {
      id: 'optimistic',
      label: 'Optimistic',
      returnDeltaPct: 2,
      contribDeltaAmt: 200,
      color: 'rgba(45,170,90,0.95)',
    },
    {
      id: 'pessimistic',
      label: 'Pessimistic',
      returnDeltaPct: -2,
      contribDeltaAmt: -200,
      color: 'rgba(220,95,95,0.95)',
    },
  ];
  _showScenarioComparison = false;
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

  // Currency map for non-EUR indicator in per-account KPIs
  const acctCurrencyMap = new Map(
    accounts.map((a) => [a.id || a.key || '', (a.currency || 'EUR').trim().toUpperCase()]),
  );

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
        <div class="kpi-label">Liquid${infoTip('Accounts not marked as locked in Settings → Accounts. Investments can still take time to sell and their value can change, so this is not the same as cash ready to spend.')}</div>
        <div class="kpi-val">${fmtEur2(liquid)}</div>
        <div class="kpi-sub">${fmtPctVal(total > 0 ? (liquid / total) * 100 : 0)} of total</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Locked${infoTip('Accounts marked as locked in Settings → Accounts, such as pensions. Goals start counting them after their configured unlock year.')}</div>
        <div class="kpi-val">${fmtEur2(locked)}</div>
        <div class="kpi-sub">${lockedSub}</div>
      </div>`;
    })()}
  `;

  const chartA = ACCTS.filter((a) => snaps.some((sn) => ((sn[a.key] as number) || 0) > 0));

  // Chart title + history chart
  document.getElementById('nw-chart-title')!.textContent =
    snaps.length === 1
      ? 'Account breakdown: ' +
        fmtMon(snaps[0].date) +
        ' (add more snapshots to see growth over time)'
      : 'Net worth over time: total + per account';

  if (snaps.length === 1) _renderNWBreakdownChart(s, chartA);
  else _renderNWHistChart(snaps, chartA);

  const bkA = ACCTS.filter((a) => ((s[a.key] as number) || 0) > 0);

  let det = bkA
    .map((a) => {
      const val = (s[a.key] as number) || 0;
      const acctCagr = acctCagrMap.get(a.key);
      const currency = acctCurrencyMap.get(a.key) || 'EUR';
      const meta = [`${fmtPctVal(total > 0 ? (val / total) * 100 : 0)} of total`];
      if (currency !== 'EUR') meta.push(`in ${esc(currency)}`);
      const cagr =
        acctCagr && acctCagr.cagrValue !== null
          ? ` · <span class="${acctCagr.cagrValue >= 0 ? 'pos' : 'neg'}">CAGR ${fmtPctNeg(acctCagr.cagrValue * 100)} (${acctCagr.monthsSpan}m)</span>`
          : '';
      return `<div class="row nw-acct-row">
        <div class="row-label"><span class="nw-acct-swatch" style="background:${safeColor(a.color)}" aria-hidden="true"></span><span class="nw-acct-text"><span class="nw-acct-name">${esc(a.label)}</span><span class="nw-acct-meta">${meta.join(' · ')}${cagr}</span></span></div>
        <div class="row-val">${fmtEur2(val)}</div></div>`;
    })
    .join('');
  // Previous-snapshot change sits under the total so the card does not need a separate row.
  const totalChange = prev
    ? `<span class="nw-acct-meta">vs ${fmtMon(prev.date)} <span class="${total - prevT! >= 0 ? 'pos' : 'neg'}">${fmtEurSigned(total - prevT!, 2)}</span></span>`
    : '';
  det += `<div class="row nw-acct-row" style="border-top:1px solid var(--line-2);margin-top:4px">
    <div class="row-label"><span class="nw-acct-text"><span class="nw-acct-name" style="font-weight:500">Total</span>${totalChange}</span></div>
    <div class="row-val" style="font-weight:500">${fmtEur2(total)}</div></div>`;
  if (s.notes) det += `<p class="note" style="margin-top:.5rem">${esc(s.notes)}</p>`;
  document.getElementById('nw-detail')!.innerHTML = det;
  const detailTitle = document.getElementById('nw-detail-title');
  if (detailTitle)
    detailTitle.innerHTML = `Accounts · ${fmtMon(s.date)} snapshot${infoTip('CAGR is the yearly growth rate of each account balance between its first and latest snapshots with a balance (shown after 12 months). It includes money you added or withdrew, so it is not the same as your investment return.')}`;

  // Goal progress cards (one per named goal)
  _renderGoalCards();

  // Forecast + retirement planning card (tabbed)
  _renderPlanningCard(snaps, accounts);

  attachInfoTips(document.getElementById('networth')!);
}

// ── History chart (total + per-account lines) ──

type ChartAccount = { key: string; label: string; color: string };

function _renderNWBreakdownChart(s: Snapshot, chartA: ChartAccount[]): void {
  renderChart(
    'c-nw-hist',
    ({ tokens: t, width }) => ({
      tooltip: {
        trigger: 'axis',
        confine: true,
        axisPointer: { type: 'shadow' },
        valueFormatter: (v) => fmtEur2(Number(v)),
      },
      grid: { left: 4, right: 52, top: 36, bottom: 4, containLabel: true },
      xAxis: { type: 'value', axisLabel: { formatter: fmtEurCompact } },
      yAxis: {
        type: 'category',
        inverse: true,
        data: chartA.map((a) => a.label),
        axisTick: { show: false },
        axisLabel: {
          color: t.ink2,
          fontSize: 12,
          // Long account names would otherwise squeeze the bars on narrow screens.
          width: width > 0 ? Math.max(90, Math.round(width * 0.38)) : 180,
          overflow: 'truncate',
        },
      },
      series: [
        {
          name: 'Value',
          label: {
            show: true,
            position: 'right',
            color: t.ink2,
            fontSize: 11,
            formatter: (p: { value: unknown }) => fmtEurCompact(Number(p.value)),
          },
          type: 'bar',
          barMaxWidth: 28,
          data: chartA.map((a) => ({
            value: (s[a.key] as number) || 0,
            itemStyle: { color: safeColor(a.color), borderRadius: [0, 4, 4, 0] },
          })),
        },
      ],
    }),
    { valueFormatter: fmtEur2 },
  );
}

function _renderNWHistChart(snaps: Snapshot[], chartA: ChartAccount[]): void {
  const times = snaps.map((sn) => monthToTime(sn.date));
  const notes = new Map(
    snaps.map((sn, i) => [times[i], String(sn.notes || '').trim()] as [number, string]),
  );
  const last = times[times.length - 1];
  const totalName = 'Total net worth';

  renderChart(
    'c-nw-hist',
    ({ tokens: t }) => ({
      legend: {
        data: [totalName, ...chartA.map((a) => a.label)],
        // Total stays visible: it is the reference line for every account.
        selector: false,
      },
      tooltip: {
        trigger: 'axis',
        confine: true,
        order: 'seriesAsc',
        formatter: axisTooltip({
          value: (v) => fmtEur2(v),
          note: (axisValue) => {
            const note = notes.get(Number(axisValue));
            return note ? `Note: ${note}` : null;
          },
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
          name: totalName,
          type: 'line',
          z: 3,
          data: snaps.map((sn, i) => [times[i], snapTotal(sn)]),
          showSymbol: false,
          smooth: 0.2,
          lineStyle: { width: 2.5, color: t.brand },
          itemStyle: { color: t.brand },
          emphasis: { focus: 'series' },
          markPoint: {
            symbol: 'circle',
            symbolSize: 7,
            itemStyle: { color: t.brand, borderColor: t.surface, borderWidth: 1.5 },
            label: { show: false },
            data: snaps
              .map((sn, i) => ({ sn, t: times[i] }))
              .filter(({ t: time }) => notes.get(time))
              .map(({ sn, t: time }) => ({ name: 'Note', coord: [time, snapTotal(sn)] })),
          },
        },
        ...chartA.map((a) => ({
          name: a.label,
          type: 'line' as const,
          data: snaps.map((sn, i) => [times[i], (sn[a.key] as number) || 0]),
          showSymbol: false,
          lineStyle: { width: 1.25, color: safeColor(a.color) },
          itemStyle: { color: safeColor(a.color) },
          emphasis: { focus: 'series' as const },
        })),
      ],
    }),
    {
      zoom: true,
      xAxisType: 'time',
      presets: monthPresets(last),
      defaultPreset: 'all',
      valueFormatter: fmtEur2,
    },
  );
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
      <div class="forecast-inflation">
        <label for="nw-forecast-inflation" class="forecast-inflation-label">Annual inflation (%/yr)</label>${infoTip(`${inflHint} Applies to Forecast and Retirement withdrawals.`)}
        <div class="forecast-inflation-input-wrap">
          <input id="nw-forecast-inflation" class="forecast-inflation-input" type="number" inputmode="decimal" min="0" max="20" step="0.1"
                 value="${_inflationRate}"
                 aria-label="Annual inflation rate for real-return projection">
        </div>
      </div>
      <div class="range-toggle" id="nw-planning-tabs" role="tablist" aria-label="Projections" style="margin-bottom:.75rem">
        <button class="btn btn-sm btn-ghost${_planningTab === 'forecast' ? ' active' : ''}" role="tab" aria-selected="${_planningTab === 'forecast'}" aria-controls="nw-fc-panel" data-planning-tab="forecast">Forecast</button>
        <button class="btn btn-sm btn-ghost${_planningTab === 'drawdown' ? ' active' : ''}" role="tab" aria-selected="${_planningTab === 'drawdown'}" aria-controls="nw-dd-panel" data-planning-tab="drawdown">Retirement withdrawals</button>
      </div>
      <div id="nw-fc-panel" role="tabpanel"${_planningTab !== 'forecast' ? ' hidden' : ''}></div>
      <div id="nw-dd-panel" role="tabpanel"${_planningTab !== 'drawdown' ? ' hidden' : ''}></div>
    </div>`;
  attachInfoTips(el);

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

// ── Forecast chart ──

const FORECAST_MAX_MONTHS = 600;
const FORECAST_HORIZONS = ['60', '120', '240', '360', '480', '600'] as const;

function _forecastGroupSummaryHtml(groupSummaryLines: string): string {
  return groupSummaryLines
    ? `<div style="margin:8px 0 4px">Grouped forecast summary (current → ${esc(FORECAST_RANGE_LABELS[_fcRange] || 'horizon')}):</div>${groupSummaryLines}`
    : '';
}

function _renderForecastChart(snaps: Snapshot[], accounts: Account[]): void {
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
  const baselineSeries = forecastMultiAccountSeries(accountInputs, FORECAST_MAX_MONTHS, latestDate);
  const scenarioSeries = _showScenarioComparison
    ? _scenarios.map((scenario) => ({
        scenario,
        series: forecastMultiAccountSeries(
          _applyScenarioToAccountInputs(accountInputs, accounts, scenario),
          FORECAST_MAX_MONTHS,
          latestDate,
        ),
      }))
    : [];

  // Inflation-adjusted (real) series
  const realSeries = _deflateByInflation(baselineSeries, _inflationRate);
  const showReal = _inflationRate > 0;

  // Last 12 months of actual data, then forecast series that start at the latest actual point.
  const historySlice = snaps.slice(-12);
  const histPoints = historySlice.map((sn) => [monthToTime(sn.date), snapTotal(sn)] as Pt);
  const anchor = histPoints[histPoints.length - 1];
  const toPoints = (series: Array<{ month: string; value: number }>): Pt[] => [
    anchor,
    ...series.map((p) => [monthToTime(p.month), p.value] as Pt),
  ];
  const baselinePoints = toPoints(baselineSeries);
  const realPoints = showReal ? toPoints(realSeries) : null;
  const scenarioPoints = scenarioSeries.map((x) => ({
    scenario: x.scenario,
    points: toPoints(x.series),
  }));
  const histStart = histPoints[0][0];
  const today = anchor[0];
  const horizonEnd = baselinePoints[baselinePoints.length - 1][0];

  const DEADLINE_COLORS = ['#e8961e', '#c050c8', '#1ebeb4', '#dc3c3c'];
  const goalDeadlines: Array<{
    title: string;
    time: number;
    color: string;
    targetNW: number | null;
  }> = [];
  getGoals().forEach((g, gi) => {
    const dl = (g.targetDate || '').trim();
    if (!/^\d{4}-\d{2}$/.test(dl)) return;
    const rawNW = (g.targetNetWorth || '').replace(/\./g, '').replace(',', '.');
    const targetNW = parseFloat(rawNW);
    // Skip goals already reached
    if (!isNaN(targetNW) && targetNW > 0 && snapTotal(latestSnap) >= targetNW) return;
    const time = monthToTime(dl);
    if (time < histStart || time > horizonEnd) return;
    goalDeadlines.push({
      title: g.label || `Goal ${gi + 1}`,
      time,
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
  const groupSummaryLines = _buildForecastGroupSummary(
    latestSnap,
    latestDate,
    forecastMonths,
    accounts,
    accountInputs,
  );

  forecastEl.innerHTML = `
      <div class="forecast-controls-right">
        <button
          id="nw-scenario-toggle"
          class="btn btn-sm btn-ghost scenario-toggle-btn ${_showScenarioComparison ? 'active' : ''}"
          type="button"
          aria-label="${_showScenarioComparison ? 'Hide scenario comparison' : 'Show scenario comparison'}"
          aria-expanded="${_showScenarioComparison}"
          title="${_showScenarioComparison ? 'Hide scenario comparison' : 'Show scenario comparison'}"
        >
          ${_showScenarioComparison ? SCENARIOS_OFF_ICON : SCENARIOS_ICON}
        </button>
      </div>
      <div class="forecast-scenario-card"${_showScenarioComparison ? '' : ' hidden'}>
        <div class="forecast-scenario-title">Scenario comparison</div>
        <div class="note forecast-scenario-note">Editable what-if assumptions, not probabilities or guaranteed best/worst cases. The return change is added to every account's yearly return (percentage points). The monthly contribution change is applied to your main investment account.</div>
        ${_scenarios
          .map(
            (scenario) => `
              <div class="forecast-scenario-row">
                <div class="forecast-scenario-label">${esc(scenario.label)}</div>
                <div class="forecast-scenario-fields">
                  <label class="forecast-scenario-field">
                    <span>Return ± pp/yr</span>
                    <input id="nw-scn-${scenario.id}-ret" class="form-input form-input-sm" type="number" inputmode="decimal" min="-30" max="30" step="0.1" value="${scenario.returnDeltaPct}">
                  </label>
                  <label class="forecast-scenario-field">
                    <span>Monthly ± €</span>
                    <input id="nw-scn-${scenario.id}-contrib" class="form-input form-input-sm" type="number" inputmode="decimal" min="-5000" max="5000" step="10" value="${scenario.contribDeltaAmt}">
                  </label>
                </div>
              </div>`,
          )
          .join('')}
      </div>
      <div class="chart-wrap chart-h-lg chart-zoomable"><div id="c-nw-forecast" class="chart-host" role="img" aria-label="Net worth forecast chart"></div></div>
      <p class="note planning-caveat">Illustration, not a prediction: one fixed yearly return per account, before taxes, fees and FX. A downturn near your target could leave you 30–40% below this line; try a lower return too.${goalDeadlines.length > 0 ? ' Goal deadlines and target amounts are shown as markers on the chart.' : ''}</p>
      <details class="inline-details">
        <summary>Assumptions and grouped summary</summary>
        <div class="note" style="line-height:1.6">
          <div style="margin-bottom:4px">Per-account return &amp; contribution assumptions (Settings \u2192 Accounts):</div>
          ${acctSummaryLines}
          <div id="nw-fc-group-summary">${_forecastGroupSummaryHtml(groupSummaryLines)}</div>
          <div style="margin-top:4px;color:var(--ink-4)">Contribution timing follows each configured cadence (weekly, every 2 weeks, monthly, quarterly) and is bucketed month-by-month in the projection.</div>
          <div style="margin-top:4px;color:var(--ink-4)">Assumes zero rebalancing costs; spreads, commissions, and capital-gains tax from rebalancing can reduce long-horizon returns.</div>
        </div>
      </details>
    `;

  const scenarioName = (scenario: ForecastScenario) =>
    `${scenario.label} (${scenario.returnDeltaPct >= 0 ? '+' : ''}${scenario.returnDeltaPct.toFixed(1)}% / ${fmtEurSigned(scenario.contribDeltaAmt, 0)}/mo)`;
  const horizonPresets = FORECAST_HORIZONS.map((key) => ({
    key,
    label: FORECAST_RANGE_SHORT[key],
    startValue: histStart,
    endValue: addMonths(today, parseInt(key)),
  }));

  renderChart(
    'c-nw-forecast',
    ({ tokens: t }) => ({
      legend: {},
      tooltip: {
        trigger: 'axis',
        confine: true,
        formatter: axisTooltip({ value: (v) => fmtEur2(v) }),
      },
      xAxis: monthTimeAxis(),
      yAxis: {
        type: 'value',
        scale: true,
        axisLabel: { formatter: (v: number) => fmtEurCompact(v) },
      },
      series: [
        {
          name: 'Actual',
          type: 'line',
          z: 4,
          data: histPoints,
          showSymbol: false,
          lineStyle: { width: 2.5, color: t.brand },
          itemStyle: { color: t.brand },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { type: 'solid', color: t.line2, width: 1 },
            label: {
              // With a single snapshot "Today" sits on the y-axis; the Forecast label marks it.
              show: histPoints.length > 1,
              formatter: 'Today',
              color: t.ink3,
              fontSize: 10,
              position: 'insideEndTop',
            },
            data: [{ xAxis: today }],
          },
        },
        {
          name: 'Baseline (nominal)',
          type: 'line',
          z: 3,
          data: baselinePoints,
          showSymbol: false,
          smooth: 0.3,
          lineStyle: { width: 2, type: [5, 3], color: t.brand },
          itemStyle: { color: t.brand },
          areaStyle: { origin: 'start', color: toRgba(t.brand, 0.07) },
          markArea: {
            silent: true,
            itemStyle: { color: toRgba(t.brand, 0.03) },
            label: { show: true, position: 'insideTopLeft', color: t.ink4, fontSize: 10 },
            data: [[{ name: 'Forecast', xAxis: today }, { xAxis: horizonEnd }]],
          },
          markLine: goalDeadlines.length
            ? {
                symbol: 'none',
                data: goalDeadlines.map((d) => ({
                  name: d.title,
                  xAxis: d.time,
                  lineStyle: { color: d.color, type: [4, 3], width: 1.5 },
                  label: {
                    formatter: d.title,
                    color: d.color,
                    fontSize: 10,
                    position: 'insideEndTop' as const,
                  },
                })),
              }
            : undefined,
          markPoint: goalDeadlines.some((d) => d.targetNW !== null)
            ? {
                symbol: 'circle',
                symbolSize: 10,
                label: { show: false },
                tooltip: { show: true },
                data: goalDeadlines
                  .filter((d) => d.targetNW !== null)
                  .map((d) => ({
                    name: `${d.title}: ${fmtEur(d.targetNW!)} by ${fmtMon(timeToMonth(d.time))}`,
                    coord: [d.time, d.targetNW!],
                    itemStyle: { color: d.color, borderColor: t.surface, borderWidth: 1.5 },
                  })),
              }
            : undefined,
        },
        ...scenarioPoints.map(({ scenario, points }, idx) => ({
          name: scenarioName(scenario),
          type: 'line' as const,
          data: points,
          showSymbol: false,
          smooth: 0.3,
          lineStyle: { width: 2, type: idx === 0 ? [2, 3] : [8, 3], color: scenario.color },
          itemStyle: { color: scenario.color },
        })),
        ...(realPoints
          ? [
              {
                name: `Real (${_inflationRate}% inflation)`,
                type: 'line' as const,
                data: realPoints,
                showSymbol: false,
                smooth: 0.3,
                lineStyle: { width: 1.5, type: [3, 3], color: t.ink4 },
                itemStyle: { color: t.ink4 },
              },
            ]
          : []),
      ],
    }),
    {
      zoom: true,
      xAxisType: 'time',
      presets: horizonPresets,
      defaultPreset: _fcRange,
      valueFormatter: fmtEur2,
      onPresetChange: (key) => {
        if (!key || key === _fcRange) return;
        _fcRange = key as typeof _fcRange;
        const summaryEl = document.getElementById('nw-fc-group-summary');
        if (summaryEl)
          summaryEl.innerHTML = _forecastGroupSummaryHtml(
            _buildForecastGroupSummary(
              latestSnap,
              latestDate,
              parseInt(_fcRange),
              accounts,
              accountInputs,
            ),
          );
      },
    },
  );

  const scenarioToggle = document.getElementById('nw-scenario-toggle') as HTMLButtonElement | null;
  scenarioToggle?.addEventListener('click', () => {
    _showScenarioComparison = !_showScenarioComparison;
    _renderForecastChart(_lastSnaps, _lastAccounts);
  });
  if (_showScenarioComparison) {
    _scenarios.forEach((scenario) => {
      const retInput = document.getElementById(
        `nw-scn-${scenario.id}-ret`,
      ) as HTMLInputElement | null;
      const contribInput = document.getElementById(
        `nw-scn-${scenario.id}-contrib`,
      ) as HTMLInputElement | null;
      retInput?.addEventListener('change', () => {
        const parsed = parseFloat(retInput.value);
        scenario.returnDeltaPct = _clampScenarioReturnDelta(parsed);
        _saveScenarioToStorage(scenario);
        _renderForecastChart(_lastSnaps, _lastAccounts);
      });
      contribInput?.addEventListener('change', () => {
        const parsed = parseFloat(contribInput.value);
        scenario.contribDeltaAmt = _clampScenarioContributionDelta(parsed);
        _saveScenarioToStorage(scenario);
        _renderForecastChart(_lastSnaps, _lastAccounts);
      });
    });
  }
}

// ── Decumulation chart ──

function _renderDecumulationChart(
  ddSeries: ReturnType<typeof decumulationSeries>,
  ddRealSeries: Array<{ month: string; value: number }> | null,
  startingCorpus: number,
  endMonth: string | null,
): void {
  const times = ddSeries.map((p) => monthToTime(p.month));
  const balanceName = ddRealSeries
    ? `Portfolio balance (real, ${_inflationRate}% inflation)`
    : 'Portfolio balance';
  const balance = (ddRealSeries ?? ddSeries).map((p, i) => [times[i], p.value] as Pt);
  const first = times[0];
  const last = times[times.length - 1];
  const depletion = endMonth ? monthToTime(endMonth) : null;

  renderChart(
    'c-nw-decumulation',
    ({ tokens: t }) => ({
      legend: { selected: { 'Monthly withdrawal': false } },
      tooltip: {
        trigger: 'axis',
        confine: true,
        formatter: axisTooltip({ value: (v) => fmtEur2(v) }),
      },
      xAxis: monthTimeAxis(),
      yAxis: [
        { type: 'value', min: 0, axisLabel: { formatter: fmtEurCompact } },
        {
          type: 'value',
          min: 0,
          splitLine: { show: false },
          axisLabel: { formatter: fmtEurCompact },
        },
      ],
      series: [
        {
          name: balanceName,
          type: 'line',
          z: 3,
          data: balance,
          showSymbol: false,
          smooth: 0.3,
          lineStyle: { width: 2, color: t.brand },
          itemStyle: { color: t.brand },
          areaStyle: { color: toRgba(t.brand, 0.08) },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { type: [4, 4], color: t.ink4, width: 1 },
            label: {
              formatter: `Starting balance ${fmtEurCompact(startingCorpus)}`,
              color: t.ink3,
              fontSize: 10,
              position: 'insideEndTop',
            },
            data: [{ yAxis: startingCorpus }],
          },
          markPoint:
            depletion !== null
              ? {
                  symbol: 'pin',
                  symbolSize: 34,
                  itemStyle: { color: t.neg },
                  label: { color: '#fff', fontSize: 9, formatter: '0' },
                  tooltip: { show: true },
                  data: [
                    {
                      name: `Depleted ${fmtMon(endMonth!)}`,
                      coord: [depletion, 0],
                    },
                  ],
                }
              : undefined,
        },
        ...(ddRealSeries
          ? [
              {
                name: 'Portfolio balance (nominal)',
                type: 'line' as const,
                data: ddSeries.map((p, i) => [times[i], p.value] as Pt),
                showSymbol: false,
                smooth: 0.3,
                lineStyle: { width: 1.25, type: [5, 3], color: t.ink4 },
                itemStyle: { color: t.ink4 },
              },
            ]
          : []),
        {
          name: 'Monthly withdrawal',
          type: 'line',
          yAxisIndex: 1,
          step: 'end',
          data: ddSeries.map((p, i) => [times[i], p.withdrawal] as Pt),
          showSymbol: false,
          lineStyle: { width: 1.25, color: t.warn },
          itemStyle: { color: t.warn },
        },
      ],
    }),
    {
      zoom: true,
      xAxisType: 'time',
      presets: [
        { key: '120', label: '10Y', startValue: first, endValue: addMonths(first, 119) },
        { key: '240', label: '20Y', startValue: first, endValue: addMonths(first, 239) },
        { key: 'all', label: 'All' },
      ],
      defaultPreset: 'all',
      valueFormatter: fmtEur2,
    },
  );
}

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
      ? `Projected starting balance: ${fmtEur(corpus.liquidCorpus)} liquid` +
        corpus.lockedGroups
          .map((g) => ` + ${fmtEur(g.corpus)} locked (unlocks ${g.unlockYear})`)
          .join('') +
        `. Chart uses liquid portion only.`
      : corpus
        ? `Projected starting balance: ${fmtEur(corpus.liquidCorpus)} (at ${fmtMon(_ddRetirementDate)}).`
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
                label: `Portfolio lasts until${infoTip('When the projected liquid balance reaches zero. "40+ years" means it does not run out within the 40-year model, which is not a guarantee that it never will.')}`,
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
                      label: `Break-even withdrawal${infoTip('Model estimate of the monthly amount where projected growth exactly offsets withdrawals. Above it the balance declines; below it, the balance grows. It is not a safe-spending limit, and results are very sensitive near this threshold.')}`,
                      value: `${fmtEur(breakEvenMonthly)}/mo`,
                      sub:
                        _ddWithdrawalParam > breakEvenMonthly
                          ? 'withdrawing above break-even'
                          : 'withdrawing below break-even',
                    })
                  : ''
              }
            </div>
            ${
              nearBreakEven
                ? `<div class="status-bar status-info" style="margin-bottom:.75rem">
                    ℹ️ Your withdrawal is near the break-even amount (${fmtEur(breakEvenMonthly)}/mo). In this zone, small changes (e.g. ${fmtEur(1000)}/mo) cause large differences over 40 years due to compounding.
                  </div>`
                : ''
            }
            <div class="chart-wrap chart-h-lg chart-zoomable"><div id="c-nw-decumulation" class="chart-host" role="img" aria-label="Retirement drawdown chart"></div></div>`
          : `<p class="note" style="color:var(--ink-3)">
              ${
                !corpus || corpus.liquidCorpus <= 0
                  ? 'Set a retirement date that is after your latest snapshot to project the starting balance.'
                  : 'Enter a withdrawal amount to see the retirement withdrawal projection.'
              }
             </p>`
      }
      <div class="note" style="margin-top:.5rem;line-height:1.5">
        ${corpusNote ? `<div>${corpusNote}</div>` : ''}
        <div style="color:var(--ink-4);margin-top:2px">Withdrawal amounts are pre-tax, so actual spendable income will be lower depending on your tax situation. Projection uses a fixed annual return and does not model sequence-of-returns risk (an early-retirement market decline would deplete the portfolio faster than shown).${_inflationRate > 0 ? ` Chart shows real (inflation-adjusted) values at ${_inflationRate}% annual inflation.` : ' Return during retirement defaults to the value-weighted average of your configured account returns.'}</div>
      </div>
    `;

  if (ddSeries.length > 0 && corpus && corpus.liquidCorpus > 0) {
    _renderDecumulationChart(ddSeries, ddRealSeries, corpus.liquidCorpus, endMonth);
  } else {
    disposeChart('c-nw-decumulation');
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
