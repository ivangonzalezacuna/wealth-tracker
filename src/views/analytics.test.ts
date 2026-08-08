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
}));

import { renderAnalytics } from './analytics';
import { appTemplate } from '../template';
import type { PortfolioData, Snapshot, Transaction } from '../types';

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
    expect(yieldTile?.querySelector('.kpi-sub')?.textContent).toBe('trailing 12M / investment value');
    expect(trailingTile?.querySelector('.kpi-sub')?.textContent).toBe('through Mar 2026');
    expect(yoyTile?.querySelector('.kpi-sub')?.textContent).toBe('through Mar 2026 vs prior 12M');
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

    expect(document.getElementById('an-advanced-gate')?.textContent).toContain('/24 months');
    expect(document.getElementById('an-kpis-risk')?.textContent).toContain(
      'Risk metrics unlock after 24 months of snapshot history',
    );
    expect((document.getElementById('an-drawdown-card') as HTMLElement).style.display).toBe('none');
    expect((document.getElementById('an-income') as HTMLElement).style.display).toBe('');
  });
});
