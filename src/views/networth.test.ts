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
    annualTaxDragPct: 10,
    drawdownStartMonth: '2035-01',
    annualWithdrawal: 12000,
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
    annualTaxDragPct: 0,
    drawdownStartMonth: '',
    annualWithdrawal: 0,
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
  isConfigLoaded: () => true,
  getGoals: vi.fn(() => []),
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
  },
}));

import { renderNW } from './networth';
import type { PortfolioData, Snapshot } from '../types';
import * as configStore from '../store/config';

function makeSnap(date: string, acct1 = 1000, acct2 = 500): Snapshot {
  return { date, acct1, acct2 };
}

function makePD(overrides: Partial<PortfolioData> = {}): PortfolioData {
  return {
    etfs: {},
    divHist: [],
    intHist: [],
    monthly: {},
    monthlyBy: {},
    months: [],
    totalInv: 0,
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
    <div id="nw-forecast">
      <div class="card">
        <div id="nw-forecast-legend"></div>
        <canvas id="c-nw-forecast"></canvas>
        <div class="range-toggle" id="nw-forecast-range-toggle">
          <button class="btn active" data-range="60">5Y</button>
          <button class="btn" data-range="120">10Y</button>
          <button class="btn" data-range="240">20Y</button>
          <button class="btn" data-range="360">30Y</button>
        </div>
      </div>
    </div>
    <div id="nw-goal"></div>
    <div id="nw-detail"></div>
  </div>
  <div id="networth"></div>
`;

describe('renderNW', () => {
  beforeEach(() => {
    document.body.innerHTML = DOM_FIXTURE;
    chartInstances.length = 0;
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
    renderNW(null, []);
    expect((document.getElementById('nw-empty') as HTMLElement).style.display).toBe('block');
    expect((document.getElementById('nw-content') as HTMLElement).style.display).toBe('none');
    expect(chartInstances.length).toBe(0);
  });

  it('shows empty state when pd is provided but snaps is empty', () => {
    renderNW(makePD(), []);
    expect((document.getElementById('nw-empty') as HTMLElement).style.display).toBe('block');
    expect((document.getElementById('nw-content') as HTMLElement).style.display).toBe('none');
    expect(chartInstances.length).toBe(0);
  });

  it('renders content when snaps have data', () => {
    const snaps = [makeSnap('2026-01-01'), makeSnap('2026-02-01', 1100, 550)];
    renderNW(makePD(), snaps);
    expect((document.getElementById('nw-empty') as HTMLElement).style.display).toBe('none');
    expect((document.getElementById('nw-content') as HTMLElement).style.display).toBe('block');
  });

  it('creates the history chart on first render with 2+ snapshots', () => {
    const snaps = [makeSnap('2026-01-01'), makeSnap('2026-02-01', 1100, 550)];
    renderNW(makePD(), snaps);
    // At least the history chart is created
    expect(chartInstances.length).toBeGreaterThanOrEqual(1);
  });

  it('destroys prior charts on re-render', () => {
    const snaps = [makeSnap('2026-01-01'), makeSnap('2026-02-01', 1100, 550)];
    renderNW(makePD(), snaps);
    const firstCount = chartInstances.length;
    expect(firstCount).toBeGreaterThanOrEqual(1);

    // Re-render
    renderNW(makePD(), snaps);
    // All prior charts should be destroyed
    for (let i = 0; i < firstCount; i++) {
      expect(chartInstances[i].destroyed).toBe(true);
    }
    // New charts created
    expect(chartInstances.length).toBeGreaterThan(firstCount);
  });

  it('renders lead KPI tile with net worth total and MoM delta for 2+ snapshots', () => {
    const snaps = [makeSnap('2026-01-01', 1000, 500), makeSnap('2026-02-01', 1100, 550)];
    renderNW(makePD(), snaps);
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
    renderNW(makePD(), snaps);
    const kpis = document.getElementById('nw-kpis')!.innerHTML;
    expect(kpis).toContain('Net worth');
    expect(kpis).toContain('1.500,00');
    // No delta since only 1 snapshot
    expect(kpis).not.toContain('+');
  });

  it('renders per-account KPI tiles for each active account', () => {
    const snaps = [makeSnap('2026-01-01', 1000, 500)];
    renderNW(makePD(), snaps);
    const kpis = document.getElementById('nw-kpis')!.textContent!;
    expect(kpis).toContain('Trade Republic');
    expect(kpis).toContain('Savings');
  });

  it('does not render liquid/locked tiles when all accounts are liquid', () => {
    MOCK_ACCOUNTS[0].locked = false as any;
    MOCK_ACCOUNTS[1].locked = false as any;
    const snaps = [makeSnap('2026-01-01', 1000, 500)];
    renderNW(makePD(), snaps);
    const kpis = document.getElementById('nw-kpis')!.textContent!;
    expect(kpis).not.toContain('Liquid');
    expect(kpis).not.toContain('Locked');
  });

  it('renders liquid and locked split when at least one account is locked', () => {
    MOCK_ACCOUNTS[0].locked = true as any;
    MOCK_ACCOUNTS[0].lockedUntil = '2055' as any;
    const snaps = [makeSnap('2026-01-01', 1000, 500)];
    renderNW(makePD(), snaps);
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
    renderNW(makePD(), snaps);
    const kpis = document.getElementById('nw-kpis')!.textContent!;
    expect(kpis).toContain('Locked');
    expect(kpis).toContain('unlocks 2055-2060');
  });

  it('forecast chart renders given snapshots and accounts', () => {
    const snaps = makeMonthlySnaps(14);
    renderNW(makePD(), snaps);
    const kpis = document.getElementById('nw-kpis')!.innerHTML;
    expect(kpis).toContain('CAGR');
    expect(kpis).not.toContain('TWR');
    expect(kpis).not.toContain('IRR (investments)');
  });

  it('forecast chart renders given snapshots and accounts', () => {
    const snaps = [makeSnap('2026-01-01', 5000, 2000), makeSnap('2026-02-01', 5100, 2050)];
    renderNW(makePD(), snaps);
    // The forecast chart should be among the created charts
    expect(chartInstances.length).toBeGreaterThanOrEqual(2);
  });

  it('forecast assumptions copy includes phased drawdown and tax drag context', () => {
    const snaps = [makeSnap('2026-01-01', 5000, 2000), makeSnap('2026-02-01', 5100, 2050)];
    renderNW(makePD(), snaps);
    const forecast = document.getElementById('nw-forecast')!.textContent || '';
    expect(forecast).toContain('Deterministic two-phase projection');
    expect(forecast).toContain('drawdown');
    expect(forecast).toContain('tax drag');
  });

  it('forecast range toggle re-creates the forecast chart on click', () => {
    const snaps = [makeSnap('2026-01-01', 5000, 2000), makeSnap('2026-02-01', 5100, 2050)];
    renderNW(makePD(), snaps);
    const countBefore = chartInstances.length;

    // Click 10Y range button
    const toggle = document.getElementById('nw-forecast-range-toggle')!;
    const btn10Y = toggle.querySelector('[data-range="120"]') as HTMLElement;
    btn10Y.click();

    // A new chart should have been created (forecast re-rendered)
    expect(chartInstances.length).toBeGreaterThan(countBefore);
    // Prior forecast chart destroyed
    expect(chartInstances[countBefore - 1].destroyed).toBe(true);
  });

  it('NW history range toggle re-creates the history chart on click', () => {
    const snaps = makeMonthlySnaps(20);
    renderNW(makePD(), snaps);
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
    renderNW(makePD(), snaps);
    const goalEl = document.getElementById('nw-goal')!;
    expect(goalEl.innerHTML).toContain('Goal');
    expect(goalEl.innerHTML).toContain('100.000');
  });

  it('multiple goals render a single card with a tab strip', () => {
    const snaps = [makeSnap('2026-01-01', 5000, 2000)];
    vi.mocked(configStore.getGoals).mockReturnValueOnce([
      { label: 'FIRE', targetNetWorth: '500000', targetDate: '' },
      { label: 'House', targetNetWorth: '100000', targetDate: '' },
    ]);
    renderNW(makePD(), snaps);
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
    renderNW(makePD(), snaps);
    renderNW(makePD(), snaps);
    const kpis = document.getElementById('nw-kpis')!;
    // Should have exactly 1 lead KPI
    const leadKpis = kpis.querySelectorAll('.kpi-lead');
    expect(leadKpis.length).toBe(1);
  });
});
