/**
 * Forecast helpers - pure functions for projecting net worth growth.
 */

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
  const perAccountMonthlyRate = accounts.map(
    (a) => Math.pow(1 + a.annualReturnPct / 100, 1 / 12) - 1,
  );
  const perAccountMonthlyContrib = accounts.map((a) => a.annualContrib / 12);
  let values = accounts.map((a) => a.current);

  const result: Array<{ month: string; value: number }> = [];
  let [year, mon] = startDate.split('-').map(Number);

  for (let i = 0; i < months; i++) {
    mon++;
    if (mon > 12) {
      mon = 1;
      year++;
    }
    values = values.map(
      (v, idx) => (v + perAccountMonthlyContrib[idx]) * (1 + perAccountMonthlyRate[idx]),
    );
    const total = values.reduce((s, v) => s + v, 0);
    result.push({
      month: `${year}-${String(mon).padStart(2, '0')}`,
      value: Math.round(total),
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

  const perAccountMonthlyRate = accounts.map(
    (a) => Math.pow(1 + a.annualReturnPct / 100, 1 / 12) - 1,
  );
  const perAccountMonthlyContrib = accounts.map((a) => a.annualContrib / 12);
  let values = accounts.map((a) => a.current);

  let months = 0;
  const maxMonths = 1200;
  let total = current;

  while (total < target && months < maxMonths) {
    values = values.map(
      (v, idx) => (v + perAccountMonthlyContrib[idx]) * (1 + perAccountMonthlyRate[idx]),
    );
    total = values.reduce((s, v) => s + v, 0);
    months++;
  }

  return months >= maxMonths ? null : months;
}

// ── Single-account convenience wrappers ──────────────────

/** Single-account wrapper for forecastMonthsToTargetMulti. */
export function forecastMonthsToTarget(
  current: number,
  target: number,
  annualContrib: number,
  annualReturnPct: number,
): number | null {
  return forecastMonthsToTargetMulti([{ current, annualContrib, annualReturnPct }], target);
}

/** Single-account wrapper for forecastMultiAccountSeries. */
export function forecastSeries(
  startValue: number,
  annualContrib: number,
  annualReturnPct: number,
  months: number,
  startDate: string, // YYYY-MM
): Array<{ month: string; value: number }> {
  return forecastMultiAccountSeries(
    [{ current: startValue, annualContrib, annualReturnPct }],
    months,
    startDate,
  );
}
