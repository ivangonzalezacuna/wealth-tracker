import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  monthlyGrowthSplit,
  cagr,
  findYoYSnapshot,
  monthlyGrowthHistory,
  normalizeExternalCashFlows,
  buildInvestmentPerformanceData,
  twr,
  xirr,
  annualizedVolatility,
  annualizedVolatilityFromMonthlyReturns,
  maxDrawdown,
  drawdownFromMonthlyReturns,
  cagrPerAccount,
  dividendMetrics,
  monthsBetween,
  rollingCagr,
  annualizedReturnFromMonthlyReturns,
  annualReturnsFromMonthlyReturns,
  rollingAnnualizedReturnFromMonthlyReturns,
} from './insights';
import type { Snapshot, Account, Transaction } from '../types';
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

describe('dividendMetrics', () => {
  it('anchors trailing income windows to the latest imported transaction month', () => {
    const metrics = dividendMetrics(
      [
        { type: 'DIVIDEND', date: '2024-05-15', amount: 10 },
        { type: 'DIVIDEND', date: '2025-04-15', amount: 20 },
        { type: 'DIVIDEND', date: '2025-12-15', amount: 30 },
        { type: 'BUY', date: '2026-03-01', amount: 1000 },
      ],
      1000,
      800,
    );

    expect(metrics.asOfMonth).toBe('2026-03');
    expect(metrics.trailing12m).toBe(50);
    expect(metrics.yoyGrowth).toBeCloseTo(4);
  });

  it('uses current investment value for yield inputs without requiring wall-clock dates', () => {
    const metrics = dividendMetrics(
      [
        { type: 'DIVIDEND', date: '2025-04-15', amount: 12 },
        { type: 'DIVIDEND', date: '2026-03-15', amount: 108 },
      ],
      1000,
      1200,
    );

    expect(metrics.trailing12m).toBe(120);
    expect(metrics.yieldPct).toBeCloseTo(0.12);
    expect(metrics.yieldOnCost).toBeCloseTo(0.1);
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

  describe('investment performance foundation', () => {
    it('normalizes deposit and withdrawal signs into canonical external flows', () => {
      const txs: Transaction[] = [
        {
          id: 'dep',
          date: '2024-02-05',
          source: 'broker',
          type: 'DEPOSIT',
          name: 'Deposit',
          isin: '',
          shares: 0,
          price: 0,
          amount: -100,
          fee: 0,
          tax: 0,
          currency: 'EUR',
          fxRate: 1,
        },
        {
          id: 'wd',
          date: '2024-03-02',
          source: 'broker',
          type: 'WITHDRAWAL',
          name: 'Withdrawal',
          isin: '',
          shares: 0,
          price: 0,
          amount: 50,
          fee: 0,
          tax: 0,
          currency: 'EUR',
          fxRate: 1,
        },
      ];

      const result = normalizeExternalCashFlows(txs);

      expect(result.monthlyExternalFlows).toEqual({
        '2024-02': 100,
        '2024-03': -50,
      });
      expect(result.externalCashFlows).toEqual([
        {
          date: '2024-02-29',
          month: '2024-02',
          amount: -100,
          portfolioFlow: 100,
          type: 'DEPOSIT',
        },
        {
          date: '2024-03-31',
          month: '2024-03',
          amount: 50,
          portfolioFlow: -50,
          type: 'WITHDRAWAL',
        },
      ]);
    });

    it('ignores transfer rows in external cash-flow normalization', () => {
      const txs: Transaction[] = [
        {
          id: 'dep',
          date: '2024-02-05',
          source: 'broker',
          type: 'DEPOSIT',
          name: 'Deposit',
          isin: '',
          shares: 0,
          price: 0,
          amount: 100,
          fee: 0,
          tax: 0,
          currency: 'EUR',
          fxRate: 1,
        },
        {
          id: 'tr',
          date: '2024-02-10',
          source: 'broker',
          type: 'TRANSFER',
          name: 'Portfolio Transfer',
          isin: '',
          shares: 0,
          price: 0,
          amount: 5000,
          fee: 0,
          tax: 0,
          currency: 'EUR',
          fxRate: 1,
        },
      ];

      const result = normalizeExternalCashFlows(txs);

      expect(result.monthlyExternalFlows).toEqual({ '2024-02': 100 });
      expect(result.externalCashFlows).toHaveLength(1);
      expect(result.externalCashFlows[0].type).toBe('DEPOSIT');
    });

    it('builds monthly investment returns from snapshots and external flows', () => {
      const accounts: Account[] = [{ id: 'broker', label: 'Broker', moneyType: 'investment' }];
      const snaps: Snapshot[] = [
        { date: '2024-01', broker: 1000 },
        { date: '2024-02', broker: 1200 },
        { date: '2024-03', broker: 1270 },
      ];
      const txs: Transaction[] = [
        {
          id: 'dep',
          date: '2024-02-05',
          source: 'broker',
          type: 'DEPOSIT',
          name: 'Deposit',
          isin: '',
          shares: 0,
          price: 0,
          amount: 100,
          fee: 0,
          tax: 0,
          currency: 'EUR',
          fxRate: 1,
        },
        {
          id: 'wd',
          date: '2024-03-05',
          source: 'broker',
          type: 'WITHDRAWAL',
          name: 'Withdrawal',
          isin: '',
          shares: 0,
          price: 0,
          amount: -50,
          fee: 0,
          tax: 0,
          currency: 'EUR',
          fxRate: 1,
        },
      ];

      const result = buildInvestmentPerformanceData(snaps, txs, accounts);

      expect(result.skippedGapPeriods).toBe(0);
      expect(result.skippedMissingValuePeriods).toBe(0);
      expect(result.latestInvestmentValue).toBe(1270);
      expect(result.monthlyReturns).toHaveLength(2);
      expect(result.monthlyReturns[0]).toMatchObject({
        date: '2024-02',
        startValue: 1000,
        endValue: 1200,
        externalFlow: 100,
      });
      expect(result.monthlyReturns[0].return).toBeCloseTo(0.1, 6);
      expect(result.monthlyReturns[1].return).toBeCloseTo(0.1, 6);
    });

    it('tracks missing values and month gaps for gating', () => {
      const accounts: Account[] = [{ id: 'broker', label: 'Broker', moneyType: 'investment' }];
      const snaps: Snapshot[] = [
        { date: '2024-01', broker: 1000 },
        { date: '2024-03', broker: 1100 },
        { date: '2024-04', cash: 100 },
      ];

      const result = buildInvestmentPerformanceData(snaps, [], accounts);

      expect(result.monthlyReturns).toEqual([]);
      expect(result.skippedGapPeriods).toBe(1);
      expect(result.skippedMissingValuePeriods).toBe(1);
    });
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
  it('returns annualized: null with fewer than 3 snapshots', () => {
    expect(annualizedVolatility([]).annualized).toBeNull();
    expect(annualizedVolatility([{ date: '2026-01' }]).annualized).toBeNull();
    expect(annualizedVolatility([{ date: '2026-01' }, { date: '2026-02' }]).annualized).toBeNull();
  });

  describe('investment return risk helpers', () => {
    const monthlyReturns = [
      { date: '2024-01', startValue: 1000, return: 0.1 },
      { date: '2024-02', startValue: 1100, return: -0.05 },
      { date: '2024-03', startValue: 1045, return: 0.02 },
    ];

    it('computes volatility from monthly investment returns', () => {
      const result = annualizedVolatilityFromMonthlyReturns(monthlyReturns);
      expect(result.annualized).not.toBeNull();
      expect(result.monthlyReturns).toEqual(monthlyReturns);
    });

    it('derives drawdown series from linked monthly returns', () => {
      const result = drawdownFromMonthlyReturns(monthlyReturns);
      expect(result.max).toBeLessThan(0);
      expect(result.series).toHaveLength(3);
      expect(result.series[1].drawdown).toBeLessThan(0);
    });

    it('builds annualized and annual return summaries from investment return series', () => {
      expect(annualizedReturnFromMonthlyReturns(monthlyReturns)).not.toBeNull();
      expect(annualReturnsFromMonthlyReturns(monthlyReturns)).toEqual([
        { year: 2024, return: (1 + 0.1) * (1 - 0.05) * (1 + 0.02) - 1 },
      ]);
      expect(rollingAnnualizedReturnFromMonthlyReturns(monthlyReturns, 3)).toHaveLength(1);
    });
  });

  it('returns annualized: null when a starting snapshot total is non-positive', () => {
    vi.spyOn(utils, 'snapTotal')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1050);
    const snaps: Snapshot[] = [{ date: '2026-01' }, { date: '2026-02' }, { date: '2026-03' }];
    expect(annualizedVolatility(snaps).annualized).toBeNull();
  });

  it('returns 0 for a flat series (no variance)', () => {
    vi.spyOn(utils, 'snapTotal').mockReturnValue(1000);
    const snaps: Snapshot[] = [{ date: '2026-01' }, { date: '2026-02' }, { date: '2026-03' }];
    expect(annualizedVolatility(snaps).annualized).toBeCloseTo(0, 10);
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
    const result = annualizedVolatility(snaps);
    expect(result.annualized).not.toBeNull();
    const returns = [0.05, -0.03, 0.02];
    const m = returns.reduce((s, r) => s + r, 0) / 3;
    const sv = returns.reduce((s, r) => s + (r - m) ** 2, 0) / 2;
    const expected = Math.sqrt(sv) * Math.sqrt(12);
    expect(result.annualized).toBeCloseTo(expected, 5);
    expect(result.monthlyReturns.length).toBe(3);
  });
});

describe('maxDrawdown', () => {
  it('returns max: null for fewer than 2 snapshots', () => {
    expect(maxDrawdown([]).max).toBeNull();
    expect(maxDrawdown([{ date: '2026-01' }]).max).toBeNull();
  });

  it('returns max: 0 for a monotonically increasing series', () => {
    vi.spyOn(utils, 'snapTotal')
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1100)
      .mockReturnValueOnce(1200);
    const snaps: Snapshot[] = [{ date: '2026-01' }, { date: '2026-02' }, { date: '2026-03' }];
    expect(maxDrawdown(snaps).max).toBe(0);
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
    expect(maxDrawdown(snaps).max).toBeCloseTo(-0.25, 8);
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
    expect(maxDrawdown(snaps).max).toBeCloseTo(-0.25, 8);
  });

  it('handles a flat series with 0 drawdown', () => {
    vi.spyOn(utils, 'snapTotal').mockReturnValueOnce(5000).mockReturnValueOnce(5000);
    const snaps: Snapshot[] = [{ date: '2026-01' }, { date: '2026-02' }];
    expect(maxDrawdown(snaps).max).toBe(0);
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

describe('monthsBetween', () => {
  it('returns 1 for consecutive months', () => {
    expect(monthsBetween('2026-01', '2026-02')).toBe(1);
    expect(monthsBetween('2025-12', '2026-01')).toBe(1);
  });

  it('returns 0 for the same month', () => {
    expect(monthsBetween('2026-03', '2026-03')).toBe(0);
  });

  it('returns correct distance across years', () => {
    expect(monthsBetween('2024-01', '2026-01')).toBe(24);
    expect(monthsBetween('2025-06', '2026-01')).toBe(7);
  });

  it('is symmetric', () => {
    expect(monthsBetween('2026-01', '2026-04')).toBe(monthsBetween('2026-04', '2026-01'));
  });

  it('returns 0 for unparseable dates', () => {
    expect(monthsBetween('', '2026-01')).toBe(0);
    expect(monthsBetween('2026-01', 'bad')).toBe(0);
  });
});

describe('annualizedVolatility — skipped month handling', () => {
  it('excludes multi-month gaps from the monthly return series', () => {
    // 4 snapshots but with a 2-month gap between index 1 and 2
    // Dates: Jan, Feb, Apr (gap!), May — only Jan→Feb and Apr→May are single-month pairs
    vi.spyOn(utils, 'snapTotal')
      .mockReturnValueOnce(10000) // Jan prev
      .mockReturnValueOnce(10500) // Feb cur  → Jan→Feb included (1 month gap)
      .mockReturnValueOnce(10500) // Feb prev (for next pair check — gap=2, skipped)
      .mockReturnValueOnce(10000) // Apr prev
      .mockReturnValueOnce(10100) // May cur  → Apr→May included (1 month gap)
      .mockReturnValueOnce(10100); // extra call guard

    const snaps: Snapshot[] = [
      { date: '2026-01' },
      { date: '2026-02' },
      { date: '2026-04' }, // skipped March
      { date: '2026-05' },
    ];
    const result = annualizedVolatility(snaps);
    // Only 2 monthly return points should survive (Jan→Feb and Apr→May)
    expect(result.monthlyReturns.length).toBe(2);
  });

  it('returns annualized: null when too few consecutive pairs survive after gap filtering', () => {
    // Only a single consecutive pair remains — not enough for variance
    vi.spyOn(utils, 'snapTotal')
      .mockReturnValueOnce(10000)
      .mockReturnValueOnce(10500)
      .mockReturnValue(10500);

    // 3 snapshots but only 1 is a consecutive pair (Jan→Feb); Feb→Apr is a gap
    const snaps: Snapshot[] = [{ date: '2026-01' }, { date: '2026-02' }, { date: '2026-04' }];
    const result = annualizedVolatility(snaps);
    expect(result.annualized).toBeNull();
    expect(result.monthlyReturns.length).toBe(1);
  });
});

describe('rollingCagr — actual elapsed months', () => {
  it('uses actual elapsed months when snapshots have gaps', () => {
    // windowMonths = 1 (index step), but the two snapshots are 15 calendar months apart.
    // Old code: cagr(start, end, 1) → null (< 12 months minimum)
    // New code: cagr(start, end, 15) → a real CAGR value
    vi.spyOn(utils, 'snapTotal')
      .mockReturnValueOnce(10000) // startVal (snaps[0])
      .mockReturnValueOnce(12000); // endVal (snaps[1])

    const snaps: Snapshot[] = [
      { date: '2024-01' },
      { date: '2025-04' }, // 15 calendar months later
    ];
    const result = rollingCagr(snaps, 1);
    // actualMonths = 15 — enough for cagr() to return a result
    expect(result.length).toBe(1);
    // CAGR(10000, 12000, 15) = (12000/10000)^(12/15) - 1 = 1.2^0.8 - 1
    expect(result[0].cagr).toBeCloseTo(Math.pow(1.2, 12 / 15) - 1, 4);
  });
});
