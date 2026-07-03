import { describe, it, expect } from 'vitest';
import {
  fmt,
  fmtEur2,
  fmtShares,
  fmtEurNeg,
  fmtPctNeg,
  fmtEurSigned,
  fmtPctSigned,
  currentMonth,
} from './utils';

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

describe('fmtEurNeg', () => {
  it('positive: no sign, matches fmtEur2', () => {
    expect(fmtEurNeg(1234.56, 2)).toBe(fmtEur2(1234.56));
  });

  it('negative: starts with U+2212, contains locale-formatted amount, no +', () => {
    const result = fmtEurNeg(-1234.56, 2);
    expect(result.startsWith('\u2212')).toBe(true);
    expect(result).toContain('1.234,56');
    expect(result).not.toContain('+');
  });

  it('zero: matches fmtEur2(0)', () => {
    expect(fmtEurNeg(0, 2)).toBe(fmtEur2(0));
  });
});

describe('fmtPctNeg', () => {
  it('positive: no sign', () => {
    expect(fmtPctNeg(17.6)).toBe('17,6%');
  });

  it('negative: U+2212 prefix', () => {
    expect(fmtPctNeg(-35.3)).toBe('\u221235,3%');
  });

  it('zero: no sign', () => {
    expect(fmtPctNeg(0)).toBe('0,0%');
  });
});

describe('fmtEurSigned', () => {
  it('positive: starts with +', () => {
    const result = fmtEurSigned(1234.56, 2);
    expect(result.startsWith('+')).toBe(true);
    expect(result).toContain('1.234,56');
  });

  it('negative: starts with U+2212, no double-negative', () => {
    const result = fmtEurSigned(-1234.56, 2);
    expect(result.startsWith('\u2212')).toBe(true);
    // No second minus or U+2212 anywhere after the first character
    const afterSign = result.slice(1);
    expect(afterSign).not.toContain('-');
    expect(afterSign).not.toContain('\u2212');
  });

  it('zero: no sign, matches fmtEur2(0)', () => {
    expect(fmtEurSigned(0, 2)).toBe(fmtEur2(0));
  });
});

describe('fmtPctSigned', () => {
  it('positive: + prefix', () => {
    expect(fmtPctSigned(17.6)).toBe('+17,6%');
  });

  it('negative: U+2212 prefix', () => {
    expect(fmtPctSigned(-35.3)).toBe('\u221235,3%');
  });

  it('zero: no sign', () => {
    expect(fmtPctSigned(0)).toBe('0,0%');
  });
});
