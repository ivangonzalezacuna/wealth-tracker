import { describe, it, expect } from 'vitest';
import { splitHoldings, validateHoldings, computeFeeDrag } from './holdings';
import type { Holding } from '../types';

describe('splitHoldings', () => {
  it('fully-sold ISIN lands in exited', () => {
    const list = [{ shortName: 'SOLD', shares: 0, exited: true, active: true }];
    const { held, exited } = splitHoldings(list);
    expect(exited).toHaveLength(1);
    expect(exited[0].shortName).toBe('SOLD');
    expect(held).toHaveLength(0);
  });

  it('active:false ISIN with remaining shares stays in held', () => {
    const list = [{ shortName: 'CLOSED', shares: 5, exited: false, active: false }];
    const { held, exited } = splitHoldings(list);
    expect(held).toHaveLength(1);
    expect(held[0].shortName).toBe('CLOSED');
    expect(exited).toHaveLength(0);
  });

  it('normal active position stays in held', () => {
    const list = [{ shortName: 'IWDA', shares: 100, exited: false, active: true }];
    const { held, exited } = splitHoldings(list);
    expect(held).toHaveLength(1);
    expect(held[0].shortName).toBe('IWDA');
    expect(exited).toHaveLength(0);
  });

  it('partitions correctly with mixed positions', () => {
    const list = [
      { shortName: 'IWDA', shares: 100, exited: false, active: true },
      { shortName: 'IEEM', shares: 0, exited: true, active: false },
      { shortName: 'AGGH', shares: 50, exited: false, active: false },
      { shortName: 'IEAC', shares: 0.0000001, exited: false, active: false }, // below threshold
    ];
    const { held, exited } = splitHoldings(list);
    expect(held).toHaveLength(2);
    expect(held.map((h) => h.shortName)).toEqual(['IWDA', 'AGGH']);
    expect(exited).toHaveLength(2);
    expect(exited.map((h) => h.shortName)).toEqual(['IEEM', 'IEAC']);
  });

  it('treats shares below 1e-6 as zero (exited)', () => {
    const list = [{ shortName: 'TINY', shares: 1e-7, active: true }];
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
  const validHolding = (overrides: Partial<Holding> = {}): Holding => ({
    isin: 'IE00B4L5Y983',
    shortName: 'IWDA',
    name: '',
    color: '#888',
    acc: true,
    active: true,
    contribAmount: 0,
    contribInterval: 'weekly',
    assetClass: 'equity',
    region: 'developed',
    foldInto: '',
    order: 1,
    ...overrides,
  });

  it('returns empty array for valid holdings', () => {
    const holdings = [
      validHolding(),
      validHolding({ isin: 'IE00BKM4GZ66', shortName: 'EIMI', order: 2 }),
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

  it('rejects fund name in shortName field', () => {
    const holdings = [validHolding({ shortName: 'MSCI EM USD Acc' })];
    const errors = validateHoldings(holdings);
    expect(errors.some((e) => e.field === 'shortName')).toBe(true);
  });

  it('rejects empty shortName', () => {
    const holdings = [validHolding({ shortName: '' })];
    const errors = validateHoldings(holdings);
    expect(errors.some((e) => e.field === 'shortName')).toBe(true);
  });

  it('accepts shortName with dots and hyphens', () => {
    const holdings = [validHolding({ shortName: 'BRK.B' })];
    expect(validateHoldings(holdings)).toHaveLength(0);
  });

  it('accepts shortName with spaces (short)', () => {
    const holdings = [validHolding({ shortName: 'EM IMI' })];
    expect(validateHoldings(holdings)).toHaveLength(0);
  });

  it('rejects shortName longer than 10 characters', () => {
    const holdings = [validHolding({ shortName: 'VERYLONGTIK' })];
    const errors = validateHoldings(holdings);
    expect(errors.some((e) => e.field === 'shortName')).toBe(true);
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
      validHolding({ isin: 'BAD', shortName: 'This is way too long for a ticker name' }),
    ];
    const errors = validateHoldings(holdings);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });

  it('returns empty array for empty input', () => {
    expect(validateHoldings([])).toHaveLength(0);
  });
});

describe('computeFeeDrag', () => {
  const makeEtf = (
    isin: string,
    cost: number,
    marketValue?: number,
  ): import('../types').EtfPosition => ({
    isin,
    shortName: isin,
    name: '',
    color: '',
    acc: true,
    active: true,
    shares: 10,
    cost,
    divNet: 0,
    taxPaid: 0,
    buys: 1,
    realizedPnL: 0,
    totalFees: 0,
    exited: false,
    marketValue: marketValue ?? null,
  });

  const makeHolding = (isin: string, ter: number): import('../types').Holding => ({
    isin,
    name: '',
    shortName: isin,
    color: '',
    acc: true,
    active: true,
    contribAmount: 0,
    contribInterval: 'weekly',
    assetClass: 'equity',
    region: 'developed',
    foldInto: '',
    order: 1,
    ter,
  });

  it('returns null when no holdings have a TER configured', () => {
    const etfs = [makeEtf('IE00B4L5Y983', 1000)];
    const holdings = [makeHolding('IE00B4L5Y983', 0)];
    expect(computeFeeDrag(etfs, holdings, {})).toBeNull();
  });

  it('computes annual cost using cost basis when no market value is available', () => {
    const etfs = [makeEtf('IE00B4L5Y983', 10000)];
    const holdings = [makeHolding('IE00B4L5Y983', 0.2)];
    const result = computeFeeDrag(etfs, holdings, {});
    expect(result).not.toBeNull();
    expect(result!.annualCost).toBeCloseTo(20); // 10000 * 0.2 / 100
    expect(result!.costPct).toBeCloseTo(0.002);
    expect(result!.coveredCount).toBe(1);
  });

  it('prefers snapshot market value over cost basis', () => {
    const etfs = [makeEtf('IE00B4L5Y983', 10000)];
    const holdings = [makeHolding('IE00B4L5Y983', 0.2)];
    const snapEtfValues = { IE00B4L5Y983: 15000 };
    const result = computeFeeDrag(etfs, holdings, snapEtfValues);
    expect(result!.annualCost).toBeCloseTo(30); // 15000 * 0.2 / 100
  });

  it('sums across multiple positions', () => {
    const etfs = [makeEtf('ISIN1', 5000), makeEtf('ISIN2', 3000)];
    const holdings = [makeHolding('ISIN1', 0.2), makeHolding('ISIN2', 0.5)];
    const result = computeFeeDrag(etfs, holdings, {});
    expect(result!.annualCost).toBeCloseTo(25); // 5000*0.2/100 + 3000*0.5/100 = 10 + 15
    expect(result!.coveredCount).toBe(2);
  });

  it('skips positions without a TER configured', () => {
    const etfs = [makeEtf('ISIN1', 5000), makeEtf('ISIN2', 3000)];
    const holdings = [makeHolding('ISIN1', 0.2), makeHolding('ISIN2', 0)];
    const result = computeFeeDrag(etfs, holdings, {});
    expect(result!.coveredCount).toBe(1);
    expect(result!.annualCost).toBeCloseTo(10);
  });
});
