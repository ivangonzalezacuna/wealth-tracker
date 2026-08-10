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

const MOCK_ACCOUNTS: Account[] = [
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
  getACCTS: () =>
    MOCK_ACCOUNTS.map((a) => ({
      key: a.id || a.key || '',
      label: a.label,
      color: a.color || '',
    })),
  getISINMap: () => ({}),
  getMETA: () => ({}),
  getISIN_ORDER: () => [],
}));

import { renderAnalytics } from './analytics';
import { appTemplate } from '../template';
import type { Account, PortfolioData, Snapshot, Transaction } from '../types';

function makeSnap(date: string, investment: number, cash = 0): Snapshot {
  return { date, acct_inv: investment, acct_cash: cash };
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
    delete (MOCK_ACCOUNTS[0] as { key?: string }).key;
    delete (MOCK_ACCOUNTS[1] as { key?: string }).key;
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
      '/24 months recorded. Risk metrics require 24 months of history.',
    );
    expect(
      (document.getElementById('an-risk-metrics-note-card') as HTMLElement).style.display,
    ).toBe('');
    expect(document.getElementById('an-kpis-risk')?.textContent).toBe('');
    expect((document.getElementById('an-drawdown-card') as HTMLElement).style.display).toBe('none');
    expect((document.getElementById('an-income') as HTMLElement).style.display).toBe('');
  });

  it('computes TWR from investment snapshots, not total net-worth balances', () => {
    const pd = makePd();
    pd.monthly = {};
    const snaps = [makeSnap('2026-01', 1000, 1000), makeSnap('2026-02', 1000, 2000)];

    renderAnalytics(pd, snaps, []);

    const twrTile = Array.from(document.querySelectorAll('#an-kpis-l2 .kpi')).find((el) =>
      el.textContent?.includes('TWR'),
    );
    expect(twrTile?.querySelector('.kpi-val')?.textContent).toBe('0%');
  });

  it('computes TWR when legacy snapshots use an account key different from the current id', () => {
    const pd = makePd();
    pd.monthly = {};
    (MOCK_ACCOUNTS[0] as { key?: string }).key = 'legacy_inv';
    const snaps: Snapshot[] = [
      { date: '2026-01', legacy_inv: 1000, acct_cash: 0 },
      { date: '2026-02', legacy_inv: 1100, acct_cash: 0 },
    ];

    renderAnalytics(pd, snaps, []);

    const twrTile = Array.from(document.querySelectorAll('#an-kpis-l2 .kpi')).find((el) =>
      el.textContent?.includes('TWR'),
    );
    expect(twrTile?.querySelector('.kpi-val')?.textContent).toBe('10%');
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

  it('renders annual returns table when at least one full year of data is present', () => {
    // Two snapshots spanning early 2024 to early 2025 gives one annual data point
    const snaps = [makeSnap('2024-01', 800, 0), makeSnap('2024-12', 900, 0)];
    renderAnalytics(makePd(), snaps, []);
    const card = document.getElementById('an-annual-table-card');
    const table = document.getElementById('an-annual-table');
    expect(card?.style.display).not.toBe('none');
    // Table should contain at least one year row
    expect(table?.querySelector('tbody tr')).not.toBeNull();
  });

  it('hides the level-2 section (including annual table card) when fewer than 2 snapshots exist', () => {
    // Single snapshot → level-2 block (which contains the annual table card) is hidden
    const snaps = [makeSnap('2025-06', 1000, 0)];
    renderAnalytics(makePd(), snaps, []);
    const level2 = document.getElementById('an-level2') as HTMLElement;
    expect(level2.style.display).toBe('none');
  });
});
