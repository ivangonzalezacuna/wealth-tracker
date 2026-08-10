import type { ContribInterval } from '../types';

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
