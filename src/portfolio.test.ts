import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TxType } from './model/tx';
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

    // Net tax: 3.44 (from div) - 3.44 (refund) = 0
    expect(pd.totalTax).toBeCloseTo(0);
  });
});
