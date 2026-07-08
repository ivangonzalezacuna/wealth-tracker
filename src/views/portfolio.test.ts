/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Chart.js mock ──────────────────────────────────────────────────
// jsdom has no canvas getContext implementation; mock the constructor to
// record what it was called with instead of rendering anything real.
const chartInstances: Array<{ config: unknown; destroyed: boolean }> = [];
vi.mock('chart.js/auto', () => ({
  default: class MockChart {
    config: unknown;
    private _record: { config: unknown; destroyed: boolean };
    constructor(_ctx: unknown, config: unknown) {
      this.config = config;
      this._record = { config, destroyed: false };
      chartInstances.push(this._record);
    }
    destroy() {
      this._record.destroyed = true;
    }
    update() {}
  },
}));

// ── Mock store/config ──────────────────────────────────────────────
const MOCK_ACCOUNTS = [
  {
    id: 'acct1',
    moneyType: 'investment',
    institution: 'TR',
    label: 'Trade Republic',
    color: '#111111',
    isPrimaryInvestment: true,
    order: 1,
  },
];
const MOCK_HOLDINGS = [
  {
    isin: 'IE00TEST1',
    shortName: 'IWDA',
    name: 'iShares Core MSCI World',
    color: '#222222',
    acc: true,
    active: true,
    contribAmount: 50,
    contribInterval: 'weekly',
    assetClass: 'equity',
    region: 'developed',
    foldInto: '',
    order: 1,
  },
];
vi.mock('../store/config', () => ({
  getAccounts: () => MOCK_ACCOUNTS,
  getHoldings: () => MOCK_HOLDINGS,
  isConfigLoaded: () => true,
  getISIN_ORDER: () => ['IE00TEST1'],
  getMETA: () => ({ IWDA: { color: '#222222', acc: true, active: true } }),
  getACCTS: () => [{ key: 'acct1', label: 'Trade Republic', color: '#111111' }],
}));

vi.mock('../constants', () => ({
  getISIN_ORDERList: () => ['IE00TEST1'],
  getMETAMap: () => ({ IWDA: { color: '#222222', acc: true, active: true } }),
}));

import { renderPortfolio } from './portfolio';
import type { PortfolioData, Snapshot, EtfPosition } from '../types';

function makeEtf(overrides: Partial<EtfPosition> = {}): EtfPosition {
  return {
    isin: 'IE00TEST1',
    shortName: 'IWDA',
    name: 'iShares Core MSCI World',
    color: '#222222',
    acc: true,
    active: true,
    shares: 10,
    cost: 1000,
    divNet: 25,
    taxPaid: 5,
    buys: 12,
    realizedPnL: 0,
    totalFees: 2,
    exited: false,
    ...overrides,
  };
}

function makePD(overrides: Partial<PortfolioData> = {}): PortfolioData {
  return {
    etfs: { IE00TEST1: makeEtf() },
    divHist: [],
    intHist: [],
    monthly: {},
    monthlyBy: {},
    months: [],
    totalInv: 1000,
    totalDivNet: 25,
    totalTax: 5,
    totalFees: 2,
    totalInterest: 0,
    realizedPnL: 0,
    ...overrides,
  };
}

const DOM_FIXTURE = `
  <div id="port-empty"></div>
  <div id="port-content">
    <div id="port-kpis"></div>
    <div id="port-table-header"></div>
    <div id="port-table"></div>
    <canvas id="c-port-donut"></canvas>
    <div id="port-donut-legend"></div>
    <div id="port-summary"></div>
    <div id="port-drift"></div>
    <div id="port-pagination"></div>
  </div>
`;

describe('renderPortfolio', () => {
  beforeEach(() => {
    document.body.innerHTML = DOM_FIXTURE;
    chartInstances.length = 0;
    // jsdom does not implement matchMedia; stub it for resolvedT()
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it('shows the empty state and skips chart creation when pd is null', () => {
    renderPortfolio(null, []);
    expect((document.getElementById('port-empty') as HTMLElement).style.display).not.toBe('none');
    expect((document.getElementById('port-content') as HTMLElement).style.display).toBe('none');
    expect(chartInstances.length).toBe(0);
  });

  it('shows the empty state when pd has no etfs', () => {
    renderPortfolio({ ...makePD(), etfs: {} }, []);
    expect((document.getElementById('port-empty') as HTMLElement).style.display).toBe('block');
    expect(chartInstances.length).toBe(0);
  });

  it('renders the four KPI tiles with correct labels', () => {
    renderPortfolio(makePD(), []);
    const kpis = document.getElementById('port-kpis')!.textContent!;
    expect(kpis).toContain('Total invested');
    expect(kpis).toContain('Current value');
    expect(kpis).toContain('Unrealized gain');
    expect(kpis).toContain('Realized P&L');
  });

  it('shows "-" for Current value when no snapshots are provided', () => {
    renderPortfolio(makePD(), []);
    const kpisHtml = document.getElementById('port-kpis')!.innerHTML;
    // Current value shows dash when no snapshot
    expect(kpisHtml).toContain('add a snapshot');
  });

  it('computes Current value and Unrealized gain from snapshot', () => {
    const snap: Snapshot = { date: '2026-06-01', acct1: 1200 };
    renderPortfolio(makePD(), [snap]);
    const kpis = document.getElementById('port-kpis')!.textContent!;
    // Current value = 1200 (from snapshot for primary investment account)
    expect(kpis).toContain('1.200,00');
    // Unrealized gain = 1200 - 1000 = 200
    expect(kpis).toContain('200,00');
  });

  it('creates exactly one chart on first render', () => {
    renderPortfolio(makePD(), []);
    expect(chartInstances.length).toBe(1);
    expect(chartInstances[0].destroyed).toBe(false);
  });

  it('destroys the prior chart and creates a new one on re-render', () => {
    renderPortfolio(makePD(), []);
    expect(chartInstances.length).toBe(1);
    renderPortfolio(makePD(), []);
    expect(chartInstances.length).toBe(2);
    expect(chartInstances[0].destroyed).toBe(true);
  });

  it('renders holdings table with one row per etf entry', () => {
    renderPortfolio(makePD(), []);
    const table = document.getElementById('port-table')!.textContent!;
    expect(table).toContain('IWDA');
  });

  it('renders multiple ETF rows', () => {
    const pd = makePD({
      etfs: {
        IE00TEST1: makeEtf(),
        IE00TEST2: makeEtf({ isin: 'IE00TEST2', shortName: 'EIMI', color: '#333', cost: 500 }),
      },
      totalInv: 1500,
    });
    renderPortfolio(pd, []);
    const table = document.getElementById('port-table')!.textContent!;
    expect(table).toContain('IWDA');
    expect(table).toContain('EIMI');
  });

  it('shows the held/closed/all filter toggle', () => {
    renderPortfolio(makePD(), []);
    const filterToggle = document.getElementById('port-filter-toggle');
    expect(filterToggle).not.toBeNull();
    expect(filterToggle!.textContent).toContain('Held');
    expect(filterToggle!.textContent).toContain('Closed');
    expect(filterToggle!.textContent).toContain('All');
  });

  it('filter toggle switches between held and closed positions', () => {
    const pd = makePD({
      etfs: {
        IE00TEST1: makeEtf(),
        IE00CLOSED: makeEtf({
          isin: 'IE00CLOSED',
          shortName: 'EXITED',
          exited: true,
          shares: 0,
          cost: 200,
        }),
      },
      totalInv: 1200,
    });
    renderPortfolio(pd, []);
    const table = document.getElementById('port-table')!;

    // Default "Held" filter shows only non-exited
    expect(table.textContent).toContain('IWDA');
    expect(table.textContent).not.toContain('EXITED');

    // Click "Closed" filter button
    const closedBtn = table.querySelector('[data-filter="closed"]') as HTMLElement;
    closedBtn.click();
    expect(table.textContent).toContain('EXITED');
    expect(table.textContent).not.toContain('IWDA');

    // Click "All" filter button
    const allBtn = table.querySelector('[data-filter="all"]') as HTMLElement;
    allBtn.click();
    expect(table.textContent).toContain('IWDA');
    expect(table.textContent).toContain('EXITED');
  });

  it('renders drift card when holdings have contribution targets', () => {
    const pd = makePD();
    renderPortfolio(pd, []);
    const drift = document.getElementById('port-drift')!;
    // With a single holding that has contribAmount, drift should render
    expect(drift.innerHTML).toContain('Allocation drift');
    expect(drift.innerHTML).toContain('IWDA');
  });

  it('tap-to-expand detail panel opens on row click', () => {
    renderPortfolio(makePD(), []);
    const table = document.getElementById('port-table')!;
    const row = table.querySelector('.hold-row:not(.th)') as HTMLElement;
    expect(row).not.toBeNull();
    row.click();
    const detail = table.querySelector('.hold-detail') as HTMLElement;
    expect(detail).not.toBeNull();
    expect(detail.textContent).toContain('ISIN');
    expect(detail.textContent).toContain('Status');
    expect(detail.textContent).toContain('Type');
    expect(detail.textContent).toContain('Accumulating');
  });

  it('tap-to-expand closes the panel when the same row is clicked again', () => {
    renderPortfolio(makePD(), []);
    const table = document.getElementById('port-table')!;
    const row = table.querySelector('.hold-row:not(.th)') as HTMLElement;
    row.click();
    expect(table.querySelector('.hold-detail')).not.toBeNull();
    row.click();
    expect(table.querySelector('.hold-detail')).toBeNull();
  });

  it('re-render does not throw or duplicate KPI tiles or table rows', () => {
    renderPortfolio(makePD(), []);
    renderPortfolio(makePD(), []);
    const kpis = document.getElementById('port-kpis')!;
    expect(kpis.children.length).toBe(4);
    // Only one set of data rows (non-header, non-total, non-filter)
    const rows = document.getElementById('port-table')!.querySelectorAll('.hold-row:not(.th)');
    expect(rows.length).toBe(1);
  });

  it('chart config contains the correct labels and data', () => {
    renderPortfolio(makePD(), []);
    expect(chartInstances.length).toBe(1);
    const config = chartInstances[0].config as { data: { labels: string[]; datasets: unknown[] } };
    expect(config.data.labels).toContain('IWDA');
    expect(config.data.datasets[0]).toHaveProperty('data');
  });

  it('renders donut legend with short name and percentage', () => {
    renderPortfolio(makePD(), []);
    const legend = document.getElementById('port-donut-legend')!.textContent!;
    expect(legend).toContain('IWDA');
    expect(legend).toContain('100%');
  });

  it('renders summary section with total invested and fees', () => {
    renderPortfolio(makePD(), []);
    const summary = document.getElementById('port-summary')!.textContent!;
    expect(summary).toContain('Total invested');
    expect(summary).toContain('Total fees');
    expect(summary).toContain('Dividends (net)');
  });
});
