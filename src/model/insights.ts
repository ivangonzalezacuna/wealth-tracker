import type { Snapshot, Account, Transaction } from '../types';
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

/**
 * Monthly percentage returns series extracted from snapshot totals.
 * Returns null when fewer than 2 snapshots or any starting snapshot has a non-positive total.
 */
export function monthlyReturns(snaps: Snapshot[]): number[] | null {
  if (snaps.length < 2) return null;
  const returns: number[] = [];
  for (let i = 1; i < snaps.length; i++) {
    const prev = snapTotal(snaps[i - 1]);
    if (prev <= 0) return null;
    returns.push(snapTotal(snaps[i]) / prev - 1);
  }
  return returns;
}

/**
 * Monthly return series with date metadata (year, month, return fraction).
 * Used for heatmap rendering.
 */
export function monthlyReturnSeries(
  snaps: Snapshot[],
): { year: number; month: number; ret: number }[] {
  if (snaps.length < 2) return [];
  const result: { year: number; month: number; ret: number }[] = [];
  for (let i = 1; i < snaps.length; i++) {
    const prev = snapTotal(snaps[i - 1]);
    if (prev <= 0) continue;
    const cur = snapTotal(snaps[i]);
    const d = _parseYM(snaps[i].date);
    if (!d) continue;
    result.push({ year: d.year, month: d.month, ret: cur / prev - 1 });
  }
  return result;
}

/**
 * Annualized volatility: sample std-dev of monthly net-worth % returns, scaled by sqrt(12).
 * Returns null when fewer than 3 snapshots exist.
 */
export function annualizedVolatility(snaps: Snapshot[]): number | null {
  if (snaps.length < 3) return null;
  const returns = monthlyReturns(snaps);
  if (!returns || returns.length < 2) return null;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(12);
}

/** Point in a per-snapshot drawdown series. */
export interface DrawdownPoint {
  date: string;
  drawdown: number; // fraction, e.g. -0.10 means 10% below prior peak
}

/**
 * Computes both the max drawdown scalar and the full per-snapshot drawdown series.
 * The series starts from snaps[1] (one entry per snapshot after the first).
 * Returns null when fewer than 2 snapshots.
 */
export function maxDrawdownFull(
  snaps: Snapshot[],
): { scalar: number; series: DrawdownPoint[] } | null {
  if (snaps.length < 2) return null;
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
  return { scalar: maxDD, series };
}

/**
 * Maximum drawdown: largest peak-to-trough decline as a fraction (e.g. -0.15).
 * Returns 0 when the series never draws down; null when fewer than 2 snapshots.
 */
export function maxDrawdown(snaps: Snapshot[]): number | null {
  if (snaps.length < 2) return null;
  const result = maxDrawdownFull(snaps);
  return result ? result.scalar : null;
}

// ── New analytics functions ───────────────────────────────────────

/**
 * Total portfolio return as a fraction: (current - first) / first.
 * Returns null when first <= 0.
 */
export function totalReturn(first: number, current: number): number | null {
  if (first <= 0) return null;
  return (current - first) / first;
}

/** Absolute gain in currency: current value minus total contributed. */
export function absoluteGain(current: number, totalContributed: number): number {
  return current - totalContributed;
}

/**
 * Year-to-date return: total return from the snapshot nearest to Jan 1
 * of the current year to the latest snapshot. If the portfolio started
 * during the current year, return is computed from inception.
 * Returns null when fewer than 2 snapshots.
 */
export function ytdReturn(snaps: Snapshot[]): number | null {
  if (snaps.length < 2) return null;
  const currentYear = new Date().getFullYear();
  const janTarget = currentYear * 12 + 1;
  const latest = snaps[snaps.length - 1];
  let bestSnap: Snapshot | null = null;
  let bestDist = Infinity;
  for (const sn of snaps) {
    if (sn === latest) continue;
    const d = _parseYM(sn.date);
    if (!d) continue;
    const val = d.year * 12 + d.month;
    const dist = Math.abs(val - janTarget);
    if (dist < bestDist) {
      bestDist = dist;
      bestSnap = sn;
    }
  }
  if (!bestSnap) return null;
  return totalReturn(snapTotal(bestSnap), snapTotal(latest));
}

/**
 * Downside deviation: annualized square root of mean squared negative monthly returns.
 * Uses a 0% threshold (semi-deviation below zero). Returns null for empty input.
 */
export function downsideDeviation(returns: number[]): number | null {
  if (returns.length === 0) return null;
  const sumSq = returns.reduce((s, r) => s + Math.pow(Math.min(r, 0), 2), 0);
  return Math.sqrt(sumSq / returns.length) * Math.sqrt(12);
}

/**
 * Sharpe ratio: (CAGR - riskFreeRate) / annualizedVolatility.
 * Returns null when volatility is 0.
 */
export function sharpeRatio(
  cagrVal: number,
  volatility: number,
  riskFreeRate: number,
): number | null {
  if (volatility === 0) return null;
  return (cagrVal - riskFreeRate) / volatility;
}

/**
 * Sortino ratio: (CAGR - riskFreeRate) / downsideDeviation.
 * Returns null when downside deviation is 0.
 */
export function sortinoRatio(
  cagrVal: number,
  downsideDev: number,
  riskFreeRate: number,
): number | null {
  if (downsideDev === 0) return null;
  return (cagrVal - riskFreeRate) / downsideDev;
}

/**
 * Calmar ratio: CAGR / |maxDrawdown|.
 * Returns null when maxDrawdown is 0.
 */
export function calmarRatio(cagrVal: number, maxDd: number): number | null {
  if (maxDd === 0) return null;
  return cagrVal / Math.abs(maxDd);
}

/**
 * Average drawdown: arithmetic mean of all drawdown fractions in the series.
 * Returns null for an empty series.
 */
export function averageDrawdown(series: DrawdownPoint[]): number | null {
  if (series.length === 0) return null;
  return series.reduce((s, p) => s + p.drawdown, 0) / series.length;
}

/**
 * Drawdown duration: maximum number of consecutive months where the portfolio
 * is below its prior peak (drawdown < 0).
 */
export function drawdownDuration(series: DrawdownPoint[]): number {
  let maxLen = 0;
  let cur = 0;
  for (const p of series) {
    if (p.drawdown < 0) {
      cur++;
      if (cur > maxLen) maxLen = cur;
    } else {
      cur = 0;
    }
  }
  return maxLen;
}

/**
 * Rolling CAGR series: for each snapshot at position i >= windowMonths, compute
 * the CAGR over [i - windowMonths, i]. Returns an empty array when there are
 * fewer than windowMonths + 1 snapshots.
 */
export function rollingCagrSeries(
  snaps: Snapshot[],
  windowMonths: number,
): { month: string; cagr: number }[] {
  const result: { month: string; cagr: number }[] = [];
  for (let i = windowMonths; i < snaps.length; i++) {
    const startSnap = snaps[i - windowMonths];
    const endSnap = snaps[i];
    const startD = _parseYM(startSnap.date);
    const endD = _parseYM(endSnap.date);
    if (!startD || !endD) continue;
    const months = (endD.year - startD.year) * 12 + (endD.month - startD.month);
    if (months < windowMonths) continue;
    const c = cagr(snapTotal(startSnap), snapTotal(endSnap), months);
    if (c !== null) result.push({ month: endSnap.date, cagr: c });
  }
  return result;
}

/**
 * Rolling annualized volatility series.
 * For each snapshot i (starting at index windowMonths), computes the
 * annualized standard deviation of monthly returns in the preceding
 * windowMonths-long window.
 */
export function rollingVolatilitySeries(
  snaps: Snapshot[],
  windowMonths: number,
): { month: string; volatility: number }[] {
  if (snaps.length < windowMonths + 1) return [];
  const result: { month: string; volatility: number }[] = [];
  for (let i = windowMonths; i < snaps.length; i++) {
    const window = snaps.slice(i - windowMonths, i + 1);
    const rets = monthlyReturns(window);
    if (!rets || rets.length < 2) continue;
    const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
    const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
    const vol = Math.sqrt(variance) * Math.sqrt(12);
    result.push({ month: snaps[i].date, volatility: vol });
  }
  return result;
}

export function annualReturns(snaps: Snapshot[]): { year: number; return: number }[] {
  if (snaps.length < 2) return [];
  const byYear = new Map<number, Snapshot>();
  for (const sn of snaps) {
    const d = _parseYM(sn.date);
    if (!d) continue;
    const existing = byYear.get(d.year);
    if (!existing) {
      byYear.set(d.year, sn);
    } else {
      const ed = _parseYM(existing.date);
      if (ed && d.month > ed.month) byYear.set(d.year, sn);
    }
  }
  const years = Array.from(byYear.keys()).sort((a, b) => a - b);
  const results: { year: number; return: number }[] = [];
  for (let i = 1; i < years.length; i++) {
    const prevSnap = byYear.get(years[i - 1])!;
    const curSnap = byYear.get(years[i])!;
    const prevTotal = snapTotal(prevSnap);
    const curTotal = snapTotal(curSnap);
    if (prevTotal <= 0) continue;
    results.push({ year: years[i], return: (curTotal - prevTotal) / prevTotal });
  }
  return results;
}

// ── Income analytics ──────────────────────────────────────────────

/**
 * Sum of DIVIDEND and INTEREST transaction amounts in the trailing 12 months.
 */
export function trailing12mIncome(txs: Transaction[]): number {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  return txs
    .filter((tx) => {
      if (tx.type !== 'DIVIDEND' && tx.type !== 'INTEREST') return false;
      const dateStr = tx.date.length === 7 ? `${tx.date}-01` : tx.date;
      return new Date(dateStr) >= cutoff;
    })
    .reduce((s, tx) => s + (tx.amount || 0), 0);
}

/**
 * Dividend yield as a fraction: annualIncome / portfolioValue.
 * Returns null when portfolioValue <= 0.
 */
export function dividendYieldPct(annualIncome: number, portfolioValue: number): number | null {
  if (portfolioValue <= 0) return null;
  return annualIncome / portfolioValue;
}

/**
 * Yield on cost as a fraction: annualIncome / totalCostBasis.
 * Returns null when totalCostBasis <= 0.
 */
export function yieldOnCostPct(annualIncome: number, totalCostBasis: number): number | null {
  if (totalCostBasis <= 0) return null;
  return annualIncome / totalCostBasis;
}

/**
 * Dividend growth year-over-year: (this year income - last year income) / last year income.
 * Returns null when last year had no income.
 */
export function dividendGrowthYoY(txs: Transaction[]): number | null {
  const thisYear = new Date().getFullYear();
  const sumYear = (yr: number) =>
    txs
      .filter((tx) => {
        if (tx.type !== 'DIVIDEND' && tx.type !== 'INTEREST') return false;
        const dateStr = tx.date.length === 7 ? `${tx.date}-01` : tx.date;
        return new Date(dateStr).getFullYear() === yr;
      })
      .reduce((s, tx) => s + (tx.amount || 0), 0);
  const thisYearIncome = sumYear(thisYear);
  const lastYearIncome = sumYear(thisYear - 1);
  if (lastYearIncome <= 0) return null;
  return (thisYearIncome - lastYearIncome) / lastYearIncome;
}

/**
 * Dividend CAGR: compound annual growth rate applied to annual dividend totals.
 * Returns null when fewer than 2 years of dividend data exist.
 */
export function dividendCagr(txs: Transaction[]): number | null {
  const annualTotals = new Map<number, number>();
  for (const tx of txs) {
    if (tx.type !== 'DIVIDEND' && tx.type !== 'INTEREST') continue;
    const dateStr = tx.date.length === 7 ? `${tx.date}-01` : tx.date;
    const yr = new Date(dateStr).getFullYear();
    annualTotals.set(yr, (annualTotals.get(yr) || 0) + (tx.amount || 0));
  }
  if (annualTotals.size < 2) return null;
  const years = Array.from(annualTotals.keys()).sort((a, b) => a - b);
  const first = annualTotals.get(years[0])!;
  const last = annualTotals.get(years[years.length - 1])!;
  const span = (years[years.length - 1] - years[0]) * 12;
  return cagr(first, last, span);
}

/**
 * Income (DIVIDEND + INTEREST) broken down by month for the last N months.
 * Each entry is { month: 'YYYY-MM', amount: number }.
 */
export function incomeByMonth(
  txs: Transaction[],
  months = 12,
): { month: string; amount: number }[] {
  const now = new Date();
  const result: { month: string; amount: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const total = txs
      .filter((tx) => {
        if (tx.type !== 'DIVIDEND' && tx.type !== 'INTEREST') return false;
        return tx.date.startsWith(month) || tx.date === month;
      })
      .reduce((s, tx) => s + (tx.amount || 0), 0);
    result.push({ month, amount: total });
  }
  return result;
}

// private helpers shared across this module
function parseYearMonth(d: string): { year: number; month: number } | null {
  return _parseYM(d);
}

function _parseYM(d: string): { year: number; month: number } | null {
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

// ── Trailing dividend yield ───────────────────────────────────────

/**
 * Compute trailing 12-month net dividend yield as a percentage.
 * Returns null when totalInvested is zero or fewer than 12 months of dividend data exist.
 */
export function trailingDividendYield(
  divHist: Array<{ date: string; net: number }>,
  totalInvested: number,
): number | null {
  if (totalInvested <= 0 || divHist.length === 0) return null;
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  const sum = divHist
    .filter((d) => {
      const dateStr = d.date.length === 7 ? `${d.date}-01` : d.date;
      return new Date(dateStr) >= cutoff;
    })
    .reduce((s, d) => s + d.net, 0);
  if (sum <= 0) return null;
  return (sum / totalInvested) * 100;
}
