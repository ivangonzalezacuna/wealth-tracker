import { describe, it, expect } from 'vitest';
import { splitHoldings } from './holdings.js';

describe('splitHoldings', () => {
  it('fully-sold ISIN lands in exited', () => {
    const list = [
      { ticker: 'SOLD', shares: 0, exited: true, active: true },
    ];
    const { held, exited } = splitHoldings(list);
    expect(exited).toHaveLength(1);
    expect(exited[0].ticker).toBe('SOLD');
    expect(held).toHaveLength(0);
  });

  it('active:false ISIN with remaining shares stays in held', () => {
    const list = [
      { ticker: 'CLOSED', shares: 5, exited: false, active: false },
    ];
    const { held, exited } = splitHoldings(list);
    expect(held).toHaveLength(1);
    expect(held[0].ticker).toBe('CLOSED');
    expect(exited).toHaveLength(0);
  });

  it('normal active position stays in held', () => {
    const list = [
      { ticker: 'IWDA', shares: 100, exited: false, active: true },
    ];
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
    expect(held.map(h => h.ticker)).toEqual(['IWDA', 'AGGH']);
    expect(exited).toHaveLength(2);
    expect(exited.map(h => h.ticker)).toEqual(['IEEM', 'IEAC']);
  });

  it('treats shares below 1e-6 as zero (exited)', () => {
    const list = [
      { ticker: 'TINY', shares: 1e-7, active: true },
    ];
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
