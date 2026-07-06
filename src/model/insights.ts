import type { Snapshot, Account } from '../types';
import { snapTotal } from '../utils';

/** Split monthly delta into contributed vs market movement. */
export function monthlyGrowthSplit(
  primaryNow: number,
  primaryPrev: number,
  contrib: number,
): { contributed: number; market: number } {
  const totalChange = primaryNow - primaryPrev;
  return {
    contributed: contrib,
    market: totalChange - contrib,
  };
}

/**
 * Compound annual growth rate.
 * Returns null when months < 12 or first <= 0.
 */
export function cagr(first: number, last: number, months: number): number | null {
  if (months < 12 || first <= 0) return null;
  return Math.pow(last / first, 12 / months) - 1;
}

/**
 * Find the snapshot nearest to 12 months before the latest snapshot.
 * Returns null when fewer than 13 snapshots' months of history exist.
 */
export function findYoYSnapshot(snaps: Snapshot[]): { snap: Snapshot; total: number } | null {
  if (snaps.length < 2) return null;

  const latest = snaps[snaps.length - 1];
  const latestDate = parseYearMonth(latest.date);
  if (!latestDate) return null;

  const tY =
    latestDate.month > 12
      ? latestDate.year
      : latestDate.month - 12 > 0
        ? latestDate.year
        : latestDate.year - 1;
  const tM = ((latestDate.month - 1 - 12 + 120) % 12) + 1;
  const targetVal = tY * 12 + tM;

  // Need at least 12 months of history
  const firstDate = parseYearMonth(snaps[0].date);
  if (!firstDate) return null;
  const span = latestDate.year * 12 + latestDate.month - (firstDate.year * 12 + firstDate.month);
  if (span < 12) return null;

  let bestSnap: Snapshot | null = null;
  let bestDist = Infinity;
  for (const sn of snaps) {
    if (sn === latest) continue;
    const d = parseYearMonth(sn.date);
    if (!d) continue;
    const val = d.year * 12 + d.month;
    const dist = Math.abs(val - targetVal);
    if (dist < bestDist) {
      bestDist = dist;
      bestSnap = sn;
    }
  }

  if (!bestSnap) return null;
  return { snap: bestSnap, total: snapTotal(bestSnap) };
}

/**
 * Build a month-by-month contributed-vs-market history across the full
 * snapshot array. One point per consecutive snapshot pair where both
 * snapshots have a resolvable primary-investment balance.
 *
 * Pairs with no primary-investment value on either side (e.g. before any
 * account was flagged isPrimaryInvestment) are silently skipped - they
 * contribute no data point rather than a zeroed/misleading one.
 */
export interface MonthlyGrowthPoint {
  month: string; // YYYY-MM, the later snapshot's date
  contributed: number;
  market: number;
  total: number; // contributed + market, i.e. the raw snapshot-to-snapshot delta
}

export function monthlyGrowthHistory(
  snaps: { date: string; [k: string]: number | string | undefined }[],
  accounts: Account[],
  monthlyContrib: Record<string, number>,
  primaryValueFn: (
    snap: { date: string; [k: string]: number | string | undefined },
    accounts: Account[],
  ) => number | null,
): MonthlyGrowthPoint[] {
  const points: MonthlyGrowthPoint[] = [];
  for (let i = 1; i < snaps.length; i++) {
    const prev = snaps[i - 1];
    const cur = snaps[i];
    const primaryPrev = primaryValueFn(prev, accounts);
    const primaryNow = primaryValueFn(cur, accounts);
    if (primaryPrev === null || primaryNow === null) continue;
    const contrib = monthlyContrib[cur.date] || 0;
    const split = monthlyGrowthSplit(primaryNow, primaryPrev, contrib);
    points.push({
      month: cur.date,
      contributed: split.contributed,
      market: split.market,
      total: primaryNow - primaryPrev,
    });
  }
  return points;
}

function parseYearMonth(d: string): { year: number; month: number } | null {
  if (!d) return null;
  const parts = d.split('-');
  if (parts.length < 2) return null;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  if (isNaN(year) || isNaN(month)) return null;
  return { year, month };
}
