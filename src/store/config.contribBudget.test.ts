import { describe, it, expect } from 'vitest';
import {
  hydrateConfigFromCache,
  getContributionBudgetAmount,
  getContributionInterval,
  getMonthlyContribBudget,
} from './config';

describe('global contribution budget cadence', () => {
  it('defaults to monthly cadence for legacy settings without contribution_interval', () => {
    hydrateConfigFromCache({
      accounts: [],
      holdings: [],
      settings: { monthly_contrib_budget: '500' },
    } as any);

    expect(getContributionBudgetAmount()).toBe(500);
    expect(getContributionInterval()).toBe('monthly');
    expect(getMonthlyContribBudget()).toBe(500);
  });

  it('normalizes weekly, biweekly, and quarterly amounts to monthly budget', () => {
    hydrateConfigFromCache({
      accounts: [],
      holdings: [],
      settings: { monthly_contrib_budget: '100', contribution_interval: 'weekly' },
    } as any);
    expect(getMonthlyContribBudget()).toBeCloseTo((100 * 52) / 12, 6);

    hydrateConfigFromCache({
      accounts: [],
      holdings: [],
      settings: { monthly_contrib_budget: '100', contribution_interval: 'biweekly' },
    } as any);
    expect(getMonthlyContribBudget()).toBeCloseTo((100 * 26) / 12, 6);

    hydrateConfigFromCache({
      accounts: [],
      holdings: [],
      settings: { monthly_contrib_budget: '100', contribution_interval: 'quarterly' },
    } as any);
    expect(getMonthlyContribBudget()).toBeCloseTo((100 * 4) / 12, 6);
  });

  it('keeps monthly behavior unchanged and falls back for invalid cadence', () => {
    hydrateConfigFromCache({
      accounts: [],
      holdings: [],
      settings: { monthly_contrib_budget: '500', contribution_interval: 'monthly' },
    } as any);
    expect(getMonthlyContribBudget()).toBe(500);

    hydrateConfigFromCache({
      accounts: [],
      holdings: [],
      settings: { monthly_contrib_budget: '500', contribution_interval: 'invalid' },
    } as any);
    expect(getContributionInterval()).toBe('monthly');
    expect(getMonthlyContribBudget()).toBe(500);
  });
});
