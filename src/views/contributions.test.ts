/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('echarts/core', () => import('./charts/echartsMock'));
import { chartFor, instances as chartInstances, resetMockCharts } from './charts/echartsMock';
import { loadCharts } from './charts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = any;

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
  getMonthlyContribBudget: () => 500,
  getHoldings: () => [
    {
      isin: 'IE00TEST1',
      shortName: 'IWDA',
      name: 'iShares Core MSCI World',
      color: '#222222',
      acc: true,
      active: true,
      targetPct: 100,
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
  FORECAST_RANGE_LABELS: {
    '60': '5 years',
    '120': '10 years',
    '240': '20 years',
    '360': '30 years',
  },
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
    totalIntGross: 0,
    totalIntTax: 0,
    realizedPnL: 0,
    interestBySource: {},
    taxBySource: {},
    ...overrides,
  };
}

const DOM_FIXTURE = `
  <div id="dca-empty"></div>
  <div id="dca-content">
    <div id="dca-kpis"></div>
    <div id="c-dca-bar"></div>
    <div id="dca-proj-card"></div>
    <select id="dca-year-filter"></select>
    <div id="dca-table-header"></div>
    <div id="dca-table"></div>
  </div>
`;

describe('renderDCA', () => {
  beforeEach(async () => {
    await loadCharts();
    resetMockCharts();
    document.body.innerHTML = DOM_FIXTURE;
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
    expect(kpis).toContain('Current cost basis');
    expect(kpis).toContain('Active months');
    expect(kpis).toContain('Avg / month');
    expect(kpis).toContain('Latest month');
    // Total = 450, n = 3, avg = 150, latest = 200
    expect(kpis).toContain('3');
  });

  it('creates DCA bar chart with one stacked series per ETF', () => {
    renderDCA(makePD(), []);
    const opt = chartFor('c-dca-bar')!.option as AnyRec;
    expect(opt.xAxis.data).toHaveLength(3);
    expect(opt.series).toHaveLength(1);
    expect(opt.series[0]).toMatchObject({ name: 'IWDA', type: 'bar', stack: 'dca' });
    expect(opt.series[0].data.map((d: AnyRec) => d.value)).toEqual([100, 150, 200]);
    // Only the top segment of each stack is rounded.
    expect(opt.series[0].data[0].itemStyle.borderRadius).toEqual([3, 3, 0, 0]);
  });

  it('reuses the bar chart instance on re-render', () => {
    renderDCA(makePD(), []);
    const chart = chartFor('c-dca-bar');
    renderDCA(makePD(), []);
    expect(chartFor('c-dca-bar')).toBe(chart);
    expect(chartInstances.filter((c) => c.dom.id === 'c-dca-bar')).toHaveLength(1);
  });

  it('DCA range presets zoom the full month axis', () => {
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
    const chart = chartFor('c-dca-bar')!;
    const opt = chart.option as AnyRec;
    expect(opt.xAxis.data).toHaveLength(20);
    const presets = opt.graphic[0].children;
    expect(presets.map((c: AnyRec) => c.id)).toEqual(['preset-12', 'preset-36', 'preset-all']);
    presets[0].onclick();
    expect(chart.actions.at(-1)).toMatchObject({ type: 'dataZoom', startValue: 8, endValue: 19 });
  });

  it('bar tooltip skips zero rows and only totals multiple ETFs', () => {
    renderDCA(makePD(), []);
    const fmt = (chartFor('c-dca-bar')!.option as AnyRec).tooltip.formatter;
    const html = fmt([
      { seriesName: 'IWDA', value: 100, axisValue: 'Jan 25', axisValueLabel: 'Jan 25' },
      { seriesName: 'VWCE', value: 0, axisValue: 'Jan 25', axisValueLabel: 'Jan 25' },
    ]);
    expect(html).toContain('IWDA');
    expect(html).not.toContain('VWCE');
    expect(html).not.toContain('Total');
    const both = fmt([
      { seriesName: 'IWDA', value: 100, axisValue: 'Jan 25', axisValueLabel: 'Jan 25' },
      { seriesName: 'VWCE', value: 50, axisValue: 'Jan 25', axisValueLabel: 'Jan 25' },
    ]);
    expect(both).toContain('Total');
  });

  it('projection chart renders actual and projected series', () => {
    renderDCA(makePD(), []);
    const opt = chartFor('c-dca-proj')!.option as AnyRec;
    expect(opt.series.map((x: AnyRec) => x.name)).toEqual(['Actual', 'Projected']);
    expect(opt.series[0].data).toHaveLength(3);
    // Projection always covers 30 years (plus the joining point); presets only zoom.
    expect(opt.series[1].data).toHaveLength(361);
    expect(opt.series[1].data[0][1]).toBe(450);
    expect(opt.series[1].markArea.data[0][0].name).toBe('Projected');
  });

  it('forecast presets zoom the projection and update the title', () => {
    renderDCA(makePD(), []);
    const chart = chartFor('c-dca-proj')!;
    expect(document.getElementById('dca-proj-range')!.textContent).toBe('5 years');
    const presets = (chart.option as AnyRec).graphic[0].children;
    expect(presets.map((c: AnyRec) => c.id)).toEqual([
      'preset-60',
      'preset-120',
      'preset-240',
      'preset-360',
    ]);
    presets[1].onclick();
    expect(chart.actions.at(-1)).toMatchObject({ type: 'dataZoom' });
    expect(document.getElementById('dca-proj-range')!.textContent).toBe('10 years');
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
