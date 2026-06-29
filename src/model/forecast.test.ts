import { describe, it, expect } from 'vitest';
import { forecastMonthsToTarget, formatMonthsEta, forecastSeries } from './forecast';

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
