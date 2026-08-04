import type { Snapshot, Account } from '../types';
import { snapTotal } from '../utils';

export interface XirrCashFlow {
  date: string;
  amount: number;
}

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
 * Time-weighted return using linked sub-period returns between consecutive
 * snapshots. Returns null when fewer than 2 periods exist or any period starts
 * at a non-positive value.
 */
export function twr(
  snaps: Snapshot[],
  contributionsByMonth: Record<string, number>,
): number | null {
  if (snaps.length < 2) return null;
  let growth = 1;
  let periods = 0;
  for (let i = 1; i < snaps.length; i++) {
    const prevTotal = snapTotal(snaps[i - 1]);
    const curTotal = snapTotal(snaps[i]);
    if (prevTotal <= 0) return null;
    const contribution = contributionsByMonth[snaps[i].date] || 0;
    const periodReturn = (curTotal - contribution) / prevTotal - 1;
    growth *= 1 + periodReturn;
    periods++;
  }
  return periods > 0 ? growth - 1 : null;
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

  const tY = latestDate.year - 1;
  const tM = latestDate.month;
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

function toUtcDay(date: string): number | null {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  const ts = Date.UTC(year, month - 1, day);
  if (!isFinite(ts)) return null;
  return ts / 86_400_000;
}

export function xirr(cashFlows: XirrCashFlow[]): number | null {
  if (cashFlows.length < 2) return null;
  const prepared = cashFlows
    .map((cf) => {
      const day = toUtcDay(cf.date);
      return day === null ? null : { ...cf, day };
    })
    .filter((cf): cf is XirrCashFlow & { day: number } => !!cf)
    .sort((a, b) => a.day - b.day);
  if (prepared.length < 2) return null;
  const hasPositive = prepared.some((cf) => cf.amount > 0);
  const hasNegative = prepared.some((cf) => cf.amount < 0);
  if (!hasPositive || !hasNegative) return null;

  const day0 = prepared[0].day;
  const yearFracs = prepared.map((cf) => ({
    amount: cf.amount,
    years: (cf.day - day0) / 365,
  }));

  let rate = 0.1;
  const tol = 1e-6;
  for (let i = 0; i < 100; i++) {
    let f = 0;
    let df = 0;
    for (const cf of yearFracs) {
      const base = 1 + rate;
      if (base <= 0) return null;
      const disc = Math.pow(base, cf.years);
      f += cf.amount / disc;
      df += (-cf.years * cf.amount) / (disc * base);
    }
    if (!isFinite(f) || !isFinite(df) || Math.abs(df) < 1e-12) return null;
    const next = rate - f / df;
    if (!isFinite(next)) return null;
    if (Math.abs(next - rate) < tol) return next;
    rate = next;
  }
  return null;
}
