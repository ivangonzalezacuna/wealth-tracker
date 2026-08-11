import { describe, it, expect } from 'vitest';
import {
  formatMonthsEta,
  forecastMultiAccountSeries,
  forecastMonthsToTargetMulti,
  decumulationSeries,
  decumulationDuration,
} from './forecast';

describe('forecastMonthsToTargetMulti (single-account)', () => {
  it('returns null when target already met', () => {
    expect(
      forecastMonthsToTargetMulti(
        [{ current: 100_000, annualContrib: 10_000, annualReturnPct: 7 }],
        50_000,
      ),
    ).toBeNull();
  });

  it('returns null when target equals current', () => {
    expect(
      forecastMonthsToTargetMulti(
        [{ current: 100_000, annualContrib: 10_000, annualReturnPct: 7 }],
        100_000,
      ),
    ).toBeNull();
  });

  it('returns null when target is zero or negative', () => {
    expect(
      forecastMonthsToTargetMulti(
        [{ current: 50_000, annualContrib: 10_000, annualReturnPct: 7 }],
        0,
      ),
    ).toBeNull();
    expect(
      forecastMonthsToTargetMulti(
        [{ current: 50_000, annualContrib: 10_000, annualReturnPct: 7 }],
        -1,
      ),
    ).toBeNull();
  });

  it('returns null when no growth possible (zero contrib + zero return)', () => {
    expect(
      forecastMonthsToTargetMulti(
        [{ current: 50_000, annualContrib: 0, annualReturnPct: 0 }],
        100_000,
      ),
    ).toBeNull();
  });

  it('calculates months with contributions only (0% return)', () => {
    // 50k remaining, 12k/year = 1k/month → 50 months
    const months = forecastMonthsToTargetMulti(
      [{ current: 50_000, annualContrib: 12_000, annualReturnPct: 0 }],
      100_000,
    );
    expect(months).toBe(50);
  });

  it('calculates months with both contributions and growth', () => {
    // 50k → 100k with 10k/year contrib and 7% annual return
    const months = forecastMonthsToTargetMulti(
      [{ current: 50_000, annualContrib: 10_000, annualReturnPct: 7 }],
      100_000,
    );
    expect(months).not.toBeNull();
    expect(months).toBeGreaterThan(0);
    expect(months).toBeLessThan(120); // should be reachable within 10 years
  });

  it('works with growth only (0 contributions)', () => {
    // 50k → 100k at 7% annual (rule of ~10 years)
    const months = forecastMonthsToTargetMulti(
      [{ current: 50_000, annualContrib: 0, annualReturnPct: 7 }],
      100_000,
    );
    expect(months).not.toBeNull();
    expect(months).toBeGreaterThan(100);
    expect(months).toBeLessThan(140);
  });

  it('returns null for unreachable targets (capped at 1200 months)', () => {
    // Very small growth, very large target
    const months = forecastMonthsToTargetMulti(
      [{ current: 100, annualContrib: 1, annualReturnPct: 0.01 }],
      1_000_000_000,
    );
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

describe('forecastMultiAccountSeries (single-account)', () => {
  it('generates correct number of points', () => {
    const series = forecastMultiAccountSeries(
      [{ current: 50_000, annualContrib: 12_000, annualReturnPct: 7 }],
      12,
      '2024-06',
    );
    expect(series).toHaveLength(12);
  });

  it('first point starts from next month', () => {
    const series = forecastMultiAccountSeries(
      [{ current: 50_000, annualContrib: 12_000, annualReturnPct: 7 }],
      3,
      '2024-06',
    );
    expect(series[0].month).toBe('2024-07');
    expect(series[1].month).toBe('2024-08');
    expect(series[2].month).toBe('2024-09');
  });

  it('handles year rollover', () => {
    const series = forecastMultiAccountSeries(
      [{ current: 50_000, annualContrib: 12_000, annualReturnPct: 7 }],
      3,
      '2024-11',
    );
    expect(series[0].month).toBe('2024-12');
    expect(series[1].month).toBe('2025-01');
    expect(series[2].month).toBe('2025-02');
  });

  it('values grow over time', () => {
    const series = forecastMultiAccountSeries(
      [{ current: 50_000, annualContrib: 12_000, annualReturnPct: 7 }],
      12,
      '2024-01',
    );
    for (let i = 1; i < series.length; i++) {
      expect(series[i].value).toBeGreaterThan(series[i - 1].value);
    }
  });

  it('with zero return and contrib, values increase by monthly contrib', () => {
    const series = forecastMultiAccountSeries(
      [{ current: 50_000, annualContrib: 12_000, annualReturnPct: 0 }],
      3,
      '2024-01',
    );
    // Each month adds 1000 (12000/12)
    expect(series[0].value).toBe(51_000);
    expect(series[1].value).toBe(52_000);
    expect(series[2].value).toBe(53_000);
  });
});

describe('forecastMultiAccountSeries', () => {
  it('two accounts: investment at 7% + cash at 0% - totals equal sum of independent compounding', () => {
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
    const investSeries = forecastMultiAccountSeries(
      [{ current: investStart, annualContrib: investContrib, annualReturnPct: 7 }],
      months,
      startDate,
    );
    const cashSeries = forecastMultiAccountSeries(
      [{ current: cashStart, annualContrib: 0, annualReturnPct: 0 }],
      months,
      startDate,
    );

    expect(multi).toHaveLength(months);
    for (let i = 0; i < months; i++) {
      expect(multi[i].value).toBe(investSeries[i].value + cashSeries[i].value);
      expect(multi[i].month).toBe(investSeries[i].month);
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

  it('cash at 0% + investment at 7% with contributions reaches target - the bug regression test', () => {
    // Scenario: 10k cash (0%), 40k investment (7%, 2400/yr contrib), target 100k
    const multiMonths = forecastMonthsToTargetMulti(
      [
        { current: 10_000, annualContrib: 0, annualReturnPct: 0 }, // cash - sits flat
        { current: 40_000, annualContrib: 2_400, annualReturnPct: 7 }, // investment - grows
      ],
      100_000,
    );

    // Old buggy single-rate: projects ENTIRE 50k at 7% with 2400/yr contrib
    const buggyMonths = forecastMonthsToTargetMulti(
      [{ current: 50_000, annualContrib: 2_400, annualReturnPct: 7 }],
      100_000,
    );

    expect(multiMonths).not.toBeNull();
    expect(buggyMonths).not.toBeNull();
    // The correct multi-account ETA must be >= the buggy single-rate ETA,
    // because the 10k cash never compounds - so it takes longer (or equal) to reach the goal.
    // With meaningful cash weight (10k/50k = 20%), it should be strictly greater.
    expect(multiMonths!).toBeGreaterThan(buggyMonths!);
  });
});

// ── decumulationSeries ─────────────────────────────────────────────────────

describe('decumulationSeries', () => {
  it('returns empty array for zero or negative startBalance', () => {
    expect(decumulationSeries(0, 'fixed', 1000, 5, 12, '2060-01')).toHaveLength(0);
    expect(decumulationSeries(-100, 'fixed', 1000, 5, 12, '2060-01')).toHaveLength(0);
  });

  it('returns empty array for zero months', () => {
    expect(decumulationSeries(100_000, 'fixed', 1000, 5, 0, '2060-01')).toHaveLength(0);
  });

  it('fixed strategy with 0% return depletes linearly', () => {
    // 12 000 balance, withdraw 1 000/month → depletes in 12 months
    const series = decumulationSeries(12_000, 'fixed', 1_000, 0, 24, '2060-01');
    expect(series).toHaveLength(24);
    // After 12 months balance should be 0
    expect(series[11].value).toBe(0);
    // All months after depletion are also 0
    for (let i = 11; i < 24; i++) {
      expect(series[i].value).toBe(0);
    }
  });

  it('fixed strategy: balance decreases each month (with positive return but withdrawal > interest)', () => {
    // Large withdrawal relative to growth → balance must shrink
    const series = decumulationSeries(100_000, 'fixed', 2_000, 3, 12, '2060-01');
    for (let i = 1; i < series.length; i++) {
      expect(series[i].value).toBeLessThan(series[i - 1].value);
    }
  });

  it('pct strategy never fully depletes (balance asymptotically approaches 0)', () => {
    // 4% annual withdrawal rate (0.333%/month), 0% return
    const series = decumulationSeries(100_000, 'pct', 4, 0, 360, '2060-01');
    expect(series).toHaveLength(360);
    // Balance should always be > 0 because withdrawal is a fraction of current balance
    for (const pt of series) {
      expect(pt.value).toBeGreaterThan(0);
    }
    // Balance shrinks over time
    expect(series[359].value).toBeLessThan(series[0].value);
  });

  it('four-pct strategy uses the provided monthly amount (same as fixed)', () => {
    // 'four-pct' is just a label hint; the model treats it like 'fixed'
    const fixed = decumulationSeries(120_000, 'fixed', 400, 5, 12, '2060-01');
    const fourPct = decumulationSeries(120_000, 'four-pct', 400, 5, 12, '2060-01');
    expect(fixed).toEqual(fourPct);
  });

  it('withdrawal is capped at remaining balance (no negative values)', () => {
    // 500 balance, withdraw 1000/month → first month withdrawal = 500, balance = 0
    const series = decumulationSeries(500, 'fixed', 1_000, 0, 3, '2060-01');
    expect(series[0].value).toBe(0);
    expect(series[0].withdrawal).toBe(500); // capped
    expect(series[1].value).toBe(0);
    expect(series[1].withdrawal).toBe(0); // nothing left
  });

  it('generates correct month labels starting from the month after startDate', () => {
    const series = decumulationSeries(100_000, 'fixed', 500, 0, 3, '2059-11');
    expect(series[0].month).toBe('2059-12');
    expect(series[1].month).toBe('2060-01');
    expect(series[2].month).toBe('2060-02');
  });

  it('handles year rollover in month labels', () => {
    const series = decumulationSeries(100_000, 'fixed', 500, 0, 2, '2060-12');
    expect(series[0].month).toBe('2061-01');
    expect(series[1].month).toBe('2061-02');
  });
});

// ── decumulationDuration ───────────────────────────────────────────────────

describe('decumulationDuration', () => {
  it('returns the month when balance first hits 0', () => {
    const series = decumulationSeries(12_000, 'fixed', 1_000, 0, 24, '2060-01');
    const endMonth = decumulationDuration(series);
    expect(endMonth).toBe('2061-01'); // 12 months from 2060-01
  });

  it('returns null when portfolio never depletes', () => {
    const series = decumulationSeries(100_000, 'pct', 4, 0, 360, '2060-01');
    expect(decumulationDuration(series)).toBeNull();
  });

  it('returns null for empty series', () => {
    expect(decumulationDuration([])).toBeNull();
  });
});
