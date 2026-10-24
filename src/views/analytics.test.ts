/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('echarts/core', () => import('./charts/echartsMock'));
import { chartFor } from './charts/echartsMock';

const MOCK_ACCOUNTS = [
  {
    id: 'acct_inv',
    moneyType: 'investment',
    institution: 'Broker',
    country: 'Germany',
    group: 'Retirement',
    label: 'Broker',
    color: '#111111',
    isPrimaryInvestment: true,
    order: 1,
  },
  {
    id: 'acct_cash',
    moneyType: 'savings',
    institution: 'Bank',
    country: 'Spain',
    group: 'Liquid',
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
  getNumberSetting: (_key: string, defaultVal: number) => defaultVal,
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
import { monthToTime } from './charts/format';
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
  beforeEach(async () => {
    await (await import('./charts')).loadCharts();
    document.body.innerHTML = appTemplate();
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

    const incomeTiles = Array.from(document.querySelectorAll('#an-kpis-income .kpi-group-row'));
    const yieldTile = incomeTiles.find((el) =>
      el.textContent?.includes('Recorded income / investment value'),
    );
    const trailingTile = incomeTiles.find((el) => el.textContent?.includes('Trailing 12M Income'));
    const yoyTile = incomeTiles.find((el) => el.textContent?.includes('Income Growth (YoY)'));

    expect(yieldTile?.querySelector('.row-val')?.textContent).toBe('10%');
    expect(yieldTile?.querySelector('.kpi-group-sub')?.textContent).toBe(
      'trailing 12M as of Mar 2026 / investment value',
    );
    expect(trailingTile?.querySelector('.kpi-group-sub')?.textContent).toBe('through Mar 2026');
    expect(yoyTile?.querySelector('.kpi-group-sub')?.textContent).toBe(
      'Mar 2026 vs Mar 2025 (12M windows)',
    );
    expect(document.querySelector('#an-kpis-l1 .kpi-group-result')).toBeNull();

    renderAnalytics(
      makePd(),
      snaps,
      txs.map((tx) => ({ ...tx, amount: tx.amount * 2 })),
    );
    const income = chartFor('c-an-income')!.option as Record<string, any>;
    expect(income.series[0].data).toContain(200);
    expect(income.series[0].data).not.toContain(100);
    expect(income.series[0].itemStyle.borderRadius).toEqual([3, 3, 0, 0]);
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

  it('renders the growth chart as a native ECharts time series with zoom and no range presets', () => {
    const snaps = [makeSnap('2025-01', 900, 0), makeSnap('2025-02', 950, 0)];
    renderAnalytics(makePd(), snaps, []);
    const opt = chartFor('c-an-growth')!.option as Record<string, any>;
    expect(opt.xAxis.type).toBe('time');
    expect(opt.series[0].data.map((p: number[]) => p[1])).toEqual([900, 950]);
    expect(opt.dataZoom.map((z: { type: string }) => z.type)).toEqual(['inside', 'slider']);
    expect(opt.toolbox.feature.myDataTable).toBeDefined();
    expect(opt.graphic).toBeUndefined();
    expect(opt.dataZoom[0]).toMatchObject({ start: 0, end: 100 });
  });

  it('keeps growth and flow ranges on the latest rendered data', () => {
    renderAnalytics(makePd(), [makeSnap('2025-01', 900), makeSnap('2025-02', 950)], []);
    renderAnalytics(makePd(), [makeSnap('2026-01', 2000), makeSnap('2026-02', 2200)], []);
    const growth = chartFor('c-an-growth')!;
    const opt = growth.option as Record<string, any>;
    expect(opt.series[0].data.map((p: number[]) => p[1])).toEqual([2000, 2200]);
    expect(opt.series[0].data[0][0]).toBe(monthToTime('2026-01'));
    const contrib = chartFor('c-an-contrib')!.option as Record<string, any>;
    expect(contrib.series[1].data.map((d: { value: number }) => d.value)).toEqual([200]);
  });

  it('disposes the growth chart when only one snapshot remains', () => {
    renderAnalytics(makePd(), [makeSnap('2025-01', 900), makeSnap('2025-02', 950)], []);
    renderAnalytics(makePd(), [makeSnap('2026-01', 2000)], []);
    expect(chartFor('c-an-growth')).toBeUndefined();
  });

  it('pages the latest heatmap data after replacing history', () => {
    renderAnalytics(makePd(), monthlySnaps(2019, 1, 40), []);
    renderAnalytics(makePd(), monthlySnaps(2023, 1, 40), []);
    document.getElementById('an-heatmap-prev')!.click();
    expect(document.getElementById('an-heatmap')!.textContent).toContain('2023');
    expect(document.getElementById('an-heatmap')!.textContent).not.toContain('2019');
  });

  it('keeps risk readiness separate from the heatmap count gate', () => {
    renderAnalytics(makePd(), monthlySnaps(2023, 1, 24), []);
    expect(document.getElementById('an-kpis-risk')!.style.display).toBe('none');
    renderAnalytics(makePd(), monthlySnaps(2023, 1, 25), []);
    expect(document.querySelectorAll('#an-kpis-risk .kpi-group-row')).toHaveLength(7);
    const withGap = monthlySnaps(2023, 1, 40).filter((_, index) => index !== 10);
    renderAnalytics(makePd(), withGap, []);
    expect(document.getElementById('an-kpis-risk')!.style.display).toBe('none');
    expect(document.querySelector('#an-heatmap table')).not.toBeNull();
    expect(document.getElementById('an-risk-metrics-note')!.textContent).toContain('gap period');
  });

  it('shows unchanged balance figures and percentage-point annual differences', () => {
    renderAnalytics(makePd(), [makeSnap('2025-01', 1000), makeSnap('2026-01', 1200)], []);
    expect(document.querySelector('#an-kpis-l1 .kpi-val')!.textContent).toBe('200,00 €');
    expect(document.querySelector('#an-kpis-l2 .row-val')!.textContent).toBe('20%');
    renderAnalytics(makePd(), monthlySnaps(2023, 1, 40), []);
    expect(document.getElementById('an-annual-table')!.textContent).toContain(' pp');
    expect(document.getElementById('an-metrics-explainer')!.textContent).not.toContain(
      'Good to aim for',
    );
  });

  it('renders drawdown with a zero ceiling, distinct percent ticks and a trough marker', () => {
    renderAnalytics(makePd(), monthlySnaps(2023, 1, 36), []);
    const flat = chartFor('c-an-drawdown')!.option as Record<string, any>;
    expect(flat.yAxis.min).toBe(-1);
    expect(flat.series[0].markPoint).toBeUndefined();

    const dipped = monthlySnaps(2023, 1, 36).map((s, i) =>
      i === 20 ? { ...s, acct_inv: Number(s.acct_inv) * 0.8 } : s,
    );
    renderAnalytics(makePd(), dipped, []);
    const drawdown = chartFor('c-an-drawdown')!.option as Record<string, any>;
    expect(drawdown.yAxis.max).toBe(0);
    expect(drawdown.yAxis.min).toBeUndefined();
    expect(drawdown.series[0].markPoint.data[0]).toMatchObject({ type: 'min' });
    const format = drawdown.yAxis.axisLabel.formatter as (value: number) => string;
    for (const values of [
      [0, -0.5, -1, -1.5, -2],
      [0, -20, -40, -60],
    ]) {
      const labels = values.map(format);
      expect(new Set(labels).size).toBe(values.length);
    }
    expect(format(-1.5)).toBe('\u22121.5%');
  });

  it('renders contribution and allocation charts with native legends and data view', () => {
    const snaps = [
      makeSnap('2025-01', 900, 100),
      makeSnap('2025-02', 950, 110),
      makeSnap('2025-03', 980, 120),
    ];
    renderAnalytics(makePd(), snaps, []);

    const contrib = chartFor('c-an-contrib')!.option as Record<string, any>;
    expect(contrib.legend.data).toEqual(['Contributed', 'Market movement']);
    expect(contrib.series.map((s: { stack: string }) => s.stack)).toEqual(['contrib', 'contrib']);
    expect(contrib.toolbox.feature.myDataTable).toBeDefined();

    const alloc = chartFor('c-an-alloc-acct')!.option as Record<string, any>;
    expect(alloc.series[0].type).toBe('pie');
    expect(alloc.legend.orient).toBe('vertical');
    expect(alloc.series[0].data[0].label.position).toBe('center');
    expect(alloc.toolbox.feature.myDataTable).toBeDefined();
  });

  it('renders allocation by country accessible via account donut group toggle', () => {
    const snaps = [makeSnap('2025-01', 1000, 500), makeSnap('2025-02', 1200, 550)];
    renderAnalytics(makePd(), snaps, []);

    // The account donut toggle wrap should contain the "By country" button
    const toggleWrap = document.getElementById('an-alloc-acct-toggle-wrap');
    expect(toggleWrap).not.toBeNull();
    const countryBtn = toggleWrap?.querySelector(
      '[data-acct-group="country"]',
    ) as HTMLElement | null;
    expect(countryBtn).not.toBeNull();

    // Clicking it should switch the legend to show country names
    countryBtn?.click();
    const legend = (chartFor('c-an-alloc-acct')!.option as Record<string, any>).series[0].data
      .map((d: { name: string }) => d.name)
      .join(' ');
    expect(legend).toContain('Germany');
    expect(legend).toContain('Spain');
  });

  it('renders allocation by group accessible via account donut group toggle', () => {
    const snaps = [makeSnap('2025-01', 1000, 500), makeSnap('2025-02', 1200, 550)];
    renderAnalytics(makePd(), snaps, []);

    const toggleWrap = document.getElementById('an-alloc-acct-toggle-wrap');
    expect(toggleWrap).not.toBeNull();
    const groupBtn = toggleWrap?.querySelector('[data-acct-group="group"]') as HTMLElement | null;
    expect(groupBtn).not.toBeNull();

    groupBtn?.click();
    const legend = (chartFor('c-an-alloc-acct')!.option as Record<string, any>).series[0].data
      .map((d: { name: string }) => d.name)
      .join(' ');
    expect(legend).toContain('Retirement');
    expect(legend).toContain('Liquid');
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

    const perfTiles = Array.from(document.querySelectorAll('#an-kpis-l1 .kpi-group-row'));
    const twrTile = perfTiles.find((el) => el.textContent?.includes('Cumulative return (TWR)'));

    expect(twrTile?.querySelector('.row-val')?.textContent).toBe('21%');
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

    const perfTiles = Array.from(document.querySelectorAll('#an-kpis-l1 .kpi-group-row'));
    const irrTile = perfTiles.find((el) => el.textContent?.includes('Annualized return (IRR)'));

    expect(irrTile?.querySelector('.row-val')?.textContent).not.toBe('-');
    expect(irrTile?.querySelector('.kpi-group-sub')?.textContent).toContain('XIRR, annualized');
  });

  it('keeps heatmap locked before 24 months and shows long-horizon guidance', () => {
    const snaps = monthlySnaps(2024, 1, 14);
    renderAnalytics(makePd(), snaps, []);
    expect(document.getElementById('an-heatmap')?.textContent).toContain(
      'Heatmap unlocks after 24 valid monthly investment-return periods',
    );
    expect(document.getElementById('an-heatmap-footer')?.textContent).toContain(
      'should not be used for short-term timing decisions',
    );
  });

  it('hides the level-2 section (including annual table card) when fewer than 2 snapshots exist', () => {
    // Single snapshot â†’ level-2 block (which contains the annual table card) is hidden
    const snaps = [makeSnap('2025-06', 1000, 0)];
    renderAnalytics(makePd(), snaps, []);
    const level2 = document.getElementById('an-level2') as HTMLElement;
    expect(level2.style.display).toBe('none');
  });
});
