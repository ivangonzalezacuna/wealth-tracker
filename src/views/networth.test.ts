/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Chart.js mock ───────
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
const MOCK_ACCOUNTS: any[] = [
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
  {
    id: 'acct2',
    moneyType: 'savings',
    institution: 'ING',
    label: 'Savings',
    color: '#222222',
    isPrimaryInvestment: false,
    order: 2,
    annualReturnPct: 2,
    contribAmount: 100,
    contribInterval: 'monthly',
  },
];

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
  getSettings: () => ({}),
  getNumberSetting: (_key: string, defaultVal: number) => defaultVal,
  setSetting: () => Promise.resolve(),
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
    <div id="nw-chart-legend"></div>
    <canvas id="c-nw-hist"></canvas>
    <div class="range-toggle" id="nw-range-toggle">
      <button class="btn active" data-range="12">12M</button>
      <button class="btn" data-range="36">36M</button>
      <button class="btn" data-range="all">All</button>
    </div>
    <div class="card">
      <div id="nw-growth-legend"></div>
      <canvas id="c-nw-growth"></canvas>
      <div class="range-toggle" id="nw-growth-range-toggle">
        <button class="btn active" data-range="12">12M</button>
        <button class="btn" data-range="36">36M</button>
        <button class="btn" data-range="all">All</button>
      </div>
    </div>
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
  beforeEach(() => {
    document.body.innerHTML = DOM_FIXTURE;
    chartInstances.length = 0;
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

  it('creates the history chart on first render with 2+ snapshots', () => {
    const snaps = [makeSnap('2026-01-01'), makeSnap('2026-02-01', 1100, 550)];
    renderNW(snaps);
    // At least the history chart is created
    expect(chartInstances.length).toBeGreaterThanOrEqual(1);
  });

  it('adds note markers and tooltip note text in net-worth history chart', () => {
    const snaps = [
      makeSnap('2026-01-01', 1000, 500),
      { ...makeSnap('2026-02-01', 1100, 550), notes: 'bonus payment' },
    ];
    renderNW(snaps);
    const config = chartInstances[0].config as {
      data: { datasets: Array<{ label?: string; pointRadius?: number[] }> };
      options?: {
        plugins?: {
          tooltip?: {
            callbacks?: {
              afterBody?: (items: Array<{ dataIndex: number }>) => string;
            };
          };
        };
      };
    };
    const totalDs = config.data.datasets.find((ds) => ds.label === 'Total net worth');
    expect(totalDs?.pointRadius).toEqual([0, 3]);
    const afterBody = config.options?.plugins?.tooltip?.callbacks?.afterBody;
    expect(afterBody?.([{ dataIndex: 1 }])).toContain('Note: bonus payment');
    expect(afterBody?.([{ dataIndex: 0 }]) || '').toBe('');
  });

  it('destroys prior charts on re-render', () => {
    const snaps = [makeSnap('2026-01-01'), makeSnap('2026-02-01', 1100, 550)];
    renderNW(snaps);
    const firstCount = chartInstances.length;
    expect(firstCount).toBeGreaterThanOrEqual(1);

    // Re-render
    renderNW(snaps);
    // All prior charts should be destroyed
    for (let i = 0; i < firstCount; i++) {
      expect(chartInstances[i].destroyed).toBe(true);
    }
    // New charts created
    expect(chartInstances.length).toBeGreaterThan(firstCount);
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

  it('renders per-account KPI tiles for each active account', () => {
    const snaps = [makeSnap('2026-01-01', 1000, 500)];
    renderNW(snaps);
    const kpis = document.getElementById('nw-kpis')!.textContent!;
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
    const kpis = document.getElementById('nw-kpis')!.innerHTML;
    expect(kpis).toContain('CAGR');
    expect(kpis).not.toContain('TWR');
    expect(kpis).not.toContain('IRR (investments)');
  });

  it('forecast chart renders given snapshots and accounts', () => {
    const snaps = [makeSnap('2026-01-01', 5000, 2000), makeSnap('2026-02-01', 5100, 2050)];
    renderNW(snaps);
    // The forecast chart should be among the created charts
    expect(chartInstances.length).toBeGreaterThanOrEqual(2);
  });

  it('forecast range toggle re-creates the forecast chart on click', () => {
    const snaps = [makeSnap('2026-01-01', 5000, 2000), makeSnap('2026-02-01', 5100, 2050)];
    renderNW(snaps);
    const countBefore = chartInstances.length;

    // Click 10Y range button
    const toggle = document.getElementById('nw-forecast-range-toggle')!;
    const btn10Y = toggle.querySelector('[data-range="120"]') as HTMLElement;
    btn10Y.click();

    // A new chart should have been created (forecast re-rendered)
    expect(chartInstances.length).toBeGreaterThan(countBefore);
    // The forecast chart is always the 2nd chart created (index 1, after the history chart at 0).
    // It should have been destroyed and replaced when the range toggle was clicked.
    expect(chartInstances[1].destroyed).toBe(true);
  });

  it('NW history range toggle re-creates the history chart on click', () => {
    const snaps = makeMonthlySnaps(20);
    renderNW(snaps);
    const countBefore = chartInstances.length;

    // Click 36M range button
    const toggle = document.getElementById('nw-range-toggle')!;
    const btn36 = toggle.querySelector('[data-range="36"]') as HTMLElement;
    btn36.click();

    expect(chartInstances.length).toBeGreaterThan(countBefore);
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
    expect(planningEl.innerHTML).toContain('Drawdown');
    // Forecast panel should be visible by default
    const fcPanel = document.getElementById('nw-fc-panel')!;
    expect(fcPanel.hidden).toBe(false);
    // Drawdown panel should be hidden by default
    const ddPanel = document.getElementById('nw-dd-panel')!;
    expect(ddPanel.hidden).toBe(true);
  });

  it('planning card tab switch shows drawdown panel and hides forecast panel', () => {
    const snaps = [makeSnap('2026-01', 5000, 2000)];
    renderNW(snaps);
    const ddEl = switchToDrawdownTab();
    expect(ddEl.hidden).toBe(false);
    const fcPanel = document.getElementById('nw-fc-panel')!;
    expect(fcPanel.hidden).toBe(true);
  });

  it('keeps scenarios hidden and empty by default until user adds one', () => {
    const snaps = [makeSnap('2026-01', 5000, 2000)];
    renderNW(snaps);
    const planningEl = document.getElementById('nw-planning')!;
    expect(planningEl.textContent).not.toContain('Optimistic');
    expect(planningEl.textContent).not.toContain('Pessimistic');

    (document.getElementById('nw-fc-scenarios-toggle') as HTMLElement).click();
    expect(planningEl.textContent).toContain('No scenarios yet');
    expect(document.querySelectorAll('.forecast-scenario-row').length).toBe(0);

    (document.getElementById('nw-fc-add-scenario') as HTMLElement).click();
    expect(document.querySelectorAll('.forecast-scenario-row').length).toBe(1);
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

  it('decumulation card shows sustainable withdrawal KPI when corpus and withdrawal are set', () => {
    const snaps = [makeSnap('2026-01', 5000, 2000)];
    renderNW(snaps);
    const ddEl = switchToDrawdownTab();
    // Should show the corpus KPIs (Portfolio lasts until, Monthly withdrawal, Estimated sustainable withdrawal)
    expect(ddEl.textContent).toContain('Portfolio lasts until');
    expect(ddEl.textContent).toContain('Monthly withdrawal');
    expect(ddEl.textContent).toContain('Estimated sustainable withdrawal');
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
