import { describe, it, expect } from 'vitest';
import { computeDrift, maxDrift } from './drift';
import type { Holding, EtfPosition } from '../types';

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

function makePosition(overrides: Partial<EtfPosition> = {}): EtfPosition {
  return {
    isin: 'IE00B4L5Y983',
    shortName: 'IWDA',
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
      makeHolding({ isin: 'A', shortName: 'ETF_A', contribAmount: 50, contribInterval: 'weekly' }), // 50*52 = 2600
      makeHolding({ isin: 'B', shortName: 'ETF_B', contribAmount: 50, contribInterval: 'weekly' }), // 50*52 = 2600
    ];
    // Target is 50/50, actual is 70/30
    const positions = {
      A: makePosition({ isin: 'A', cost: 7000 }),
      B: makePosition({ isin: 'B', cost: 3000 }),
    };
    const drift = computeDrift(holdings, positions, 10000);
    expect(drift).toHaveLength(2);

    // Sorted by |drift| desc
    const etfA = drift.find((d) => d.shortName === 'ETF_A')!;
    const etfB = drift.find((d) => d.shortName === 'ETF_B')!;

    expect(etfA.targetPct).toBe(50);
    expect(etfA.actualPct).toBe(70);
    expect(etfA.driftPct).toBe(20);

    expect(etfB.targetPct).toBe(50);
    expect(etfB.actualPct).toBe(30);
    expect(etfB.driftPct).toBe(-20);
  });

  it('uses snapEtfValues when provided instead of cost basis', () => {
    const holdings = [makeHolding({ contribAmount: 50, contribInterval: 'weekly' })];
    const positions = { IE00B4L5Y983: makePosition({ cost: 8000 }) };
    // Market value is 12000, cost basis is 8000; totalValue is the snapshot account total
    const drift = computeDrift(holdings, positions, 12000, { IE00B4L5Y983: 12000 });
    expect(drift).toHaveLength(1);
    expect(drift[0].actualValue).toBe(12000);
    expect(drift[0].actualPct).toBe(100);
    expect(drift[0].driftPct).toBe(0);
  });

  it('falls back to cost basis for ISINs not in snapEtfValues', () => {
    const holdings = [makeHolding({ contribAmount: 50, contribInterval: 'weekly' })];
    const positions = { IE00B4L5Y983: makePosition({ cost: 5000 }) };
    // snapEtfValues exists but does not include this ISIN
    const drift = computeDrift(holdings, positions, 10000, { OTHER_ISIN: 5000 });
    expect(drift).toHaveLength(1);
    expect(drift[0].actualValue).toBe(5000); // fell back to cost
  });

  it('includes inactive-but-held positions with target 0%', () => {
    const holdings = [
      makeHolding({
        isin: 'ACTIVE',
        shortName: 'ACT',
        contribAmount: 100,
        contribInterval: 'monthly',
      }),
    ];
    const positions = {
      ACTIVE: makePosition({ isin: 'ACTIVE', shortName: 'ACT', cost: 7000 }),
      LEGACY: makePosition({ isin: 'LEGACY', shortName: 'LEG', cost: 3000, active: false }),
    };
    const drift = computeDrift(holdings, positions, 10000);
    expect(drift).toHaveLength(2);

    const active = drift.find((d) => d.isin === 'ACTIVE')!;
    const legacy = drift.find((d) => d.isin === 'LEGACY')!;

    expect(active.targetPct).toBe(100);
    expect(active.actualPct).toBe(70);

    expect(legacy.targetPct).toBe(0);
    expect(legacy.actualPct).toBe(30);
    expect(legacy.driftPct).toBe(30);
    expect(legacy.actualValue).toBe(3000);
    expect(legacy.targetValue).toBe(0);
    expect(legacy.deltaValue).toBe(3000);
  });

  it('excludes exited positions from the inactive-held pass', () => {
    const holdings = [
      makeHolding({
        isin: 'ACTIVE',
        shortName: 'ACT',
        contribAmount: 100,
        contribInterval: 'monthly',
      }),
    ];
    const positions = {
      ACTIVE: makePosition({ isin: 'ACTIVE', shortName: 'ACT', cost: 10000 }),
      EXITED: makePosition({ isin: 'EXITED', shortName: 'EX', cost: 0, shares: 0, exited: true }),
    };
    const drift = computeDrift(holdings, positions, 10000);
    expect(drift).toHaveLength(1);
    expect(drift[0].isin).toBe('ACTIVE');
  });

  it('uses snapEtfValues for inactive-held positions when available', () => {
    const holdings = [
      makeHolding({
        isin: 'ACTIVE',
        shortName: 'ACT',
        contribAmount: 100,
        contribInterval: 'monthly',
      }),
    ];
    const positions = {
      ACTIVE: makePosition({ isin: 'ACTIVE', shortName: 'ACT', cost: 8000 }),
      LEGACY: makePosition({ isin: 'LEGACY', shortName: 'LEG', cost: 2000 }),
    };
    // Market values differ from cost: active = 9000, legacy = 3000; total = 12000
    const drift = computeDrift(holdings, positions, 12000, { ACTIVE: 9000, LEGACY: 3000 });

    const legacy = drift.find((d) => d.isin === 'LEGACY')!;
    expect(legacy.actualValue).toBe(3000);
    expect(legacy.actualPct).toBe(25);
  });

  it('does not include inactive positions when they have zero or negative value', () => {
    const holdings = [
      makeHolding({
        isin: 'ACTIVE',
        shortName: 'ACT',
        contribAmount: 100,
        contribInterval: 'monthly',
      }),
    ];
    const positions = {
      ACTIVE: makePosition({ isin: 'ACTIVE', shortName: 'ACT', cost: 10000 }),
      ZERO_COST: makePosition({ isin: 'ZERO', shortName: 'Z', cost: 0, shares: 5 }),
    };
    const drift = computeDrift(holdings, positions, 10000);
    // ZERO_COST has shares but cost = 0, so actualValue = 0 and it is skipped
    expect(drift).toHaveLength(1);
    expect(drift[0].isin).toBe('ACTIVE');
  });
});

describe('maxDrift', () => {
  it('returns 0 for empty array', () => {
    expect(maxDrift([])).toBe(0);
  });

  it('returns max absolute drift', () => {
    const entries = [
      {
        isin: 'IE000A',
        name: 'Fund A',
        shortName: 'A',
        color: '#000',
        targetPct: 50,
        actualPct: 70,
        driftPct: 20,
        actualValue: 7000,
        targetValue: 5000,
        deltaValue: 2000,
      },
      {
        isin: 'IE000B',
        name: 'Fund B',
        shortName: 'B',
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
