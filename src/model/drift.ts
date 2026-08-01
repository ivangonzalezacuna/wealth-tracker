/**
 * Drift helpers - compare actual allocation vs target and produce rebalance signals.
 */
import type { Holding, EtfPosition } from '../types';
import { annualizeContrib } from './contributions';

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

  for (const h of activeWithTarget) {
    handledIsins.add(h.isin);
    const annual = annualizeContrib(h.contribAmount, h.contribInterval);
    const targetPct = (annual / totalAnnual) * 100;

    // Prefer snapshot market value when available; fall back to cost basis.
    const pos = positions[h.isin];
    const actualValue = snapEtfValues?.[h.isin] ?? (pos ? pos.cost : 0);
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
    });
  }

  // Second pass: inactive-but-held positions (target = 0%, not already covered above).
  // These consume portfolio allocation even though they are not part of the target strategy.
  for (const [isin, pos] of Object.entries(positions)) {
    if (handledIsins.has(isin)) continue;
    if (pos.exited || pos.shares < 1e-6) continue;

    const actualValue = snapEtfValues?.[isin] ?? pos.cost;
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
