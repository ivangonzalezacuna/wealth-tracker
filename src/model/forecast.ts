/**
 * Forecast helpers - pure functions for projecting net worth growth and decumulation.
 */

// ── Decumulation (retirement withdrawal) ──────────────────

/** Strategy for the decumulation simulation. */
export type DecumulationStrategy =
  | 'fixed' // withdraw a fixed €/month (nominal, never adjusted)
  | 'pct' // withdraw withdrawalParam % of the current balance each month
  | 'four-pct'; // 4% SWR: initial monthly amount = startBalance * 0.04 / 12, inflation-indexed annually

export interface DecumulationPoint {
  month: string;
  value: number; // portfolio balance after withdrawal
  withdrawal: number; // amount actually withdrawn this month
}

/**
 * Simulate monthly portfolio drawdown.
 *
 * Each month:
 *   1. Apply monthly compounding to the current balance.
 *   2. Subtract the month's withdrawal (capped at remaining balance; balance floors at 0).
 *
 * @param startBalance  Starting portfolio value.
 * @param strategy      'fixed' — flat €/month; 'four-pct' — 4% SWR (inflation-indexed annually);
 *                      'pct' — % of current balance.
 * @param withdrawalParam  For 'fixed'/'four-pct': initial monthly withdrawal in €.
 *                          For 'pct': annual withdrawal % (e.g. 4 means 4 %/yr = 0.333 %/mo).
 * @param annualReturnPct  Annual portfolio return % during retirement (may be 0).
 * @param months           Number of months to simulate.
 * @param startDate        ISO month string of the retirement start, e.g. "2060-01".
 * @param annualInflationPct  Annual inflation % used to index 'four-pct' withdrawals (default 0).
 */
export function decumulationSeries(
  startBalance: number,
  strategy: DecumulationStrategy,
  withdrawalParam: number,
  annualReturnPct: number,
  months: number,
  startDate: string,
  annualInflationPct = 0,
): DecumulationPoint[] {
  if (startBalance <= 0 || months <= 0) return [];

  const monthlyRate = isFinite(annualReturnPct)
    ? Math.pow(1 + annualReturnPct / 100, 1 / 12) - 1
    : 0;

  // For 'pct' strategy, convert annual % to monthly %.
  // Uses the linear approximation p/12 (error <0.05% for values ≤10%/yr).
  // Negative values are clamped to 0 so they cannot add money instead of withdrawing.
  const monthlyWithdrawalPct =
    strategy === 'pct' && isFinite(withdrawalParam) ? Math.max(0, withdrawalParam) / 100 / 12 : 0;

  // For 'fixed': flat nominal monthly amount (never adjusted).
  // For 'four-pct': starts at withdrawalParam, then inflated annually (proper SWR).
  const fixedMonthly =
    strategy !== 'pct' && isFinite(withdrawalParam) && withdrawalParam > 0 ? withdrawalParam : 0;

  let balance = startBalance;
  let [year, mon] = startDate.split('-').map(Number);
  // 'four-pct' SWR: track the current annual withdrawal amount and index it each year.
  let swrMonthly = fixedMonthly; // adjusted annually for 'four-pct'
  let yearsElapsed = 0; // full years since retirement start

  const result: DecumulationPoint[] = [];

  for (let i = 0; i < months; i++) {
    mon++;
    if (mon > 12) {
      mon = 1;
      year++;
      // Inflate 'four-pct' withdrawal once per year
      if (strategy === 'four-pct' && annualInflationPct > 0) {
        yearsElapsed++;
        swrMonthly = fixedMonthly * Math.pow(1 + annualInflationPct / 100, yearsElapsed);
      }
    }

    // 1. Apply growth
    balance = balance * (1 + monthlyRate);

    // 2. Compute withdrawal and subtract
    const monthlyAmount = strategy === 'four-pct' ? swrMonthly : fixedMonthly;
    const rawWithdrawal = strategy === 'pct' ? balance * monthlyWithdrawalPct : monthlyAmount;
    const actualWithdrawal = Math.min(rawWithdrawal, balance);
    balance = Math.max(0, balance - actualWithdrawal);

    // Round for output; use the rounded value for the depletion guard so that
    // decumulationDuration (which checks p.value === 0) stays consistent with
    // the fill-zero trigger below (avoids off-by-one-month for sub-cent balances).
    const roundedBalance = Math.round(balance);
    result.push({
      month: `${year}-${String(mon).padStart(2, '0')}`,
      value: roundedBalance,
      withdrawal: Math.round(actualWithdrawal),
    });

    if (roundedBalance === 0) {
      // Portfolio is depleted; fill remaining months as zero
      for (let j = i + 1; j < months; j++) {
        mon++;
        if (mon > 12) {
          mon = 1;
          year++;
        }
        result.push({
          month: `${year}-${String(mon).padStart(2, '0')}`,
          value: 0,
          withdrawal: 0,
        });
      }
      break;
    }
  }

  return result;
}

/**
 * Returns the month string when the balance first reaches 0, or null if the
 * portfolio is never fully depleted within the provided series.
 */
export function decumulationDuration(series: DecumulationPoint[]): string | null {
  const depleted = series.find((p) => p.value === 0);
  return depleted ? depleted.month : null;
}

/**
 * Format months as a human-readable string, e.g. "2y 3m" or "8m".
 */
export function formatMonthsEta(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m}m`;
  if (m === 0) return `${y}y`;
  return `${y}y ${m}m`;
}

// ── Multi-account forecast functions ──────────────────────

export interface AccountForecastInput {
  current: number;
  annualContrib: number;
  annualReturnPct: number;
}

function prepareAccountInputs(accounts: AccountForecastInput[]): {
  perAccountMonthlyRate: number[];
  perAccountMonthlyContrib: number[];
  values: number[];
} {
  const perAccountMonthlyRate = accounts.map(
    (a) => Math.pow(1 + a.annualReturnPct / 100, 1 / 12) - 1,
  );
  // Defense-in-depth: treat NaN/Infinity as 0% growth rather than poisoning the result.
  for (let i = 0; i < perAccountMonthlyRate.length; i++) {
    if (!isFinite(perAccountMonthlyRate[i])) perAccountMonthlyRate[i] = 0;
  }

  return {
    perAccountMonthlyRate,
    perAccountMonthlyContrib: accounts.map((a) => a.annualContrib / 12),
    values: accounts.map((a) => a.current),
  };
}

function advanceAccountValues(
  values: number[],
  perAccountMonthlyContrib: number[],
  perAccountMonthlyRate: number[],
): { values: number[]; total: number } {
  const nextValues = values.map(
    (v, idx) => (v + perAccountMonthlyContrib[idx]) * (1 + perAccountMonthlyRate[idx]),
  );
  return {
    values: nextValues,
    total: nextValues.reduce((sum, value) => sum + value, 0),
  };
}

/**
 * Sum of independent per-account compounding projections.
 * Each account compounds at its own rate and receives its own monthly
 * contribution share; the totals are summed per month. This is the
 * correct generalization of forecastSeries for a portfolio of accounts
 * with different growth assumptions (e.g. ETF vs cash vs pension).
 */
export function forecastMultiAccountSeries(
  accounts: AccountForecastInput[],
  months: number,
  startDate: string,
): Array<{ month: string; value: number }> {
  const {
    perAccountMonthlyRate,
    perAccountMonthlyContrib,
    values: initialValues,
  } = prepareAccountInputs(accounts);
  let values = initialValues;

  const result: Array<{ month: string; value: number }> = [];
  let [year, mon] = startDate.split('-').map(Number);

  for (let i = 0; i < months; i++) {
    mon++;
    if (mon > 12) {
      mon = 1;
      year++;
    }
    const next = advanceAccountValues(values, perAccountMonthlyContrib, perAccountMonthlyRate);
    values = next.values;
    result.push({
      month: `${year}-${String(mon).padStart(2, '0')}`,
      value: Math.round(next.total),
    });
  }

  return result;
}

/**
 * Multi-account equivalent of forecastMonthsToTarget: each account compounds
 * independently at its own rate; returns months until the SUM crosses target.
 * Returns null if target already met, inputs invalid, or unreachable within
 * the 1200-month (100yr) cap.
 */
export function forecastMonthsToTargetMulti(
  accounts: AccountForecastInput[],
  target: number,
): number | null {
  const current = accounts.reduce((s, a) => s + a.current, 0);
  if (current >= target || target <= 0 || current < 0) return null;
  const anyGrowthPotential = accounts.some((a) => a.annualContrib > 0 || a.annualReturnPct > 0);
  if (!anyGrowthPotential) return null;

  const {
    perAccountMonthlyRate,
    perAccountMonthlyContrib,
    values: initialValues,
  } = prepareAccountInputs(accounts);
  let values = initialValues;

  let months = 0;
  const maxMonths = 1200;
  let total = current;

  while (total < target && months < maxMonths) {
    const next = advanceAccountValues(values, perAccountMonthlyContrib, perAccountMonthlyRate);
    values = next.values;
    total = next.total;
    months++;
  }

  return months >= maxMonths ? null : months;
}
