/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Chart.js mock (reused from Phase 67's portfolio.test.ts) ───────
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

// ── Mock dependencies ──────────────────────────────────────────────
const MOCK_ACCOUNTS = [
  {
    id: 'acct1',
    moneyType: 'investment',
    institution: 'TR',
    label: 'Trade Republic',
    color: '#111111',
    isPrimaryInvestment: true,
    order: 1,
    annualReturnPct: 7,
    contribAmount: 50,
    contribInterval: 'weekly',
  },
];

vi.mock('../store/config', () => ({
  getAccounts: () => MOCK_ACCOUNTS,
  getTotalAnnualContrib: () => 2600,
  getHoldings: () => [
    {
      isin: 'IE00TEST1',
      ticker: 'IWDA',
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
  ],
  isConfigLoaded: () => true,
}));

vi.mock('../constants', () => ({
  getISIN_ORDERList: () => ['IE00TEST1'],
  getISIN: () => ({ IE00TEST1: 'IWDA' }),
  getMETAMap: () => ({ IWDA: { color: '#222222', acc: true, active: true } }),
}));

import { renderDCA } from './contributions';
import type { PortfolioData, Snapshot } from '../types';

function makePD(overrides: Partial<PortfolioData> = {}): PortfolioData {
  return {
    etfs: {},
    divHist: [],
    intHist: [],
    monthly: { '2025-01': 100, '2025-02': 150, '2025-03': 200 },
    monthlyBy: {
      '2025-01': { IE00TEST1: 100 },
      '2025-02': { IE00TEST1: 150 },
      '2025-03': { IE00TEST1: 200 },
    },
    months: ['2025-01', '2025-02', '2025-03'],
    totalInv: 450,
    totalDivNet: 0,
    totalTax: 0,
    totalFees: 0,
    totalInterest: 0,
    realizedPnL: 0,
    ...overrides,
  };
}

const DOM_FIXTURE = `
  <div id="dca-empty"></div>
  <div id="dca-content">
    <div id="dca-kpis"></div>
    <div id="dca-legend"></div>
    <canvas id="c-dca-bar"></canvas>
    <div class="range-toggle" id="dca-range-toggle">
      <button class="btn active" data-range="12">12M</button>
      <button class="btn" data-range="36">36M</button>
      <button class="btn" data-range="all">All</button>
    </div>
    <div id="dca-proj-card">
      <div id="dca-forecast-legend"></div>
      <canvas id="c-dca-proj"></canvas>
      <div class="range-toggle" id="dca-forecast-range-toggle">
        <button class="btn active" data-range="60">5Y</button>
        <button class="btn" data-range="120">10Y</button>
        <button class="btn" data-range="240">20Y</button>
      </div>
    </div>
    <select id="dca-year-filter"></select>
    <div id="dca-table-header"></div>
    <div id="dca-table"></div>
  </div>
`;

describe('renderDCA', () => {
  beforeEach(() => {
    document.body.innerHTML = DOM_FIXTURE;
    chartInstances.length = 0;
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

  it('shows empty state when pd is null', () => {
    renderDCA(null, []);
    expect((document.getElementById('dca-empty') as HTMLElement).style.display).not.toBe('none');
    expect((document.getElementById('dca-content') as HTMLElement).style.display).toBe('none');
    expect(chartInstances.length).toBe(0);
  });

  it('shows empty state when pd has no months', () => {
    renderDCA(makePD({ months: [], monthly: {}, monthlyBy: {} }), []);
    expect((document.getElementById('dca-empty') as HTMLElement).style.display).not.toBe('none');
    expect((document.getElementById('dca-content') as HTMLElement).style.display).toBe('none');
    expect(chartInstances.length).toBe(0);
  });

  it('renders four KPI tiles with correct values', () => {
    renderDCA(makePD(), []);
    const kpis = document.getElementById('dca-kpis')!.textContent!;
    expect(kpis).toContain('Total invested');
    expect(kpis).toContain('Active months');
    expect(kpis).toContain('Avg / month');
    expect(kpis).toContain('Latest month');
    // Total = 450, n = 3, avg = 150, latest = 200
    expect(kpis).toContain('3');
  });

  it('creates DCA bar chart with monthlyBy data', () => {
    renderDCA(makePD(), []);
    // Should create at least the bar chart
    expect(chartInstances.length).toBeGreaterThanOrEqual(1);
  });

  it('destroys prior bar chart on re-render', () => {
    renderDCA(makePD(), []);
    const firstCount = chartInstances.length;
    renderDCA(makePD(), []);
    // Prior charts destroyed
    for (let i = 0; i < firstCount; i++) {
      expect(chartInstances[i].destroyed).toBe(true);
    }
    expect(chartInstances.length).toBeGreaterThan(firstCount);
  });

  it('DCA range toggle changes the chart labels length', () => {
    // Use a longer months array to make range filtering visible
    const months = Array.from({ length: 20 }, (_, i) => {
      const y = 2024 + Math.floor(i / 12);
      const m = (i % 12) + 1;
      return `${y}-${String(m).padStart(2, '0')}`;
    });
    const monthly: Record<string, number> = {};
    const monthlyBy: Record<string, Record<string, number>> = {};
    months.forEach((mo) => {
      monthly[mo] = 100;
      monthlyBy[mo] = { IE00TEST1: 100 };
    });
    renderDCA(makePD({ months, monthly, monthlyBy, totalInv: 2000 }), []);
    const countAfterFirst = chartInstances.length;

    // Click "12M" range button (it's already active by default in the toggle HTML but
    // the internal state starts at 'all', so clicking '12' will trigger a re-render)
    const toggle = document.getElementById('dca-range-toggle')!;
    const btn12 = toggle.querySelector('[data-range="12"]') as HTMLElement;
    btn12.click();

    // A new chart should be created
    expect(chartInstances.length).toBeGreaterThan(countAfterFirst);
    // The new chart should have fewer labels (12 months vs 20)
    const newChart = chartInstances[chartInstances.length - 1];
    const cfg = newChart.config as { data?: { labels?: string[] } };
    expect(cfg.data!.labels!.length).toBe(12);
  });

  it('projection chart renders given contribution data', () => {
    renderDCA(makePD(), []);
    // Proj chart (c-dca-proj) should be created in addition to bar chart
    expect(chartInstances.length).toBeGreaterThanOrEqual(2);
  });

  it('forecast range toggle re-creates projection chart', () => {
    renderDCA(makePD(), []);
    const countBefore = chartInstances.length;

    const toggle = document.getElementById('dca-forecast-range-toggle')!;
    const btn10Y = toggle.querySelector('[data-range="120"]') as HTMLElement;
    btn10Y.click();

    expect(chartInstances.length).toBeGreaterThan(countBefore);
  });

  it('DCA table renders rows for each month plus a total row', () => {
    renderDCA(makePD(), []);
    const table = document.getElementById('dca-table')!;
    // 3 data rows + 1 total row + 1 header row = 5 total .tbl-row elements
    // .th for header, data rows and total row are not .th
    const dataRows = table.querySelectorAll('.tbl-row:not(.th)');
    // 3 months + 1 total = 4
    expect(dataRows.length).toBe(4);
  });

  it('year filter narrows visible rows', () => {
    const months = ['2024-11', '2024-12', '2025-01', '2025-02'];
    const monthly: Record<string, number> = {};
    const monthlyBy: Record<string, Record<string, number>> = {};
    months.forEach((mo) => {
      monthly[mo] = 100;
      monthlyBy[mo] = { IE00TEST1: 100 };
    });
    renderDCA(makePD({ months, monthly, monthlyBy, totalInv: 400 }), []);

    const select = document.getElementById('dca-year-filter') as HTMLSelectElement;
    // Select 2024
    select.value = '2024';
    select.dispatchEvent(new Event('change'));
    const table = document.getElementById('dca-table')!;
    const rows = table.querySelectorAll('.tbl-row:not(.th)');
    // 2 months in 2024 + 1 total row = 3
    expect(rows.length).toBe(3);
  });

  it('re-render does not throw or duplicate KPI tiles', () => {
    renderDCA(makePD(), []);
    renderDCA(makePD(), []);
    const kpis = document.getElementById('dca-kpis')!;
    expect(kpis.children.length).toBe(4);
  });

  it('re-render does not duplicate table rows', () => {
    renderDCA(makePD(), []);
    const table = document.getElementById('dca-table')!;
    const rowsAfterFirst = table.querySelectorAll('.tbl-row:not(.th)').length;
    renderDCA(makePD(), []);
    const rowsAfterSecond = table.querySelectorAll('.tbl-row:not(.th)').length;
    expect(rowsAfterSecond).toBe(rowsAfterFirst);
  });
});
