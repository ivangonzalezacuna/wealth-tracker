/**
 * Drift helpers - compare actual allocation vs target and produce rebalance signals.
 */
import type { Holding, EtfPosition, ContribInterval } from '../types';
import { annualizeContrib, INTERVAL_PER_YEAR } from './contributions';

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
 * Compute per-holding drift between target allocation (from contribution weights)
 * and actual allocation (from current cost basis or market value).
 *
 * Active holdings (contribAmount > 0) drive the target allocation.
 * Inactive-but-held positions (shares > 0, not exited) are included with
 * target 0%, showing how much allocation they currently consume.
 *
 * @param holdings - configured holdings (active ones with contribAmount define target)
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

  // Target allocation: based on annualized contribution weights
  const activeWithTarget = holdings.filter((h) => h.active && h.contribAmount > 0);
  const totalAnnual = activeWithTarget.reduce(
    (sum, h) => sum + annualizeContrib(h.contribAmount, h.contribInterval),
    0,
  );
  if (totalAnnual <= 0) return [];

  const result: DriftEntry[] = [];
  const handledIsins = new Set<string>();
  const hasSnapValues = !!snapEtfValues && Object.keys(snapEtfValues).length > 0;

  for (const h of activeWithTarget) {
    handledIsins.add(h.isin);
    const annual = annualizeContrib(h.contribAmount, h.contribInterval);
    const targetPct = (annual / totalAnnual) * 100;

    // Prefer snapshot market value when available; fall back to cost basis.
    const pos = positions[h.isin];
    const hasMarketForIsin = hasSnapValues && snapEtfValues![h.isin] !== undefined;
    const actualValue = hasMarketForIsin ? snapEtfValues![h.isin] : pos ? pos.cost : 0;
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
      valuationMode: hasMarketForIsin ? 'market' : 'cost',
    });
  }

  // Second pass: inactive-but-held positions (target = 0%, not already covered above).
  // These consume portfolio allocation even though they are not part of the target strategy.
  for (const [isin, pos] of Object.entries(positions)) {
    if (handledIsins.has(isin)) continue;
    if (pos.exited || pos.shares < 1e-6) continue;

    const hasMarketForIsin = hasSnapValues && snapEtfValues![isin] !== undefined;
    const actualValue = hasMarketForIsin ? snapEtfValues![isin] : pos.cost;
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
      valuationMode: hasMarketForIsin ? 'market' : 'cost',
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
  /** Contribution cadence for this holding (from its Holding settings). */
  contribInterval: ContribInterval;
  /** Original contribution amount per execution, in the holding's own cadence. */
  currentContribAmt: number;
  /** Current share of total monthly contributions (0-100). */
  currentContribPct: number;
  /** Suggested contribution amount per execution, in the holding's own cadence. */
  suggestedContribAmt: number;
  /** Suggested share of total monthly contributions (0-100). */
  suggestedContribPct: number;
  /** Difference in monthly share: suggested minus current (percentage points). */
  deltaContribPct: number;
  /** Rebalance state based on current drift (positive driftPct = overweight). */
  state: 'overweight' | 'on-target' | 'underweight';
  /** Estimated drift percentage remaining after following this plan for K months. */
  projectedDriftPct: number;
}

export interface RebalancePlanOptions {
  /** Minimum actionable per-execution contribution delta per interval. */
  minActionByInterval?: Partial<Record<ContribInterval, number>>;
  /** Optional per-execution rounding step per interval. */
  roundingStepByInterval?: Partial<Record<ContribInterval, number>>;
}

/**
 * Compute a buy-only contribution rebalance plan that drives allocations back
 * to target over the given number of months.
 *
 * On-target holdings (current drift within ON_TARGET_DRIFT_EPS) keep their
 * current contribution unchanged. The remaining "available pool" is
 * redistributed: overweight holdings temporarily receive zero while underweight
 * holdings receive a proportionally larger share. Total monthly contribution
 * is preserved exactly. Mixed cadences (weekly, biweekly, monthly, quarterly)
 * are normalised to a monthly basis, then the suggested monthly amount is
 * converted back to each holding's own cadence for actionable output.
 *
 * @param driftEntries - output of computeDrift; only entries with targetPct > 0 are used
 * @param holdings     - holding configuration (contribAmount + contribInterval per ISIN)
 * @param totalValue   - current total portfolio value
 * @param months       - rebalance horizon in months (e.g. 1, 2, 3, 6, 12)
 */
export function computeRebalancePlan(
  driftEntries: DriftEntry[],
  holdings: Holding[],
  totalValue: number,
  months: number,
  options: RebalancePlanOptions = {},
): RebalancePlanEntry[] {
  if (months <= 0 || totalValue <= 0) return [];

  // Only active holdings that have a configured target allocation.
  const activeDrift = driftEntries.filter((d) => d.targetPct > 0);
  if (activeDrift.length === 0) return [];

  const holdingMap = new Map(holdings.map((h) => [h.isin, h]));

  // Compute monthly contribution per holding and the portfolio-wide total.
  const monthlyByIsin = new Map<string, number>();
  let totalMonthly = 0;
  for (const d of activeDrift) {
    const h = holdingMap.get(d.isin);
    if (!h) continue;
    const m = annualizeContrib(h.contribAmount, h.contribInterval) / 12;
    monthlyByIsin.set(d.isin, m);
    totalMonthly += m;
  }
  if (totalMonthly <= 0) return [];

  // Projected portfolio value after K months (no market-growth assumption -- conservative).
  const projectedTotal = totalValue + months * totalMonthly;

  // Identify on-target holdings by current drift; lock them at their current contribution.
  const onTargetIsins = new Set<string>();
  let onTargetMonthly = 0;
  for (const d of activeDrift) {
    if (!holdingMap.has(d.isin)) continue;
    if (Math.abs(d.driftPct) <= ON_TARGET_DRIFT_EPS) {
      onTargetIsins.add(d.isin);
      onTargetMonthly += monthlyByIsin.get(d.isin) ?? 0;
    }
  }
  // Budget available for redistribution between overweight and underweight holdings.
  const availablePool = totalMonthly - onTargetMonthly;

  // Raw monthly requirement per holding: gap to projected target divided by K.
  // On-target holdings are excluded; overweight gaps are clamped to 0 (buy-only, no selling).
  const rawByIsin = new Map<string, number>();
  const gapByIsin = new Map<string, number>();
  const projectedStateByIsin = new Map<string, RebalancePlanEntry['state']>();
  let sumRaw = 0;
  const GAP_EPS = 1e-9;
  for (const d of activeDrift) {
    if (!holdingMap.has(d.isin)) continue;
    if (onTargetIsins.has(d.isin)) {
      rawByIsin.set(d.isin, 0);
      gapByIsin.set(d.isin, 0);
      projectedStateByIsin.set(d.isin, 'on-target');
      continue;
    }
    const targetAmt = projectedTotal * (d.targetPct / 100);
    const gap = targetAmt - d.actualValue;
    const projectedState: RebalancePlanEntry['state'] =
      gap > GAP_EPS ? 'underweight' : gap < -GAP_EPS ? 'overweight' : 'on-target';
    const raw = projectedState === 'underweight' ? gap / months : 0;
    rawByIsin.set(d.isin, raw);
    gapByIsin.set(d.isin, gap);
    projectedStateByIsin.set(d.isin, projectedState);
    sumRaw += raw;
  }
  if (sumRaw <= 0 || availablePool <= 0) return [];

  const amtFromMonthly = (monthly: number, interval: ContribInterval) =>
    (monthly * 12) / INTERVAL_PER_YEAR[interval];
  const monthlyFromAmt = (amt: number, interval: ContribInterval) =>
    annualizeContrib(amt, interval) / 12;
  const roundAmt = (amt: number, step?: number) => {
    if (!step || step <= 0) return amt;
    return Math.round(amt / step) * step;
  };

  type Work = {
    drift: DriftEntry;
    holding: Holding;
    monthlyCurrent: number;
    monthlySuggested: number;
    projectedState: RebalancePlanEntry['state'];
  };
  const work: Work[] = [];

  for (const d of activeDrift) {
    const h = holdingMap.get(d.isin);
    if (!h) continue;

    const m = monthlyByIsin.get(d.isin) ?? 0;
    const raw = rawByIsin.get(d.isin) ?? 0;
    const projectedState = projectedStateByIsin.get(d.isin) ?? 'on-target';

    // On-target holdings keep their current contribution; others share the available pool.
    const c = onTargetIsins.has(d.isin) ? m : availablePool * (raw / sumRaw);
    work.push({
      drift: d,
      holding: h,
      monthlyCurrent: m,
      monthlySuggested: c,
      projectedState,
    });
  }

  // Apply minimum actionable delta and optional rounding in holding cadence.
  // On-target holdings are locked at their current contribution and are not adjusted.
  for (const item of work) {
    if (onTargetIsins.has(item.drift.isin)) continue;
    const interval = item.holding.contribInterval;
    const currentAmt = item.holding.contribAmount;
    let suggestedAmt = amtFromMonthly(item.monthlySuggested, interval);
    const minAction = options.minActionByInterval?.[interval] ?? 0;
    if (Math.abs(suggestedAmt - currentAmt) < minAction) {
      suggestedAmt = currentAmt;
    }
    suggestedAmt = roundAmt(suggestedAmt, options.roundingStepByInterval?.[interval]);
    if (suggestedAmt < 0) suggestedAmt = 0;
    item.monthlySuggested = monthlyFromAmt(suggestedAmt, interval);
  }

  // Final normalization pass: preserve total monthly contribution after guardrails.
  // On-target holdings are locked, so only non-on-target holdings absorb any rounding diff.
  const normalizedTotal = work.reduce((sum, item) => sum + item.monthlySuggested, 0);
  const diffMonthly = totalMonthly - normalizedTotal;
  if (Math.abs(diffMonthly) > 1e-9 && work.length > 0) {
    const nonOnTargetWork = work.filter((item) => !onTargetIsins.has(item.drift.isin));
    const preferred =
      (diffMonthly > 0
        ? nonOnTargetWork.filter((item) => item.projectedState === 'underweight')
        : nonOnTargetWork.filter((item) => item.projectedState !== 'underweight')) || [];
    const anchor = preferred[0] ?? nonOnTargetWork[0] ?? work[0];
    anchor.monthlySuggested = Math.max(0, anchor.monthlySuggested + diffMonthly);
  }

  const result: RebalancePlanEntry[] = [];
  for (const item of work) {
    const d = item.drift;
    const h = item.holding;
    const m = item.monthlyCurrent;
    const c = item.monthlySuggested;
    const projectedState = item.projectedState;
    const displayState: RebalancePlanEntry['state'] =
      d.driftPct > ON_TARGET_DRIFT_EPS
        ? 'overweight'
        : d.driftPct < -ON_TARGET_DRIFT_EPS
          ? 'underweight'
          : 'on-target';
    const suggestedContribAmt = amtFromMonthly(c, h.contribInterval);

    const currentContribPct = (m / totalMonthly) * 100;
    const suggestedContribPct = (c / totalMonthly) * 100;

    // Estimate value after K months with this plan.
    // On-target holdings contribute at their locked current rate; underweight ones
    // receive their share of the available pool; overweight ones receive nothing.
    const targetAmt = projectedTotal * (d.targetPct / 100);
    const gap = gapByIsin.get(d.isin) ?? targetAmt - d.actualValue;
    const kContrib = onTargetIsins.has(d.isin)
      ? m * months
      : projectedState === 'underweight'
        ? (availablePool * gap) / sumRaw
        : 0;
    const newValue = d.actualValue + kContrib;
    const newActualPct = (newValue / projectedTotal) * 100;
    const projectedDriftPct = newActualPct - d.targetPct;

    result.push({
      isin: d.isin,
      shortName: d.shortName,
      color: d.color,
      contribInterval: h.contribInterval,
      currentContribAmt: h.contribAmount,
      currentContribPct: Math.round(currentContribPct * 10) / 10,
      suggestedContribAmt: Math.round(suggestedContribAmt * 100) / 100,
      suggestedContribPct: Math.round(suggestedContribPct * 10) / 10,
      deltaContribPct: Math.round((suggestedContribPct - currentContribPct) * 10) / 10,
      state: displayState,
      projectedDriftPct: Math.round(projectedDriftPct * 10) / 10,
    });
  }

  // Mirror the drift table sort: targetPct descending, shortName ascending as tiebreaker.
  result.sort((a, b) => {
    const da = driftEntries.find((d) => d.isin === a.isin);
    const db = driftEntries.find((d) => d.isin === b.isin);
    if (da && db && da.targetPct !== db.targetPct) return db.targetPct - da.targetPct;
    return a.shortName.localeCompare(b.shortName);
  });

  return result;
}
