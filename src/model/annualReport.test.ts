import { describe, it, expect } from 'vitest';
import { buildAnnualReport, renderAnnualReportHtml } from './annualReport';
import type { Transaction, Snapshot, Holding, Account } from '../types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const accounts: Account[] = [
  { id: 'acct-1', label: 'Investment Account', isPrimaryInvestment: true, moneyType: 'investment' },
  { id: 'acct-2', label: 'Savings Account', moneyType: 'savings' },
];

const holdings: Holding[] = [
  {
    isin: 'IE00B4L5Y983',
    name: 'iShares Core MSCI World',
    shortName: 'MSCI World',
    color: '#1e90ff',
    acc: true,
    active: true,
    assetClass: 'equity',
    region: 'global',
    foldInto: '',
    order: 0,
  },
  {
    isin: 'IE00BKX55T58',
    name: 'Vanguard FTSE All-World',
    shortName: 'FTSE AW',
    color: '#ff6a00',
    acc: false,
    active: true,
    assetClass: 'equity',
    region: 'global',
    foldInto: '',
    order: 1,
  },
];

const snapshots: Snapshot[] = [
  { date: '2023-12-01', 'acct-1': 80_000, 'acct-2': 15_000 },
  { date: '2024-06-01', 'acct-1': 90_000, 'acct-2': 16_000 },
  { date: '2024-12-01', 'acct-1': 100_000, 'acct-2': 17_000 },
  { date: '2025-06-01', 'acct-1': 110_000, 'acct-2': 18_000 },
];

const baseTxs: Transaction[] = [
  {
    id: 'buy-1',
    date: '2023-01-15',
    source: 'broker',
    type: 'BUY',
    name: 'iShares Core MSCI World',
    isin: 'IE00B4L5Y983',
    shares: 10,
    price: 70,
    amount: 700,
    fee: 0,
    tax: 0,
    currency: 'EUR',
    fxRate: 1,
  },
  {
    id: 'buy-2',
    date: '2023-06-01',
    source: 'broker',
    type: 'BUY',
    name: 'Vanguard FTSE All-World',
    isin: 'IE00BKX55T58',
    shares: 5,
    price: 100,
    amount: 500,
    fee: 0,
    tax: 0,
    currency: 'EUR',
    fxRate: 1,
  },
];

// ── buildAnnualReport ──────────────────────────────────────────────────────────

describe('buildAnnualReport — snapshot & net worth', () => {
  it('picks the last snapshot on or before year end', () => {
    const report = buildAnnualReport(2024, baseTxs, snapshots, holdings, accounts);
    expect(report.totalNetWorth).toBe(117_000); // 100k + 17k from 2024-12-01
  });

  it('maps account IDs to labels correctly', () => {
    const report = buildAnnualReport(2024, baseTxs, snapshots, holdings, accounts);
    expect(report.accounts[0].label).toBe('Investment Account');
    expect(report.accounts[0].value).toBe(100_000);
    expect(report.accounts[1].label).toBe('Savings Account');
    expect(report.accounts[1].value).toBe(17_000);
  });

  it('reports zero net worth when no snapshot exists for the year', () => {
    const report = buildAnnualReport(2020, baseTxs, snapshots, holdings, accounts);
    expect(report.totalNetWorth).toBe(0);
  });
});

describe('buildAnnualReport — report completeness', () => {
  it('marks report as partial when year has ended but no 31 Dec snapshot exists', () => {
    const report = buildAnnualReport(2024, baseTxs, snapshots, holdings, accounts);
    expect(report.hasReachedYearEnd).toBe(true);
    expect(report.hasClosingSnapshotAtYearEnd).toBe(false);
    expect(report.isPartialYearReport).toBe(true);
    expect(report.isFullYearReport).toBe(false);
    expect(report.reportEndDate).toBe('2024-12-01');
  });

  it('marks report as full-year when year ended and 31 Dec snapshot exists', () => {
    const fullSnapshots: Snapshot[] = [
      { date: '2019-12-31', 'acct-1': 40_000, 'acct-2': 10_000 },
      { date: '2020-12-31', 'acct-1': 50_000, 'acct-2': 11_000 },
    ];
    const report = buildAnnualReport(2020, baseTxs, fullSnapshots, holdings, accounts);
    expect(report.hasReachedYearEnd).toBe(true);
    expect(report.hasClosingSnapshotAtYearEnd).toBe(true);
    expect(report.isPartialYearReport).toBe(false);
    expect(report.isFullYearReport).toBe(true);
    expect(report.reportEndDate).toBe('2020-12-31');
  });
});

describe('buildAnnualReport — dividends', () => {
  const divTxs: Transaction[] = [
    {
      id: 'div-1',
      date: '2024-03-10',
      source: 'broker',
      type: 'DIVIDEND',
      name: 'Vanguard FTSE All-World',
      isin: 'IE00BKX55T58',
      shares: 0,
      price: 0,
      amount: 85,
      fee: 0,
      tax: -15, // 15 EUR withholding tax (negative = paid)
      currency: 'EUR',
      fxRate: 1,
    },
    {
      id: 'div-2',
      date: '2024-09-10',
      source: 'broker',
      type: 'DIVIDEND',
      name: 'Vanguard FTSE All-World',
      isin: 'IE00BKX55T58',
      shares: 0,
      price: 0,
      amount: 85,
      fee: 0,
      tax: -15,
      currency: 'EUR',
      fxRate: 1,
    },
  ];

  it('aggregates dividends by ISIN and totals correctly', () => {
    const report = buildAnnualReport(2024, [...baseTxs, ...divTxs], snapshots, holdings, accounts);
    expect(report.dividends).toHaveLength(1);
    expect(report.dividends[0].isin).toBe('IE00BKX55T58');
    expect(report.dividends[0].net).toBeCloseTo(170, 1); // 85 + 85
    expect(report.dividends[0].tax).toBeCloseTo(30, 1); // 15 + 15
    expect(report.dividends[0].gross).toBeCloseTo(200, 1); // 100 + 100
    expect(report.totalDividendNet).toBeCloseTo(170, 1);
  });

  it('excludes dividends outside the year', () => {
    const report = buildAnnualReport(2023, [...baseTxs, ...divTxs], snapshots, holdings, accounts);
    expect(report.dividends).toHaveLength(0);
  });

  it('resolves holding name from holdings array', () => {
    const report = buildAnnualReport(2024, [...baseTxs, ...divTxs], snapshots, holdings, accounts);
    expect(report.dividends[0].name).toBe('Vanguard FTSE All-World');
  });
});

describe('buildAnnualReport — interest', () => {
  const intTxs: Transaction[] = [
    {
      id: 'int-1',
      date: '2024-04-01',
      source: 'savings-bank',
      type: 'INTEREST',
      name: 'Interest',
      isin: '',
      shares: 0,
      price: 0,
      amount: 200,
      fee: 0,
      tax: -40, // 40 EUR withholding tax
      currency: 'EUR',
      fxRate: 1,
    },
  ];

  it('aggregates interest by source', () => {
    const report = buildAnnualReport(2024, [...baseTxs, ...intTxs], snapshots, holdings, accounts);
    expect(report.interest).toHaveLength(1);
    expect(report.interest[0].source).toBe('savings-bank');
    expect(report.interest[0].net).toBeCloseTo(200, 1);
    expect(report.interest[0].tax).toBeCloseTo(40, 1);
    expect(report.interest[0].gross).toBeCloseTo(240, 1); // net - taxRaw = 200 - (-40)
  });

  it('totals interest fields correctly', () => {
    const report = buildAnnualReport(2024, [...baseTxs, ...intTxs], snapshots, holdings, accounts);
    expect(report.totalInterestNet).toBeCloseTo(200, 1);
    expect(report.totalInterestTax).toBeCloseTo(40, 1);
    expect(report.totalInterestGross).toBeCloseTo(240, 1);
  });
});

describe('buildAnnualReport — realised gains', () => {
  const sellTxs: Transaction[] = [
    {
      id: 'sell-1',
      date: '2024-05-01',
      source: 'broker',
      type: 'SELL',
      name: 'iShares Core MSCI World',
      isin: 'IE00B4L5Y983',
      shares: 5,
      price: 100,
      amount: 500,
      fee: 0,
      tax: 0,
      currency: 'EUR',
      fxRate: 1,
    },
  ];

  it('computes year-specific realised gain (selling at a higher price than buy)', () => {
    // Bought 10 shares at €70 each → avg cost €70. Sold 5 at €100 → gain = (100-70)*5 = 150
    const report = buildAnnualReport(2024, [...baseTxs, ...sellTxs], snapshots, holdings, accounts);
    const isinEntry = report.holdings.find((h) => h.isin === 'IE00B4L5Y983');
    expect(isinEntry).toBeDefined();
    expect(isinEntry!.yearRealisedGain).toBeCloseTo(150, 1);
    expect(report.totalYearRealisedGains).toBeCloseTo(150, 1);
  });

  it('does not include gains from sells before the year', () => {
    const earlyTxs = [...baseTxs, { ...sellTxs[0], id: 'sell-early', date: '2022-05-01' }];
    const report = buildAnnualReport(2024, earlyTxs, snapshots, holdings, accounts);
    const isinEntry = report.holdings.find((h) => h.isin === 'IE00B4L5Y983');
    // Gain happened in 2022, so yearRealisedGain for 2024 should be 0
    expect(isinEntry?.yearRealisedGain ?? 0).toBe(0);
  });
});

describe('buildAnnualReport — dividends with refunds', () => {
  it('treats a positive tx.tax on a dividend as a refund (reduces total)', () => {
    const txs: Transaction[] = [
      {
        id: 'div-normal',
        date: '2024-03-01',
        source: 'broker',
        type: 'DIVIDEND',
        name: 'Vanguard FTSE All-World',
        isin: 'IE00BKX55T58',
        shares: 0,
        price: 0,
        amount: 85,
        fee: 0,
        tax: -15, // 15 EUR withheld
        currency: 'EUR',
        fxRate: 1,
      },
      {
        id: 'div-refund',
        date: '2024-09-01',
        source: 'broker',
        type: 'DIVIDEND',
        name: 'Vanguard FTSE All-World',
        isin: 'IE00BKX55T58',
        shares: 0,
        price: 0,
        amount: 10,
        fee: 0,
        tax: 8, // 8 EUR refunded
        currency: 'EUR',
        fxRate: 1,
      },
    ];
    const report = buildAnnualReport(2024, [...baseTxs, ...txs], snapshots, holdings, accounts);
    // net tax paid = 15 - 8 = 7
    expect(report.totalDividendTax).toBeCloseTo(7, 1);
  });
});

describe('buildAnnualReport — standalone TAX refunds', () => {
  it('treats a negative standalone TAX transaction as a refund', () => {
    const txs: Transaction[] = [
      {
        id: 'tax-paid',
        date: '2024-01-31',
        source: 'broker',
        type: 'TAX',
        name: 'Capital gains tax',
        isin: '',
        shares: 0,
        price: 0,
        amount: 100,
        fee: 0,
        tax: 100,
        currency: 'EUR',
        fxRate: 1,
      },
      {
        id: 'tax-refund',
        date: '2024-06-30',
        source: 'broker',
        type: 'TAX',
        name: 'Tax refund',
        isin: '',
        shares: 0,
        price: 0,
        amount: -30,
        fee: 0,
        tax: -30, // refund
        currency: 'EUR',
        fxRate: 1,
      },
    ];
    const report = buildAnnualReport(2024, [...baseTxs, ...txs], snapshots, holdings, accounts);
    expect(report.standaloneTaxTotal).toBeCloseTo(70, 1); // 100 - 30
    expect(report.totalTax).toBeCloseTo(70, 1);
  });
});

describe('buildAnnualReport — total tax', () => {
  it('sums dividend tax, interest tax, and standalone TAX transactions', () => {
    const taxTxs: Transaction[] = [
      {
        id: 'tax-1',
        date: '2024-01-31',
        source: 'broker',
        type: 'TAX',
        name: 'Capital gains tax',
        isin: '',
        shares: 0,
        price: 0,
        amount: 50,
        fee: 0,
        tax: 50,
        currency: 'EUR',
        fxRate: 1,
      },
    ];
    const divTx: Transaction = {
      id: 'div-tax',
      date: '2024-03-01',
      source: 'broker',
      type: 'DIVIDEND',
      name: 'Div',
      isin: 'IE00BKX55T58',
      shares: 0,
      price: 0,
      amount: 90,
      fee: 0,
      tax: -10,
      currency: 'EUR',
      fxRate: 1,
    };
    const report = buildAnnualReport(
      2024,
      [...baseTxs, ...taxTxs, divTx],
      snapshots,
      holdings,
      accounts,
    );
    expect(report.totalTax).toBeCloseTo(60, 1); // 10 (dividend WHT) + 50 (standalone)
  });
});

// ── renderAnnualReportHtml ─────────────────────────────────────────────────────

describe('renderAnnualReportHtml', () => {
  it('includes the year in the title and heading', () => {
    const report = buildAnnualReport(2024, baseTxs, snapshots, holdings, accounts);
    const html = renderAnnualReportHtml(report, 'EUR');
    expect(html).toContain('Annual Portfolio Report');
    expect(html).toContain('2024');
  });

  it('contains each account label', () => {
    const report = buildAnnualReport(2024, baseTxs, snapshots, holdings, accounts);
    const html = renderAnnualReportHtml(report, 'EUR');
    expect(html).toContain('Investment Account');
    expect(html).toContain('Savings Account');
  });

  it('contains holding ISINs when holdings are present', () => {
    const report = buildAnnualReport(2024, baseTxs, snapshots, holdings, accounts);
    const html = renderAnnualReportHtml(report, 'EUR');
    expect(html).toContain('IE00B4L5Y983');
    expect(html).toContain('IE00BKX55T58');
  });

  it('contains the currency symbol in table headers', () => {
    const report = buildAnnualReport(2024, baseTxs, snapshots, holdings, accounts);
    const html = renderAnnualReportHtml(report, 'EUR');
    expect(html).toContain('EUR');
  });

  it('is valid self-contained HTML (has doctype and closing html tag)', () => {
    const report = buildAnnualReport(2024, baseTxs, snapshots, holdings, accounts);
    const html = renderAnnualReportHtml(report, 'EUR');
    expect(html.trimStart()).toMatch(/^<!DOCTYPE html>/i);
    expect(html.trimEnd()).toMatch(/<\/html>$/i);
  });

  it('includes A4 page model via @page rule', () => {
    const report = buildAnnualReport(2024, baseTxs, snapshots, holdings, accounts);
    const html = renderAnnualReportHtml(report, 'EUR');
    expect(html).toContain('@page');
    expect(html).toContain('A4');
  });

  it('includes light-theme colour tokens', () => {
    const report = buildAnnualReport(2024, baseTxs, snapshots, holdings, accounts);
    const html = renderAnnualReportHtml(report, 'EUR');
    // Frozen light palette must be embedded
    expect(html).toContain('--surface:');
    expect(html).toContain('--brand:');
    expect(html).toContain('--ink:');
  });

  it('includes thead with display:table-header-group for repeated print headers', () => {
    const report = buildAnnualReport(2024, baseTxs, snapshots, holdings, accounts);
    const html = renderAnnualReportHtml(report, 'EUR');
    expect(html).toContain('display: table-header-group');
  });

  it('includes a Yearly Summary section', () => {
    const report = buildAnnualReport(2024, baseTxs, snapshots, holdings, accounts);
    const html = renderAnnualReportHtml(report, 'EUR');
    expect(html).toContain('Yearly Summary');
    expect(html).toContain('Period breakdown');
    expect(html).toContain('Final report totals');
    expect(html).toContain('Opening net worth');
  });

  it('shows opening vs closing net worth difference in summary', () => {
    const report = buildAnnualReport(2024, baseTxs, snapshots, holdings, accounts);
    expect(report.openingNetWorth).toBe(95_000); // 80k + 15k from 2023-12-01
    expect(report.totalNetWorth).toBe(117_000);
    const html = renderAnnualReportHtml(report, 'EUR');
    expect(html).toContain('Net worth change');
  });

  it('labels incomplete years as partial reports', () => {
    const report = buildAnnualReport(2024, baseTxs, snapshots, holdings, accounts);
    const html = renderAnnualReportHtml(report, 'EUR');
    expect(report.isPartialYearReport).toBe(true);
    expect(html).toContain('Annual Portfolio Report 2024 (Partial)');
    expect(html).toContain('Partial report');
    expect(html).toContain('Net worth at report end');
  });

  it('includes tax sign explanation in tax summary', () => {
    const report = buildAnnualReport(
      2024,
      [
        ...baseTxs,
        {
          id: 'tax-legend',
          date: '2024-05-01',
          source: 'broker',
          type: 'TAX',
          name: 'Tax row',
          isin: '',
          shares: 0,
          price: 0,
          amount: 20,
          fee: 0,
          tax: 20,
          currency: 'EUR',
          fxRate: 1,
        },
      ],
      snapshots,
      holdings,
      accounts,
    );
    const html = renderAnnualReportHtml(report, 'EUR');
    expect(html).toContain(
      'Tax sign convention: positive values = tax paid, negative values = tax refund received back.',
    );
    expect(html).toContain('Total taxes (signed)');
  });
});

// ── buildAnnualReport — openingNetWorth ──────────────────────────────────────

describe('buildAnnualReport — openingNetWorth', () => {
  it('uses the last snapshot on or before the previous year end', () => {
    // 2023-12-01 snapshot: acct-1=80k, acct-2=15k → openingNetWorth for 2024 = 95k
    const report = buildAnnualReport(2024, baseTxs, snapshots, holdings, accounts);
    expect(report.openingNetWorth).toBe(95_000);
  });

  it('is zero when no snapshot exists before the year', () => {
    // No snapshot before 2022
    const report = buildAnnualReport(2022, baseTxs, snapshots, holdings, accounts);
    expect(report.openingNetWorth).toBe(0);
  });

  it('does not include snapshots from the current year in opening net worth', () => {
    // 2024-06-01 is inside 2024 and must NOT count as opening for 2024
    const report = buildAnnualReport(2024, baseTxs, snapshots, holdings, accounts);
    // opening should be 2023-12-01 (95k), not 2024-06-01 (106k)
    expect(report.openingNetWorth).toBe(95_000);
  });
});

// ── buildAnnualReport — standaloneTaxTotal ───────────────────────────────────

describe('buildAnnualReport — standaloneTaxTotal', () => {
  it('counts standalone TAX transactions separately from WHT', () => {
    const taxTx: Transaction = {
      id: 'tax-standalone',
      date: '2024-06-01',
      source: 'broker',
      type: 'TAX',
      name: 'Capital gains tax',
      isin: '',
      shares: 0,
      price: 0,
      amount: 75,
      fee: 0,
      tax: 75,
      currency: 'EUR',
      fxRate: 1,
    };
    const divTx: Transaction = {
      id: 'div-wht',
      date: '2024-03-01',
      source: 'broker',
      type: 'DIVIDEND',
      name: 'Div',
      isin: 'IE00BKX55T58',
      shares: 0,
      price: 0,
      amount: 90,
      fee: 0,
      tax: -10,
      currency: 'EUR',
      fxRate: 1,
    };
    const report = buildAnnualReport(
      2024,
      [...baseTxs, taxTx, divTx],
      snapshots,
      holdings,
      accounts,
    );
    expect(report.standaloneTaxTotal).toBeCloseTo(75, 1);
    expect(report.totalDividendTax).toBeCloseTo(10, 1);
    expect(report.totalTax).toBeCloseTo(85, 1);
  });

  it('is zero when no standalone TAX transactions exist', () => {
    const report = buildAnnualReport(2024, baseTxs, snapshots, holdings, accounts);
    expect(report.standaloneTaxTotal).toBe(0);
  });
});

// ── buildAnnualReport — cost-basis method ────────────────────────────────────

describe('buildAnnualReport — cost-basis method', () => {
  const buyTxs: Transaction[] = [
    {
      id: 'buy-a',
      date: '2023-01-01',
      source: 'broker',
      type: 'BUY',
      isin: 'TEST001',
      name: 'Test Fund',
      shares: 5,
      price: 100,
      amount: 500,
      fee: 0,
      tax: 0,
      currency: 'EUR',
      fxRate: 1,
    },
    {
      id: 'buy-b',
      date: '2023-06-01',
      source: 'broker',
      type: 'BUY',
      isin: 'TEST001',
      name: 'Test Fund',
      shares: 5,
      price: 200,
      amount: 1000,
      fee: 0,
      tax: 0,
      currency: 'EUR',
      fxRate: 1,
    },
    {
      id: 'sell',
      date: '2024-03-01',
      source: 'broker',
      type: 'SELL',
      isin: 'TEST001',
      name: 'Test Fund',
      shares: 5,
      price: 150,
      amount: 750,
      fee: 0,
      tax: 0,
      currency: 'EUR',
      fxRate: 1,
    },
  ];

  it('uses the provided cost-basis method (avgco vs fifo give different gains)', () => {
    const reportAvg = buildAnnualReport(2024, buyTxs, snapshots, holdings, accounts, 'avgco');
    const reportFifo = buildAnnualReport(2024, buyTxs, snapshots, holdings, accounts, 'fifo');
    // avgco: avg cost = 150, sell 5 at 150 → gain = 0
    // fifo: first lot at 100, sell 5 at 150 → gain = 250
    const avgGain = reportAvg.holdings.find((h) => h.isin === 'TEST001')?.yearRealisedGain ?? 0;
    const fifoGain = reportFifo.holdings.find((h) => h.isin === 'TEST001')?.yearRealisedGain ?? 0;
    expect(avgGain).toBeCloseTo(0, 1);
    expect(fifoGain).toBeCloseTo(250, 1);
  });
});
