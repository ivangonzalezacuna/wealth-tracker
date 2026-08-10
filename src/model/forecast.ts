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
  drawdownStartMonth?: string;
  annualWithdrawal?: number;
  annualTaxDragPct?: number;
}

function prepareAccountInputs(accounts: AccountForecastInput[]): {
  perAccountMonthlyRate: number[];
  perAccountMonthlyContrib: number[];
  perAccountMonthlyWithdrawal: number[];
  perAccountTaxDragPct: number[];
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
    perAccountMonthlyWithdrawal: accounts.map((a) => (a.annualWithdrawal ?? 0) / 12),
    perAccountTaxDragPct: accounts.map((a) => a.annualTaxDragPct ?? 0),
    values: accounts.map((a) => a.current),
  };
}

function advanceAccountValues(
  values: number[],
  perAccountMonthlyContrib: number[],
  perAccountMonthlyWithdrawal: number[],
  perAccountMonthlyRate: number[],
  perAccountTaxDragPct: number[],
  perAccountDrawdownStartOffset: number[],
  monthOffset: number,
): { values: number[]; total: number } {
  const nextValues = values.map((v, idx) => {
    const inDrawdown = monthOffset >= perAccountDrawdownStartOffset[idx];
    const monthlyContrib = inDrawdown ? 0 : perAccountMonthlyContrib[idx];
    const monthlyWithdrawal = inDrawdown ? perAccountMonthlyWithdrawal[idx] : 0;
    const base = Math.max(0, v + monthlyContrib);
    const projectedGrowth = base * perAccountMonthlyRate[idx];
    const taxDragPct = perAccountTaxDragPct[idx];
    const growthAfterTax =
      projectedGrowth > 0 ? projectedGrowth * (1 - taxDragPct / 100) : projectedGrowth;
    return Math.max(0, base + growthAfterTax - monthlyWithdrawal);
  });
  return {
    values: nextValues,
    total: nextValues.reduce((sum, value) => sum + value, 0),
  };
}

function monthOffsetFromStart(startDate: string, month: string): number {
  const [sy, sm] = startDate.slice(0, 7).split('-').map(Number);
  const [y, m] = month.split('-').map(Number);
  if (!isFinite(sy) || !isFinite(sm) || !isFinite(y) || !isFinite(m))
    return Number.POSITIVE_INFINITY;
  return (y - sy) * 12 + (m - sm);
}

function isValidMonth(value: string | undefined): value is string {
  return !!value && /^\d{4}-\d{2}$/.test(value);
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
    perAccountMonthlyWithdrawal,
    values: initialValues,
    perAccountTaxDragPct,
  } = prepareAccountInputs(accounts);
  const startMonth = startDate.slice(0, 7);
  const perAccountDrawdownStartOffset = accounts.map((a) =>
    isValidMonth(a.drawdownStartMonth)
      ? Math.max(0, monthOffsetFromStart(startMonth, a.drawdownStartMonth))
      : Number.POSITIVE_INFINITY,
  );
  let values = initialValues;

  const result: Array<{ month: string; value: number }> = [];
  let [year, mon] = startDate.split('-').map(Number);

  for (let i = 0; i < months; i++) {
    mon++;
    if (mon > 12) {
      mon = 1;
      year++;
    }
    const next = advanceAccountValues(
      values,
      perAccountMonthlyContrib,
      perAccountMonthlyWithdrawal,
      perAccountMonthlyRate,
      perAccountTaxDragPct,
      perAccountDrawdownStartOffset,
      i + 1,
    );
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
  startDate = new Date().toISOString().slice(0, 7),
): number | null {
  const current = accounts.reduce((s, a) => s + a.current, 0);
  if (current >= target || target <= 0 || current < 0) return null;

  const {
    perAccountMonthlyRate,
    perAccountMonthlyContrib,
    perAccountMonthlyWithdrawal,
    perAccountTaxDragPct,
    values: initialValues,
  } = prepareAccountInputs(accounts);
  const startMonth = startDate.slice(0, 7);
  const perAccountDrawdownStartOffset = accounts.map((a) =>
    isValidMonth(a.drawdownStartMonth)
      ? Math.max(0, monthOffsetFromStart(startMonth, a.drawdownStartMonth))
      : Number.POSITIVE_INFINITY,
  );
  let values = initialValues;

  let months = 0;
  const maxMonths = 1200;
  let total = current;

  while (total < target && months < maxMonths) {
    const next = advanceAccountValues(
      values,
      perAccountMonthlyContrib,
      perAccountMonthlyWithdrawal,
      perAccountMonthlyRate,
      perAccountTaxDragPct,
      perAccountDrawdownStartOffset,
      months + 1,
    );
    values = next.values;
    total = next.total;
    months++;
  }

  return months >= maxMonths ? null : months;
}
