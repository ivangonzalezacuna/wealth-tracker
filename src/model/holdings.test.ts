// @ts-nocheck - test fixtures use partial objects; strict typing deferred
import { describe, it, expect } from 'vitest';
import { splitHoldings, validateHoldings } from './holdings';

describe('splitHoldings', () => {
  it('fully-sold ISIN lands in exited', () => {
    const list = [{ ticker: 'SOLD', shares: 0, exited: true, active: true }];
    const { held, exited } = splitHoldings(list);
    expect(exited).toHaveLength(1);
    expect(exited[0].ticker).toBe('SOLD');
    expect(held).toHaveLength(0);
  });

  it('active:false ISIN with remaining shares stays in held', () => {
    const list = [{ ticker: 'CLOSED', shares: 5, exited: false, active: false }];
    const { held, exited } = splitHoldings(list);
    expect(held).toHaveLength(1);
    expect(held[0].ticker).toBe('CLOSED');
    expect(exited).toHaveLength(0);
  });

  it('normal active position stays in held', () => {
    const list = [{ ticker: 'IWDA', shares: 100, exited: false, active: true }];
    const { held, exited } = splitHoldings(list);
    expect(held).toHaveLength(1);
    expect(held[0].ticker).toBe('IWDA');
    expect(exited).toHaveLength(0);
  });

  it('partitions correctly with mixed positions', () => {
    const list = [
      { ticker: 'IWDA', shares: 100, exited: false, active: true },
      { ticker: 'IEEM', shares: 0, exited: true, active: false },
      { ticker: 'AGGH', shares: 50, exited: false, active: false },
      { ticker: 'IEAC', shares: 0.0000001, exited: false, active: false }, // below threshold
    ];
    const { held, exited } = splitHoldings(list);
    expect(held).toHaveLength(2);
    expect(held.map((h) => h.ticker)).toEqual(['IWDA', 'AGGH']);
    expect(exited).toHaveLength(2);
    expect(exited.map((h) => h.ticker)).toEqual(['IEEM', 'IEAC']);
  });

  it('treats shares below 1e-6 as zero (exited)', () => {
    const list = [{ ticker: 'TINY', shares: 1e-7, active: true }];
    const { held, exited } = splitHoldings(list);
    expect(exited).toHaveLength(1);
    expect(held).toHaveLength(0);
  });

  it('returns empty arrays for empty input', () => {
    const { held, exited } = splitHoldings([]);
    expect(held).toHaveLength(0);
    expect(exited).toHaveLength(0);
  });
});

describe('validateHoldings', () => {
  const validHolding = (overrides = {}) => ({
    isin: 'IE00B4L5Y983',
    ticker: 'IWDA',
    name: '',
    color: '#888',
    acc: true,
    active: true,
    contribAmount: 0,
    interval: 'weekly',
    assetClass: 'equity',
    region: 'developed',
    foldInto: '',
    order: 1,
    ...overrides,
  });

  it('returns empty array for valid holdings', () => {
    const holdings = [
      validHolding(),
      validHolding({ isin: 'IE00BKM4GZ66', ticker: 'EIMI', order: 2 }),
    ];
    expect(validateHoldings(holdings)).toHaveLength(0);
  });

  it('rejects invalid ISIN format (too short)', () => {
    const holdings = [validHolding({ isin: 'IE00B4L5Y98' })];
    const errors = validateHoldings(holdings);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('isin');
    expect(errors[0].index).toBe(0);
  });

  it('rejects ISIN with lowercase letters', () => {
    const holdings = [validHolding({ isin: 'ie00B4L5Y983' })];
    const errors = validateHoldings(holdings);
    expect(errors.some((e) => e.field === 'isin')).toBe(true);
  });

  it('rejects ISIN that does not end with a digit', () => {
    const holdings = [validHolding({ isin: 'IE00B4L5Y98A' })];
    const errors = validateHoldings(holdings);
    expect(errors.some((e) => e.field === 'isin')).toBe(true);
  });

  it('rejects fund name in ticker field', () => {
    const holdings = [validHolding({ ticker: 'MSCI EM USD Acc' })];
    const errors = validateHoldings(holdings);
    expect(errors.some((e) => e.field === 'ticker')).toBe(true);
  });

  it('rejects empty ticker', () => {
    const holdings = [validHolding({ ticker: '' })];
    const errors = validateHoldings(holdings);
    expect(errors.some((e) => e.field === 'ticker')).toBe(true);
  });

  it('accepts ticker with dots and hyphens', () => {
    const holdings = [validHolding({ ticker: 'BRK.B' })];
    expect(validateHoldings(holdings)).toHaveLength(0);
  });

  it('accepts ticker with spaces (short)', () => {
    const holdings = [validHolding({ ticker: 'EM IMI' })];
    expect(validateHoldings(holdings)).toHaveLength(0);
  });

  it('rejects ticker longer than 10 characters', () => {
    const holdings = [validHolding({ ticker: 'VERYLONGTIK' })];
    const errors = validateHoldings(holdings);
    expect(errors.some((e) => e.field === 'ticker')).toBe(true);
  });

  it('detects duplicate ISINs', () => {
    const holdings = [
      validHolding({ isin: 'IE00B4L5Y983', order: 1 }),
      validHolding({ isin: 'IE00B4L5Y983', order: 2 }),
    ];
    const errors = validateHoldings(holdings);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('isin');
    expect(errors[0].index).toBe(1);
    expect(errors[0].message).toContain('duplicate');
  });

  it('returns multiple errors for multiple issues', () => {
    const holdings = [
      validHolding({ isin: 'BAD', ticker: 'This is way too long for a ticker name' }),
    ];
    const errors = validateHoldings(holdings);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });

  it('returns empty array for empty input', () => {
    expect(validateHoldings([])).toHaveLength(0);
  });
});
