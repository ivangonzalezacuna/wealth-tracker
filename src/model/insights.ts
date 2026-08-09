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
 * Returns null when months < 12, first <= 0, or last < 0 (avoids NaN from
 * fractional exponentiation of a negative base).
 */
export function cagr(first: number, last: number, months: number): number | null {
  if (months < 12 || first <= 0 || last < 0) return null;
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

/** One month of return data, including portfolio value at the start of that month. */
export interface MonthlyReturnPoint {
  date: string;
  startValue: number;
  return: number;
}

/** Result of annualizedVolatility - scalar plus the per-month return series. */
export interface VolatilityResult {
  annualized: number | null;
  monthlyReturns: MonthlyReturnPoint[];
}

/**
 * Annualized volatility: sample std-dev of monthly net-worth % returns, scaled by sqrt(12).
 * Returns { annualized: null, monthlyReturns: [] } when fewer than 3 snapshots exist.
 * The monthlyReturns array is reused by the heatmap and downside-deviation functions.
 */
export function annualizedVolatility(snaps: Snapshot[]): VolatilityResult {
  const empty: VolatilityResult = { annualized: null, monthlyReturns: [] };
  if (snaps.length < 3) return empty;
  const monthlyReturns: MonthlyReturnPoint[] = [];
  for (let i = 1; i < snaps.length; i++) {
    const prev = snapTotal(snaps[i - 1]);
    if (prev <= 0) return { annualized: null, monthlyReturns };
    // Skip pairs that span more than one calendar month: the return cannot be
    // attributed to a single month period and would distort volatility estimates.
    if (monthsBetween(snaps[i - 1].date, snaps[i].date) > 1) continue;
    monthlyReturns.push({
      date: snaps[i].date,
      startValue: prev,
      return: snapTotal(snaps[i]) / prev - 1,
    });
  }
  if (monthlyReturns.length < 2) return { annualized: null, monthlyReturns };
  const returns = monthlyReturns.map((m) => m.return);
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  return { annualized: Math.sqrt(variance) * Math.sqrt(12), monthlyReturns };
}

/** One point in the drawdown time series. */
export interface DrawdownPoint {
  date: string;
  drawdown: number;
}

/** Result of maxDrawdown - scalar max plus the full per-month series. */
export interface DrawdownResult {
  max: number | null;
  series: DrawdownPoint[];
}

/**
 * Maximum drawdown: largest peak-to-trough decline as a fraction (e.g. -0.15).
 * Returns { max: null, series: [] } when fewer than 2 snapshots.
 * The series is reused by avgDrawdown, drawdownDuration, and the drawdown chart.
 */
export function maxDrawdown(snaps: Snapshot[]): DrawdownResult {
  if (snaps.length < 2) return { max: null, series: [] };
  let peak = snapTotal(snaps[0]);
  let maxDD = 0;
  const series: DrawdownPoint[] = [];
  for (let i = 1; i < snaps.length; i++) {
    const val = snapTotal(snaps[i]);
    if (val > peak) peak = val;
    const dd = peak > 0 ? (val - peak) / peak : 0;
    series.push({ date: snaps[i].date, drawdown: dd });
    if (dd < maxDD) maxDD = dd;
  }
  return { max: maxDD, series };
}

// ── New analytics metric functions ───────────────────────────────

/**
 * Total return as a fraction: (current - first) / first.
 * Returns null when first <= 0.
 */
export function totalReturn(first: number, current: number): number | null {
  if (first <= 0) return null;
  return (current - first) / first;
}

/**
 * YTD return: total return from the snapshot nearest to Jan 1 of the current
 * year to the latest snapshot. Falls back to return from inception when the
 * portfolio started in the current year.
 * Returns null when fewer than 2 snapshots exist.
 */
export function ytdReturn(snaps: Snapshot[]): number | null {
  if (snaps.length < 2) return null;
  const latest = snaps[snaps.length - 1];
  const latestDate = parseYearMonth(latest.date);
  if (!latestDate) return null;
  const currentYear = latestDate.year;
  // Find snapshot closest to Dec of previous year (target: Dec prev year)
  const targetVal = (currentYear - 1) * 12 + 12;
  let ytdSnap: Snapshot | null = null;
  let bestDist = Infinity;
  for (const sn of snaps) {
    if (sn === latest) continue;
    const d = parseYearMonth(sn.date);
    if (!d) continue;
    const val = d.year * 12 + d.month;
    if (val >= latestDate.year * 12 + latestDate.month) continue;
    const dist = Math.abs(val - targetVal);
    if (dist < bestDist) {
      bestDist = dist;
      ytdSnap = sn;
    }
  }
  if (!ytdSnap) return null;
  const ytdTotal = snapTotal(ytdSnap);
  if (ytdTotal <= 0) return null;
  return (snapTotal(latest) - ytdTotal) / ytdTotal;
}

/** Absolute gain in currency: current portfolio value minus total contributed. */
export function absoluteGain(current: number, totalContributed: number): number {
  return current - totalContributed;
}

/**
 * Average drawdown: mean drawdown fraction across months where the portfolio
 * was below its prior peak (i.e. drawdown < 0). Returns null when the series
 * is empty or the portfolio never drew down.
 */
export function avgDrawdown(series: DrawdownPoint[]): number | null {
  if (series.length === 0) return null;
  const underwater = series.filter((pt) => pt.drawdown < 0);
  if (underwater.length === 0) return null;
  return underwater.reduce((s, pt) => s + pt.drawdown, 0) / underwater.length;
}

/**
 * Drawdown duration: maximum number of consecutive months below the prior peak.
 * Returns 0 when the portfolio never drew down.
 */
export function drawdownDuration(series: DrawdownPoint[]): number {
  let maxDur = 0;
  let cur = 0;
  for (const pt of series) {
    if (pt.drawdown < 0) {
      cur++;
      if (cur > maxDur) maxDur = cur;
    } else {
      cur = 0;
    }
  }
  return maxDur;
}

/**
 * Downside deviation: semi-standard deviation using a threshold of 0.
 * Scaled to annual: sqrt(mean(min(r, 0)^2)) * sqrt(12).
 * Returns null when fewer than 2 return points exist.
 */
export function downsideDeviation(monthlyReturns: MonthlyReturnPoint[]): number | null {
  if (monthlyReturns.length < 2) return null;
  const meanSqNeg =
    monthlyReturns.reduce((s, m) => s + Math.min(m.return, 0) ** 2, 0) / monthlyReturns.length;
  return Math.sqrt(meanSqNeg) * Math.sqrt(12);
}

/**
 * Sharpe ratio: (CAGR - riskFreeRate) / annualizedVolatility.
 * riskFreeRate is a fraction (e.g. 0.02 for 2%).
 * Returns null when volatility is 0 or negative.
 */
export function sharpeRatio(
  cagrVal: number,
  volatility: number,
  riskFreeRate: number,
): number | null {
  if (volatility <= 0) return null;
  return (cagrVal - riskFreeRate) / volatility;
}

/**
 * Sortino ratio: (CAGR - riskFreeRate) / downsideDeviation.
 * riskFreeRate is a fraction (e.g. 0.02 for 2%).
 * Returns null when downside deviation is 0 or negative.
 */
export function sortinoRatio(
  cagrVal: number,
  downDev: number,
  riskFreeRate: number,
): number | null {
  if (downDev <= 0) return null;
  return (cagrVal - riskFreeRate) / downDev;
}

/**
 * Calmar ratio: CAGR / abs(maxDrawdown).
 * Returns null when maxDrawdown is 0 (no drawdown occurred).
 */
export function calmarRatio(cagrVal: number, maxDD: number): number | null {
  if (maxDD >= 0) return null;
  return cagrVal / Math.abs(maxDD);
}

/**
 * Rolling CAGR: for each snapshot at index i >= windowMonths, computes
 * cagr(snaps[i - windowMonths], snaps[i], windowMonths).
 * Returns an empty array when not enough history exists.
 */
export function rollingCagr(
  snaps: Snapshot[],
  windowMonths: number,
): { month: string; cagr: number }[] {
  if (snaps.length <= windowMonths) return [];
  const result: { month: string; cagr: number }[] = [];
  for (let i = windowMonths; i < snaps.length; i++) {
    const startVal = snapTotal(snaps[i - windowMonths]);
    const endVal = snapTotal(snaps[i]);
    // Use actual elapsed calendar months so skipped months are properly accounted for.
    const actualMonths = monthsBetween(snaps[i - windowMonths].date, snaps[i].date);
    const c = cagr(startVal, endVal, actualMonths > 0 ? actualMonths : windowMonths);
    if (c !== null) result.push({ month: snaps[i].date, cagr: c });
  }
  return result;
}

/**
 * Annual returns: one return per calendar year derived from snapshots.
 * Start value: nearest snapshot to Dec 31 of the previous year.
 * End value: latest snapshot of the current year.
 * Returns an empty array when fewer than 2 snapshots exist.
 */
export function annualReturns(snaps: Snapshot[]): { year: number; return: number }[] {
  if (snaps.length < 2) return [];
  const byYear = new Map<number, Snapshot[]>();
  for (const sn of snaps) {
    const d = parseYearMonth(sn.date);
    if (!d) continue;
    if (!byYear.has(d.year)) byYear.set(d.year, []);
    byYear.get(d.year)!.push(sn);
  }
  const years = Array.from(byYear.keys()).sort((a, b) => a - b);
  const result: { year: number; return: number }[] = [];
  for (let i = 0; i < years.length; i++) {
    const year = years[i];
    const yearSnaps = byYear.get(year)!.sort((a, b) => a.date.localeCompare(b.date));
    let startVal: number | null = null;
    if (i > 0 && years[i - 1] === year - 1) {
      // Consecutive prior year available: use nearest snapshot to Dec of that year
      const prevYearSnaps = byYear.get(years[i - 1])!;
      const decSnaps = prevYearSnaps.filter((s) => parseYearMonth(s.date)?.month === 12);
      const startSnap =
        decSnaps.length > 0
          ? decSnaps[decSnaps.length - 1]
          : prevYearSnaps[prevYearSnaps.length - 1];
      startVal = snapTotal(startSnap);
    } else {
      // First year, or gap in data: use first snapshot of this year as baseline
      startVal = snapTotal(yearSnaps[0]);
    }
    if (startVal === null || startVal <= 0) continue;
    const endVal = snapTotal(yearSnaps[yearSnaps.length - 1]);
    result.push({ year, return: (endVal - startVal) / startVal });
  }
  return result;
}

/** Value-weighted monthly return for the heatmap. */
export interface WeightedMonthReturn {
  year: number;
  month: number;
  return: number;
  startValue: number;
  /** return * (startValue / maxStartValue) - drives color intensity. */
  weightedReturn: number;
}

/**
 * Compute value-weighted monthly returns for the return heatmap.
 * Each cell shows the raw return (%) but its color intensity is scaled by
 * startValue / maxStartValue so months with more capital appear more saturated.
 * This means a 1% loss with 1 000 EUR looks less intense than a 1% loss with 10 000 EUR.
 */
export function weightedMonthlyReturns(
  monthlyReturns: MonthlyReturnPoint[],
): WeightedMonthReturn[] {
  if (monthlyReturns.length === 0) return [];
  const maxStartValue = Math.max(...monthlyReturns.map((m) => m.startValue));
  return monthlyReturns
    .map((m) => {
      const d = parseYearMonth(m.date);
      if (!d) return null;
      const weight = maxStartValue > 0 ? m.startValue / maxStartValue : 1;
      return {
        year: d.year,
        month: d.month,
        return: m.return,
        startValue: m.startValue,
        weightedReturn: m.return * weight,
      };
    })
    .filter((x): x is WeightedMonthReturn => x !== null);
}

/** Aggregated dividend/income analytics derived from transactions. */
export interface DividendMetrics {
  trailing12m: number;
  yieldPct: number | null;
  yieldOnCost: number | null;
  yoyGrowth: number | null;
  monthlyBreakdown: { month: string; amount: number }[];
  dividendCagr: number | null;
  asOfMonth: string | null;
}

/**
 * Compute dividend and income analytics from a transaction list.
 * Includes DIVIDEND and INTEREST transaction types only.
 * currentPortfolioValue and totalCostBasis are used for yield calculations.
 */
export function dividendMetrics(
  transactions: Array<{ type: string; date: string; amount: number }>,
  currentPortfolioValue: number,
  totalCostBasis: number,
): DividendMetrics {
  const incTxs = transactions.filter((t) => t.type === 'DIVIDEND' || t.type === 'INTEREST');
  // Build monthly totals (YYYY-MM key)
  const byMonthMap = new Map<string, number>();
  for (const tx of incTxs) {
    const month = tx.date.substring(0, 7);
    byMonthMap.set(month, (byMonthMap.get(month) || 0) + Math.abs(tx.amount));
  }
  const monthlyBreakdown = Array.from(byMonthMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, amount]) => ({ month, amount }));

  const datedMonths = transactions
    .map((t) => t.date.substring(0, 7))
    .filter((month) => parseYearMonth(month) !== null)
    .sort((a, b) => a.localeCompare(b));
  const asOfMonth = datedMonths[datedMonths.length - 1] || null;
  const anchorVal = asOfMonth ? _yearMonthToIndex(asOfMonth) : null;

  // Trailing 12m income, anchored to the latest imported transaction month.
  const trailing12m = monthlyBreakdown
    .filter((m) => {
      const idx = _yearMonthToIndex(m.month);
      return anchorVal !== null && idx !== null && idx >= anchorVal - 11 && idx <= anchorVal;
    })
    .reduce((s, m) => s + m.amount, 0);

  // Yield and yield on cost
  const yieldPct = currentPortfolioValue > 0 ? trailing12m / currentPortfolioValue : null;
  const yieldOnCost = totalCostBasis > 0 ? trailing12m / totalCostBasis : null;

  // YoY growth: trailing 12m income versus the prior trailing 12m window,
  // both anchored to the latest imported transaction month.
  const prior12m =
    anchorVal === null
      ? 0
      : monthlyBreakdown
          .filter((m) => {
            const idx = _yearMonthToIndex(m.month);
            return idx !== null && idx >= anchorVal - 23 && idx <= anchorVal - 12;
          })
          .reduce((s, m) => s + m.amount, 0);
  const yoyGrowth = prior12m > 0 ? (trailing12m - prior12m) / prior12m : null;

  // Dividend CAGR from annual totals
  const byYear = new Map<number, number>();
  for (const m of monthlyBreakdown) {
    const year = parseInt(m.month.substring(0, 4), 10);
    byYear.set(year, (byYear.get(year) || 0) + m.amount);
  }
  const yearEntries = Array.from(byYear.entries()).sort((a, b) => a[0] - b[0]);
  let dividendCagr: number | null = null;
  if (yearEntries.length >= 2) {
    const firstAnnual = yearEntries[0][1];
    const lastAnnual = yearEntries[yearEntries.length - 1][1];
    const yearsSpan = yearEntries[yearEntries.length - 1][0] - yearEntries[0][0];
    if (firstAnnual > 0 && yearsSpan >= 1) {
      dividendCagr = Math.pow(lastAnnual / firstAnnual, 1 / yearsSpan) - 1;
    }
  }

  return {
    trailing12m,
    yieldPct,
    yieldOnCost,
    yoyGrowth,
    monthlyBreakdown,
    dividendCagr,
    asOfMonth,
  };
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

/**
 * Calendar-month distance between two YYYY-MM dates.
 * Returns 0 when either date is unparseable.
 */
export function monthsBetween(a: string, b: string): number {
  const da = parseYearMonth(a);
  const db = parseYearMonth(b);
  if (!da || !db) return 0;
  return Math.abs((db.year - da.year) * 12 + (db.month - da.month));
}

function _yearMonthToIndex(d: string): number | null {
  const parsed = parseYearMonth(d);
  if (!parsed) return null;
  return parsed.year * 12 + (parsed.month - 1);
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

  /** NPV at a given rate. */
  function npv(r: number): number | null {
    let f = 0;
    for (const cf of yearFracs) {
      const base = 1 + r;
      if (base <= 0) return null;
      const disc = Math.pow(base, cf.years);
      if (!isFinite(disc)) return null;
      f += cf.amount / disc;
    }
    return isFinite(f) ? f : null;
  }

  // ── Newton-Raphson (fast path, good initial guess) ───────────────
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
    if (!isFinite(f) || !isFinite(df) || Math.abs(df) < 1e-12) break;
    const next = rate - f / df;
    if (!isFinite(next)) break;
    if (Math.abs(next - rate) < tol) return next;
    rate = next;
  }

  // ── Bisection fallback (robust, slower) ──────────────────────────
  // Search in (-0.9999, 100) — covers from -99.99% to +10000% annual return.
  let lo = -0.9999;
  let hi = 100;
  let fLo = npv(lo);
  const fHi = npv(hi);
  if (fLo === null || fHi === null || fLo * fHi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (hi - lo < tol) return mid;
    const fMid = npv(mid);
    if (fMid === null) return null;
    if (fMid === 0) return mid;
    if (fLo * fMid < 0) {
      hi = mid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}

// ── Per-account CAGR ──────────────────────────────────────────────

export interface AccountCagrResult {
  accountId: string;
  label: string;
  cagrValue: number | null;
  monthsSpan: number;
}

/**
 * Compute CAGR for each account separately, using per-account snapshot values.
 * Only accounts with at least 12 months of non-zero values are included.
 */
export function cagrPerAccount(snaps: Snapshot[], accounts: Account[]): AccountCagrResult[] {
  if (snaps.length < 2) return [];
  const results: AccountCagrResult[] = [];

  for (const acct of accounts) {
    const key = acct.id || acct.key || '';
    if (!key) continue;

    // Collect non-zero snapshot values for this account
    const values = snaps
      .map((s) => ({ date: s.date, value: (s[key] as number) || 0 }))
      .filter((s) => s.value > 0);

    if (values.length < 2) continue;

    const first = values[0];
    const last = values[values.length - 1];
    const fd = parseYearMonth(first.date);
    const ld = parseYearMonth(last.date);
    if (!fd || !ld) continue;
    const months = (ld.year - fd.year) * 12 + (ld.month - fd.month);
    if (months < 12) continue;

    results.push({
      accountId: key,
      label: acct.label || `${acct.moneyType} ${acct.institution}`.trim() || key,
      cagrValue: cagr(first.value, last.value, months),
      monthsSpan: months,
    });
  }

  return results;
}
