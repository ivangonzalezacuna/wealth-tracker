import { describe, it, expect } from 'vitest';
import { buildTaxSummaryCsv } from './taxExport';
import type { Transaction } from './types';

const BASE_TX: Omit<Transaction, 'id' | 'date' | 'type' | 'amount'> = {
  source: 'TR',
  isin: 'IE00B4L5Y983',
  name: 'iShares MSCI World',
  shares: 0,
  price: 0,
  fee: 0,
  tax: 0,
  currency: 'EUR',
  fxRate: 1,
};

const txs: Transaction[] = [
  // 2023 - BUY (prior year, used to build cost basis)
  {
    ...BASE_TX,
    id: 't1',
    date: '2023-01-10',
    type: 'BUY',
    shares: 10,
    price: 100,
    amount: 1000,
    fee: 1,
  },
  // 2024 - SELL
  {
    ...BASE_TX,
    id: 't2',
    date: '2024-03-05',
    type: 'SELL',
    shares: 5,
    price: 120,
    amount: 600,
    fee: 1,
  },
  // 2024 - DIVIDEND
  {
    ...BASE_TX,
    id: 't3',
    date: '2024-06-15',
    type: 'DIVIDEND',
    shares: 0,
    price: 0,
    amount: 50,
    tax: 10,
    fee: 0,
  },
  // 2024 - INTEREST
  {
    ...BASE_TX,
    id: 't4',
    date: '2024-09-01',
    type: 'INTEREST',
    isin: '',
    name: 'Savings',
    source: 'N26',
    shares: 0,
    price: 0,
    amount: 20,
    tax: 5,
    fee: 0,
  },
  // 2024 - FEE
  {
    ...BASE_TX,
    id: 't5',
    date: '2024-12-01',
    type: 'FEE',
    isin: '',
    name: 'Account fee',
    shares: 0,
    price: 0,
    amount: 5,
    fee: 0,
    tax: 0,
  },
];

describe('buildTaxSummaryCsv', () => {
  it('includes all five sections', () => {
    const csv = buildTaxSummaryCsv({ year: 2024, txs });
    expect(csv).toContain('# SECTION 1: Realized Gains / Losses');
    expect(csv).toContain('# SECTION 2: Dividend Income');
    expect(csv).toContain('# SECTION 3: Interest Income');
    expect(csv).toContain('# SECTION 4: Fees and Taxes');
    expect(csv).toContain('# SECTION 5: Summary');
  });

  it('computes realized gain correctly (avg cost)', () => {
    // BUY 10 shares at cost 1001 (1000 + fee 1). Avg cost = 100.1/share.
    // SELL 5 shares: proceeds = 600 - 1 (fee) = 599. Cost = 5 * 100.1 = 500.5. Gain = 98.5
    const csv = buildTaxSummaryCsv({ year: 2024, txs });
    expect(csv).toContain('98.50');
  });

  it('includes dividend gross (net + tax) and net separately', () => {
    const csv = buildTaxSummaryCsv({ year: 2024, txs });
    // Gross = 50 + 10 = 60, tax = 10, net = 50
    expect(csv).toContain('60.00');
    expect(csv).toContain('10.00');
    expect(csv).toContain('50.00');
  });

  it('includes interest income', () => {
    const csv = buildTaxSummaryCsv({ year: 2024, txs });
    // Gross = 20 + 5 = 25
    expect(csv).toContain('25.00');
    expect(csv).toContain('20.00');
  });

  it('includes fees', () => {
    const csv = buildTaxSummaryCsv({ year: 2024, txs });
    expect(csv).toContain('Account fee');
    expect(csv).toContain('5.00');
  });

  it('shows empty section messages when no transactions exist for that type', () => {
    const csv = buildTaxSummaryCsv({ year: 2025, txs });
    expect(csv).toContain('(no SELL transactions in this year)');
    expect(csv).toContain('(no DIVIDEND transactions in this year)');
    expect(csv).toContain('(no INTEREST transactions in this year)');
    expect(csv).toContain('(no FEE or TAX transactions in this year)');
  });

  it('excludes transactions from other years', () => {
    const csv = buildTaxSummaryCsv({ year: 2023, txs });
    // Only BUY in 2023, no SELL - should show zero total gain/loss
    expect(csv).toContain('(no SELL transactions in this year)');
  });

  it('escapes CSV fields containing commas', () => {
    const withComma: Transaction[] = [
      {
        ...BASE_TX,
        id: 'tc1',
        date: '2024-01-01',
        type: 'FEE',
        name: 'Fee, account maintenance',
        isin: '',
        amount: 3,
        shares: 0,
        price: 0,
        fee: 0,
        tax: 0,
      },
    ];
    const csv = buildTaxSummaryCsv({ year: 2024, txs: withComma });
    expect(csv).toContain('"Fee, account maintenance"');
  });
});
