import { describe, it, expect, vi } from 'vitest';
import { computeDrift, maxDrift, computeRebalancePlan } from './drift';
import type { Holding, EtfPosition } from '../types';

function makeHolding(overrides: Partial<Holding> = {}): Holding {
  return {
    isin: 'IE00B4L5Y983',
    shortName: 'IWDA',
    name: '',
    color: '#2a78d6',
    acc: true,
    active: true,
    targetPct: 100,
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

  it('returns empty when no active holdings with targetPct', () => {
    const holdings = [makeHolding({ active: false })];
    const positions = {};
    expect(computeDrift(holdings, positions, 10000)).toEqual([]);
  });

  it('returns empty when active holdings have no targetPct', () => {
    const holdings = [makeHolding({ targetPct: 0 })];
    const positions = {};
    expect(computeDrift(holdings, positions, 10000)).toEqual([]);
  });

  it('computes drift for a single holding', () => {
    const holdings = [makeHolding({ targetPct: 100 })];
    const positions = { IE00B4L5Y983: makePosition({ cost: 10000 }) };
    const drift = computeDrift(holdings, positions, 10000);
    expect(drift).toHaveLength(1);
    expect(drift[0].targetPct).toBe(100);
    expect(drift[0].actualPct).toBe(100);
    expect(drift[0].driftPct).toBe(0);
  });

  it('computes drift for multiple holdings', () => {
    const holdings = [
      makeHolding({ isin: 'A', shortName: 'ETF_A', targetPct: 50 }),
      makeHolding({ isin: 'B', shortName: 'ETF_B', targetPct: 50 }),
    ];
    // Target is 50/50, actual is 70/30
    const positions = {
      A: makePosition({ isin: 'A', cost: 7000 }),
      B: makePosition({ isin: 'B', cost: 3000 }),
    };
    const drift = computeDrift(holdings, positions, 10000);
    expect(drift).toHaveLength(2);

    const etfA = drift.find((d) => d.shortName === 'ETF_A')!;
    const etfB = drift.find((d) => d.shortName === 'ETF_B')!;

    expect(etfA.targetPct).toBe(50);
    expect(etfA.actualPct).toBe(70);
    expect(etfA.driftPct).toBe(20);

    expect(etfB.targetPct).toBe(50);
    expect(etfB.actualPct).toBe(30);
    expect(etfB.driftPct).toBe(-20);
  });

  it('normalizes targetPct so percentages sum to 100', () => {
    // Holdings with targetPct 80+20=100 should stay as-is.
    const holdings = [
      makeHolding({ isin: 'A', shortName: 'ETF_A', targetPct: 80 }),
      makeHolding({ isin: 'B', shortName: 'ETF_B', targetPct: 20 }),
    ];
    const positions = {
      A: makePosition({ isin: 'A', cost: 5000 }),
      B: makePosition({ isin: 'B', cost: 5000 }),
    };
    const drift = computeDrift(holdings, positions, 10000);
    const etfA = drift.find((d) => d.shortName === 'ETF_A')!;
    const etfB = drift.find((d) => d.shortName === 'ETF_B')!;

    expect(etfA.targetPct).toBe(80);
    expect(etfB.targetPct).toBe(20);
    expect(etfA.driftPct).toBe(-30); // actual 50% vs target 80%
    expect(etfB.driftPct).toBe(30); // actual 50% vs target 20%
  });

  it('normalises unequal targetPct values', () => {
    // Supply targetPct 80+40=120; each is normalised to 80/120*100 and 40/120*100.
    const holdings = [
      makeHolding({ isin: 'A', shortName: 'ETF_A', targetPct: 80 }),
      makeHolding({ isin: 'B', shortName: 'ETF_B', targetPct: 40 }),
    ];
    const positions = {
      A: makePosition({ isin: 'A', cost: 10000 }), // 66.7% of 15000
      B: makePosition({ isin: 'B', cost: 5000 }), // 33.3% of 15000
    };
    const drift = computeDrift(holdings, positions, 15000);
    const etfA = drift.find((d) => d.shortName === 'ETF_A')!;
    const etfB = drift.find((d) => d.shortName === 'ETF_B')!;

    // Normalised: A = 66.7%, B = 33.3% → actual matches → drift ≈ 0
    expect(Math.abs(etfA.driftPct)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(etfB.driftPct)).toBeLessThanOrEqual(0.1);
  });

  it('uses snapshot market values when available', () => {
    const holdings = [makeHolding({ targetPct: 100 })];
    const positions = { IE00B4L5Y983: makePosition({ cost: 5000 }) };
    const snapEtf = { IE00B4L5Y983: 12000 };
    const drift = computeDrift(holdings, positions, 12000, snapEtf);
    expect(drift[0].actualValue).toBe(12000);
    expect(drift[0].valuationMode).toBe('market');
  });

  it('falls back to cost basis when no snapshot values', () => {
    const holdings = [makeHolding({ targetPct: 100 })];
    const positions = { IE00B4L5Y983: makePosition({ cost: 5000 }) };
    const drift = computeDrift(holdings, positions, 5000);
    expect(drift[0].actualValue).toBe(5000);
    expect(drift[0].valuationMode).toBe('cost');
  });

  it('includes inactive-but-held positions as legacy (targetPct = 0)', () => {
    const holdings = [makeHolding({ targetPct: 100 })];
    const positions = {
      IE00B4L5Y983: makePosition({ cost: 8000 }),
      IE000LEGACY0: makePosition({ isin: 'IE000LEGACY0', shortName: 'OLD', cost: 2000 }),
    };
    const drift = computeDrift(holdings, positions, 10000);
    const legacy = drift.find((d) => d.isin === 'IE000LEGACY0')!;
    expect(legacy.targetPct).toBe(0);
    expect(legacy.actualPct).toBe(20);
    expect(legacy.driftPct).toBe(20);
  });

  it('does not include exited positions', () => {
    const holdings = [makeHolding({ targetPct: 100 })];
    const positions = {
      IE00B4L5Y983: makePosition({ cost: 8000 }),
      IE000EXITED0: makePosition({ isin: 'IE000EXITED0', cost: 2000, exited: true }),
    };
    const drift = computeDrift(holdings, positions, 10000);
    expect(drift.every((d) => d.isin !== 'IE000EXITED0')).toBe(true);
  });

  it('sorts non-legacy by targetPct desc then name asc; legacy after', () => {
    const holdings = [
      makeHolding({ isin: 'A', shortName: 'ZZZ', targetPct: 20 }),
      makeHolding({ isin: 'B', shortName: 'AAA', targetPct: 60 }),
      makeHolding({ isin: 'C', shortName: 'MMM', targetPct: 20 }),
    ];
    const positions = {
      A: makePosition({ isin: 'A', cost: 0 }),
      B: makePosition({ isin: 'B', cost: 0 }),
      C: makePosition({ isin: 'C', cost: 0 }),
    };
    const drift = computeDrift(holdings, positions, 1);
    expect(drift[0].isin).toBe('B'); // highest targetPct
    // shortName ZZZ sorts after MMM; so order is B, C(MMM), A(ZZZ)
    expect(drift[1].isin).toBe('C');
    expect(drift[2].isin).toBe('A');
  });
});

describe('maxDrift', () => {
  it('returns 0 for empty array', () => {
    expect(maxDrift([])).toBe(0);
  });

  it('returns the max absolute drift', () => {
    const drift = [{ driftPct: -15 }, { driftPct: 10 }, { driftPct: 3 }] as ReturnType<
      typeof computeDrift
    >;
    expect(maxDrift(drift)).toBe(15);
  });
});

// ── computeRebalancePlan ─────────────────────────────────────────────────────

describe('computeRebalancePlan', () => {
  it('returns empty for months <= 0', () => {
    const drift = [
      {
        isin: 'A',
        name: 'A',
        shortName: 'A',
        color: '#000',
        targetPct: 100,
        actualPct: 80,
        driftPct: -20,
        actualValue: 8000,
        targetValue: 10000,
        deltaValue: -2000,
        valuationMode: 'market' as const,
      },
    ];
    expect(computeRebalancePlan(drift, 500, 10000, 0, 'monthly')).toEqual([]);
  });

  it('returns empty for zero totalValue', () => {
    const drift = [
      {
        isin: 'A',
        name: 'A',
        shortName: 'A',
        color: '#000',
        targetPct: 100,
        actualPct: 80,
        driftPct: -20,
        actualValue: 8000,
        targetValue: 10000,
        deltaValue: -2000,
        valuationMode: 'market' as const,
      },
    ];
    expect(computeRebalancePlan(drift, 500, 0, 3, 'monthly')).toEqual([]);
  });

  it('returns empty for zero monthly budget', () => {
    const drift = [
      {
        isin: 'A',
        name: 'A',
        shortName: 'A',
        color: '#000',
        targetPct: 100,
        actualPct: 80,
        driftPct: -20,
        actualValue: 8000,
        targetValue: 10000,
        deltaValue: -2000,
        valuationMode: 'market' as const,
      },
    ];
    expect(computeRebalancePlan(drift, 0, 10000, 3, 'monthly')).toEqual([]);
  });

  it('returns empty when no entries have targetPct > 0', () => {
    const drift = [
      {
        isin: 'A',
        name: 'A',
        shortName: 'A',
        color: '#000',
        targetPct: 0,
        actualPct: 50,
        driftPct: 50,
        actualValue: 5000,
        targetValue: 0,
        deltaValue: 5000,
        valuationMode: 'market' as const,
      },
    ];
    expect(computeRebalancePlan(drift, 500, 10000, 3, 'monthly')).toEqual([]);
  });

  it('labels underweight holding correctly', () => {
    const drift = [
      {
        isin: 'A',
        name: 'A',
        shortName: 'A',
        color: '#f00',
        targetPct: 70,
        actualPct: 50,
        driftPct: -20,
        actualValue: 5000,
        targetValue: 7000,
        deltaValue: -2000,
        valuationMode: 'market' as const,
      },
      {
        isin: 'B',
        name: 'B',
        shortName: 'B',
        color: '#0f0',
        targetPct: 30,
        actualPct: 50,
        driftPct: 20,
        actualValue: 5000,
        targetValue: 3000,
        deltaValue: 2000,
        valuationMode: 'market' as const,
      },
    ];
    const plan = computeRebalancePlan(drift, 500, 10000, 3, 'monthly');
    const a = plan.find((e) => e.isin === 'A')!;
    const b = plan.find((e) => e.isin === 'B')!;
    expect(a.state).toBe('underweight');
    expect(b.state).toBe('overweight');
  });

  it('underweight holding receives all budget; overweight receives nothing', () => {
    const drift = [
      {
        isin: 'A',
        name: 'A',
        shortName: 'A',
        color: '#f00',
        targetPct: 70,
        actualPct: 50,
        driftPct: -20,
        actualValue: 5000,
        targetValue: 7000,
        deltaValue: -2000,
        valuationMode: 'market' as const,
      },
      {
        isin: 'B',
        name: 'B',
        shortName: 'B',
        color: '#0f0',
        targetPct: 30,
        actualPct: 50,
        driftPct: 20,
        actualValue: 5000,
        targetValue: 3000,
        deltaValue: 2000,
        valuationMode: 'market' as const,
      },
    ];
    const plan = computeRebalancePlan(drift, 600, 10000, 3, 'monthly');
    const a = plan.find((e) => e.isin === 'A')!;
    const b = plan.find((e) => e.isin === 'B')!;
    // A (underweight) gets all budget: 600/mo → 600€/mo
    expect(a.suggestedAmt).toBeGreaterThan(0);
    // B (overweight) gets 0
    expect(b.suggestedAmt).toBe(0);
  });

  it('converts budget to correct cadence for weekly', () => {
    const drift = [
      {
        isin: 'A',
        name: 'A',
        shortName: 'A',
        color: '#f00',
        targetPct: 100,
        actualPct: 80,
        driftPct: -20,
        actualValue: 8000,
        targetValue: 10000,
        deltaValue: -2000,
        valuationMode: 'market' as const,
      },
    ];
    // 520€/mo = 520*12/52 = 120€/week
    const plan = computeRebalancePlan(drift, 520, 10000, 3, 'weekly');
    expect(plan[0].suggestedAmt).toBeCloseTo(120, 1);
  });

  it('falls back to monthly cadence when calibration interval is invalid', () => {
    const drift = [
      {
        isin: 'A',
        name: 'A',
        shortName: 'A',
        color: '#f00',
        targetPct: 100,
        actualPct: 80,
        driftPct: -20,
        actualValue: 8000,
        targetValue: 10000,
        deltaValue: -2000,
        valuationMode: 'market' as const,
      },
    ];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const plan = computeRebalancePlan(drift, 520, 10000, 3, 'invalid' as any);
    expect(plan[0].suggestedAmt).toBeCloseTo(520, 1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('all budget is allocated (suggestedAmts × cadence ≈ totalMonthlyBudget)', () => {
    const drift = [
      {
        isin: 'A',
        name: 'A',
        shortName: 'A',
        color: '#f00',
        targetPct: 60,
        actualPct: 50,
        driftPct: -10,
        actualValue: 5000,
        targetValue: 6000,
        deltaValue: -1000,
        valuationMode: 'market' as const,
      },
      {
        isin: 'B',
        name: 'B',
        shortName: 'B',
        color: '#0f0',
        targetPct: 40,
        actualPct: 50,
        driftPct: 10,
        actualValue: 5000,
        targetValue: 4000,
        deltaValue: 1000,
        valuationMode: 'market' as const,
      },
    ];
    const totalMonthlyBudget = 500;
    const plan = computeRebalancePlan(drift, totalMonthlyBudget, 10000, 3, 'monthly');
    const totalAllocated = plan.reduce((s, e) => s + e.suggestedAmt, 0);
    expect(totalAllocated).toBeCloseTo(totalMonthlyBudget, 0);
  });

  it('overweight holding receives surplus when budget exceeds underweight gaps', () => {
    // With a large budget the underweight gap is fully covered and the surplus is
    // redistributed proportionally, so the overweight holding does get contributions.
    const drift = [
      {
        isin: 'A',
        name: 'A',
        shortName: 'A',
        color: '#f00',
        targetPct: 70,
        actualPct: 65,
        driftPct: -5,
        actualValue: 6500,
        targetValue: 7000,
        deltaValue: -500,
        valuationMode: 'market' as const,
      },
      {
        isin: 'B',
        name: 'B',
        shortName: 'B',
        color: '#0f0',
        targetPct: 30,
        actualPct: 35,
        driftPct: 5,
        actualValue: 3500,
        targetValue: 3000,
        deltaValue: 500,
        valuationMode: 'market' as const,
      },
    ];
    // totalBudget = 12 * 2000 = 24000, totalValue = 10000
    // projectedTotal = 34000, needToBuy[A] = 34000*0.7 - 6500 = 17300, needToBuy[B] = 0
    // totalNeed = 17300 < 24000 → excess = 6700
    // B receives excess * 0.3 = 2010 over 12 months → monthly > 0
    const plan = computeRebalancePlan(drift, 2000, 10000, 12, 'monthly');
    const b = plan.find((e) => e.isin === 'B')!;
    expect(b.state).toBe('overweight');
    expect(b.suggestedAmt).toBeGreaterThan(0);
  });

  it('projected drift approaches zero when budget is sufficient to cover all gaps', () => {
    const drift = [
      {
        isin: 'A',
        name: 'A',
        shortName: 'A',
        color: '#f00',
        targetPct: 70,
        actualPct: 65,
        driftPct: -5,
        actualValue: 6500,
        targetValue: 7000,
        deltaValue: -500,
        valuationMode: 'market' as const,
      },
      {
        isin: 'B',
        name: 'B',
        shortName: 'B',
        color: '#0f0',
        targetPct: 30,
        actualPct: 35,
        driftPct: 5,
        actualValue: 3500,
        targetValue: 3000,
        deltaValue: 500,
        valuationMode: 'market' as const,
      },
    ];
    const plan = computeRebalancePlan(drift, 2000, 10000, 12, 'monthly');
    for (const e of plan) {
      expect(Math.abs(e.projectedDriftPct)).toBeLessThan(2);
    }
  });
});
