import { describe, it, expect, vi } from 'vitest';
import { computeCostBasis, _computeAvgCost, _computeFIFO, _computeHIFO, _computeLIFO } from './costbasis';
import { TxType } from '../types';
import type { Transaction } from '../types';

/** Helper to build a minimal BUY transaction. */
function buy(date: string, shares: number, amount: number, fee = 0): Transaction {
  return {
    id: '',
    source: '',
    name: '',
    isin: 'IE00B4L5Y983',
    type: TxType.BUY,
    date,
    shares,
    price: 0,
    amount: -amount,
    fee,
    tax: 0,
    currency: 'EUR',
    fxRate: 0,
  };
}

/** Helper to build a minimal SELL transaction. */
function sell(date: string, shares: number, amount: number, fee = 0): Transaction {
  return {
    id: '',
    source: '',
    name: '',
    isin: 'IE00B4L5Y983',
    type: TxType.SELL,
    date,
    shares: -shares,
    price: 0,
    amount,
    fee,
    tax: 0,
    currency: 'EUR',
    fxRate: 0,
  };
}

describe('costbasis: average cost', () => {
  it('handles two buys and a partial sell', () => {
    const txs = [
      buy('2024-01-01', 10, 1000), // avg = 100
      buy('2024-02-01', 10, 1200), // avg = (1000+1200)/20 = 110
      sell('2024-03-01', 5, 600), // sold 5 @ avg 110 = 550 cost; realized = 600-550 = 50
    ];
    const r = _computeAvgCost(txs);
    expect(r.shares).toBeCloseTo(15);
    expect(r.costBasis).toBeCloseTo(1650); // 2200 - 550
    expect(r.realizedPnL).toBeCloseTo(50);
    expect(r.exited).toBe(false);
    expect(r.buys).toBe(2);
  });

  it('sell-all marks position as exited', () => {
    const txs = [buy('2024-01-01', 10, 1000), sell('2024-02-01', 10, 1100)];
    const r = _computeAvgCost(txs);
    expect(r.shares).toBe(0);
    expect(r.costBasis).toBe(0);
    expect(r.realizedPnL).toBeCloseTo(100); // 1100 - 1000
    expect(r.exited).toBe(true);
  });

  it('includes fees in cost basis', () => {
    const txs = [
      buy('2024-01-01', 10, 1000, 10), // cost = 1000 + 10 = 1010
    ];
    const r = _computeAvgCost(txs);
    expect(r.costBasis).toBeCloseTo(1010);
    expect(r.totalFees).toBeCloseTo(10);
  });

  it('sell fee reduces proceeds', () => {
    const txs = [
      buy('2024-01-01', 10, 1000),
      sell('2024-02-01', 10, 1100, 5), // proceeds = 1100 - 5 = 1095
    ];
    const r = _computeAvgCost(txs);
    expect(r.realizedPnL).toBeCloseTo(95); // 1095 - 1000
    expect(r.totalFees).toBeCloseTo(5);
  });

  it('throws on oversell when no shares are held', () => {
    const txs = [sell('2024-01-01', 10, 1100)];
    expect(() => _computeAvgCost(txs)).toThrow(/Oversell detected/);
  });

  it('throws on partial oversell after buys', () => {
    const txs = [buy('2024-01-01', 10, 1000), sell('2024-02-01', 11, 1200)];
    expect(() => _computeAvgCost(txs)).toThrow(/Oversell detected/);
  });
});

describe('costbasis: FIFO', () => {
  it('handles two buys and a partial sell (FIFO order)', () => {
    const txs = [
      buy('2024-01-01', 10, 1000), // lot 1: 10 @ 100
      buy('2024-02-01', 10, 1200), // lot 2: 10 @ 120
      sell('2024-03-01', 5, 600), // FIFO: sell 5 from lot 1 @ 100 = 500 cost; realized = 600-500 = 100
    ];
    const r = _computeFIFO(txs);
    expect(r.shares).toBeCloseTo(15);
    // Remaining: 5 @ 100 + 10 @ 120 = 500 + 1200 = 1700
    expect(r.costBasis).toBeCloseTo(1700);
    expect(r.realizedPnL).toBeCloseTo(100);
    expect(r.exited).toBe(false);
    expect(r.buys).toBe(2);
  });

  it('sell-all marks position as exited', () => {
    const txs = [buy('2024-01-01', 10, 1000), sell('2024-02-01', 10, 1100)];
    const r = _computeFIFO(txs);
    expect(r.shares).toBe(0);
    expect(r.costBasis).toBe(0);
    expect(r.realizedPnL).toBeCloseTo(100);
    expect(r.exited).toBe(true);
  });

  it('includes fees in lot unit cost', () => {
    const txs = [
      buy('2024-01-01', 10, 1000, 10), // unitCost = 1010/10 = 101
    ];
    const r = _computeFIFO(txs);
    expect(r.costBasis).toBeCloseTo(1010);
    expect(r.totalFees).toBeCloseTo(10);
  });

  it('throws on oversell when no shares are held (no lots)', () => {
    const txs = [sell('2024-01-01', 10, 1100)];
    expect(() => _computeFIFO(txs)).toThrow(/Oversell detected/);
  });

  it('throws on partial oversell after buys', () => {
    const txs = [buy('2024-01-01', 10, 1000), sell('2024-02-01', 12, 1200)];
    expect(() => _computeFIFO(txs)).toThrow(/Oversell detected/);
  });
});

describe('costbasis: avgco vs fifo divergence', () => {
  it('same sequence yields different realized P&L', () => {
    const txs = [
      buy('2024-01-01', 10, 1000), // lot 1: 10 @ 100
      buy('2024-02-01', 10, 1500), // lot 2: 10 @ 150
      sell('2024-03-01', 10, 1400), // sell 10
    ];

    // Average cost: avg = (1000+1500)/20 = 125; sold 10 @ 125 = 1250; realized = 1400-1250 = 150
    const avg = _computeAvgCost(txs);
    expect(avg.realizedPnL).toBeCloseTo(150);
    expect(avg.shares).toBeCloseTo(10);
    expect(avg.costBasis).toBeCloseTo(1250);

    // FIFO: sell 10 from lot 1 @ 100 = 1000; realized = 1400-1000 = 400
    const fifo = _computeFIFO(txs);
    expect(fifo.realizedPnL).toBeCloseTo(400);
    expect(fifo.shares).toBeCloseTo(10);
    expect(fifo.costBasis).toBeCloseTo(1500);

    // They must differ
    expect(avg.realizedPnL).not.toBeCloseTo(fifo.realizedPnL);
  });

  describe('costbasis: LIFO and HIFO', () => {
    it('LIFO sells newest lots first', () => {
      const txs = [
        buy('2024-01-01', 10, 1000), // lot 1: 10 @ 100
        buy('2024-02-01', 10, 1500), // lot 2: 10 @ 150
        sell('2024-03-01', 10, 1400), // LIFO: consume lot 2 => pnl -100
      ];
      const r = _computeLIFO(txs);
      expect(r.realizedPnL).toBeCloseTo(-100);
      expect(r.shares).toBeCloseTo(10);
      expect(r.costBasis).toBeCloseTo(1000);
    });

    it('HIFO sells highest-cost lots first', () => {
      const txs = [
        buy('2024-01-01', 10, 900), // lot 1: unit 90
        buy('2024-02-01', 10, 1500), // lot 2: unit 150
        buy('2024-03-01', 10, 1100), // lot 3: unit 110
        sell('2024-04-01', 10, 1300), // HIFO: consume lot 2 => pnl -200
      ];
      const r = _computeHIFO(txs);
      expect(r.realizedPnL).toBeCloseTo(-200);
      expect(r.shares).toBeCloseTo(20);
      expect(r.costBasis).toBeCloseTo(2000); // lots 1 + 3
    });
  });
});

describe('computeCostBasis (multi-ISIN)', () => {
  it('groups by ISIN and computes independently', () => {
    const txs: Transaction[] = [
      {
        id: '',
        source: '',
        name: '',
        isin: 'A',
        type: TxType.BUY,
        date: '2024-01-01',
        shares: 10,
        price: 0,
        amount: -1000,
        fee: 0,
        tax: 0,
        currency: 'EUR',
        fxRate: 0,
      },
      {
        id: '',
        source: '',
        name: '',
        isin: 'B',
        type: TxType.BUY,
        date: '2024-01-01',
        shares: 5,
        price: 0,
        amount: -500,
        fee: 0,
        tax: 0,
        currency: 'EUR',
        fxRate: 0,
      },
      {
        id: '',
        source: '',
        name: '',
        isin: 'A',
        type: TxType.SELL,
        date: '2024-02-01',
        shares: -10,
        price: 0,
        amount: 1100,
        fee: 0,
        tax: 0,
        currency: 'EUR',
        fxRate: 0,
      },
    ];
    const result = computeCostBasis(txs, 'avgco');
    expect(result['A'].exited).toBe(true);
    expect(result['A'].realizedPnL).toBeCloseTo(100);
    expect(result['B'].shares).toBeCloseTo(5);
    expect(result['B'].exited).toBe(false);
  });

  it('supports hifo method selection', () => {
    const txs = [
      buy('2024-01-01', 10, 1000),
      buy('2024-02-01', 10, 1500),
      sell('2024-03-01', 10, 1400),
    ];
    const result = computeCostBasis(txs, 'hifo');
    expect(result['IE00B4L5Y983'].realizedPnL).toBeCloseTo(-100);
  });
});

describe('costbasis: SPLIT transaction type', () => {
  function split(date: string, ratio: number): Transaction {
    return {
      id: '',
      source: '',
      name: '',
      isin: 'IE00B4L5Y983',
      type: TxType.SPLIT,
      date,
      shares: ratio,
      price: 0,
      amount: 0,
      fee: 0,
      tax: 0,
      currency: 'EUR',
      fxRate: 0,
    };
  }

  it('avg-cost: 2:1 split doubles shares without changing total cost basis', () => {
    const txs = [
      buy('2024-01-01', 10, 1000), // 10 shares @ avg 100
      split('2024-02-01', 2), // 2:1 split -> 20 shares @ avg 50
    ];
    const r = _computeAvgCost(txs);
    expect(r.shares).toBeCloseTo(20);
    expect(r.costBasis).toBeCloseTo(1000); // unchanged
    expect(r.exited).toBe(false);
  });

  it('avg-cost: 3:2 split adjusts shares correctly', () => {
    const txs = [
      buy('2024-01-01', 10, 1000),
      split('2024-02-01', 1.5), // 3:2 split
    ];
    const r = _computeAvgCost(txs);
    expect(r.shares).toBeCloseTo(15);
    expect(r.costBasis).toBeCloseTo(1000);
  });

  it('avg-cost: sell after split uses post-split share count', () => {
    const txs = [
      buy('2024-01-01', 10, 1000), // 10 shares @ avg 100
      split('2024-02-01', 2), // 20 shares @ avg 50
      sell('2024-03-01', 10, 600), // sell 10 post-split shares; cost = 10 * 50 = 500
    ];
    const r = _computeAvgCost(txs);
    expect(r.shares).toBeCloseTo(10);
    expect(r.realizedPnL).toBeCloseTo(100); // 600 - 500
    expect(r.costBasis).toBeCloseTo(500); // 10 remaining @ 50
  });

  it('fifo: 2:1 split doubles each lot shares, halves unit cost', () => {
    const txs = [
      buy('2024-01-01', 10, 1000), // lot: 10 @ 100
      split('2024-02-01', 2), // lot: 20 @ 50
    ];
    const r = _computeFIFO(txs);
    expect(r.shares).toBeCloseTo(20);
    expect(r.costBasis).toBeCloseTo(1000);
  });

  it('fifo: 3:2 split on two lots', () => {
    const txs = [
      buy('2024-01-01', 10, 1000), // lot 1: 10 @ 100
      buy('2024-02-01', 10, 1500), // lot 2: 10 @ 150
      split('2024-03-01', 1.5), // lot 1: 15 @ 66.67; lot 2: 15 @ 100
    ];
    const r = _computeFIFO(txs);
    expect(r.shares).toBeCloseTo(30);
    expect(r.costBasis).toBeCloseTo(2500); // unchanged
  });

  it('fifo: sell after split uses post-split shares and unit costs', () => {
    const txs = [
      buy('2024-01-01', 10, 1000), // lot: 10 @ 100
      split('2024-02-01', 2), // lot: 20 @ 50
      sell('2024-03-01', 10, 600), // sell 10; cost = 10 * 50 = 500; pnl = 100
    ];
    const r = _computeFIFO(txs);
    expect(r.shares).toBeCloseTo(10);
    expect(r.realizedPnL).toBeCloseTo(100);
    expect(r.costBasis).toBeCloseTo(500);
  });
});

describe('costbasis: mixed-currency FX normalization', () => {
  /** Helper: BUY in a non-EUR currency */
  function buyFx(
    date: string,
    shares: number,
    amount: number,
    currency: string,
    fxRate: number,
    fee = 0,
  ): Transaction {
    return {
      id: '',
      source: '',
      name: '',
      isin: 'IE00B4L5Y983',
      type: TxType.BUY,
      date,
      shares,
      price: 0,
      amount: -amount,
      fee,
      tax: 0,
      currency,
      fxRate,
    };
  }

  /** Helper: SELL in a non-EUR currency */
  function sellFx(
    date: string,
    shares: number,
    amount: number,
    currency: string,
    fxRate: number,
    fee = 0,
  ): Transaction {
    return {
      id: '',
      source: '',
      name: '',
      isin: 'IE00B4L5Y983',
      type: TxType.SELL,
      date,
      shares: -shares,
      price: 0,
      amount,
      fee,
      tax: 0,
      currency,
      fxRate,
    };
  }

  it('avg-cost: USD BUY converts cost basis to EUR via fxRate', () => {
    // 100 USD at fxRate 0.9 → 90 EUR cost
    const txs = [buyFx('2024-01-01', 10, 100, 'USD', 0.9)];
    const r = _computeAvgCost(txs);
    expect(r.costBasis).toBeCloseTo(90);
    expect(r.shares).toBeCloseTo(10);
  });

  it('avg-cost: USD BUY fee converts to EUR via fxRate', () => {
    // amount 100 USD + fee 2 USD, fxRate 0.9 → cost (100+2)*0.9 = 91.8 EUR
    const txs = [buyFx('2024-01-01', 10, 100, 'USD', 0.9, 2)];
    const r = _computeAvgCost(txs);
    expect(r.costBasis).toBeCloseTo(91.8);
    expect(r.totalFees).toBeCloseTo(1.8); // 2 * 0.9
  });

  it('avg-cost: mixed BUY (EUR) + SELL (USD) realizedPnL in EUR', () => {
    // BUY 10 shares for 1000 EUR (EUR, no conversion)
    // SELL 10 shares for 1200 USD at fxRate 0.9 → proceeds 1080 EUR
    // realized P&L = 1080 - 1000 = 80
    const txs = [
      buyFx('2024-01-01', 10, 1000, 'EUR', 1),
      sellFx('2024-02-01', 10, 1200, 'USD', 0.9),
    ];
    const r = _computeAvgCost(txs);
    expect(r.realizedPnL).toBeCloseTo(80);
    expect(r.exited).toBe(true);
  });

  it('fifo: USD BUY converts lot unitCost to EUR', () => {
    // 100 USD for 10 shares, fxRate 0.9 → 90 EUR → 9 EUR/share
    const txs = [buyFx('2024-01-01', 10, 100, 'USD', 0.9)];
    const r = _computeFIFO(txs);
    expect(r.costBasis).toBeCloseTo(90);
    expect(r.shares).toBeCloseTo(10);
  });

  it('fifo: USD BUY + USD SELL computes realized P&L in EUR', () => {
    // BUY 10 shares for 1000 USD at 0.9 → 900 EUR cost (90 EUR/share)
    // SELL 10 shares for 1200 USD at 0.85 → 1020 EUR proceeds
    // realized P&L = 1020 - 900 = 120 EUR
    const txs = [
      buyFx('2024-01-01', 10, 1000, 'USD', 0.9),
      sellFx('2024-02-01', 10, 1200, 'USD', 0.85),
    ];
    const r = _computeFIFO(txs);
    expect(r.realizedPnL).toBeCloseTo(120);
    expect(r.exited).toBe(true);
  });

  it('warns and falls back to raw amount when fxRate is missing for non-EUR tx', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const txs = [buyFx('2024-01-01', 10, 100, 'USD', 0)]; // fxRate = 0 → missing
    const r = _computeAvgCost(txs);
    // Falls back to raw amount (100) with a warning
    expect(r.costBasis).toBeCloseTo(100);
    expect(warnSpy).toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
