/**
 * Drift helpers - compare actual allocation vs target and produce rebalance signals.
 */
import type { Holding, EtfPosition, ContribInterval } from '../types';
import { INTERVAL_PER_YEAR } from './contributions';

export interface DriftEntry {
  isin: string;
  name: string;
  shortName: string;
  color: string;
  targetPct: number;
  actualPct: number;
  driftPct: number; // actual - target (positive = overweight)
  actualValue: number;
  targetValue: number;
  deltaValue: number; // actual - target value (positive = sell to rebalance)
  valuationMode: 'cost' | 'market';
}

/**
 * Compute per-holding drift between target allocation and actual allocation
 * (from current cost basis or market value).
 *
 * Target allocation source: explicit strategic targets via holding.targetPct.
 * Holdings without a target (targetPct = 0) are excluded from the target plan
 * but inactive-but-held positions are still shown with target 0% as legacy rows.
 *
 * @param holdings - configured holdings
 * @param positions - current ETF positions from portfolio data
 * @param totalValue - total portfolio value (snapshot primary account value, or sum of costs)
 * @param snapEtfValues - optional ISIN to current market value map from the latest snapshot
 */
export function computeDrift(
  holdings: Holding[],
  positions: Record<string, EtfPosition>,
  totalValue: number,
  snapEtfValues?: Record<string, number>,
): DriftEntry[] {
  if (totalValue <= 0) return [];

  const activeHoldings = holdings.filter((h) => h.active);
  const activeWithTarget = activeHoldings.filter((h) => (h.targetPct ?? 0) > 0);
  if (activeWithTarget.length === 0) return [];
  const totalTargetPct = activeWithTarget.reduce((sum, h) => sum + (h.targetPct ?? 0), 0);
  if (totalTargetPct <= 0) return [];

  const result: DriftEntry[] = [];
  const handledIsins = new Set<string>();

  for (const h of activeWithTarget) {
    handledIsins.add(h.isin);
    const targetPct = ((h.targetPct ?? 0) / totalTargetPct) * 100;

    // Prefer snapshot market value when available; fall back to cost basis.
    const pos = positions[h.isin];
    const snapVal = snapEtfValues?.[h.isin];
    const actualValue = snapVal !== undefined ? snapVal : pos ? pos.cost : 0;
    const actualPct = totalValue > 0 ? (actualValue / totalValue) * 100 : 0;

    const driftPct = actualPct - targetPct;
    const targetValue = (totalValue * targetPct) / 100;
    const deltaValue = actualValue - targetValue;

    result.push({
      isin: h.isin,
      name: h.name || (pos ? pos.name : '') || '',
      shortName: h.shortName,
      color: h.color,
      targetPct: Math.round(targetPct * 10) / 10,
      actualPct: Math.round(actualPct * 10) / 10,
      driftPct: Math.round(driftPct * 10) / 10,
      actualValue,
      targetValue: Math.round(targetValue),
      deltaValue: Math.round(deltaValue),
      valuationMode: snapVal !== undefined ? 'market' : 'cost',
    });
  }

  // Second pass: inactive-but-held positions (target = 0%, not already covered above).
  // These consume portfolio allocation even though they are not part of the target strategy.
  for (const [isin, pos] of Object.entries(positions)) {
    if (handledIsins.has(isin)) continue;
    if (pos.exited || pos.shares < 1e-6) continue;

    const snapVal = snapEtfValues?.[isin];
    const actualValue = snapVal !== undefined ? snapVal : pos.cost;
    if (actualValue <= 0) continue;

    const actualPct = (actualValue / totalValue) * 100;

    result.push({
      isin,
      name: pos.name || '',
      shortName: pos.shortName,
      color: pos.color,
      targetPct: 0,
      actualPct: Math.round(actualPct * 10) / 10,
      driftPct: Math.round(actualPct * 10) / 10,
      actualValue,
      targetValue: 0,
      deltaValue: Math.round(actualValue),
      valuationMode: snapVal !== undefined ? 'market' : 'cost',
    });
  }

  // Sort: non-legacy first, then legacy.
  // Non-legacy: targetPct descending so the table follows configured allocation weights; name ascending as tiebreaker.
  // Legacy: actualPct descending (all have targetPct 0); name ascending as tiebreaker.
  result.sort((a, b) => {
    const aLegacy = a.targetPct === 0 ? 1 : 0;
    const bLegacy = b.targetPct === 0 ? 1 : 0;
    if (aLegacy !== bLegacy) return aLegacy - bLegacy;
    if (aLegacy === 0) {
      if (b.targetPct !== a.targetPct) return b.targetPct - a.targetPct;
    } else {
      if (b.actualPct !== a.actualPct) return b.actualPct - a.actualPct;
    }
    return a.shortName.localeCompare(b.shortName);
  });
  return result;
}

/**
 * Maximum absolute drift across all entries.
 */
export function maxDrift(entries: DriftEntry[]): number {
  if (entries.length === 0) return 0;
  return Math.max(...entries.map((e) => Math.abs(e.driftPct)));
}

// ── Contribution rebalance plan ──────────────────────────────────────────────

/**
 * Drift tolerance in percentage points. Holdings whose current drift falls
 * within this band are considered "on-target" and are not rebalanced.
 */
export const ON_TARGET_DRIFT_EPS = 0.5;

export interface RebalancePlanEntry {
  isin: string;
  shortName: string;
  color: string;
  /** Suggested share of total budget for this holding (0-100). */
  suggestedPct: number;
  /** Suggested amount per execution in the global calibration cadence. */
  suggestedAmt: number;
  /** Rebalance state based on current drift (positive driftPct = overweight). */
  state: 'overweight' | 'on-target' | 'underweight';
  /** Estimated drift percentage remaining after following this plan for K months. */
  projectedDriftPct: number;
}

/**
 * Compute a buy-only contribution rebalance plan that drives allocations back
 * to target over the given number of months.
 *
 * The global monthly budget is redistributed across holdings with targetPct > 0:
 * - On-target holdings (drift within ON_TARGET_DRIFT_EPS) keep their pro-rata share.
 * - Overweight holdings temporarily receive nothing; their freed budget is
 *   redistributed proportionally among underweight holdings.
 * - Total monthly budget is preserved exactly.
 *
 * @param driftEntries       - output of computeDrift; only entries with targetPct > 0 are used
 * @param totalMonthlyBudget - total monthly contribution budget in EUR
 * @param totalValue         - current total portfolio value
 * @param months             - rebalance horizon in months (e.g. 1, 2, 3, 6, 12)
 * @param calibrationInterval - global contribution cadence for the suggested amounts
 */
export function computeRebalancePlan(
  driftEntries: DriftEntry[],
  totalMonthlyBudget: number,
  totalValue: number,
  months: number,
  calibrationInterval: ContribInterval,
): RebalancePlanEntry[] {
  if (months <= 0 || totalValue <= 0 || totalMonthlyBudget <= 0) return [];

  const activeDrift = driftEntries.filter((d) => d.targetPct > 0);
  if (activeDrift.length === 0) return [];

  // Projected portfolio value after K months (no market-growth assumption).
  const projectedTotal = totalValue + months * totalMonthlyBudget;

  // Classify each holding by current drift.
  const onTargetIsins = new Set<string>();
  for (const d of activeDrift) {
    if (Math.abs(d.driftPct) <= ON_TARGET_DRIFT_EPS) {
      onTargetIsins.add(d.isin);
    }
  }

  // On-target holdings receive their proportional share of the budget (locked).
  const totalTargetPct = activeDrift.reduce((s, d) => s + d.targetPct, 0);
  let onTargetMonthly = 0;
  for (const d of activeDrift) {
    if (onTargetIsins.has(d.isin)) {
      onTargetMonthly += totalMonthlyBudget * (d.targetPct / totalTargetPct);
    }
  }
  const availablePool = totalMonthlyBudget - onTargetMonthly;

  // For non-on-target holdings compute the gap to projected target.
  // Overweight holdings are clamped to 0 (buy-only); use current drift to classify.
  const GAP_EPS = 1e-9;
  const gapByIsin = new Map<string, number>();
  const projectedStateByIsin = new Map<string, RebalancePlanEntry['state']>();
  let sumUnderweightGap = 0;
  for (const d of activeDrift) {
    if (onTargetIsins.has(d.isin)) continue;
    // Use current drift direction to determine state (prevents an overweight holding from
    // appearing underweight just because the projected total grows enough to exceed it).
    const state: RebalancePlanEntry['state'] =
      d.driftPct > ON_TARGET_DRIFT_EPS
        ? 'overweight'
        : d.driftPct < -ON_TARGET_DRIFT_EPS
          ? 'underweight'
          : 'on-target';
    const targetAmt = projectedTotal * (d.targetPct / 100);
    const gap = targetAmt - d.actualValue;
    gapByIsin.set(d.isin, gap > GAP_EPS ? gap : 0);
    projectedStateByIsin.set(d.isin, state);
    if (state === 'underweight') sumUnderweightGap += gap > GAP_EPS ? gap : 0;
  }
  if (availablePool <= 0 && onTargetIsins.size === activeDrift.length) return [];

  // Convert global budget to per-execution amount in the calibration cadence.
  const execsPerYear = INTERVAL_PER_YEAR[calibrationInterval];
  const monthlyFromAmt = (amt: number) => (amt * execsPerYear) / 12;
  const amtFromMonthly = (monthly: number) => (monthly * 12) / execsPerYear;

  const result: RebalancePlanEntry[] = [];
  for (const d of activeDrift) {
    const displayState: RebalancePlanEntry['state'] =
      d.driftPct > ON_TARGET_DRIFT_EPS
        ? 'overweight'
        : d.driftPct < -ON_TARGET_DRIFT_EPS
          ? 'underweight'
          : 'on-target';

    let monthlySuggested: number;
    let projectedState: RebalancePlanEntry['state'];

    if (onTargetIsins.has(d.isin)) {
      monthlySuggested = totalMonthlyBudget * (d.targetPct / totalTargetPct);
      projectedState = 'on-target';
    } else {
      const gap = gapByIsin.get(d.isin) ?? 0;
      projectedState = projectedStateByIsin.get(d.isin) ?? 'on-target';
      if (projectedState === 'underweight' && sumUnderweightGap > 0) {
        monthlySuggested = availablePool * (gap / sumUnderweightGap);
      } else {
        // Overweight: hold (zero contribution for this period)
        monthlySuggested = 0;
      }
    }

    const suggestedAmt = Math.round(amtFromMonthly(monthlySuggested) * 100) / 100;
    const suggestedPct = Math.round((monthlySuggested / totalMonthlyBudget) * 1000) / 10;

    // Estimate projected drift after K months with an improved model.
    // When the total redirected budget exceeds the sum of all underweight gaps,
    // the underweight holdings would overshoot their target if the excess is ignored.
    // Instead, cap each underweight holding's contribution at its gap and redistribute
    // the excess pro-rata across all holdings (including formerly overweight ones).
    const totalAvailableContrib = availablePool * months;
    const excessContrib =
      sumUnderweightGap > 0 && totalAvailableContrib > sumUnderweightGap
        ? totalAvailableContrib - sumUnderweightGap
        : 0;

    let kContrib: number;
    if (onTargetIsins.has(d.isin)) {
      kContrib = monthlySuggested * months;
    } else if (projectedState === 'underweight' && sumUnderweightGap > 0) {
      const gap_i = gapByIsin.get(d.isin) ?? 0;
      kContrib = gap_i + excessContrib * (d.targetPct / totalTargetPct);
    } else if (projectedState === 'overweight') {
      kContrib = excessContrib * (d.targetPct / totalTargetPct);
    } else {
      kContrib = 0;
    }
    const newValue = d.actualValue + kContrib;
    const newActualPct = (newValue / projectedTotal) * 100;
    const projectedDriftPct = newActualPct - d.targetPct;

    result.push({
      isin: d.isin,
      shortName: d.shortName,
      color: d.color,
      suggestedPct,
      suggestedAmt,
      state: displayState,
      projectedDriftPct: Math.round(projectedDriftPct * 10) / 10,
    });
  }

  // Normalize to ensure total monthly ≈ budget (guard against rounding).
  const normalizedTotal = result.reduce((sum, e) => sum + monthlyFromAmt(e.suggestedAmt), 0);
  const diffMonthly = totalMonthlyBudget - normalizedTotal;
  if (Math.abs(diffMonthly) > 1e-6 && result.length > 0) {
    const preferred =
      result.find((e) => e.state === 'underweight') ??
      result.find((e) => e.state === 'on-target') ??
      result[0];
    preferred.suggestedAmt = Math.max(
      0,
      Math.round((preferred.suggestedAmt + amtFromMonthly(diffMonthly)) * 100) / 100,
    );
    preferred.suggestedPct =
      Math.round((monthlyFromAmt(preferred.suggestedAmt) / totalMonthlyBudget) * 1000) / 10;
  }

  // Sort to mirror drift table order (targetPct desc, shortName asc).
  result.sort((a, b) => {
    const da = driftEntries.find((d) => d.isin === a.isin);
    const db = driftEntries.find((d) => d.isin === b.isin);
    if (da && db && da.targetPct !== db.targetPct) return db.targetPct - da.targetPct;
    return a.shortName.localeCompare(b.shortName);
  });

  return result;
}
