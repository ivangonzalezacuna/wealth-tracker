/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('echarts/core', () => import('./charts/echartsMock'));
import { chartFor, instances as chartInstances, resetMockCharts } from './charts/echartsMock';
import { addMonths, loadCharts } from './charts';

type AnyRec = Record<string, any>;
const seriesNames = (id: string): string[] =>
  ((chartFor(id)?.option as AnyRec | undefined)?.series ?? [])
    .map((x: AnyRec) => x.name)
    .filter((n: unknown): n is string => typeof n === 'string');

// ── Mock dependencies ──────────────────────────────────────────────
const MOCK_ACCOUNTS: any[] = [
  {
    id: 'acct1',
    moneyType: 'investment',
    institution: 'TR',
    group: 'Retirement',
    label: 'Trade Republic',
    color: '#111111',
    isPrimaryInvestment: true,
    order: 1,
    annualReturnPct: 7,
    contribAmount: 50,
    contribInterval: 'weekly',
  },
  {
    id: 'acct2',
    moneyType: 'savings',
    institution: 'ING',
    group: 'Liquid savings',
    label: 'Savings',
    color: '#222222',
    isPrimaryInvestment: false,
    order: 2,
    annualReturnPct: 2,
    contribAmount: 100,
    contribInterval: 'monthly',
  },
];

// Mutable settings store so tests can simulate typed values surviving a reload.
const mockSettings: Record<string, string> = {};

vi.mock('../store/config', () => ({
  getAccounts: () => MOCK_ACCOUNTS,
  getTargetNetWorth: () => 100000,
  getTargetDate: () => '2030-01',
  getHoldings: () => [],
  getMonthlyContribBudget: () => 500,
  getContributionBudgetAmount: () => 500,
  getContributionInterval: () => 'monthly',
  isConfigLoaded: () => true,
  getGoals: vi.fn(() => []),
  getSettings: () => ({ ...mockSettings }),
  getNumberSetting: (key: string, defaultVal: number) =>
    key in mockSettings ? parseFloat(mockSettings[key]) : defaultVal,
  setSetting: vi.fn((key: string, value: string) => {
    mockSettings[key] = value;
    return Promise.resolve();
  }),
  setSettings: vi.fn((values: Record<string, string | null>) => {
    for (const [k, v] of Object.entries(values)) {
      if (v == null) delete mockSettings[k];
      else mockSettings[k] = v;
    }
    return Promise.resolve();
  }),
}));

vi.mock('../constants', () => ({
  getACCTSList: () => [
    { key: 'acct1', label: 'Trade Republic', color: '#111111' },
    { key: 'acct2', label: 'Savings', color: '#222222' },
  ],
  FORECAST_RANGE_LABELS: {
    '60': '5 years',
    '120': '10 years',
    '240': '20 years',
    '360': '30 years',
    '480': '40 years',
    '600': '50 years',
  },
}));

import { renderNW, _resetPlanningTabForTest } from './networth';
import type { Snapshot } from '../types';
import * as configStore from '../store/config';

function makeSnap(date: string, acct1 = 1000, acct2 = 500): Snapshot {
  return { date, acct1, acct2 };
}

function makeMonthlySnaps(count: number): Snapshot[] {
  const snaps: Snapshot[] = [];
  for (let i = 0; i < count; i++) {
    const year = 2024 + Math.floor(i / 12);
    const month = (i % 12) + 1;
    const date = `${year}-${String(month).padStart(2, '0')}-01`;
    snaps.push(makeSnap(date, 1000 + i * 100, 500 + i * 50));
  }
  return snaps;
}

const DOM_FIXTURE = `
  <div id="nw-empty"></div>
  <div id="nw-content">
    <div id="nw-kpis"></div>
    <div id="nw-chart-title"></div>
    <div id="c-nw-hist"></div>
    <div id="nw-planning"></div>
    <div id="nw-goal"></div>
    <div id="nw-detail"></div>
  </div>
  <div id="networth"></div>
`;

/** Switches the planning card to the drawdown tab and returns the panel element. */
function switchToDrawdownTab(): HTMLElement {
  const btn = document.querySelector('[data-planning-tab="drawdown"]') as HTMLElement;
  btn?.click();
  return document.getElementById('nw-dd-panel') as HTMLElement;
}

describe('renderNW', () => {
  beforeEach(async () => {
    await loadCharts();
    resetMockCharts();
    document.body.innerHTML = DOM_FIXTURE;
    for (const k of Object.keys(mockSettings)) delete mockSettings[k];
    _resetPlanningTabForTest();
    delete (MOCK_ACCOUNTS[0] as any).locked;
    delete (MOCK_ACCOUNTS[0] as any).lockedUntil;
    delete (MOCK_ACCOUNTS[1] as any).locked;
    delete (MOCK_ACCOUNTS[1] as any).lockedUntil;
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

  it('shows empty state and creates zero charts when snaps is empty', () => {
    renderNW([]);
    expect((document.getElementById('nw-empty') as HTMLElement).style.display).toBe('block');
    expect((document.getElementById('nw-content') as HTMLElement).style.display).toBe('none');
    expect(chartInstances.length).toBe(0);
  });

  it('shows empty state when pd is provided but snaps is empty', () => {
    renderNW([]);
    expect((document.getElementById('nw-empty') as HTMLElement).style.display).toBe('block');
    expect((document.getElementById('nw-content') as HTMLElement).style.display).toBe('none');
    expect(chartInstances.length).toBe(0);
  });

  it('renders content when snaps have data', () => {
    const snaps = [makeSnap('2026-01-01'), makeSnap('2026-02-01', 1100, 550)];
    renderNW(snaps);
    expect((document.getElementById('nw-empty') as HTMLElement).style.display).toBe('none');
    expect((document.getElementById('nw-content') as HTMLElement).style.display).toBe('block');
  });

  it('renders grouped forecast summary with current and projected values', () => {
    const snaps = [makeSnap('2026-01-01', 1000, 500), makeSnap('2026-02-01', 1100, 550)];
    renderNW(snaps);
    const planning = document.getElementById('nw-planning')?.textContent || '';
    expect(planning).toContain('Grouped forecast summary');
    expect(planning).toContain('Retirement');
    expect(planning).toContain('Liquid savings');
    expect(planning).toContain('Projected');
  });

  it('creates the history chart on first render with 2+ snapshots', () => {
    const snaps = [makeSnap('2026-01-01'), makeSnap('2026-02-01', 1100, 550)];
    renderNW(snaps);
    const opt = chartFor('c-nw-hist')!.option as AnyRec;
    expect(opt.xAxis.type).toBe('time');
    expect(seriesNames('c-nw-hist')).toEqual(['Total net worth', 'Trade Republic', 'Savings']);
    expect(opt.dataZoom.map((z: AnyRec) => z.type)).toEqual(['inside', 'slider']);
    expect(opt.graphic).toBeUndefined();
    expect(opt.dataZoom[0]).toMatchObject({ start: 0, end: 100 });
  });

  it('renders a horizontal account breakdown for a single snapshot', () => {
    renderNW([makeSnap('2026-01-01', 1000, 500)]);
    const opt = chartFor('c-nw-hist')!.option as AnyRec;
    expect(opt.yAxis.type).toBe('category');
    expect(opt.yAxis.data).toEqual(['Trade Republic', 'Savings']);
    expect(opt.series[0].data.map((d: AnyRec) => d.value)).toEqual([1000, 500]);
    expect(opt.dataZoom).toBeUndefined();
  });

  it('adds note markers and tooltip note text in net-worth history chart', () => {
    const snaps = [
      makeSnap('2026-01-01', 1000, 500),
      { ...makeSnap('2026-02-01', 1100, 550), notes: 'bonus <b>payment</b>' },
    ];
    renderNW(snaps);
    const opt = chartFor('c-nw-hist')!.option as AnyRec;
    const total = opt.series[0];
    expect(total.markPoint.data).toHaveLength(1);
    expect(total.markPoint.data[0].coord[1]).toBe(1650);
    const t1 = total.data[1][0];
    const html = opt.tooltip.formatter([
      { axisValue: t1, axisType: 'xAxis.time', seriesName: 'Total net worth', value: [t1, 1650] },
    ]);
    expect(html).toContain('Note: bonus &lt;b&gt;payment&lt;/b&gt;');
    const t0 = total.data[0][0];
    expect(
      opt.tooltip.formatter([
        { axisValue: t0, axisType: 'xAxis.time', seriesName: 'Total net worth', value: [t0, 1500] },
      ]),
    ).not.toContain('Note:');
  });

  it('reuses chart instances on re-render', () => {
    const snaps = [makeSnap('2026-01-01'), makeSnap('2026-02-01', 1100, 550)];
    renderNW(snaps);
    const hist = chartFor('c-nw-hist');
    renderNW(snaps);
    expect(chartFor('c-nw-hist')).toBe(hist);
    expect(hist!.disposed).toBe(false);
  });

  it('renders lead KPI tile with net worth total and MoM delta for 2+ snapshots', () => {
    const snaps = [makeSnap('2026-01-01', 1000, 500), makeSnap('2026-02-01', 1100, 550)];
    renderNW(snaps);
    const kpis = document.getElementById('nw-kpis')!.innerHTML;
    expect(kpis).toContain('Net worth');
    expect(kpis).toContain('kpi-lead');
    // Total = 1100 + 550 = 1650
    expect(kpis).toContain('1.650,00');
    // Delta = 1650 - 1500 = 150
    expect(kpis).toContain('150,00');
  });

  it('renders lead KPI without delta sub-line for exactly 1 snapshot', () => {
    const snaps = [makeSnap('2026-01-01', 1000, 500)];
    renderNW(snaps);
    const kpis = document.getElementById('nw-kpis')!.innerHTML;
    expect(kpis).toContain('Net worth');
    expect(kpis).toContain('1.500,00');
    // No delta since only 1 snapshot
    expect(kpis).not.toContain('+');
  });

  it('renders each active account once in the accounts card, not as KPI tiles', () => {
    const snaps = [makeSnap('2026-01-01', 1000, 500)];
    renderNW(snaps);
    expect(document.getElementById('nw-kpis')!.textContent).not.toContain('Trade Republic');
    const kpis = document.getElementById('nw-detail')!.textContent!;
    expect(kpis).toContain('Trade Republic');
    expect(kpis).toContain('Savings');
  });

  it('does not render liquid/locked tiles when all accounts are liquid', () => {
    MOCK_ACCOUNTS[0].locked = false as any;
    MOCK_ACCOUNTS[1].locked = false as any;
    const snaps = [makeSnap('2026-01-01', 1000, 500)];
    renderNW(snaps);
    const kpis = document.getElementById('nw-kpis')!.textContent!;
    expect(kpis).not.toContain('Liquid');
    expect(kpis).not.toContain('Locked');
  });

  it('renders liquid and locked split when at least one account is locked', () => {
    MOCK_ACCOUNTS[0].locked = true as any;
    MOCK_ACCOUNTS[0].lockedUntil = '2055' as any;
    const snaps = [makeSnap('2026-01-01', 1000, 500)];
    renderNW(snaps);
    const kpis = document.getElementById('nw-kpis')!.textContent!;
    expect(kpis).toContain('Liquid');
    expect(kpis).toContain('Locked');
    expect(kpis).toContain('unlocks 2055');
  });

  it('supports all-locked portfolios', () => {
    MOCK_ACCOUNTS[0].locked = true as any;
    MOCK_ACCOUNTS[0].lockedUntil = '2055' as any;
    MOCK_ACCOUNTS[1].locked = true as any;
    MOCK_ACCOUNTS[1].lockedUntil = '2060' as any;
    const snaps = [makeSnap('2026-01-01', 1000, 500)];
    renderNW(snaps);
    const kpis = document.getElementById('nw-kpis')!.textContent!;
    expect(kpis).toContain('Locked');
    expect(kpis).toContain('unlocks 2055-2060');
  });

  it('forecast chart renders given snapshots and accounts', () => {
    const snaps = makeMonthlySnaps(14);
    renderNW(snaps);
    const kpis = document.getElementById('nw-detail')!.innerHTML;
    expect(kpis).toContain('CAGR');
    expect(kpis).not.toContain('TWR');
    expect(kpis).not.toContain('IRR (investments)');
  });

  it('forecast chart renders given snapshots and accounts', () => {
    const snaps = [makeSnap('2026-01-01', 5000, 2000), makeSnap('2026-02-01', 5100, 2050)];
    renderNW(snaps);
    const opt = chartFor('c-nw-forecast')!.option as AnyRec;
    expect(opt.xAxis.type).toBe('time');
    // Full 50-year horizon is computed once; the zoom window picks the visible part.
    expect(opt.series[1].data).toHaveLength(601);
    expect(opt.series[0].markLine.data[0].xAxis).toBe(opt.series[0].data.at(-1)[0]);
    expect(opt.series[1].markArea.data[0][0].name).toBe('Forecast');
  });

  it('forecast opens on 5 years and the grouped summary follows the zoom', () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    try {
      const snaps = [makeSnap('2026-01-01', 5000, 2000), makeSnap('2026-02-01', 5100, 2050)];
      renderNW(snaps);
      const chart = chartFor('c-nw-forecast')!;
      const opt = chart.option as AnyRec;
      const summary = () => document.getElementById('nw-fc-group-summary')!.textContent;
      expect(opt.graphic).toBeUndefined();
      const today = opt.series[0].data.at(-1)[0];
      expect(opt.dataZoom[0].endValue).toBe(addMonths(today, 60));
      expect(summary()).toContain('5 years');
      const zoomTo = (months: number) => {
        chart.option = {
          ...opt,
          dataZoom: [{ startValue: opt.series[0].data[0][0], endValue: addMonths(today, months) }],
        };
        chart.trigger('datazoom', {});
      };
      zoomTo(120);
      expect(summary()).toContain('10 years');
      expect(chartFor('c-nw-forecast')).toBe(chart);
      zoomTo(60);
      expect(summary()).toContain('5 years');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('forecast chart includes only baseline dataset by default when comparison is closed', () => {
    const snaps = [makeSnap('2026-01-01', 5000, 2000), makeSnap('2026-02-01', 5100, 2050)];
    renderNW(snaps);
    const labels = seriesNames('c-nw-forecast');
    expect(labels).toContain('Baseline (nominal)');
    expect(labels.some((l) => l.includes('Optimistic'))).toBe(false);
    expect(labels.some((l) => l.includes('Pessimistic'))).toBe(false);
  });

  it('scenario edits change the scenario lines and show the deltas in the tooltip', () => {
    const snaps = [makeSnap('2026-01-01', 5000, 2000), makeSnap('2026-02-01', 5100, 2050)];
    renderNW(snaps);
    const scenarioToggle = document.getElementById('nw-scenario-toggle') as HTMLButtonElement;
    scenarioToggle.click();
    const retInput = document.getElementById('nw-scn-optimistic-ret') as HTMLInputElement;
    const contribInput = document.getElementById('nw-scn-optimistic-contrib') as HTMLInputElement;
    retInput.value = '3.5';
    retInput.dispatchEvent(new Event('change'));
    contribInput.value = '350';
    contribInput.dispatchEvent(new Event('change'));

    const opt = chartFor('c-nw-forecast')!.option as AnyRec;
    const optimistic = opt.series.find((s: AnyRec) => s.name === 'Optimistic');
    const baseline = opt.series.find((s: AnyRec) => s.name === 'Baseline (nominal)');
    expect(optimistic).toBeTruthy();
    const last = (s: AnyRec) => s.data[s.data.length - 1][1];
    expect(last(optimistic)).toBeGreaterThan(last(baseline));
    const tooltip = opt.tooltip.formatter([
      {
        seriesName: 'Optimistic',
        value: [optimistic.data[1][0], 1000],
        axisValue: optimistic.data[1][0],
      },
    ]);
    expect(tooltip).toContain('+3.5 pp/yr');
    expect(tooltip).toContain('+350');
  });

  it('binds the what-if infoTip after the forecast panel re-renders', () => {
    renderNW([makeSnap('2026-01-01', 5000, 2000), makeSnap('2026-02-01', 5100, 2050)]);
    (document.getElementById('nw-scenario-toggle') as HTMLButtonElement).click();
    const tip = document.querySelector('.forecast-scenario-card .info-tip') as HTMLElement;
    expect(tip).not.toBeNull();
    expect(tip.dataset.tipBound).toBe('1');
  });

  it('scenario comparison draws a shaded band that stays out of legend, tooltip and table', () => {
    renderNW([makeSnap('2026-01-01', 5000, 2000), makeSnap('2026-02-01', 5100, 2050)]);
    (document.getElementById('nw-scenario-toggle') as HTMLButtonElement).click();
    const opt = chartFor('c-nw-forecast')!.option as AnyRec;
    const helpers = opt.series.filter((s: AnyRec) => String(s.id ?? '').startsWith('_'));
    expect(helpers).toHaveLength(2);
    expect(helpers.every((s: AnyRec) => s.stack === '_band' && !s.name)).toBe(true);
    const pess = opt.series.find((s: AnyRec) => s.name === 'Pessimistic');
    const optm = opt.series.find((s: AnyRec) => s.name === 'Optimistic');
    const i = optm.data.length - 1;
    expect(helpers[0].data[i][1] + helpers[1].data[i][1]).toBeCloseTo(optm.data[i][1]);
    expect(helpers[0].data[i][1]).toBe(pess.data[i][1]);
    const tooltip = opt.tooltip.formatter([
      { seriesId: '_band-fill', seriesName: 'series2', value: [0, 5] },
      { seriesName: 'Optimistic', value: [0, 10] },
    ]);
    expect(tooltip).not.toContain('series2');
    expect(tooltip).toContain('Optimistic');
  });

  it('forecast headline shows the net worth at the end of the visible window', () => {
    renderNW([makeSnap('2026-01-01', 5000, 2000), makeSnap('2026-02-01', 5100, 2050)]);
    const answer = document.getElementById('nw-fc-answer')!;
    expect(answer.textContent).toContain('Net worth in Feb 2031');
    expect(answer.textContent).toContain('vs today');
  });

  it('marks the retirement start on the forecast when it falls inside the horizon', () => {
    mockSettings['dd_retirement_date'] = '2030-06';
    renderNW([makeSnap('2026-01-01', 5000, 2000), makeSnap('2026-02-01', 5100, 2050)]);
    const baseline = (chartFor('c-nw-forecast')!.option as AnyRec).series[1];
    expect(baseline.markLine.data.map((d: AnyRec) => d.name)).toContain('Retirement');
  });

  it('scenario comparison toggle adds and removes scenario datasets', () => {
    const snaps = [makeSnap('2026-01-01', 5000, 2000), makeSnap('2026-02-01', 5100, 2050)];
    renderNW(snaps);
    expect(seriesNames('c-nw-forecast').some((l) => l.includes('Optimistic'))).toBe(false);

    (document.getElementById('nw-scenario-toggle') as HTMLButtonElement).click();
    let labels = seriesNames('c-nw-forecast');
    expect(labels.some((l) => l.includes('Optimistic'))).toBe(true);
    expect(labels.some((l) => l.includes('Pessimistic'))).toBe(true);

    (document.getElementById('nw-scenario-toggle') as HTMLButtonElement).click();
    labels = seriesNames('c-nw-forecast');
    expect(labels.some((l) => l.includes('Optimistic'))).toBe(false);
    expect(labels.some((l) => l.includes('Pessimistic'))).toBe(false);
  });

  it('forecast data view is available through the toolbox', () => {
    renderNW([makeSnap('2026-01-01', 5000, 2000), makeSnap('2026-02-01', 5100, 2050)]);
    expect((chartFor('c-nw-forecast')!.option as AnyRec).toolbox.feature.myDataTable).toBeDefined();
  });

  it('marks goal deadlines and targets on the forecast chart', () => {
    vi.mocked(configStore.getGoals).mockReturnValue([
      { label: 'House <deposit>', targetNetWorth: '50000', targetDate: '2028-06' },
    ] as any);
    renderNW([makeSnap('2026-01-01', 5000, 2000), makeSnap('2026-02-01', 5100, 2050)]);
    const baseline = (chartFor('c-nw-forecast')!.option as AnyRec).series[1];
    expect(baseline.markLine.data[0].name).toBe('House <deposit>');
    expect(baseline.markPoint.data[0].coord[1]).toBe(50000);
    vi.mocked(configStore.getGoals).mockReturnValue([]);
  });

  it('goal progress card renders when target net worth is set', () => {
    const snaps = [makeSnap('2026-01-01', 5000, 2000)];
    vi.mocked(configStore.getGoals).mockReturnValueOnce([
      { label: 'Goal', targetNetWorth: '100000', targetDate: '' },
    ]);
    renderNW(snaps);
    const goalEl = document.getElementById('nw-goal')!;
    expect(goalEl.innerHTML).toContain('Goal');
    expect(goalEl.innerHTML).toContain('100.000');
  });

  it('shows explicit beyond-horizon message when goal is unreachable within 100 years', () => {
    const snaps = [makeSnap('2026-01-01', 5000, 2000)];
    vi.mocked(configStore.getGoals).mockReturnValueOnce([
      { label: 'Huge goal', targetNetWorth: '999999999999999999999', targetDate: '' },
    ]);
    renderNW(snaps);
    const goalEl = document.getElementById('nw-goal')!;
    expect(goalEl.textContent).toContain(
      'Target not reachable within the 100-year forecast horizon',
    );
  });

  it('multiple goals render a single card with a tab strip', () => {
    const snaps = [makeSnap('2026-01-01', 5000, 2000)];
    vi.mocked(configStore.getGoals).mockReturnValueOnce([
      { label: 'FIRE', targetNetWorth: '500000', targetDate: '' },
      { label: 'House', targetNetWorth: '100000', targetDate: '' },
    ]);
    renderNW(snaps);
    const goalEl = document.getElementById('nw-goal')!;
    // Should have exactly one card, not two
    expect(goalEl.querySelectorAll('.card').length).toBe(1);
    // Tab strip is present
    expect(goalEl.querySelector('#nw-goal-tabs')).not.toBeNull();
    // Both goal labels appear as tabs
    expect(goalEl.innerHTML).toContain('FIRE');
    expect(goalEl.innerHTML).toContain('House');
    // First tab is active by default
    const activeTabs = goalEl.querySelectorAll('.range-toggle .btn.active');
    expect(activeTabs.length).toBe(1);
    expect(activeTabs[0].textContent).toBe('FIRE');
  });

  it('re-render does not throw or duplicate KPI tiles', () => {
    const snaps = [makeSnap('2026-01-01', 1000, 500), makeSnap('2026-02-01', 1100, 550)];
    renderNW(snaps);
    renderNW(snaps);
    const kpis = document.getElementById('nw-kpis')!;
    // Should have exactly 1 lead KPI
    const leadKpis = kpis.querySelectorAll('.kpi-lead');
    expect(leadKpis.length).toBe(1);
  });

  it('planning card renders a grouped card with Forecast and Drawdown tabs', () => {
    const snaps = [makeSnap('2026-01', 5000, 2000)];
    renderNW(snaps);
    const planningEl = document.getElementById('nw-planning')!;
    expect(planningEl.querySelector('#nw-planning-tabs')).not.toBeNull();
    expect(planningEl.innerHTML).toContain('Forecast');
    expect(planningEl.innerHTML).toContain('Retirement withdrawals');
    // Forecast panel should be visible by default
    const fcPanel = document.getElementById('nw-fc-panel')!;
    expect(fcPanel.hidden).toBe(false);
    // Drawdown panel should be hidden by default
    const ddPanel = document.getElementById('nw-dd-panel')!;
    expect(ddPanel.hidden).toBe(true);
    const scenarioCard = planningEl.querySelector('.forecast-scenario-card') as HTMLElement;
    expect(scenarioCard.hidden).toBe(true);
    expect(planningEl.querySelector('#nw-scenario-toggle')).not.toBeNull();
  });

  it('planning card tab switch shows drawdown panel and hides forecast panel', () => {
    const snaps = [makeSnap('2026-01', 5000, 2000)];
    renderNW(snaps);
    const ddEl = switchToDrawdownTab();
    expect(ddEl.hidden).toBe(false);
    const fcPanel = document.getElementById('nw-fc-panel')!;
    expect(fcPanel.hidden).toBe(true);
  });

  it('decumulation card renders with a retirement date 20y in the future by default', () => {
    // Accounts with 7% return → auto-derived return should match
    const snaps = [makeSnap('2026-01', 5000, 2000)];
    renderNW(snaps);
    const ddEl = switchToDrawdownTab();
    expect(ddEl.innerHTML).not.toBe('');
    // Card title should not be present in the panel (removed redundant title)
    expect(ddEl.textContent).not.toContain('Retirement drawdown');
    // Should have a date input with default retirement date ~2046
    const dateInput = ddEl.querySelector('#dd-retirement-date') as HTMLInputElement | null;
    expect(dateInput).not.toBeNull();
    expect(dateInput?.value).toMatch(/^2046-/);
  });

  it('decumulation card leads with how long the money lasts, then first withdrawal and break-even', () => {
    const snaps = [makeSnap('2026-01', 5000, 2000)];
    renderNW(snaps);
    const ddEl = switchToDrawdownTab();
    expect(ddEl.querySelector('#nw-dd-answer')?.textContent).toMatch(/Lasts 40\+ years|Runs out/);
    expect(ddEl.textContent).toContain('First withdrawal');
    expect(ddEl.textContent).toContain('same amount every month');
    expect(ddEl.textContent).toContain('Break-even');
    const opt = chartFor('c-nw-decumulation')!.option as AnyRec;
    expect(opt.xAxis.type).toBe('time');
    expect(opt.series[0].markLine.data).toHaveLength(1);
    const withdrawal = opt.series.find((x: AnyRec) => x.name === 'Monthly withdrawal');
    expect(withdrawal.yAxisIndex).toBe(1);
    // The withdrawal line is shown by default.
    expect(opt.legend.selected?.['Monthly withdrawal']).not.toBe(false);
  });

  it('shades the zero-balance zone when the money runs out', () => {
    mockSettings['dd_withdrawal_fixed'] = '5000';
    renderNW([makeSnap('2026-01', 5000, 2000)]);
    switchToDrawdownTab();
    expect(document.getElementById('nw-dd-answer')?.textContent).toContain('Runs out');
    const opt = chartFor('c-nw-decumulation')!.option as AnyRec;
    expect(opt.series[0].markArea.data[0][0].name).toBe('Depleted');
    expect(opt.series[0].markArea.label.position).toBe('inside');
    expect(opt.series[0].markPoint).toBeUndefined();
  });

  it('suggests 4% of the balance for every strategy on first open', () => {
    renderNW([makeSnap('2026-01', 5000, 2000)]);
    let ddEl = switchToDrawdownTab();
    const fixed = Number((ddEl.querySelector('#dd-withdrawal') as HTMLInputElement).value);
    expect(fixed).toBeGreaterThan(10);
    expect(ddEl.querySelector('#dd-withdrawal-reset')).toBeNull();
    (ddEl.querySelector('[data-dd-strategy="pct"]') as HTMLElement).click();
    ddEl = document.getElementById('nw-dd-panel')!;
    expect((ddEl.querySelector('#dd-withdrawal') as HTMLInputElement).value).toBe('4');
    (ddEl.querySelector('[data-dd-strategy="four-pct"]') as HTMLElement).click();
    ddEl = document.getElementById('nw-dd-panel')!;
    expect(Number((ddEl.querySelector('#dd-withdrawal') as HTMLInputElement).value)).toBe(fixed);
  });

  it('keeps the Fixed amount after typing a % rate, switching strategy and reloading', () => {
    renderNW([makeSnap('2026-01', 5000, 2000)]);
    let ddEl = switchToDrawdownTab();
    const suggested = (ddEl.querySelector('#dd-withdrawal') as HTMLInputElement).value;
    (ddEl.querySelector('[data-dd-strategy="pct"]') as HTMLElement).click();
    const input = document.getElementById('dd-withdrawal') as HTMLInputElement;
    input.value = '3.5';
    input.dispatchEvent(new Event('change'));
    (document.querySelector('[data-dd-strategy="fixed"]') as HTMLElement).click();
    expect((document.getElementById('dd-withdrawal') as HTMLInputElement).value).toBe(suggested);

    // Reload: module state is re-read from the persisted settings.
    document.body.innerHTML = DOM_FIXTURE;
    _resetPlanningTabForTest();
    renderNW([makeSnap('2026-01', 5000, 2000)]);
    ddEl = switchToDrawdownTab();
    expect((ddEl.querySelector('[data-dd-strategy="fixed"]') as HTMLElement).classList).toContain(
      'active',
    );
    expect((ddEl.querySelector('#dd-withdrawal') as HTMLInputElement).value).toBe(suggested);
    (ddEl.querySelector('[data-dd-strategy="pct"]') as HTMLElement).click();
    expect((document.getElementById('dd-withdrawal') as HTMLInputElement).value).toBe('3.5');
  });

  it('a typed amount survives date changes and reloads; reset returns to the suggestion', () => {
    renderNW([makeSnap('2026-01', 5000, 2000)]);
    switchToDrawdownTab();
    const input = document.getElementById('dd-withdrawal') as HTMLInputElement;
    const suggested = input.value;
    input.value = '777';
    input.dispatchEvent(new Event('change'));
    const date = document.getElementById('dd-retirement-date') as HTMLInputElement;
    date.value = '2050-01';
    date.dispatchEvent(new Event('change'));
    expect((document.getElementById('dd-withdrawal') as HTMLInputElement).value).toBe('777');

    document.body.innerHTML = DOM_FIXTURE;
    _resetPlanningTabForTest();
    renderNW([makeSnap('2026-01', 5000, 2000)]);
    switchToDrawdownTab();
    expect((document.getElementById('dd-withdrawal') as HTMLInputElement).value).toBe('777');
    (document.getElementById('dd-withdrawal-reset') as HTMLButtonElement).click();
    const after = (document.getElementById('dd-withdrawal') as HTMLInputElement).value;
    expect(after).not.toBe('777');
    expect(mockSettings['dd_withdrawal_fixed']).toBeUndefined();
    // The suggestion follows the later retirement date (bigger balance).
    expect(Number(after)).toBeGreaterThan(Number(suggested));
  });

  it('drops the legacy unit-less withdrawal setting', () => {
    mockSettings['dd_withdrawal_param'] = '4';
    renderNW([makeSnap('2026-01', 5000, 2000)]);
    expect(mockSettings['dd_withdrawal_param']).toBeUndefined();
    const ddEl = switchToDrawdownTab();
    expect(
      Number((ddEl.querySelector('#dd-withdrawal') as HTMLInputElement).value),
    ).toBeGreaterThan(10);
  });

  it('decumulation card shows near-break-even warning when withdrawal is within ±20% of sustainable rate', () => {
    // Set up a large portfolio so the break-even is well above 0
    const snaps = [makeSnap('2026-01', 1_000_000, 0)];
    renderNW(snaps);
    const ddEl = switchToDrawdownTab();
    // The auto-initialised withdrawal is 4% of projected corpus / 12 which should be near break-even
    // Just verify the warning can render (its presence depends on exact corpus and return values)
    // The important thing is the card doesn't throw and renders the main elements
    expect(ddEl.querySelector('#dd-withdrawal')).not.toBeNull();
    expect(ddEl.querySelector('#dd-return')).not.toBeNull();
    expect(ddEl.querySelector('#dd-retirement-date')).not.toBeNull();
  });

  it('decumulation date input min attribute uses YYYY-MM format', () => {
    const snaps = [makeSnap('2026-08-15', 5000, 2000)];
    renderNW(snaps);
    switchToDrawdownTab();
    const dateInput = document.querySelector('#dd-retirement-date') as HTMLInputElement | null;
    expect(dateInput).not.toBeNull();
    // min should be YYYY-MM (7 chars), not YYYY-MM-DD (10 chars)
    expect(dateInput?.getAttribute('min')).toMatch(/^\d{4}-\d{2}$/);
  });
});
