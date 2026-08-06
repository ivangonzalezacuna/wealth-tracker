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
  maxDrawdownFull,
  cagrPerAccount,
  trailingDividendYield,
  monthlyReturns,
  monthlyReturnSeries,
  totalReturn,
  absoluteGain,
  ytdReturn,
  downsideDeviation,
  sharpeRatio,
  sortinoRatio,
  calmarRatio,
  averageDrawdown,
  drawdownDuration,
  rollingCagrSeries,
  annualReturns,
  trailing12mIncome,
  dividendYieldPct,
  yieldOnCostPct,
  dividendGrowthYoY,
  dividendCagr,
  incomeByMonth,
} from './insights';
import type { Snapshot, Transaction } from '../types';
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
    vi.spyOn(utils, 'snapTotal')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1050);
    const snaps: Snapshot[] = [{ date: '2026-01' }, { date: '2026-02' }, { date: '2026-03' }];
    expect(annualizedVolatility(snaps)).toBeNull();
  });

  it('returns 0 for a flat series (no variance)', () => {
    vi.spyOn(utils, 'snapTotal').mockReturnValue(1000);
    const snaps: Snapshot[] = [{ date: '2026-01' }, { date: '2026-02' }, { date: '2026-03' }];
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
    const snaps: Snapshot[] = [{ date: '2026-01' }, { date: '2026-02' }, { date: '2026-03' }];
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

describe('cagrPerAccount', () => {
  const makeSnap = (date: string, vals: Record<string, number>): import('../types').Snapshot => ({
    date,
    ...vals,
  });
  const makeAcct = (id: string, label: string): import('../types').Account => ({
    id,
    label,
    color: '#aabbcc',
  });

  it('returns empty array when fewer than 2 snapshots', () => {
    const snaps = [makeSnap('2024-01', { acct1: 1000 })];
    expect(cagrPerAccount(snaps, [makeAcct('acct1', 'Savings')])).toHaveLength(0);
  });

  it('excludes accounts with fewer than 12 months of non-zero data', () => {
    const snaps = [makeSnap('2024-01', { acct1: 1000 }), makeSnap('2024-06', { acct1: 1100 })];
    expect(cagrPerAccount(snaps, [makeAcct('acct1', 'Savings')])).toHaveLength(0);
  });

  it('computes CAGR for an account with 24 months of data', () => {
    const start = 10000;
    const end = 12000;
    const snaps = [makeSnap('2022-01', { acct1: start }), makeSnap('2024-01', { acct1: end })];
    const results = cagrPerAccount(snaps, [makeAcct('acct1', 'ETF Account')]);
    expect(results).toHaveLength(1);
    expect(results[0].label).toBe('ETF Account');
    expect(results[0].monthsSpan).toBe(24);
    expect(results[0].cagrValue).not.toBeNull();
    // CAGR = (12000/10000)^(12/24) - 1 = sqrt(1.2) - 1 ~ 9.54%
    expect(results[0].cagrValue!).toBeCloseTo(Math.sqrt(1.2) - 1, 4);
  });

  it('skips accounts with no values in snapshots', () => {
    const snaps = [makeSnap('2022-01', { acct1: 1000 }), makeSnap('2024-01', { acct1: 1200 })];
    const results = cagrPerAccount(snaps, [makeAcct('acct1', 'A'), makeAcct('acct2', 'B')]);
    expect(results).toHaveLength(1);
    expect(results[0].accountId).toBe('acct1');
  });

  it('handles multiple accounts independently', () => {
    const snaps = [
      makeSnap('2022-01', { acct1: 10000, acct2: 5000 }),
      makeSnap('2024-01', { acct1: 14000, acct2: 6000 }),
    ];
    const results = cagrPerAccount(snaps, [makeAcct('acct1', 'A'), makeAcct('acct2', 'B')]);
    expect(results).toHaveLength(2);
    const a = results.find((r) => r.accountId === 'acct1')!;
    const b = results.find((r) => r.accountId === 'acct2')!;
    expect(a.cagrValue).not.toBeNull();
    expect(b.cagrValue).not.toBeNull();
    expect(a.cagrValue).not.toBeCloseTo(b.cagrValue!);
  });
});

describe('trailingDividendYield', () => {
  it('returns null when totalInvested is 0', () => {
    expect(trailingDividendYield([{ date: '2025-01', net: 100 }], 0)).toBeNull();
  });

  it('returns null when no dividends in trailing 12 months', () => {
    // Very old dividend date
    expect(trailingDividendYield([{ date: '2020-01', net: 100 }], 10000)).toBeNull();
  });

  it('returns null when divHist is empty', () => {
    expect(trailingDividendYield([], 10000)).toBeNull();
  });

  it('computes yield correctly from recent dividends', () => {
    const now = new Date();
    const recentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const result = trailingDividendYield([{ date: recentMonth, net: 200 }], 10000);
    expect(result).not.toBeNull();
    expect(result!).toBeCloseTo(2); // 200 / 10000 * 100 = 2%
  });

  it('yields higher when denominator is dist-only capital (excluding acc holdings)', () => {
    // Scenario: 200 net dividends, 5000 in dist holdings, 5000 in acc holdings (total 10000).
    // Using total capital: 200/10000 = 2%. Using dist-only capital: 200/5000 = 4%.
    const now = new Date();
    const recentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const divHist = [{ date: recentMonth, net: 200 }];
    const totalResult = trailingDividendYield(divHist, 10000);
    const distOnlyResult = trailingDividendYield(divHist, 5000);
    expect(totalResult!).toBeCloseTo(2);
    expect(distOnlyResult!).toBeCloseTo(4); // more accurate: only dist capital in denominator
  });
});

// ── New analytics function tests ──────────────────────────────────

describe('monthlyReturns', () => {
  it('returns null for fewer than 2 snapshots', () => {
    expect(monthlyReturns([])).toBeNull();
    expect(monthlyReturns([{ date: '2026-01' }])).toBeNull();
  });

  it('returns null when a period starts at zero', () => {
    vi.spyOn(utils, 'snapTotal').mockReturnValueOnce(0).mockReturnValueOnce(1000);
    const snaps: Snapshot[] = [{ date: '2026-01' }, { date: '2026-02' }];
    expect(monthlyReturns(snaps)).toBeNull();
  });

  it('computes returns for a growing series', () => {
    vi.spyOn(utils, 'snapTotal')
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1100)
      .mockReturnValueOnce(1100)
      .mockReturnValueOnce(1210);
    const snaps: Snapshot[] = [{ date: '2026-01' }, { date: '2026-02' }, { date: '2026-03' }];
    const r = monthlyReturns(snaps);
    expect(r).not.toBeNull();
    expect(r!.length).toBe(2);
    expect(r![0]).toBeCloseTo(0.1);
    expect(r![1]).toBeCloseTo(0.1);
  });
});

describe('monthlyReturnSeries', () => {
  it('returns empty array for fewer than 2 snapshots', () => {
    expect(monthlyReturnSeries([])).toEqual([]);
    expect(monthlyReturnSeries([{ date: '2026-01' }])).toEqual([]);
  });

  it('includes year and month metadata', () => {
    vi.spyOn(utils, 'snapTotal').mockReturnValueOnce(1000).mockReturnValueOnce(1050);
    const snaps: Snapshot[] = [{ date: '2026-01' }, { date: '2026-02' }];
    const series = monthlyReturnSeries(snaps);
    expect(series).toHaveLength(1);
    expect(series[0].year).toBe(2026);
    expect(series[0].month).toBe(2);
    expect(series[0].ret).toBeCloseTo(0.05);
  });
});

describe('maxDrawdownFull', () => {
  it('returns null for fewer than 2 snapshots', () => {
    expect(maxDrawdownFull([])).toBeNull();
  });

  it('returns scalar matching maxDrawdown and a series', () => {
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
    const result = maxDrawdownFull(snaps);
    expect(result).not.toBeNull();
    expect(result!.scalar).toBeCloseTo(-0.25, 8);
    expect(result!.series).toHaveLength(3);
    expect(result!.series[0].date).toBe('2026-02');
    expect(result!.series[1].drawdown).toBeCloseTo(-0.25, 8);
  });
});

describe('totalReturn', () => {
  it('returns null when first <= 0', () => {
    expect(totalReturn(0, 1000)).toBeNull();
    expect(totalReturn(-100, 1000)).toBeNull();
  });

  it('computes total return correctly', () => {
    expect(totalReturn(10000, 12000)).toBeCloseTo(0.2);
    expect(totalReturn(10000, 8000)).toBeCloseTo(-0.2);
  });
});

describe('absoluteGain', () => {
  it('subtracts contributed from current value', () => {
    expect(absoluteGain(15000, 10000)).toBe(5000);
    expect(absoluteGain(8000, 10000)).toBe(-2000);
  });
});

describe('ytdReturn', () => {
  it('returns null for fewer than 2 snapshots', () => {
    expect(ytdReturn([])).toBeNull();
    expect(ytdReturn([{ date: '2026-01' }])).toBeNull();
  });

  it('returns a value when snapshots span the current year start', () => {
    const yr = new Date().getFullYear();
    const prevYear = yr - 1;
    const snaps: Snapshot[] = [
      { date: `${prevYear}-12`, savings: 10000 },
      { date: `${yr}-06`, savings: 11000 },
    ];
    vi.spyOn(utils, 'snapTotal').mockReturnValueOnce(10000).mockReturnValueOnce(11000);
    const result = ytdReturn(snaps);
    expect(result).not.toBeNull();
    expect(result!).toBeCloseTo(0.1);
  });
});

describe('downsideDeviation', () => {
  it('returns null for empty array', () => {
    expect(downsideDeviation([])).toBeNull();
  });

  it('returns 0 when all returns are positive', () => {
    expect(downsideDeviation([0.05, 0.03, 0.07])).toBeCloseTo(0);
  });

  it('computes correctly for mixed returns', () => {
    const returns = [0.05, -0.03, 0.02, -0.01];
    const result = downsideDeviation(returns);
    expect(result).not.toBeNull();
    const sumSq = Math.pow(0.03, 2) + Math.pow(0.01, 2);
    const expected = Math.sqrt(sumSq / 4) * Math.sqrt(12);
    expect(result!).toBeCloseTo(expected, 5);
  });
});

describe('sharpeRatio', () => {
  it('returns null when volatility is 0', () => {
    expect(sharpeRatio(0.1, 0, 0.02)).toBeNull();
  });

  it('computes sharpe correctly', () => {
    expect(sharpeRatio(0.1, 0.2, 0.02)).toBeCloseTo((0.1 - 0.02) / 0.2);
  });
});

describe('sortinoRatio', () => {
  it('returns null when downside deviation is 0', () => {
    expect(sortinoRatio(0.1, 0, 0.02)).toBeNull();
  });

  it('computes sortino correctly', () => {
    expect(sortinoRatio(0.1, 0.1, 0.02)).toBeCloseTo((0.1 - 0.02) / 0.1);
  });
});

describe('calmarRatio', () => {
  it('returns null when maxDd is 0', () => {
    expect(calmarRatio(0.1, 0)).toBeNull();
  });

  it('computes calmar correctly', () => {
    expect(calmarRatio(0.1, -0.2)).toBeCloseTo(0.5);
  });
});

describe('averageDrawdown', () => {
  it('returns null for empty series', () => {
    expect(averageDrawdown([])).toBeNull();
  });

  it('computes mean of drawdown values', () => {
    const series = [
      { date: '2026-01', drawdown: 0 },
      { date: '2026-02', drawdown: -0.1 },
      { date: '2026-03', drawdown: -0.2 },
    ];
    expect(averageDrawdown(series)).toBeCloseTo(-0.1, 5);
  });
});

describe('drawdownDuration', () => {
  it('returns 0 for no drawdown', () => {
    expect(drawdownDuration([{ date: '2026-01', drawdown: 0 }])).toBe(0);
  });

  it('finds the max consecutive run below zero', () => {
    const series = [
      { date: '2026-01', drawdown: 0 },
      { date: '2026-02', drawdown: -0.05 },
      { date: '2026-03', drawdown: -0.1 },
      { date: '2026-04', drawdown: 0 },
      { date: '2026-05', drawdown: -0.03 },
    ];
    expect(drawdownDuration(series)).toBe(2);
  });
});

describe('rollingCagrSeries', () => {
  it('returns empty for insufficient snapshots', () => {
    const snaps: Snapshot[] = [{ date: '2024-01' }, { date: '2025-01' }];
    expect(rollingCagrSeries(snaps, 12)).toEqual([]);
  });

  it('produces one result per qualifying window', () => {
    const snaps: Snapshot[] = Array.from({ length: 14 }, (_, i) => ({
      date: `${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`,
    }));
    vi.spyOn(utils, 'snapTotal').mockReturnValue(1000);
    const result = rollingCagrSeries(snaps, 12);
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('annualReturns', () => {
  it('returns empty for fewer than 2 snapshots', () => {
    expect(annualReturns([])).toEqual([]);
    expect(annualReturns([{ date: '2024-06' }])).toEqual([]);
  });

  it('computes year-over-year returns from last snap per year', () => {
    const snaps: Snapshot[] = [
      { date: '2023-06', savings: 10000 },
      { date: '2023-12', savings: 11000 },
      { date: '2024-12', savings: 13200 },
    ];
    vi.spyOn(utils, 'snapTotal')
      .mockReturnValueOnce(11000) // prevSnap = 2023-12 (last snap of 2023)
      .mockReturnValueOnce(13200); // curSnap = 2024-12
    const results = annualReturns(snaps);
    expect(results).toHaveLength(1);
    expect(results[0].year).toBe(2024);
    expect(results[0].return).toBeCloseTo(0.2, 5);
  });
});

describe('trailing12mIncome', () => {
  const now = new Date();
  const recentDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`;
  const makeTx = (type: string, amount: number, date = recentDate): Transaction => ({
    id: '1',
    date,
    source: 'test',
    type,
    name: 'test',
    isin: '',
    shares: 0,
    price: 0,
    amount,
    fee: 0,
    tax: 0,
    currency: 'EUR',
    fxRate: 1,
  });

  it('sums DIVIDEND and INTEREST in trailing 12 months', () => {
    const txs: Transaction[] = [
      makeTx('DIVIDEND', 100),
      makeTx('INTEREST', 50),
      makeTx('BUY', 1000),
    ];
    expect(trailing12mIncome(txs)).toBeCloseTo(150);
  });

  it('excludes transactions older than 12 months', () => {
    const old = makeTx('DIVIDEND', 500, '2020-01-01');
    expect(trailing12mIncome([old])).toBeCloseTo(0);
  });
});

describe('dividendYieldPct', () => {
  it('returns null when portfolioValue <= 0', () => {
    expect(dividendYieldPct(100, 0)).toBeNull();
  });

  it('computes yield as fraction', () => {
    expect(dividendYieldPct(200, 10000)).toBeCloseTo(0.02);
  });
});

describe('yieldOnCostPct', () => {
  it('returns null when costBasis <= 0', () => {
    expect(yieldOnCostPct(100, 0)).toBeNull();
  });

  it('computes yield on cost as fraction', () => {
    expect(yieldOnCostPct(300, 10000)).toBeCloseTo(0.03);
  });
});

describe('dividendGrowthYoY', () => {
  it('returns null when last year had no income', () => {
    expect(dividendGrowthYoY([])).toBeNull();
  });

  it('computes growth correctly', () => {
    const now = new Date();
    const yr = now.getFullYear();
    const makeTx = (amount: number, year: number): Transaction => ({
      id: '1',
      date: `${year}-06-01`,
      source: 'test',
      type: 'DIVIDEND',
      name: 'div',
      isin: '',
      shares: 0,
      price: 0,
      amount,
      fee: 0,
      tax: 0,
      currency: 'EUR',
      fxRate: 1,
    });
    const txs: Transaction[] = [makeTx(100, yr - 1), makeTx(120, yr)];
    const result = dividendGrowthYoY(txs);
    expect(result).not.toBeNull();
    expect(result!).toBeCloseTo(0.2, 5);
  });
});

describe('dividendCagr', () => {
  it('returns null when fewer than 2 years of data', () => {
    const tx: Transaction = {
      id: '1',
      date: '2024-01-01',
      source: 'test',
      type: 'DIVIDEND',
      name: '',
      isin: '',
      shares: 0,
      price: 0,
      amount: 100,
      fee: 0,
      tax: 0,
      currency: 'EUR',
      fxRate: 1,
    };
    expect(dividendCagr([tx])).toBeNull();
  });

  it('computes CAGR for multi-year dividend series', () => {
    const make = (amount: number, date: string): Transaction => ({
      id: '1',
      date,
      source: 'test',
      type: 'DIVIDEND',
      name: '',
      isin: '',
      shares: 0,
      price: 0,
      amount,
      fee: 0,
      tax: 0,
      currency: 'EUR',
      fxRate: 1,
    });
    const txs: Transaction[] = [make(100, '2022-06-01'), make(121, '2024-06-01')];
    const result = dividendCagr(txs);
    expect(result).not.toBeNull();
    // 100 -> 121 over 24 months = (121/100)^(12/24) - 1 = 0.1
    expect(result!).toBeCloseTo(0.1, 3);
  });
});

describe('incomeByMonth', () => {
  it('returns 12 entries by default', () => {
    expect(incomeByMonth([], 12)).toHaveLength(12);
  });

  it('sums income per month', () => {
    const now = new Date();
    const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const txs: Transaction[] = [
      {
        id: '1',
        date: curMonth,
        source: 'test',
        type: 'DIVIDEND',
        name: '',
        isin: '',
        shares: 0,
        price: 0,
        amount: 200,
        fee: 0,
        tax: 0,
        currency: 'EUR',
        fxRate: 1,
      },
    ];
    const result = incomeByMonth(txs, 1);
    expect(result).toHaveLength(1);
    expect(result[0].amount).toBeCloseTo(200);
  });
});
