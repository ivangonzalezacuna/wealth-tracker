import { describe, it, expect } from 'vitest';
import { computeCostBasis, _computeAvgCost, _computeFIFO } from './costbasis';
import { TxType } from './tx';
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

  it('sell with no shares is safely ignored', () => {
    const txs = [sell('2024-01-01', 10, 1100)];
    const r = _computeAvgCost(txs);
    expect(r.shares).toBe(0);
    expect(r.costBasis).toBe(0);
    expect(r.realizedPnL).toBe(0);
    expect(r.exited).toBe(true);
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

  it('sell with no shares is safely ignored (no lots)', () => {
    const txs = [sell('2024-01-01', 10, 1100)];
    const r = _computeFIFO(txs);
    expect(r.shares).toBe(0);
    expect(r.realizedPnL).toBe(0);
    expect(r.exited).toBe(true);
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
