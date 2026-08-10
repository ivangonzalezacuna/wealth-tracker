import { describe, it, expect } from 'vitest';
import { annualizeContrib, INTERVAL_PER_YEAR, INTERVAL_LABELS } from './contributions';

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
