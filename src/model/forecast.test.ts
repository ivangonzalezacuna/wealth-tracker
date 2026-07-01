import { describe, it, expect } from 'vitest';
import {
  forecastMonthsToTarget,
  formatMonthsEta,
  forecastSeries,
  forecastMultiAccountSeries,
  forecastMonthsToTargetMulti,
} from './forecast';

describe('forecastMonthsToTarget', () => {
  it('returns null when target already met', () => {
    expect(forecastMonthsToTarget(100_000, 50_000, 10_000, 7)).toBeNull();
  });

  it('returns null when target equals current', () => {
    expect(forecastMonthsToTarget(100_000, 100_000, 10_000, 7)).toBeNull();
  });

  it('returns null when target is zero or negative', () => {
    expect(forecastMonthsToTarget(50_000, 0, 10_000, 7)).toBeNull();
    expect(forecastMonthsToTarget(50_000, -1, 10_000, 7)).toBeNull();
  });

  it('returns null when no growth possible (zero contrib + zero return)', () => {
    expect(forecastMonthsToTarget(50_000, 100_000, 0, 0)).toBeNull();
  });

  it('calculates months with contributions only (0% return)', () => {
    // 50k remaining, 12k/year = 1k/month → 50 months
    const months = forecastMonthsToTarget(50_000, 100_000, 12_000, 0);
    expect(months).toBe(50);
  });

  it('calculates months with both contributions and growth', () => {
    // 50k → 100k with 10k/year contrib and 7% annual return
    const months = forecastMonthsToTarget(50_000, 100_000, 10_000, 7);
    expect(months).not.toBeNull();
    expect(months).toBeGreaterThan(0);
    expect(months).toBeLessThan(120); // should be reachable within 10 years
  });

  it('works with growth only (0 contributions)', () => {
    // 50k → 100k at 7% annual (rule of ~10 years)
    const months = forecastMonthsToTarget(50_000, 100_000, 0, 7);
    expect(months).not.toBeNull();
    expect(months).toBeGreaterThan(100);
    expect(months).toBeLessThan(140);
  });

  it('returns null for unreachable targets (capped at 1200 months)', () => {
    // Very small growth, very large target
    const months = forecastMonthsToTarget(100, 1_000_000_000, 1, 0.01);
    expect(months).toBeNull();
  });
});

describe('formatMonthsEta', () => {
  it('formats months only', () => {
    expect(formatMonthsEta(8)).toBe('8m');
  });

  it('formats years only', () => {
    expect(formatMonthsEta(24)).toBe('2y');
    expect(formatMonthsEta(12)).toBe('1y');
  });

  it('formats years and months', () => {
    expect(formatMonthsEta(15)).toBe('1y 3m');
    expect(formatMonthsEta(27)).toBe('2y 3m');
  });

  it('formats zero months', () => {
    expect(formatMonthsEta(0)).toBe('0m');
  });
});

describe('forecastSeries', () => {
  it('generates correct number of points', () => {
    const series = forecastSeries(50_000, 12_000, 7, 12, '2024-06');
    expect(series).toHaveLength(12);
  });

  it('first point starts from next month', () => {
    const series = forecastSeries(50_000, 12_000, 7, 3, '2024-06');
    expect(series[0].month).toBe('2024-07');
    expect(series[1].month).toBe('2024-08');
    expect(series[2].month).toBe('2024-09');
  });

  it('handles year rollover', () => {
    const series = forecastSeries(50_000, 12_000, 7, 3, '2024-11');
    expect(series[0].month).toBe('2024-12');
    expect(series[1].month).toBe('2025-01');
    expect(series[2].month).toBe('2025-02');
  });

  it('values grow over time', () => {
    const series = forecastSeries(50_000, 12_000, 7, 12, '2024-01');
    for (let i = 1; i < series.length; i++) {
      expect(series[i].value).toBeGreaterThan(series[i - 1].value);
    }
  });

  it('with zero return and contrib, values increase by monthly contrib', () => {
    const series = forecastSeries(50_000, 12_000, 0, 3, '2024-01');
    // Each month adds 1000 (12000/12)
    expect(series[0].value).toBe(51_000);
    expect(series[1].value).toBe(52_000);
    expect(series[2].value).toBe(53_000);
  });
});

describe('forecastMultiAccountSeries', () => {
  it('two accounts: investment at 7% + cash at 0% — totals equal sum of independent compounding', () => {
    const investStart = 40_000;
    const cashStart = 10_000;
    const investContrib = 2_400; // annual
    const months = 12;
    const startDate = '2024-01';

    // Multi-account path
    const multi = forecastMultiAccountSeries(
      [
        { current: investStart, annualContrib: investContrib, annualReturnPct: 7 },
        { current: cashStart, annualContrib: 0, annualReturnPct: 0 },
      ],
      months,
      startDate,
    );

    // Single-account paths computed separately
    const investSeries = forecastSeries(investStart, investContrib, 7, months, startDate);
    const cashSeries = forecastSeries(cashStart, 0, 0, months, startDate);

    expect(multi).toHaveLength(months);
    for (let i = 0; i < months; i++) {
      expect(multi[i].value).toBe(investSeries[i].value + cashSeries[i].value);
      expect(multi[i].month).toBe(investSeries[i].month);
    }
  });

  it('single account reproduces forecastSeries output exactly', () => {
    const start = 50_000;
    const contrib = 12_000;
    const rate = 7;
    const months = 24;
    const startDate = '2024-06';

    const single = forecastSeries(start, contrib, rate, months, startDate);
    const multi = forecastMultiAccountSeries(
      [{ current: start, annualContrib: contrib, annualReturnPct: rate }],
      months,
      startDate,
    );

    expect(multi).toHaveLength(single.length);
    for (let i = 0; i < months; i++) {
      expect(multi[i].month).toBe(single[i].month);
      expect(multi[i].value).toBe(single[i].value);
    }
  });

  it('20-year (240 months) forecast returns 240 points with correct final month', () => {
    const accounts = [{ current: 50_000, annualContrib: 6_000, annualReturnPct: 7 }];
    const startDate = '2024-06';
    const series = forecastMultiAccountSeries(accounts, 240, startDate);
    expect(series).toHaveLength(240);
    // 240 months from 2024-06 → 2044-06
    expect(series[239].month).toBe('2044-06');
  });
});

describe('forecastMonthsToTargetMulti', () => {
  it('returns null when target already met (sum >= target)', () => {
    expect(
      forecastMonthsToTargetMulti(
        [
          { current: 80_000, annualContrib: 0, annualReturnPct: 0 },
          { current: 30_000, annualContrib: 0, annualReturnPct: 0 },
        ],
        100_000,
      ),
    ).toBeNull();
  });

  it('returns null when all accounts have 0% return and 0 contribution (unreachable)', () => {
    expect(
      forecastMonthsToTargetMulti(
        [
          { current: 40_000, annualContrib: 0, annualReturnPct: 0 },
          { current: 10_000, annualContrib: 0, annualReturnPct: 0 },
        ],
        100_000,
      ),
    ).toBeNull();
  });

  it('cash at 0% + investment at 7% with contributions reaches target — the bug regression test', () => {
    // Scenario: 10k cash (0%), 40k investment (7%, 2400/yr contrib), target 100k
    const multiMonths = forecastMonthsToTargetMulti(
      [
        { current: 10_000, annualContrib: 0, annualReturnPct: 0 }, // cash — sits flat
        { current: 40_000, annualContrib: 2_400, annualReturnPct: 7 }, // investment — grows
      ],
      100_000,
    );

    // Old buggy single-rate: projects ENTIRE 50k at 7% with 2400/yr contrib
    const buggyMonths = forecastMonthsToTarget(50_000, 100_000, 2_400, 7);

    expect(multiMonths).not.toBeNull();
    expect(buggyMonths).not.toBeNull();
    // The correct multi-account ETA must be >= the buggy single-rate ETA,
    // because the 10k cash never compounds — so it takes longer (or equal) to reach the goal.
    // With meaningful cash weight (10k/50k = 20%), it should be strictly greater.
    expect(multiMonths!).toBeGreaterThan(buggyMonths!);
  });
});
