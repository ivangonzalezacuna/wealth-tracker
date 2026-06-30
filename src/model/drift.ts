/**
 * Drift helpers — compare actual allocation vs target and produce rebalance signals.
 */
import type { Holding, EtfPosition } from '../types';
import { annualizeContrib } from './contributions';

export interface DriftEntry {
  ticker: string;
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
 * @param holdings - configured holdings (active ones with contribAmount define target)
 * @param positions - current ETF positions from portfolio data
 * @param totalValue - total portfolio value (from snapshot or sum of costs)
 */
export function computeDrift(
  holdings: Holding[],
  positions: Record<string, EtfPosition>,
  totalValue: number,
): DriftEntry[] {
  if (totalValue <= 0) return [];

  // Target allocation: based on annualized contribution weights
  const activeWithTarget = holdings.filter((h) => h.active && h.contribAmount > 0);
  const totalAnnual = activeWithTarget.reduce(
    (sum, h) => sum + annualizeContrib(h.contribAmount, h.interval),
    0,
  );
  if (totalAnnual <= 0) return [];

  const result: DriftEntry[] = [];

  for (const h of activeWithTarget) {
    const annual = annualizeContrib(h.contribAmount, h.interval);
    const targetPct = (annual / totalAnnual) * 100;

    // Find the matching position by ISIN
    const pos = positions[h.isin];
    const actualValue = pos ? pos.cost : 0;
    const actualPct = totalValue > 0 ? (actualValue / totalValue) * 100 : 0;

    const driftPct = actualPct - targetPct;
    const targetValue = (totalValue * targetPct) / 100;
    const deltaValue = actualValue - targetValue;

    result.push({
      ticker: h.ticker,
      color: h.color,
      targetPct: Math.round(targetPct * 10) / 10,
      actualPct: Math.round(actualPct * 10) / 10,
      driftPct: Math.round(driftPct * 10) / 10,
      actualValue,
      targetValue: Math.round(targetValue),
      deltaValue: Math.round(deltaValue),
    });
  }

  // Sort by absolute drift descending (most drifted first)
  result.sort((a, b) => Math.abs(b.driftPct) - Math.abs(a.driftPct));
  return result;
}

/**
 * Maximum absolute drift across all entries.
 */
export function maxDrift(entries: DriftEntry[]): number {
  if (entries.length === 0) return 0;
  return Math.max(...entries.map((e) => Math.abs(e.driftPct)));
}
