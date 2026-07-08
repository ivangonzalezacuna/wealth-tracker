import { describe, it, expect } from 'vitest';
import {
  annualizeContrib,
  totalAnnualContrib,
  INTERVAL_PER_YEAR,
  INTERVAL_LABELS,
} from './contributions';
import type { Holding, ContribInterval } from '../types';

function makeHolding(overrides: Partial<Holding> = {}): Holding {
  return {
    isin: 'IE00B4L5Y983',
    shortName: 'IWDA',
    name: '',
    color: '#2a78d6',
    acc: true,
    active: true,
    contribAmount: 50,
    contribInterval: 'weekly',
    assetClass: 'equity',
    region: 'developed',
    foldInto: '',
    order: 1,
    ...overrides,
  };
}

describe('INTERVAL_PER_YEAR', () => {
  it('has correct factors', () => {
    expect(INTERVAL_PER_YEAR.weekly).toBe(52);
    expect(INTERVAL_PER_YEAR.biweekly).toBe(26);
    expect(INTERVAL_PER_YEAR.monthly).toBe(12);
    expect(INTERVAL_PER_YEAR.quarterly).toBe(4);
  });
});

describe('INTERVAL_LABELS', () => {
  it('provides a label for every interval', () => {
    expect(Object.keys(INTERVAL_LABELS)).toHaveLength(4);
    expect(INTERVAL_LABELS.weekly).toBe('Weekly');
    expect(INTERVAL_LABELS.biweekly).toBe('Every 2 weeks');
    expect(INTERVAL_LABELS.monthly).toBe('Monthly');
    expect(INTERVAL_LABELS.quarterly).toBe('Quarterly');
  });
});

describe('annualizeContrib', () => {
  it('weekly: 50 × 52 = 2600', () => {
    expect(annualizeContrib(50, 'weekly')).toBe(2600);
  });

  it('biweekly: 100 × 26 = 2600', () => {
    expect(annualizeContrib(100, 'biweekly')).toBe(2600);
  });

  it('monthly: 200 × 12 = 2400', () => {
    expect(annualizeContrib(200, 'monthly')).toBe(2400);
  });

  it('quarterly: 600 × 4 = 2400', () => {
    expect(annualizeContrib(600, 'quarterly')).toBe(2400);
  });

  it('zero amount returns zero', () => {
    expect(annualizeContrib(0, 'weekly')).toBe(0);
  });
});

describe('totalAnnualContrib', () => {
  it('sums annualized contributions from active holdings', () => {
    const holdings: Holding[] = [
      makeHolding({ contribAmount: 50, contribInterval: 'weekly' }), // 50×52 = 2600
      makeHolding({ contribAmount: 100, contribInterval: 'monthly' }), // 100×12 = 1200
    ];
    expect(totalAnnualContrib(holdings)).toBe(3800);
  });

  it('ignores inactive holdings', () => {
    const holdings: Holding[] = [
      makeHolding({ contribAmount: 50, contribInterval: 'weekly', active: true }), // 2600
      makeHolding({ contribAmount: 100, contribInterval: 'weekly', active: false }), // excluded
    ];
    expect(totalAnnualContrib(holdings)).toBe(2600);
  });

  it('ignores holdings with zero contribAmount', () => {
    const holdings: Holding[] = [
      makeHolding({ contribAmount: 0, contribInterval: 'weekly', active: true }),
      makeHolding({ contribAmount: 50, contribInterval: 'biweekly' }), // 50×26 = 1300
    ];
    expect(totalAnnualContrib(holdings)).toBe(1300);
  });

  it('returns 0 for empty array', () => {
    expect(totalAnnualContrib([])).toBe(0);
  });

  it('handles mixed intervals correctly', () => {
    const holdings: Holding[] = [
      makeHolding({ contribAmount: 50, contribInterval: 'weekly' }), // 2600
      makeHolding({ contribAmount: 100, contribInterval: 'biweekly' }), // 2600
      makeHolding({ contribAmount: 200, contribInterval: 'monthly' }), // 2400
      makeHolding({ contribAmount: 600, contribInterval: 'quarterly' }), // 2400
    ];
    expect(totalAnnualContrib(holdings)).toBe(10000);
  });
});
