import { describe, it, expect } from 'vitest';
import { computeDrift, maxDrift } from './drift';
import type { Holding, EtfPosition } from '../types';

function makeHolding(overrides: Partial<Holding> = {}): Holding {
  return {
    isin: 'IE00B4L5Y983',
    ticker: 'IWDA',
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

function makePosition(overrides: Partial<EtfPosition> = {}): EtfPosition {
  return {
    symbol: 'IE00B4L5Y983',
    ticker: 'IWDA',
    name: '',
    color: '#2a78d6',
    acc: true,
    active: true,
    shares: 10,
    cost: 5000,
    divNet: 0,
    taxPaid: 0,
    buys: 10,
    realizedPnL: 0,
    totalFees: 0,
    exited: false,
    ...overrides,
  };
}

describe('computeDrift', () => {
  it('returns empty for zero totalValue', () => {
    const holdings = [makeHolding()];
    const positions = { IE00B4L5Y983: makePosition() };
    expect(computeDrift(holdings, positions, 0)).toEqual([]);
  });

  it('returns empty when no active holdings with contributions', () => {
    const holdings = [makeHolding({ active: false })];
    const positions = {};
    expect(computeDrift(holdings, positions, 10000)).toEqual([]);
  });

  it('computes drift for a single holding', () => {
    const holdings = [makeHolding({ contribAmount: 50, contribInterval: 'weekly' })];
    const positions = { IE00B4L5Y983: makePosition({ cost: 10000 }) };
    const drift = computeDrift(holdings, positions, 10000);
    expect(drift).toHaveLength(1);
    expect(drift[0].targetPct).toBe(100);
    expect(drift[0].actualPct).toBe(100);
    expect(drift[0].driftPct).toBe(0);
  });

  it('computes drift for multiple holdings', () => {
    const holdings = [
      makeHolding({ isin: 'A', ticker: 'ETF_A', contribAmount: 50, contribInterval: 'weekly' }), // 50*52 = 2600
      makeHolding({ isin: 'B', ticker: 'ETF_B', contribAmount: 50, contribInterval: 'weekly' }), // 50*52 = 2600
    ];
    // Target is 50/50, actual is 70/30
    const positions = {
      A: makePosition({ symbol: 'A', cost: 7000 }),
      B: makePosition({ symbol: 'B', cost: 3000 }),
    };
    const drift = computeDrift(holdings, positions, 10000);
    expect(drift).toHaveLength(2);

    // Sorted by |drift| desc
    const etfA = drift.find((d) => d.ticker === 'ETF_A')!;
    const etfB = drift.find((d) => d.ticker === 'ETF_B')!;

    expect(etfA.targetPct).toBe(50);
    expect(etfA.actualPct).toBe(70);
    expect(etfA.driftPct).toBe(20);

    expect(etfB.targetPct).toBe(50);
    expect(etfB.actualPct).toBe(30);
    expect(etfB.driftPct).toBe(-20);
  });

  it('handles missing positions (actual = 0)', () => {
    const holdings = [
      makeHolding({ isin: 'A', ticker: 'ETF_A', contribAmount: 100, contribInterval: 'monthly' }),
    ];
    const positions = {}; // no position data
    const drift = computeDrift(holdings, positions, 10000);
    expect(drift).toHaveLength(1);
    expect(drift[0].actualPct).toBe(0);
    expect(drift[0].actualValue).toBe(0);
    expect(drift[0].driftPct).toBe(-100);
  });
});

describe('maxDrift', () => {
  it('returns 0 for empty array', () => {
    expect(maxDrift([])).toBe(0);
  });

  it('returns max absolute drift', () => {
    const entries = [
      {
        ticker: 'A',
        color: '#000',
        targetPct: 50,
        actualPct: 70,
        driftPct: 20,
        actualValue: 7000,
        targetValue: 5000,
        deltaValue: 2000,
      },
      {
        ticker: 'B',
        color: '#000',
        targetPct: 50,
        actualPct: 30,
        driftPct: -20,
        actualValue: 3000,
        targetValue: 5000,
        deltaValue: -2000,
      },
    ];
    expect(maxDrift(entries)).toBe(20);
  });
});
