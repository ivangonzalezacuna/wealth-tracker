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
  /** Per-execution amount when contributions follow target weights at the selected cadence. */
  targetAmt: number;
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
 * For each holding the minimum needed to reach its target by the end of the
 * horizon is:
 *   needToBuy[i] = max(0, projectedTotal × targetPct[i]/100 − currentValue[i])
 *
 * Overweight holdings have a negative raw gap so needToBuy clamps to 0.
 * After computing the total need:
 *   - If totalBudget >= totalNeed: each holding is funded to exactly its target
 *     and the leftover surplus is spread proportionally by target weight (so
 *     overweight holdings do resume partial contributions rather than being
 *     frozen for the whole horizon).
 *   - If totalBudget < totalNeed: each holding's gap is funded proportionally
 *     to its share of the total need (budget is the binding constraint).
 *
 * This means the monthly suggestion varies with the selected horizon — a
 * 12-month window spreads the rebalancing more gradually and will include
 * partial contributions to overweight holdings once the budget covers all
 * underweight gaps, instead of holding them at €0 indefinitely.
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

  const totalBudget = months * totalMonthlyBudget;
  // Projected portfolio value after K months (no market-growth assumption).
  const projectedTotal = totalValue + totalBudget;
  const totalTargetPct = activeDrift.reduce((s, d) => s + d.targetPct, 0);

  // Convert global budget to per-execution amount in the calibration cadence.
  const execsPerYear = INTERVAL_PER_YEAR[calibrationInterval];
  const monthlyFromAmt = (amt: number) => (amt * execsPerYear) / 12;
  const amtFromMonthly = (monthly: number) => (monthly * 12) / execsPerYear;

  // Classify each holding by current drift (badge label only; does not affect amounts).
  const stateOf = (d: DriftEntry): RebalancePlanEntry['state'] =>
    d.driftPct > ON_TARGET_DRIFT_EPS
      ? 'overweight'
      : d.driftPct < -ON_TARGET_DRIFT_EPS
        ? 'underweight'
        : 'on-target';

  // Buy-only optimal allocation: minimum amount each holding needs to reach its
  // target at the end of the horizon, clamped to 0 for overweight holdings.
  const needToBuy = activeDrift.map((d) =>
    Math.max(0, projectedTotal * (d.targetPct / 100) - d.actualValue),
  );
  const totalNeed = needToBuy.reduce((s, n) => s + n, 0);

  // Compute total contributions[i] over the K-month window.
  const kContrib: number[] = [];
  if (totalNeed <= totalBudget + 1e-6) {
    // Budget covers all underweight gaps. Fund each holding to its target, then
    // distribute the surplus proportionally by target weight so that even
    // overweight holdings receive some contributions (at a reduced rate).
    const excess = Math.max(0, totalBudget - totalNeed);
    for (let i = 0; i < activeDrift.length; i++) {
      kContrib.push(needToBuy[i] + excess * (activeDrift[i].targetPct / totalTargetPct));
    }
  } else {
    // Budget is insufficient to close all underweight gaps. Allocate proportionally
    // by each holding's share of the total need; overweight holdings receive 0.
    for (let i = 0; i < activeDrift.length; i++) {
      kContrib.push(totalBudget * (needToBuy[i] / totalNeed));
    }
  }

  const result: RebalancePlanEntry[] = [];
  for (let i = 0; i < activeDrift.length; i++) {
    const d = activeDrift[i];
    const monthlySuggested = kContrib[i] / months;
    const monthlyTarget = totalMonthlyBudget * (d.targetPct / totalTargetPct);
    const suggestedAmt = Math.round(amtFromMonthly(monthlySuggested) * 100) / 100;
    const targetAmt = Math.round(amtFromMonthly(monthlyTarget) * 100) / 100;
    const suggestedPct = Math.round((monthlySuggested / totalMonthlyBudget) * 1000) / 10;

    const newValue = d.actualValue + kContrib[i];
    const newActualPct = (newValue / projectedTotal) * 100;
    const projectedDriftPct = newActualPct - d.targetPct;

    result.push({
      isin: d.isin,
      shortName: d.shortName,
      color: d.color,
      targetAmt,
      suggestedPct,
      suggestedAmt,
      state: stateOf(d),
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
