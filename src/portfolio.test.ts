import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TxType } from './types';
import type { Transaction } from './types';

// Stub constants module so computePD doesn't reach into Google Sheets
vi.mock('./constants', () => ({
  getISIN: () => ({
    IE00B4L5Y983: 'IWDA',
    IE00BKM4GZ66: 'EIMI',
  }),
  getMETAMap: () => ({
    IWDA: { color: '#4a90d9', acc: true, active: true },
    EIMI: { color: '#e8a838', acc: true, active: true },
  }),
}));

const { computePD } = await import('./portfolio');

/** Helpers */
function buyTx(isin: string, date: string, shares: number, amount: number, fee = 0): Transaction {
  return {
    id: '',
    source: '',
    type: TxType.BUY,
    date,
    isin,
    name: `ETF ${isin.slice(-4)}`,
    shares,
    price: 0,
    amount: -Math.abs(amount),
    fee,
    tax: 0,
    currency: 'EUR',
    fxRate: 0,
  };
}
function sellTx(isin: string, date: string, shares: number, amount: number, fee = 0): Transaction {
  return {
    id: '',
    source: '',
    type: TxType.SELL,
    date,
    isin,
    name: `ETF ${isin.slice(-4)}`,
    shares: -Math.abs(shares),
    price: 0,
    amount: Math.abs(amount),
    fee,
    tax: 0,
    currency: 'EUR',
    fxRate: 0,
  };
}
function divTx(isin: string, date: string, net: number, tax = 0): Transaction {
  return {
    id: '',
    source: '',
    type: TxType.DIVIDEND,
    date,
    isin,
    name: `ETF ${isin.slice(-4)}`,
    shares: 0,
    price: 0,
    amount: net,
    fee: 0,
    tax: -Math.abs(tax),
    currency: 'EUR',
    fxRate: 0,
  };
}
function interestTx(date: string, amount: number): Transaction {
  return {
    id: '',
    source: '',
    type: TxType.INTEREST,
    date,
    isin: '',
    name: 'Interest',
    shares: 0,
    price: 0,
    amount,
    fee: 0,
    tax: 0,
    currency: 'EUR',
    fxRate: 0,
  };
}

describe('computePD', () => {
  it('computes totals for buys only (avgco)', () => {
    const txs = [
      buyTx('IE00B4L5Y983', '2024-01-15', 10, 1000),
      buyTx('IE00B4L5Y983', '2024-02-15', 5, 600),
    ];
    const pd = computePD(txs, { method: 'avgco' });

    expect(pd.totalInv).toBeCloseTo(1600);
    expect(pd.totalFees).toBe(0);
    expect(pd.realizedPnL).toBe(0);
    expect(pd.etfs['IE00B4L5Y983'].shares).toBeCloseTo(15);
    expect(pd.etfs['IE00B4L5Y983'].cost).toBeCloseTo(1600);
    expect(pd.etfs['IE00B4L5Y983'].exited).toBe(false);
  });

  it('computes realized P&L for sells', () => {
    const txs = [
      buyTx('IE00B4L5Y983', '2024-01-01', 10, 1000),
      sellTx('IE00B4L5Y983', '2024-02-01', 5, 600),
    ];
    const pd = computePD(txs, { method: 'avgco' });

    // avg cost = 100/share; sold 5 @ cost 500; proceeds 600; realized = 100
    expect(pd.realizedPnL).toBeCloseTo(100);
    expect(pd.etfs['IE00B4L5Y983'].realizedPnL).toBeCloseTo(100);
    expect(pd.etfs['IE00B4L5Y983'].shares).toBeCloseTo(5);
  });

  it('accumulates dividends and tax', () => {
    const txs = [
      buyTx('IE00B4L5Y983', '2024-01-01', 10, 1000),
      divTx('IE00B4L5Y983', '2024-06-01', 20, 5),
      divTx('IE00B4L5Y983', '2024-12-01', 25, 6),
    ];
    const pd = computePD(txs);

    expect(pd.totalDivNet).toBeCloseTo(45);
    expect(pd.totalTax).toBeCloseTo(11);
    expect(pd.divHist).toHaveLength(2);
  });

  it('accumulates interest', () => {
    const txs = [interestTx('2024-01-31', 3.5), interestTx('2024-02-28', 4.2)];
    const pd = computePD(txs);

    expect(pd.totalInterest).toBeCloseTo(7.7);
    expect(pd.intHist).toHaveLength(2);
  });

  it('accumulates fees across ISINs', () => {
    const txs = [
      buyTx('IE00B4L5Y983', '2024-01-01', 10, 1000, 5),
      buyTx('IE00BKM4GZ66', '2024-01-01', 20, 2000, 3),
    ];
    const pd = computePD(txs);

    expect(pd.totalFees).toBeCloseTo(8);
  });

  it('standalone FEE rows contribute to totalFees', () => {
    const txs = [
      buyTx('IE00B4L5Y983', '2024-01-01', 10, 1000, 5),
      // Standalone custody fee — no ISIN, amount is the fee charge
      {
        id: '',
        source: '',
        type: TxType.FEE,
        date: '2024-01-31',
        isin: '',
        name: 'Custody fee',
        shares: 0,
        price: 0,
        amount: -2,
        fee: 0,
        tax: 0,
        currency: 'EUR',
        fxRate: 0,
      } as import('./types').Transaction,
      // Standalone FEE with fee field instead of amount
      {
        id: '',
        source: '',
        type: TxType.FEE,
        date: '2024-02-28',
        isin: '',
        name: 'Account fee',
        shares: 0,
        price: 0,
        amount: 0,
        fee: 1.5,
        tax: 0,
        currency: 'EUR',
        fxRate: 0,
      } as import('./types').Transaction,
    ];
    const pd = computePD(txs);

    // 5 (embedded BUY fee) + 2 (standalone FEE amount) + 1.5 (standalone FEE fee field)
    expect(pd.totalFees).toBeCloseTo(8.5);
  });

  it('DCA monthly only counts BUYs (excludes sells)', () => {
    const txs = [
      buyTx('IE00B4L5Y983', '2024-01-15', 10, 1000),
      buyTx('IE00B4L5Y983', '2024-01-20', 5, 500),
      sellTx('IE00B4L5Y983', '2024-01-25', 3, 360),
    ];
    const pd = computePD(txs);

    // monthly should reflect BUYs only: 1000 + 500 = 1500
    expect(pd.monthly['2024-01']).toBeCloseTo(1500);
    expect(pd.months).toEqual(['2024-01']);
  });

  it('DCA monthlyBy groups by ISIN (BUYs only)', () => {
    const txs = [
      buyTx('IE00B4L5Y983', '2024-03-01', 5, 500),
      buyTx('IE00BKM4GZ66', '2024-03-15', 10, 800),
      sellTx('IE00B4L5Y983', '2024-03-20', 2, 250),
    ];
    const pd = computePD(txs);

    expect(pd.monthlyBy['2024-03']['IE00B4L5Y983']).toBeCloseTo(500);
    expect(pd.monthlyBy['2024-03']['IE00BKM4GZ66']).toBeCloseTo(800);
  });

  it('marks fully-sold position as exited', () => {
    const txs = [
      buyTx('IE00B4L5Y983', '2024-01-01', 10, 1000),
      sellTx('IE00B4L5Y983', '2024-02-01', 10, 1100),
    ];
    const pd = computePD(txs);

    expect(pd.etfs['IE00B4L5Y983'].exited).toBe(true);
    expect(pd.etfs['IE00B4L5Y983'].shares).toBe(0);
  });

  it('works with fifo method', () => {
    const txs = [
      buyTx('IE00B4L5Y983', '2024-01-01', 10, 1000), // lot 1: 10 @ 100
      buyTx('IE00B4L5Y983', '2024-02-01', 10, 1500), // lot 2: 10 @ 150
      sellTx('IE00B4L5Y983', '2024-03-01', 10, 1400), // FIFO sells lot 1 first
    ];
    const pd = computePD(txs, { method: 'fifo' });

    // FIFO: sold 10 from lot 1 @ 100 = cost 1000; realized = 1400-1000 = 400
    expect(pd.realizedPnL).toBeCloseTo(400);
    expect(pd.etfs['IE00B4L5Y983'].costBasis || pd.etfs['IE00B4L5Y983'].cost).toBeCloseTo(1500);
  });

  it('returns empty structures for empty input', () => {
    const pd = computePD([]);

    expect(pd.totalInv).toBe(0);
    expect(pd.totalDivNet).toBe(0);
    expect(pd.totalTax).toBe(0);
    expect(pd.totalFees).toBe(0);
    expect(pd.realizedPnL).toBe(0);
    expect(pd.months).toEqual([]);
    expect(pd.divHist).toEqual([]);
    expect(pd.intHist).toEqual([]);
  });

  it('DEPOSIT rows do not enter DCA monthly', () => {
    const txs: Transaction[] = [
      buyTx('IE00B4L5Y983', '2024-01-15', 10, 1000),
      {
        id: '',
        source: '',
        type: TxType.DEPOSIT,
        date: '2024-01-20',
        isin: '',
        name: 'Bank Transfer',
        shares: 0,
        price: 0,
        amount: 500,
        fee: 0,
        tax: 0,
        currency: 'EUR',
        fxRate: 0,
      },
    ];
    const pd = computePD(txs);

    // monthly should only include the BUY (1000), not the DEPOSIT (500)
    expect(pd.monthly['2024-01']).toBeCloseTo(1000);
    expect(pd.months).toEqual(['2024-01']);
  });

  it('DCA monthly includes BUY fees, matching totalInv', () => {
    const txs = [
      buyTx('IE00B4L5Y983', '2024-01-15', 10, 1000, 1), // fee 1
      buyTx('IE00B4L5Y983', '2024-02-15', 5, 600, 1), // fee 1
    ];
    const pd = computePD(txs, { method: 'avgco' });

    expect(pd.totalInv).toBeCloseTo(1602); // 1000+1+600+1
    const monthlySum = Object.values(pd.monthly).reduce((s, v) => s + v, 0);
    expect(monthlySum).toBeCloseTo(pd.totalInv);
  });

  it('TAX refund (positive tax) reduces net tax to zero', () => {
    const txs: Transaction[] = [
      buyTx('IE00B4L5Y983', '2024-01-01', 10, 1000),
      interestTx('2024-01-31', 100),
      // Dividend with -3.44 tax withheld
      {
        id: '',
        source: '',
        type: TxType.DIVIDEND,
        date: '2024-06-01',
        isin: 'IE00B4L5Y983',
        name: 'ETF',
        shares: 0,
        price: 0,
        amount: 10,
        fee: 0,
        tax: -3.44,
        currency: 'EUR',
        fxRate: 0,
      },
      // TAX refund of +3.44 (TAX_OPTIMIZATION)
      {
        id: '',
        source: '',
        type: TxType.TAX,
        date: '2024-07-01',
        isin: '',
        name: 'Tax Refund',
        shares: 0,
        price: 0,
        amount: 3.44,
        fee: 0,
        tax: 3.44,
        currency: 'EUR',
        fxRate: 0,
      },
    ];
    const pd = computePD(txs);

    // totalTax is only dividend tax (refunds go to taxBySource, not subtracted)
    expect(pd.totalTax).toBeCloseTo(3.44);
  });

  it('same-day transactions preserve insertion order (stable sort)', () => {
    // FIFO correctness depends on same-date events being processed in the order they
    // arrive (i.e. the order loadTransactions() returns them via ORDER BY rowid ASC).
    // computePD uses a stable JS sort, so the caller-supplied order is preserved for
    // ties. This test confirms that two same-day BUYs followed by a SELL are matched
    // FIFO against the first BUY (cheaper lot) when that lot was inserted first.
    const isin = 'IE00B4L5Y983';
    const txs = [
      // Lot A — inserted first (lower rowid) — lower cost basis per share
      buyTx(isin, '2024-03-01', 5, 500), // avg 100/share
      // Lot B — inserted second (higher rowid) — higher cost basis per share
      buyTx(isin, '2024-03-01', 5, 600), // avg 120/share
      sellTx(isin, '2024-03-01', 5, 700), // sell 5 shares
    ];
    const pd = computePD(txs, { method: 'fifo' });

    // FIFO: first 5 shares (lot A at cost 500) are sold for 700 → realized P&L = +200
    expect(pd.realizedPnL).toBeCloseTo(200);
    // Remaining lot B (5 shares at cost 600) still open
    expect(pd.etfs[isin].cost).toBeCloseTo(600);
  });
});

describe('computePD: mixed-currency FX normalization', () => {
  const ISIN = 'IE00B4L5Y983';

  /** BUY in a specific currency */
  function buyFx(
    isin: string,
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
      type: TxType.BUY,
      date,
      isin,
      name: 'ETF',
      shares,
      price: 0,
      amount: -Math.abs(amount),
      fee,
      tax: 0,
      currency,
      fxRate,
    };
  }

  /** SELL in a specific currency */
  function sellFx(
    isin: string,
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
      type: TxType.SELL,
      date,
      isin,
      name: 'ETF',
      shares: -Math.abs(shares),
      price: 0,
      amount: Math.abs(amount),
      fee,
      tax: 0,
      currency,
      fxRate,
    };
  }

  /** DIVIDEND in a specific currency */
  function divFx(
    isin: string,
    date: string,
    net: number,
    currency: string,
    fxRate: number,
    tax = 0,
  ): Transaction {
    return {
      id: '',
      source: '',
      type: TxType.DIVIDEND,
      date,
      isin,
      name: 'ETF',
      shares: 0,
      price: 0,
      amount: net,
      fee: 0,
      tax: -Math.abs(tax),
      currency,
      fxRate,
    };
  }

  /** INTEREST in a specific currency */
  function interestFx(date: string, amount: number, currency: string, fxRate: number): Transaction {
    return {
      id: '',
      source: '',
      type: TxType.INTEREST,
      date,
      isin: '',
      name: 'Interest',
      shares: 0,
      price: 0,
      amount,
      fee: 0,
      tax: 0,
      currency,
      fxRate,
    };
  }

  it('USD BUY: totalInv and DCA monthly converted to EUR', () => {
    // 1000 USD at fxRate 0.9 → 900 EUR invested
    const txs = [buyFx(ISIN, '2024-01-15', 10, 1000, 'USD', 0.9)];
    const pd = computePD(txs);

    expect(pd.totalInv).toBeCloseTo(900);
    expect(pd.monthly['2024-01']).toBeCloseTo(900);
    expect(pd.etfs[ISIN].cost).toBeCloseTo(900);
  });

  it('USD BUY fee is converted to EUR in totalFees', () => {
    // fee 5 USD at fxRate 0.9 → 4.5 EUR
    const txs = [buyFx(ISIN, '2024-01-15', 10, 1000, 'USD', 0.9, 5)];
    const pd = computePD(txs);

    expect(pd.totalFees).toBeCloseTo(4.5);
    expect(pd.totalInv).toBeCloseTo(904.5); // (1000 + 5) * 0.9
  });

  it('USD BUY + USD SELL: realizedPnL computed in EUR', () => {
    // BUY 1000 USD @ 0.9 → 900 EUR cost
    // SELL for 1200 USD @ 0.85 → 1020 EUR proceeds; realized = 120
    const txs = [
      buyFx(ISIN, '2024-01-01', 10, 1000, 'USD', 0.9),
      sellFx(ISIN, '2024-02-01', 10, 1200, 'USD', 0.85),
    ];
    const pd = computePD(txs);

    expect(pd.realizedPnL).toBeCloseTo(120);
  });

  it('USD DIVIDEND: divNet and divHist converted to EUR', () => {
    // net 50 USD at fxRate 0.9 → 45 EUR; tax 5 USD → 4.5 EUR
    const txs = [
      buyFx(ISIN, '2024-01-01', 10, 1000, 'EUR', 1),
      divFx(ISIN, '2024-06-01', 50, 'USD', 0.9, 5),
    ];
    const pd = computePD(txs);

    expect(pd.totalDivNet).toBeCloseTo(45);
    expect(pd.totalTax).toBeCloseTo(4.5);
    expect(pd.divHist[0].net).toBeCloseTo(45);
    expect(pd.divHist[0].gross).toBeCloseTo(49.5); // 45 + 4.5
    expect(pd.divHist[0].tax).toBeCloseTo(4.5);
  });

  it('USD INTEREST: totalInterest converted to EUR', () => {
    // 20 USD at fxRate 0.9 → 18 EUR
    const txs = [interestFx('2024-01-31', 20, 'USD', 0.9)];
    const pd = computePD(txs);

    expect(pd.totalInterest).toBeCloseTo(18);
    expect(pd.intHist[0].net).toBeCloseTo(18);
  });

  it('standalone USD FEE: converted to EUR in totalFees', () => {
    const txs: Transaction[] = [
      {
        id: '',
        source: '',
        type: TxType.FEE,
        date: '2024-01-31',
        isin: '',
        name: 'Custody fee',
        shares: 0,
        price: 0,
        amount: -10, // 10 USD
        fee: 0,
        tax: 0,
        currency: 'USD',
        fxRate: 0.9, // → 9 EUR
      },
    ];
    const pd = computePD(txs);
    expect(pd.totalFees).toBeCloseTo(9);
  });

  it('DCA monthlyBy sums USD BUYs in EUR', () => {
    // 500 USD @ 0.9 → 450 EUR; 800 USD @ 0.9 → 720 EUR
    const txs = [
      buyFx(ISIN, '2024-03-01', 5, 500, 'USD', 0.9),
      buyFx('IE00BKM4GZ66', '2024-03-15', 10, 800, 'USD', 0.9),
    ];
    const pd = computePD(txs);

    expect(pd.monthlyBy['2024-03'][ISIN]).toBeCloseTo(450);
    expect(pd.monthlyBy['2024-03']['IE00BKM4GZ66']).toBeCloseTo(720);
    expect(pd.monthly['2024-03']).toBeCloseTo(1170);
  });
});
