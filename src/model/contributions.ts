import type { Holding, ContribInterval } from '../types';

/** How many times each interval executes per year. */
export const INTERVAL_PER_YEAR: Record<ContribInterval, number> = {
  weekly: 52,
  biweekly: 26,
  monthly: 12,
  quarterly: 4,
};

/** Human-readable labels for each interval. */
export const INTERVAL_LABELS: Record<ContribInterval, string> = {
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
};

/** Annualize a single holding's contribution: amount × executions/year. */
export function annualizeContrib(amount: number, interval: ContribInterval): number {
  return amount * INTERVAL_PER_YEAR[interval];
}

/** Sum annualized contributions across all active holdings. */
export function totalAnnualContrib(holdings: Holding[]): number {
  return holdings
    .filter((h) => h.active && h.contribAmount > 0)
    .reduce((sum, h) => sum + annualizeContrib(h.contribAmount, h.contribInterval), 0);
}

export interface MonthlyContributionPlanItem {
  holding: Holding;
  annualAmount: number;
  monthlyAmount: number;
  targetPct: number;
}

/** Convert a recurring contribution cadence into a single monthly budget. */
export function monthlyContribFromAnnualized(amount: number, interval: ContribInterval): number {
  return annualizeContrib(amount, interval) / 12;
}

/** Active holding contributions, normalized to a single monthly execution plan. */
export function buildMonthlyContributionPlan(
  holdings: Holding[],
): MonthlyContributionPlanItem[] {
  const active = holdings.filter((h) => h.active && h.contribAmount > 0);
  const totalAnnual = totalAnnualContrib(active);
  return active.map((holding) => {
    const annualAmount = annualizeContrib(holding.contribAmount, holding.contribInterval);
    return {
      holding,
      annualAmount,
      monthlyAmount: annualAmount / 12,
      targetPct: totalAnnual > 0 ? (annualAmount / totalAnnual) * 100 : 0,
    };
  });
}
