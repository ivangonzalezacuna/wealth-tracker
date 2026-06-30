/**
 * Forecast helpers — pure functions for projecting net worth growth.
 */

/**
 * Estimate the number of months to reach a target net worth given:
 * - current: current net worth
 * - target: goal net worth
 * - annualContrib: total annual contributions (sum of all savings plans)
 * - annualReturnPct: expected annual return percentage (e.g. 7 for 7%)
 *
 * Uses month-by-month compounding: each month adds contrib/12 and grows by (1+r)^(1/12).
 * Returns null if target is already met or inputs are invalid.
 * Caps at 1200 months (100 years) to avoid infinite loops.
 */
export function forecastMonthsToTarget(
  current: number,
  target: number,
  annualContrib: number,
  annualReturnPct: number,
): number | null {
  if (current >= target || target <= 0 || current < 0) return null;
  if (annualContrib <= 0 && annualReturnPct <= 0) return null;

  const monthlyContrib = annualContrib / 12;
  const monthlyRate = Math.pow(1 + annualReturnPct / 100, 1 / 12) - 1;

  let value = current;
  let months = 0;
  const maxMonths = 1200; // 100 years cap

  while (value < target && months < maxMonths) {
    value = (value + monthlyContrib) * (1 + monthlyRate);
    months++;
  }

  return months >= maxMonths ? null : months;
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

/**
 * Generate a monthly forecast series for charting.
 * Returns an array of { month: 'YYYY-MM', value: number } starting from startDate.
 * Projects forward `months` periods with monthly contributions and growth.
 */
export function forecastSeries(
  startValue: number,
  annualContrib: number,
  annualReturnPct: number,
  months: number,
  startDate: string, // YYYY-MM
): Array<{ month: string; value: number }> {
  const monthlyContrib = annualContrib / 12;
  const monthlyRate = Math.pow(1 + annualReturnPct / 100, 1 / 12) - 1;

  const result: Array<{ month: string; value: number }> = [];
  let value = startValue;
  let [year, mon] = startDate.split('-').map(Number);

  for (let i = 0; i < months; i++) {
    // Advance month
    mon++;
    if (mon > 12) {
      mon = 1;
      year++;
    }
    value = (value + monthlyContrib) * (1 + monthlyRate);
    result.push({
      month: `${year}-${String(mon).padStart(2, '0')}`,
      value: Math.round(value),
    });
  }

  return result;
}
