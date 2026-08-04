import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  monthlyGrowthSplit,
  cagr,
  findYoYSnapshot,
  monthlyGrowthHistory,
  twr,
  xirr,
  annualizedVolatility,
  maxDrawdown,
} from './insights';
import type { Snapshot } from '../types';
import * as utils from '../utils';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('monthlyGrowthSplit', () => {
  it('splits delta into contributed and market', () => {
    const result = monthlyGrowthSplit(11000, 10000, 400);
    expect(result).toEqual({ contributed: 400, market: 600 });
  });

  it('handles negative market movement', () => {
    const result = monthlyGrowthSplit(10200, 10000, 400);
    expect(result).toEqual({ contributed: 400, market: -200 });
  });

  it('handles zero contributions', () => {
    const result = monthlyGrowthSplit(10500, 10000, 0);
    expect(result).toEqual({ contributed: 0, market: 500 });
  });

  it('handles overall loss with contributions', () => {
    const result = monthlyGrowthSplit(9800, 10000, 400);
    expect(result).toEqual({ contributed: 400, market: -600 });
  });
});

describe('cagr', () => {
  it('returns the correct CAGR for a known case', () => {
    // 10000 -> 12100 over 24 months = (12100/10000)^(12/24) - 1 = 0.1 = 10%
    const result = cagr(10000, 12100, 24);
    expect(result).toBeCloseTo(0.1, 5);
  });

  describe('twr', () => {
    it('returns null with fewer than two snapshots', () => {
      expect(twr([], {})).toBeNull();
      expect(twr([{ date: '2026-01', acct: 1000 }], {})).toBeNull();
    });

    it('chains monthly returns net of contributions', () => {
      vi.spyOn(utils, 'snapTotal')
        .mockReturnValueOnce(1000)
        .mockReturnValueOnce(1200)
        .mockReturnValueOnce(1200)
        .mockReturnValueOnce(1430);
      const snaps: Snapshot[] = [
        { date: '2026-01-01' },
        { date: '2026-02-01' },
        { date: '2026-03-01' },
      ];
      const result = twr(snaps, { '2026-02-01': 100, '2026-03-01': 100 });
      expect(result).toBeCloseTo(0.2191666667, 5);
    });

    it('returns null when a period starts from zero or below', () => {
      vi.spyOn(utils, 'snapTotal').mockReturnValueOnce(0);
      const snaps: Snapshot[] = [{ date: '2026-01-01' }, { date: '2026-02-01' }];
      expect(twr(snaps, { '2026-02-01': 100 })).toBeNull();
    });
  });

  it('returns null for months < 12', () => {
    expect(cagr(10000, 11000, 6)).toBeNull();
    expect(cagr(10000, 11000, 11)).toBeNull();
  });

  it('returns null for first <= 0', () => {
    expect(cagr(0, 11000, 24)).toBeNull();
    expect(cagr(-100, 11000, 24)).toBeNull();
  });

  it('handles exactly 12 months', () => {
    // 10000 -> 11000 over 12 months = (11000/10000)^(12/12) - 1 = 0.1
    const result = cagr(10000, 11000, 12);
    expect(result).toBeCloseTo(0.1, 5);
  });

  it('handles negative growth', () => {
    // 10000 -> 9000 over 12 months
    const result = cagr(10000, 9000, 12);
    expect(result).toBeCloseTo(-0.1, 5);
  });
});

describe('findYoYSnapshot', () => {
  it('returns null when fewer than 2 snapshots', () => {
    expect(findYoYSnapshot([])).toBeNull();
    expect(findYoYSnapshot([{ date: '2026-06' }])).toBeNull();
  });

  it('returns null when history span < 12 months', () => {
    const snaps: Snapshot[] = [{ date: '2026-01' }, { date: '2026-06' }];
    expect(findYoYSnapshot(snaps)).toBeNull();
  });

  it('picks the snapshot nearest 12 months prior', () => {
    const snaps: Snapshot[] = [
      { date: '2025-01', savings: 5000 },
      { date: '2025-06', savings: 6000 },
      { date: '2025-07', savings: 6500 },
      { date: '2026-06', savings: 10000 },
    ];
    const result = findYoYSnapshot(snaps);
    expect(result).not.toBeNull();
    // Nearest to 2025-06 (12 months before 2026-06) is the snap at 2025-06
    expect(result!.snap.date).toBe('2025-06');
  });

  it('picks the closest when no exact match exists', () => {
    const snaps: Snapshot[] = [
      { date: '2025-01', savings: 5000 },
      { date: '2025-04', savings: 5500 },
      { date: '2025-08', savings: 6500 },
      { date: '2026-06', savings: 10000 },
    ];
    const result = findYoYSnapshot(snaps);
    expect(result).not.toBeNull();
    // 12 months before 2026-06 = 2025-06, nearest available is 2025-04 (dist=2) or 2025-08 (dist=2)
    // Both equidistant; first found wins = 2025-04
    expect(['2025-04', '2025-08']).toContain(result!.snap.date);
  });

  it('works at year boundary (January latest)', () => {
    const snaps: Snapshot[] = [
      { date: '2024-12', savings: 8000 },
      { date: '2025-01', savings: 8200 },
      { date: '2025-06', savings: 9000 },
      { date: '2026-01', savings: 11000 },
    ];
    const result = findYoYSnapshot(snaps);
    expect(result).not.toBeNull();
    // 12 months before 2026-01 = 2025-01
    expect(result!.snap.date).toBe('2025-01');
  });
});

describe('monthlyGrowthHistory', () => {
  const accounts = [{ id: 'tr', label: 'TR', moneyType: 'investment', isPrimaryInvestment: true }];
  const primaryValueFn = (snap: any) => snap.tr ?? null;

  it('produces one point per consecutive snapshot pair', () => {
    const snaps = [
      { date: '2026-01', tr: 10000 },
      { date: '2026-02', tr: 10500 },
      { date: '2026-03', tr: 11200 },
    ];
    const monthly = { '2026-02': 400, '2026-03': 500 };
    const points = monthlyGrowthHistory(snaps, accounts, monthly, primaryValueFn);
    expect(points).toHaveLength(2);
    expect(points[0]).toEqual({ month: '2026-02', contributed: 400, market: 100, total: 500 });
    expect(points[1]).toEqual({ month: '2026-03', contributed: 500, market: 200, total: 700 });
  });

  describe('xirr', () => {
    it('handles simple one-year buy and terminal value', () => {
      const result = xirr([
        { date: '2025-01-01', amount: -1000 },
        { date: '2026-01-01', amount: 1100 },
      ]);
      expect(result).toBeCloseTo(0.1, 3);
    });

    it('returns null for insufficient data', () => {
      expect(xirr([{ date: '2025-01-01', amount: -1000 }])).toBeNull();
    });

    it('returns null when all flows have same sign', () => {
      expect(
        xirr([
          { date: '2025-01-01', amount: -1000 },
          { date: '2026-01-01', amount: -1100 },
        ]),
      ).toBeNull();
    });

    it('supports multi-cashflow scenario', () => {
      const result = xirr([
        { date: '2024-01-01', amount: -1000 },
        { date: '2024-07-01', amount: -1000 },
        { date: '2025-12-31', amount: 2400 },
      ]);
      expect(result).not.toBeNull();
    });
  });

  it('skips pairs where either snapshot has no resolvable primary value', () => {
    const fn = (snap: any) => (snap.date === '2026-01' ? null : (snap.tr ?? null));
    const snaps = [
      { date: '2026-01', tr: 10000 },
      { date: '2026-02', tr: 10500 },
    ];
    const points = monthlyGrowthHistory(snaps, accounts, {}, fn);
    expect(points).toHaveLength(0);
  });

  it('returns empty array for a single snapshot', () => {
    const points = monthlyGrowthHistory(
      [{ date: '2026-01', tr: 10000 }],
      accounts,
      {},
      primaryValueFn,
    );
    expect(points).toHaveLength(0);
  });

  it('handles a negative (down) month correctly', () => {
    const snaps = [
      { date: '2026-01', tr: 10000 },
      { date: '2026-02', tr: 9800 },
    ];
    const points = monthlyGrowthHistory(snaps, accounts, { '2026-02': 400 }, primaryValueFn);
    expect(points[0]).toEqual({ month: '2026-02', contributed: 400, market: -600, total: -200 });
  });
});

describe('annualizedVolatility', () => {
  it('returns null with fewer than 3 snapshots', () => {
    expect(annualizedVolatility([])).toBeNull();
    expect(annualizedVolatility([{ date: '2026-01' }])).toBeNull();
    expect(annualizedVolatility([{ date: '2026-01' }, { date: '2026-02' }])).toBeNull();
  });

  it('returns null when a starting snapshot total is non-positive', () => {
    vi.spyOn(utils, 'snapTotal').mockReturnValueOnce(0).mockReturnValueOnce(1000).mockReturnValueOnce(1050);
    const snaps: Snapshot[] = [
      { date: '2026-01' },
      { date: '2026-02' },
      { date: '2026-03' },
    ];
    expect(annualizedVolatility(snaps)).toBeNull();
  });

  it('returns 0 for a flat series (no variance)', () => {
    vi.spyOn(utils, 'snapTotal').mockReturnValue(1000);
    const snaps: Snapshot[] = [
      { date: '2026-01' },
      { date: '2026-02' },
      { date: '2026-03' },
    ];
    expect(annualizedVolatility(snaps)).toBeCloseTo(0, 10);
  });

  it('computes correct annualized volatility for known returns', () => {
    // Monthly returns: +5%, -3%, +2% (4 snapshots needed for 3 returns)
    vi.spyOn(utils, 'snapTotal')
      .mockReturnValueOnce(10000)
      .mockReturnValueOnce(10500)
      .mockReturnValueOnce(10500)
      .mockReturnValueOnce(10185)
      .mockReturnValueOnce(10185)
      .mockReturnValueOnce(10388.7);
    const snaps: Snapshot[] = [
      { date: '2026-01' },
      { date: '2026-02' },
      { date: '2026-03' },
      { date: '2026-04' },
    ];
    const vol = annualizedVolatility(snaps);
    expect(vol).not.toBeNull();
    const returns = [0.05, -0.03, 0.02];
    const m = returns.reduce((s, r) => s + r, 0) / 3;
    const sv = returns.reduce((s, r) => s + (r - m) ** 2, 0) / 2;
    const expected = Math.sqrt(sv) * Math.sqrt(12);
    expect(vol).toBeCloseTo(expected, 5);
  });
});

describe('maxDrawdown', () => {
  it('returns null for fewer than 2 snapshots', () => {
    expect(maxDrawdown([])).toBeNull();
    expect(maxDrawdown([{ date: '2026-01' }])).toBeNull();
  });

  it('returns 0 for a monotonically increasing series', () => {
    vi.spyOn(utils, 'snapTotal')
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1100)
      .mockReturnValueOnce(1200);
    const snaps: Snapshot[] = [
      { date: '2026-01' },
      { date: '2026-02' },
      { date: '2026-03' },
    ];
    expect(maxDrawdown(snaps)).toBe(0);
  });

  it('computes the correct drawdown for a simple peak-trough sequence', () => {
    // 1000 -> 1200 (peak) -> 900 (trough) -> 1100
    // drawdown = (900 - 1200) / 1200 = -0.25
    vi.spyOn(utils, 'snapTotal')
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1200)
      .mockReturnValueOnce(900)
      .mockReturnValueOnce(1100);
    const snaps: Snapshot[] = [
      { date: '2026-01' },
      { date: '2026-02' },
      { date: '2026-03' },
      { date: '2026-04' },
    ];
    expect(maxDrawdown(snaps)).toBeCloseTo(-0.25, 8);
  });

  it('picks the worst drawdown when there are multiple troughs', () => {
    // peak 1200, trough 900 (-25%), then peak 1400, trough 1050 (-25%)
    vi.spyOn(utils, 'snapTotal')
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1200)
      .mockReturnValueOnce(900)
      .mockReturnValueOnce(1400)
      .mockReturnValueOnce(1050);
    const snaps: Snapshot[] = [
      { date: '2026-01' },
      { date: '2026-02' },
      { date: '2026-03' },
      { date: '2026-04' },
      { date: '2026-05' },
    ];
    expect(maxDrawdown(snaps)).toBeCloseTo(-0.25, 8);
  });

  it('handles a flat series with 0 drawdown', () => {
    vi.spyOn(utils, 'snapTotal').mockReturnValueOnce(5000).mockReturnValueOnce(5000);
    const snaps: Snapshot[] = [{ date: '2026-01' }, { date: '2026-02' }];
    expect(maxDrawdown(snaps)).toBe(0);
  });
});
