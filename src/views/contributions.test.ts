/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('echarts/core', () => import('./charts/echartsMock'));
import { chartFor, instances as chartInstances, resetMockCharts } from './charts/echartsMock';
import { addMonths, loadCharts } from './charts';

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
    <div id="dca-table-header"></div>
    <div id="dca-table"></div>
    <div id="dca-pagination"></div>
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

  it('DCA bars open on the last 12 months of the full axis', () => {
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
    expect(opt.graphic).toBeUndefined();
    expect(opt.dataZoom[0]).toMatchObject({ startValue: 8, endValue: 19 });
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
    // Projection always covers 30 years (plus the joining point); the zoom picks the view.
    expect(opt.series[1].data).toHaveLength(361);
    expect(opt.series[1].data[0][1]).toBe(450);
    expect(opt.series[1].markArea.data[0][0].name).toBe('Projected');
  });

  it('forecast opens on 5 years and the title follows the zoom', () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    try {
      renderDCA(makePD(), []);
      const chart = chartFor('c-dca-proj')!;
      const title = document.getElementById('dca-proj-range')!;
      expect(title.textContent).toBe('5 years');
      const opt = chart.option as AnyRec;
      expect(opt.graphic).toBeUndefined();
      const lastActual = opt.series[0].data.at(-1)[0];
      expect(opt.dataZoom[0]).toMatchObject({
        startValue: opt.series[0].data[0][0],
        endValue: addMonths(lastActual, 60),
      });
      const zoomTo = (months: number) => {
        chart.option = {
          ...opt,
          dataZoom: [
            { startValue: opt.series[0].data[0][0], endValue: addMonths(lastActual, months) },
          ],
        };
        chart.trigger('datazoom', {});
      };
      zoomTo(125);
      expect(title.textContent).toBe('10 years');
      zoomTo(3);
      expect(title.textContent).toBe('1 year');
      zoomTo(60);
      expect(title.textContent).toBe('5 years');
    } finally {
      vi.unstubAllGlobals();
    }
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

  it('pages months with the standard Rows selector', () => {
    const months = Array.from({ length: 14 }, (_, i) =>
      i < 12 ? `2024-${String(i + 1).padStart(2, '0')}` : `2025-0${i - 11}`,
    );
    const monthly: Record<string, number> = {};
    const monthlyBy: Record<string, Record<string, number>> = {};
    months.forEach((mo) => {
      monthly[mo] = 100;
      monthlyBy[mo] = { IE00TEST1: 100 };
    });
    renderDCA(makePD({ months, monthly, monthlyBy, totalInv: 1400 }), []);

    const rows = () => document.querySelectorAll('#dca-table .tbl-row:not(.th)');
    // 12 months + total row
    expect(rows().length).toBe(13);
    const pag = document.getElementById('dca-pagination')!;
    expect(pag.textContent).toContain('1\u201312 of 14');
    const select = pag.querySelector<HTMLSelectElement>('.js-page-size')!;
    select.value = '24';
    select.dispatchEvent(new Event('change'));
    expect(rows().length).toBe(15);
    expect(localStorage.getItem('wt:dca:pageSize')).toBe('24');
    const reset = document.querySelector<HTMLSelectElement>('#dca-pagination .js-page-size')!;
    reset.value = '12';
    reset.dispatchEvent(new Event('change'));
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
