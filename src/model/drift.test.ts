import { describe, it, expect } from 'vitest';
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
    expect(drift[0].valuationMode).toBe('market');
  });

  it('falls back to cost basis for ISINs not in snapEtfValues', () => {
    const holdings = [makeHolding({ contribAmount: 50, contribInterval: 'weekly' })];
    const positions = { IE00B4L5Y983: makePosition({ cost: 5000 }) };
    // snapEtfValues exists but does not include this ISIN
    const drift = computeDrift(holdings, positions, 10000, { OTHER_ISIN: 5000 });
    expect(drift).toHaveLength(1);
    expect(drift[0].actualValue).toBe(5000); // fell back to cost
    expect(drift[0].valuationMode).toBe('cost');
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
        valuationMode: 'cost' as const,
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
        valuationMode: 'cost' as const,
      },
    ];
    expect(maxDrift(entries)).toBe(20);
  });
});

// ── computeRebalancePlan ─────────────────────────────────────────────────────

function makeDriftEntry(
  isin: string,
  shortName: string,
  targetPct: number,
  actualPct: number,
  actualValue: number,
): ReturnType<typeof computeDrift>[number] {
  return {
    isin,
    name: shortName,
    shortName,
    color: '#000',
    targetPct,
    actualPct,
    driftPct: Math.round((actualPct - targetPct) * 10) / 10,
    actualValue,
    targetValue: 0,
    deltaValue: 0,
    valuationMode: 'cost' as const,
  };
}

describe('computeRebalancePlan', () => {
  it('returns empty for zero months', () => {
    const drift = [makeDriftEntry('A', 'A', 100, 100, 10000)];
    const holdings = [
      makeHolding({ isin: 'A', shortName: 'A', contribAmount: 100, contribInterval: 'monthly' }),
    ];
    expect(computeRebalancePlan(drift, holdings, 10000, 0)).toEqual([]);
  });

  it('returns empty for zero totalValue', () => {
    const drift = [makeDriftEntry('A', 'A', 100, 100, 0)];
    const holdings = [
      makeHolding({ isin: 'A', shortName: 'A', contribAmount: 100, contribInterval: 'monthly' }),
    ];
    expect(computeRebalancePlan(drift, holdings, 0, 3)).toEqual([]);
  });

  it('returns empty when no active drift entries (only legacy)', () => {
    const drift = [makeDriftEntry('A', 'A', 0, 30, 3000)];
    const holdings = [
      makeHolding({ isin: 'A', shortName: 'A', contribAmount: 0, contribInterval: 'monthly' }),
    ];
    expect(computeRebalancePlan(drift, holdings, 10000, 3)).toEqual([]);
  });

  it('normalisation: suggested monthly contributions sum equals current monthly total', () => {
    // 3 holdings: 50/30/20 target, drifted to 40/35/25 actual
    const totalValue = 10000;
    const drift = [
      makeDriftEntry('A', 'A', 50, 40, 4000),
      makeDriftEntry('B', 'B', 30, 35, 3500),
      makeDriftEntry('C', 'C', 20, 25, 2500),
    ];
    const holdings = [
      makeHolding({ isin: 'A', shortName: 'A', contribAmount: 50, contribInterval: 'monthly' }),
      makeHolding({ isin: 'B', shortName: 'B', contribAmount: 30, contribInterval: 'monthly' }),
      makeHolding({ isin: 'C', shortName: 'C', contribAmount: 20, contribInterval: 'monthly' }),
    ];
    const plan = computeRebalancePlan(drift, holdings, totalValue, 3);
    expect(plan).toHaveLength(3);

    // Suggested monthly amounts must sum to total current monthly (50 + 30 + 20 = 100)
    const totalCurrentMonthly = 50 + 30 + 20;
    const totalSuggestedMonthly = plan.reduce((s, e) => s + e.suggestedContribAmt, 0);
    expect(totalSuggestedMonthly).toBeCloseTo(totalCurrentMonthly, 1);

    // Suggested percentages must sum to 100
    const totalSuggestedPct = plan.reduce((s, e) => s + e.suggestedContribPct, 0);
    expect(totalSuggestedPct).toBeCloseTo(100, 0);
  });

  it('overweight holding receives zero contribution and others pick up the slack', () => {
    // A is at 60% actual vs 50% target (overweight); B is underweight
    const totalValue = 10000;
    const drift = [makeDriftEntry('A', 'A', 50, 60, 6000), makeDriftEntry('B', 'B', 50, 40, 4000)];
    const holdings = [
      makeHolding({ isin: 'A', shortName: 'A', contribAmount: 100, contribInterval: 'monthly' }),
      makeHolding({ isin: 'B', shortName: 'B', contribAmount: 100, contribInterval: 'monthly' }),
    ];
    const plan = computeRebalancePlan(drift, holdings, totalValue, 3);
    const planA = plan.find((e) => e.isin === 'A')!;
    const planB = plan.find((e) => e.isin === 'B')!;

    expect(planA.state).toBe('overweight');
    expect(planA.suggestedContribAmt).toBe(0);
    expect(planB.state).toBe('underweight');
    // B should receive the full monthly total (200)
    expect(planB.suggestedContribAmt).toBeCloseTo(200, 1);
  });

  it('handles mixed weekly and monthly intervals: normalisation is cadence-agnostic', () => {
    // A: weekly €50 (annual 2600, monthly ~216.67)
    // B: monthly €100 (annual 1200, monthly 100)
    // Total monthly ~316.67
    const totalValue = 10000;
    // A underweight, B overweight
    const drift = [
      makeDriftEntry('A', 'A', 69, 40, 4000), // ~68.4% target from annualised weights
      makeDriftEntry('B', 'B', 31, 60, 6000), // ~31.6% target
    ];
    const holdings = [
      makeHolding({ isin: 'A', shortName: 'A', contribAmount: 50, contribInterval: 'weekly' }),
      makeHolding({ isin: 'B', shortName: 'B', contribAmount: 100, contribInterval: 'monthly' }),
    ];
    const plan = computeRebalancePlan(drift, holdings, totalValue, 3);
    expect(plan).toHaveLength(2);

    const planA = plan.find((e) => e.isin === 'A')!;
    const planB = plan.find((e) => e.isin === 'B')!;

    // B is overweight, A is underweight
    expect(planB.state).toBe('overweight');
    expect(planB.suggestedContribAmt).toBe(0);
    expect(planA.state).toBe('underweight');

    // Suggested amounts: convert back to own cadence
    // A: suggestedContribAmt is in /wk
    expect(planA.contribInterval).toBe('weekly');
    expect(planB.contribInterval).toBe('monthly');

    // Total monthly must be preserved
    const totalMonthly = (50 * 52) / 12 + 100; // ~316.67
    const totalSuggestedMonthly = (planA.suggestedContribAmt * 52) / 12 + planB.suggestedContribAmt;
    expect(totalSuggestedMonthly).toBeCloseTo(totalMonthly, 1);
  });

  it('fully converges to target (projectedDriftPct ~0) when all projected gaps are positive', () => {
    // A is 1 pct point above target today; B is 1 pct point below.
    // At K=3 with totalMonthly=100, projectedTotal grows enough that both
    // holdings have positive projected gaps (raw > 0), so the plan achieves
    // full convergence and projectedDriftPct = 0 for all entries.
    const totalValue = 10000;
    const drift = [makeDriftEntry('A', 'A', 70, 71, 7100), makeDriftEntry('B', 'B', 30, 29, 2900)];
    const holdings = [
      makeHolding({ isin: 'A', shortName: 'A', contribAmount: 70, contribInterval: 'monthly' }),
      makeHolding({ isin: 'B', shortName: 'B', contribAmount: 30, contribInterval: 'monthly' }),
    ];
    const plan = computeRebalancePlan(drift, holdings, totalValue, 3);

    const planA = plan.find((e) => e.isin === 'A')!;
    const planB = plan.find((e) => e.isin === 'B')!;
    expect(planA.state).toBe('overweight');
    expect(planB.state).toBe('underweight');
    for (const entry of plan) {
      expect(Math.abs(entry.projectedDriftPct)).toBeCloseTo(0, 1);
    }
  });

  it('partially reduces drift when some holdings are overweight (no-sell constraint)', () => {
    // A: 40% actual vs 50% target (underweight). B: 60% actual vs 50% target (overweight).
    // At K=3 months with no sell, drift can only be partially reduced via dilution.
    const totalValue = 10000;
    const drift = [makeDriftEntry('A', 'A', 50, 40, 4000), makeDriftEntry('B', 'B', 50, 60, 6000)];
    const holdings = [
      makeHolding({ isin: 'A', shortName: 'A', contribAmount: 100, contribInterval: 'monthly' }),
      makeHolding({ isin: 'B', shortName: 'B', contribAmount: 100, contribInterval: 'monthly' }),
    ];
    const plan3 = computeRebalancePlan(drift, holdings, totalValue, 3);
    const plan12 = computeRebalancePlan(drift, holdings, totalValue, 12);

    const projMax3 = Math.max(...plan3.map((e) => Math.abs(e.projectedDriftPct)));
    const projMax12 = Math.max(...plan12.map((e) => Math.abs(e.projectedDriftPct)));

    // Drift must be reduced from initial 10% in both cases
    expect(projMax3).toBeLessThan(10);
    expect(projMax12).toBeLessThan(10);

    // Longer horizon should reduce residual drift further
    expect(projMax12).toBeLessThan(projMax3);
  });

  it('preserves sort order: highest targetPct first', () => {
    const totalValue = 10000;
    const drift = [
      makeDriftEntry('A', 'A', 20, 25, 2500),
      makeDriftEntry('B', 'B', 50, 45, 4500),
      makeDriftEntry('C', 'C', 30, 30, 3000),
    ];
    const holdings = [
      makeHolding({ isin: 'A', shortName: 'A', contribAmount: 20, contribInterval: 'monthly' }),
      makeHolding({ isin: 'B', shortName: 'B', contribAmount: 50, contribInterval: 'monthly' }),
      makeHolding({ isin: 'C', shortName: 'C', contribAmount: 30, contribInterval: 'monthly' }),
    ];
    const plan = computeRebalancePlan(drift, holdings, totalValue, 3);
    expect(plan[0].isin).toBe('B'); // 50% target first
    expect(plan[1].isin).toBe('C'); // 30% next
    expect(plan[2].isin).toBe('A'); // 20% last
  });

  it('classifies plan rows as overweight, on-target, and underweight', () => {
    const totalValue = 10000;
    const drift = [
      makeDriftEntry('A', 'A', 50, 60, 6000), // overweight
      makeDriftEntry('B', 'B', 30, 30.9, 3090), // overweight by drift (+0.9%), on-target at projected horizon
      makeDriftEntry('C', 'C', 20, 9.1, 910), // underweight
    ];
    const holdings = [
      makeHolding({ isin: 'A', shortName: 'A', contribAmount: 100, contribInterval: 'monthly' }),
      makeHolding({ isin: 'B', shortName: 'B', contribAmount: 100, contribInterval: 'monthly' }),
      makeHolding({ isin: 'C', shortName: 'C', contribAmount: 100, contribInterval: 'monthly' }),
    ];
    const plan = computeRebalancePlan(drift, holdings, totalValue, 1);
    expect(plan.find((e) => e.isin === 'A')?.state).toBe('overweight');
    expect(plan.find((e) => e.isin === 'B')?.state).toBe('overweight');
    expect(plan.find((e) => e.isin === 'C')?.state).toBe('underweight');
  });

  it('on-target holdings keep their current contribution and are excluded from redistribution', () => {
    // A: on-target (driftPct=0.3, within +/-0.5 tolerance), locked at 40/mo.
    // B: overweight (driftPct=+2), releases its budget.
    // C: underweight (driftPct=-2), absorbs the freed budget.
    // Total monthly = 40+30+30 = 100. Available pool after locking A = 60.
    const totalValue = 10000;
    const drift = [
      makeDriftEntry('A', 'A', 40, 40.3, 4030), // on-target
      makeDriftEntry('B', 'B', 30, 32, 3200), // overweight
      makeDriftEntry('C', 'C', 30, 27.7, 2770), // underweight
    ];
    const holdings = [
      makeHolding({ isin: 'A', shortName: 'A', contribAmount: 40, contribInterval: 'monthly' }),
      makeHolding({ isin: 'B', shortName: 'B', contribAmount: 30, contribInterval: 'monthly' }),
      makeHolding({ isin: 'C', shortName: 'C', contribAmount: 30, contribInterval: 'monthly' }),
    ];
    const plan = computeRebalancePlan(drift, holdings, totalValue, 3);
    const planA = plan.find((e) => e.isin === 'A')!;
    const planB = plan.find((e) => e.isin === 'B')!;
    const planC = plan.find((e) => e.isin === 'C')!;

    // A is on-target: contribution must be unchanged
    expect(planA.state).toBe('on-target');
    expect(planA.suggestedContribAmt).toBe(40);

    // B is overweight: gets zero
    expect(planB.state).toBe('overweight');
    expect(planB.suggestedContribAmt).toBe(0);

    // C is underweight: absorbs the available pool (60/mo)
    expect(planC.state).toBe('underweight');
    expect(planC.suggestedContribAmt).toBeCloseTo(60, 1);

    // Total must be preserved
    const total = plan.reduce((s, e) => s + e.suggestedContribAmt, 0);
    expect(total).toBeCloseTo(100, 6);
  });

  it('treats tiny contribution deltas as no-op with configurable minimum action', () => {
    // A: 90% target, 88% actual (underweight), contributes most of the budget.
    // B: 10% target, 12% actual (overweight), contributes a small slice.
    // Without minAction, A would be suggested 100 (delta=+5) and B would be 0 (delta=-5).
    // With minAction=6, both deltas (5) are below the threshold and each keeps its current amount.
    const totalValue = 10000;
    const drift = [
      makeDriftEntry('A', 'A', 90, 88, 8800), // underweight
      makeDriftEntry('B', 'B', 10, 12, 1200), // overweight
    ];
    const holdings = [
      makeHolding({ isin: 'A', shortName: 'A', contribAmount: 95, contribInterval: 'monthly' }),
      makeHolding({ isin: 'B', shortName: 'B', contribAmount: 5, contribInterval: 'monthly' }),
    ];
    const plan = computeRebalancePlan(drift, holdings, totalValue, 1, {
      minActionByInterval: { monthly: 6 },
    });
    expect(plan.find((e) => e.isin === 'A')?.suggestedContribAmt).toBe(95);
    expect(plan.find((e) => e.isin === 'B')?.suggestedContribAmt).toBe(5);
  });

  it('preserves total monthly contribution after rounding and normalization', () => {
    // A/B/C are underweight by 1%; D is overweight by 3%.
    // Without rounding each underweight holding would get ~33.33/mo.
    // With a rounding step of 10, they round to 30, leaving a 10-unit shortfall
    // that the normalization pass absorbs into the first underweight anchor.
    const totalValue = 10000;
    const drift = [
      makeDriftEntry('A', 'A', 25, 24, 2400), // underweight
      makeDriftEntry('B', 'B', 25, 24, 2400), // underweight
      makeDriftEntry('C', 'C', 25, 24, 2400), // underweight
      makeDriftEntry('D', 'D', 25, 28, 2800), // overweight
    ];
    const holdings = [
      makeHolding({ isin: 'A', shortName: 'A', contribAmount: 25, contribInterval: 'monthly' }),
      makeHolding({ isin: 'B', shortName: 'B', contribAmount: 25, contribInterval: 'monthly' }),
      makeHolding({ isin: 'C', shortName: 'C', contribAmount: 25, contribInterval: 'monthly' }),
      makeHolding({ isin: 'D', shortName: 'D', contribAmount: 25, contribInterval: 'monthly' }),
    ];
    const plan = computeRebalancePlan(drift, holdings, totalValue, 1, {
      roundingStepByInterval: { monthly: 10 },
    });
    const totalSuggestedMonthly = plan.reduce((sum, e) => sum + e.suggestedContribAmt, 0);
    expect(totalSuggestedMonthly).toBeCloseTo(100, 6);
  });
});
