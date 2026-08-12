/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const chartInstances: Array<{ config: unknown; destroyed: boolean }> = [];
vi.mock('chart.js/auto', () => ({
  default: class MockChart {
    config: unknown;
    data: { datasets: Array<{ hidden?: boolean }> };
    private _record: { config: unknown; destroyed: boolean };
    constructor(_ctx: unknown, config: unknown) {
      this.config = config;
      const cfg = config as { data?: { datasets?: unknown[] } };
      this.data = { datasets: (cfg?.data?.datasets as Array<{ hidden?: boolean }>) || [] };
      this._record = { config, destroyed: false };
      chartInstances.push(this._record);
    }
    destroy() {
      this._record.destroyed = true;
    }
    update() {}
    getDatasetMeta(i: number) {
      return { hidden: this.data.datasets[i]?.hidden || false };
    }
  },
}));

const MOCK_ACCOUNTS = [
  {
    id: 'acct_inv',
    moneyType: 'investment',
    institution: 'Broker',
    label: 'Broker',
    color: '#111111',
    isPrimaryInvestment: true,
    order: 1,
  },
  {
    id: 'acct_cash',
    moneyType: 'savings',
    institution: 'Bank',
    label: 'Cash',
    color: '#222222',
    isPrimaryInvestment: false,
    order: 2,
  },
];

vi.mock('../store/config', () => ({
  getAccounts: () => MOCK_ACCOUNTS,
  getHoldings: () => [],
  getSettings: () => ({ riskFreeRate: '2' }),
  isConfigLoaded: () => true,
  getACCTS: () => [
    { key: 'acct_inv', label: 'Broker', color: '#111111' },
    { key: 'acct_cash', label: 'Cash', color: '#222222' },
  ],
  getISINMap: () => ({}),
  getMETA: () => ({}),
  getISIN_ORDER: () => [],
}));

import { renderAnalytics } from './analytics';
import { appTemplate } from '../template';
import type { PortfolioData, Snapshot, Transaction } from '../types';

function makeSnap(date: string, investment: number, cash = 0): Snapshot {
  return { date, acct_inv: investment, acct_cash: cash };
}

function monthlySnaps(startYear: number, startMonth: number, count: number): Snapshot[] {
  const snaps: Snapshot[] = [];
  for (let i = 0; i < count; i++) {
    const m = startMonth - 1 + i;
    const year = startYear + Math.floor(m / 12);
    const month = (m % 12) + 1;
    snaps.push(makeSnap(`${year}-${String(month).padStart(2, '0')}`, 1000 + i * 10, 0));
  }
  return snaps;
}

function makePd(): PortfolioData {
  return {
    etfs: {},
    divHist: [],
    intHist: [],
    monthly: {},
    monthlyBy: {},
    months: [],
    totalInv: 1200,
    totalDivNet: 0,
    totalTax: 0,
    totalFees: 0,
    totalInterest: 0,
    totalIntGross: 0,
    totalIntTax: 0,
    realizedPnL: 0,
    interestBySource: {},
    taxBySource: {},
  };
}

describe('renderAnalytics', () => {
  beforeEach(() => {
    document.body.innerHTML = appTemplate();
    chartInstances.length = 0;
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
  });

  it('uses investment account value for dividend yield and anchors income windows to imported data', () => {
    const snaps = [makeSnap('2025-03', 900, 9000), makeSnap('2026-03', 1000, 9000)];
    const txs: Transaction[] = [
      {
        id: 'd-old',
        date: '2025-01-15',
        source: 'broker',
        type: 'DIVIDEND',
        name: 'ETF',
        isin: 'X',
        shares: 0,
        price: 0,
        amount: 20,
        fee: 0,
        tax: 0,
        currency: 'EUR',
        fxRate: 1,
      },
      {
        id: 'd-new',
        date: '2025-12-15',
        source: 'broker',
        type: 'DIVIDEND',
        name: 'ETF',
        isin: 'X',
        shares: 0,
        price: 0,
        amount: 100,
        fee: 0,
        tax: 0,
        currency: 'EUR',
        fxRate: 1,
      },
      {
        id: 'buy-anchor',
        date: '2026-03-01',
        source: 'broker',
        type: 'BUY',
        name: 'ETF',
        isin: 'X',
        shares: 1,
        price: 1000,
        amount: 1000,
        fee: 0,
        tax: 0,
        currency: 'EUR',
        fxRate: 1,
      },
    ];

    renderAnalytics(makePd(), snaps, txs);

    const incomeTiles = Array.from(document.querySelectorAll('#an-kpis-income .kpi'));
    const yieldTile = incomeTiles.find((el) => el.textContent?.includes('Dividend Yield'));
    const trailingTile = incomeTiles.find((el) => el.textContent?.includes('Trailing 12M Income'));
    const yoyTile = incomeTiles.find((el) => el.textContent?.includes('Income Growth (YoY)'));

    expect(yieldTile?.querySelector('.kpi-val')?.textContent).toBe('10%');
    expect(yieldTile?.querySelector('.kpi-sub')?.textContent).toBe(
      'trailing 12M / investment value',
    );
    expect(trailingTile?.querySelector('.kpi-sub')?.textContent).toBe('through Mar 2026');
    expect(yoyTile?.querySelector('.kpi-sub')?.textContent).toBe(
      'Mar 2026 vs Mar 2025 (12M windows)',
    );
  });

  it('gates risk metrics until 24 months of history while keeping income analytics visible', () => {
    const snaps = [makeSnap('2025-01', 900, 9000), makeSnap('2026-03', 1000, 9000)];
    const txs: Transaction[] = [
      {
        id: 'div-1',
        date: '2026-03-15',
        source: 'broker',
        type: 'DIVIDEND',
        name: 'ETF',
        isin: 'X',
        shares: 0,
        price: 0,
        amount: 12,
        fee: 0,
        tax: 0,
        currency: 'EUR',
        fxRate: 1,
      },
    ];

    renderAnalytics(makePd(), snaps, txs);

    expect(document.querySelector('#an-advanced summary')?.textContent).toContain(
      'Advanced analytics',
    );
    expect(document.querySelector('#an-advanced summary')?.textContent).not.toContain('/24 months');
    expect(document.getElementById('an-risk-metrics-note')?.textContent).toContain(
      'Insufficient data for investment risk metrics:',
    );
    expect(document.getElementById('an-risk-metrics-note')?.textContent).toContain(
      'gap period(s) in snapshot history',
    );
    expect(
      (document.getElementById('an-risk-metrics-note-card') as HTMLElement).style.display,
    ).toBe('');
    expect(document.getElementById('an-kpis-risk')?.textContent).toBe('');
    expect((document.getElementById('an-drawdown-card') as HTMLElement).style.display).toBe('none');
    expect((document.getElementById('an-income') as HTMLElement).style.display).toBe('');
  });

  it('renders growth chart data table wrap after renderAnalytics with 2+ snapshots', () => {
    const snaps = [makeSnap('2025-01', 900, 0), makeSnap('2025-02', 950, 0)];
    renderAnalytics(makePd(), snaps, []);
    const wrap = document.getElementById('c-an-growth-table-wrap');
    expect(wrap).not.toBeNull();
    // Wrap should be visible (removeAttribute('hidden') was called)
    expect(wrap?.hasAttribute('hidden')).toBe(false);
    // Toggle button should be present
    expect(wrap?.querySelector('.chart-data-table-toggle')).not.toBeNull();
    // Table should be present (hidden by default)
    const table = wrap?.querySelector('.chart-data-table') as HTMLTableElement | null;
    expect(table).not.toBeNull();
    expect(table?.getAttribute('aria-label')).toBe('Portfolio growth over time data');
  });

  it('renders annual returns table when at least one full year of monthly return data is present', () => {
    const snaps = monthlySnaps(2024, 1, 13);
    renderAnalytics(makePd(), snaps, []);
    const card = document.getElementById('an-annual-table-card');
    const table = document.getElementById('an-annual-table');
    expect(card?.style.display).not.toBe('none');
    // Table should contain at least one year row
    expect(table?.querySelector('tbody tr')).not.toBeNull();
  });

  it('marks partial-year annual returns with an asterisk', () => {
    const snaps = monthlySnaps(2024, 1, 7);
    renderAnalytics(makePd(), snaps, []);
    const table = document.getElementById('an-annual-table');
    expect(table?.textContent).toContain('*');
  });

  it('uses external deposit and withdrawal flows for TWR', () => {
    const snaps = [
      makeSnap('2024-01', 1000, 0),
      makeSnap('2024-02', 1200, 0),
      makeSnap('2024-03', 1270, 0),
    ];
    const txs: Transaction[] = [
      {
        id: 'dep-1',
        date: '2024-02-05',
        source: 'broker',
        type: 'DEPOSIT',
        name: 'Funding',
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
        id: 'wd-1',
        date: '2024-03-10',
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

    renderAnalytics(makePd(), snaps, txs);

    const perfTiles = Array.from(document.querySelectorAll('#an-kpis-l2 .kpi'));
    const twrTile = perfTiles.find((el) => el.textContent?.includes('TWR (investments)'));

    expect(twrTile?.querySelector('.kpi-val')?.textContent).toBe('21%');
  });

  it('uses normalized external cash flows for IRR', () => {
    const snaps = [makeSnap('2024-01', 1000, 0), makeSnap('2024-02', 1100, 0)];
    const txs: Transaction[] = [
      {
        id: 'dep-1',
        date: '2024-01-05',
        source: 'broker',
        type: 'DEPOSIT',
        name: 'Funding',
        isin: '',
        shares: 0,
        price: 0,
        amount: -1000,
        fee: 0,
        tax: 0,
        currency: 'EUR',
        fxRate: 1,
      },
    ];

    renderAnalytics(makePd(), snaps, txs);

    const perfTiles = Array.from(document.querySelectorAll('#an-kpis-l2 .kpi'));
    const irrTile = perfTiles.find((el) => el.textContent?.includes('IRR (investments)'));

    expect(irrTile?.querySelector('.kpi-val')?.textContent).not.toBe('-');
    expect(irrTile?.querySelector('.kpi-sub')?.textContent).toContain('XIRR, annualized');
  });

  it('keeps heatmap locked before 24 months and shows long-horizon guidance', () => {
    const snaps = monthlySnaps(2024, 1, 14);
    renderAnalytics(makePd(), snaps, []);
    expect(document.getElementById('an-heatmap')?.textContent).toContain(
      'Heatmap unlocks after 24 consecutive monthly investment-return periods',
    );
    expect(document.getElementById('an-heatmap-footer')?.textContent).toContain(
      'should not be used for short-term timing decisions',
    );
  });

  it('hides the level-2 section (including annual table card) when fewer than 2 snapshots exist', () => {
    // Single snapshot → level-2 block (which contains the annual table card) is hidden
    const snaps = [makeSnap('2025-06', 1000, 0)];
    renderAnalytics(makePd(), snaps, []);
    const level2 = document.getElementById('an-level2') as HTMLElement;
    expect(level2.style.display).toBe('none');
  });
});
