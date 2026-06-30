import { describe, it, expect } from 'vitest';
import { fmt, fmtShares, currentMonth } from './utils';

describe('fmt', () => {
  it('renders 2-decimal cents with comma separator (de-DE)', () => {
    const result = fmt(1234.56, 2);
    // de-DE uses comma as decimal separator
    expect(result).toContain(',');
    expect(result).toContain('56');
  });

  it('rounds to whole euros by default (d=0)', () => {
    const result = fmt(1234.56);
    // Should not contain decimal cents
    expect(result).toContain('1.235');
    expect(result).not.toContain('56');
  });

  it('starts with euro sign', () => {
    expect(fmt(100)).toMatch(/^€/);
    expect(fmt(100, 2)).toMatch(/^€/);
  });
});

describe('currentMonth', () => {
  it('returns YYYY-MM format', () => {
    expect(currentMonth()).toMatch(/^\d{4}-\d{2}$/);
  });

  it('matches locally-computed YYYY-MM', () => {
    const d = new Date();
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    expect(currentMonth()).toBe(expected);
  });
});

describe('fmtShares', () => {
  it('uses comma as decimal separator (de-DE)', () => {
    expect(fmtShares(1.2345)).toBe('1,2345');
  });

  it('uses dot as thousands separator for large share counts', () => {
    expect(fmtShares(1234.5)).toContain('.');
    expect(fmtShares(1234.5)).toContain(',5');
  });

  it('drops trailing zero fraction for whole share counts', () => {
    expect(fmtShares(5)).toBe('5');
  });
});
