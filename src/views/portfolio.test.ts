/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('echarts/core', () => import('./charts/echartsMock'));
import { chartFor, instances as chartInstances, resetMockCharts } from './charts/echartsMock';
import { loadCharts } from './charts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = any;
const costOption = () => chartFor('c-port-donut')!.option as AnyRec;
const driftOption = () => chartFor('c-port-drift')!.option as AnyRec;

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
    targetPct: 50,
    assetClass: 'equity',
    region: 'developed',
    foldInto: '',
    order: 1,
  },
];
vi.mock('../store/config', () => ({
  getAccounts: () => MOCK_ACCOUNTS,
  getHoldings: () => MOCK_HOLDINGS,
  getAlertSettings: () => ({ driftThresholdPct: 5 }),
  getMonthlyContribBudget: () => 500,
  getCalibrationInterval: () => 'monthly',
  isConfigLoaded: () => true,
  getISIN_ORDER: () => ['IE00TEST1'],
  getMETA: () => ({ IWDA: { color: '#222222', acc: true, active: true } }),
  getACCTS: () => [{ key: 'acct1', label: 'Trade Republic', color: '#111111' }],
}));

vi.mock('../constants', () => ({
  getISIN_ORDERList: () => ['IE00TEST1'],
  getMETAMap: () => Object.fromEntries(MOCK_HOLDINGS.map((holding) => [holding.isin, holding])),
}));

let _collapseState: Record<string, boolean> = {};
vi.mock('../ui/collapseState', () => ({
  isCollapsed: (key: string) => !!_collapseState[key],
  setCollapsed: (key: string, v: boolean) => {
    if (v) _collapseState[key] = true;
    else delete _collapseState[key];
  },
  loadCollapseState: () => Promise.resolve(),
  isCollapseStateLoaded: () => true,
}));

import { getMaxDrift, renderPortfolio } from './portfolio';
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
    totalIntGross: 0,
    totalIntTax: 0,
    realizedPnL: 0,
    interestBySource: {},
    taxBySource: {},
    ...overrides,
  };
}

function setRebalanceHoldings(): void {
  MOCK_HOLDINGS.splice(
    0,
    MOCK_HOLDINGS.length,
    {
      isin: 'IE00TEST1',
      shortName: 'IWDA',
      name: 'World',
      color: '#222222',
      acc: true,
      active: true,
      targetPct: 70,
      assetClass: 'equity',
      region: 'developed',
      foldInto: '',
      order: 1,
    } as any,
    {
      isin: 'IE00TEST2',
      shortName: 'EM',
      name: 'Emerging',
      color: '#333333',
      acc: true,
      active: true,
      targetPct: 30,
      assetClass: 'equity',
      region: 'emerging',
      foldInto: '',
      order: 2,
    } as any,
  );
}

function makeRebalancePd(overrides: Partial<PortfolioData> = {}): PortfolioData {
  return makePD({
    etfs: {
      IE00TEST1: makeEtf({ isin: 'IE00TEST1', shortName: 'IWDA', cost: 8000 }),
      IE00TEST2: makeEtf({ isin: 'IE00TEST2', shortName: 'EM', cost: 2000 }),
    },
    totalInv: 10000,
    ...overrides,
  });
}

/** Snapshot that provides market values matching the default makeRebalancePd ETF costs. */
function makeRebalanceSnap(overrides: Record<string, number> = {}): Snapshot {
  return {
    date: '2026-06-01',
    acct1: 10000,
    etf_IE00TEST1: 8000,
    etf_IE00TEST2: 2000,
    ...overrides,
  };
}

const DOM_FIXTURE = `
  <div id="port-empty"></div>
  <div id="port-content">
    <div id="port-kpis"></div>
    <div id="port-table-header"></div>
    <div id="port-table"></div>
    <div class="chart-wrap"><div id="c-port-donut"></div></div>
    <div id="port-summary"></div>
    <div id="port-drift"></div>
    <div id="port-pagination"></div>
  </div>
`;

describe('renderPortfolio', () => {
  beforeEach(async () => {
    await loadCharts();
    resetMockCharts();
    _collapseState = {};
    document.body.innerHTML = DOM_FIXTURE;
    localStorage.removeItem('drift-rebalance-months');
    localStorage.removeItem('drift-calibration-interval');
    MOCK_HOLDINGS.splice(0, MOCK_HOLDINGS.length, {
      isin: 'IE00TEST1',
      shortName: 'IWDA',
      name: 'iShares Core MSCI World',
      color: '#222222',
      acc: true,
      active: true,
      targetPct: 50,
      assetClass: 'equity',
      region: 'developed',
      foldInto: '',
      order: 1,
    } as any);
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
    expect(kpis).toContain('Market value');
    expect(kpis).toContain('Unrealized P&L');
    expect(kpis).toContain('Realized P&L');
  });

  it('shows "-" for Market value when no snapshots are provided', () => {
    renderPortfolio(makePD(), []);
    const kpisHtml = document.getElementById('port-kpis')!.innerHTML;
    expect(kpisHtml).toContain('add a snapshot');
  });

  it('computes Market value from snapshot when no ETF breakdown is available', () => {
    const snap: Snapshot = { date: '2026-06-01', acct1: 1200 };
    renderPortfolio(makePD(), [snap]);
    const kpis = document.getElementById('port-kpis')!.textContent!;
    const kpisHtml = document.getElementById('port-kpis')!.innerHTML;
    // Market value = 1200 (from snapshot for primary investment account)
    expect(kpis).toContain('1.200,00');
    // Unrealized per-position requires ETF snapshot breakdown
    expect(kpisHtml).toContain('Unrealized P&amp;L');
    expect(kpisHtml).toContain('>-<');
  });

  it('uses ETF market values for unrealized gain and shows option-2 summary rows', () => {
    const snap: Snapshot = { date: '2026-06-01', acct1: 1600, etf_IE00TEST1: 1200 };
    renderPortfolio(makePD(), [snap]);

    const kpis = document.getElementById('port-kpis')!.textContent!;
    // Unrealized P&L should use ETF position market value: 1200 - 1000 = 200
    expect(kpis).toContain('200,00');

    const summary = document.getElementById('port-summary')!.textContent!;
    expect(summary).toContain('Market value (positions)');
    expect(summary).toContain('Account value (snapshot)');
    expect(summary).toContain('Unallocated cash');
    expect(summary).toContain('1.200,00');
    expect(summary).toContain('1.600,00');
    expect(summary).toContain('400,00');
    expect(summary).toContain('Unrealized P&L (positions)');
  });

  it('shows Market value (snapshot) and hides Account value row when no ETF breakdown', () => {
    const snap: Snapshot = { date: '2026-06-01', acct1: 1200 };
    renderPortfolio(makePD(), [snap]);
    const summary = document.getElementById('port-summary')!.textContent!;
    expect(summary).toContain('Market value (snapshot)');
    expect(summary).not.toContain('Market value (positions)');
    expect(summary).not.toContain('Account value (snapshot)');
    expect(summary).not.toContain('Unallocated cash');
    expect(summary).toContain('Unrealized P&L');
    expect(summary).not.toContain('Unrealized P&L (positions)');
  });

  it('treats an explicit zero ETF market value as recorded rather than omitted', () => {
    renderPortfolio(makePD(), [{ date: '2026-06', acct1: 1200, etf_IE00TEST1: 0 }]);
    const summary = document.getElementById('port-summary')!.textContent!;
    expect(summary).toContain('Market value (positions)');
    expect(summary).toContain('Unrealized P&L (positions)');
    expect(summary).toContain('Unallocated cash');
  });

  it('hides Account value row when it equals Market value (no unallocated cash)', () => {
    const snap: Snapshot = { date: '2026-06-01', acct1: 1200, etf_IE00TEST1: 1200 };
    renderPortfolio(makePD(), [snap]);
    const summary = document.getElementById('port-summary')!.textContent!;
    expect(summary).toContain('Market value (positions)');
    expect(summary).not.toContain('Account value (snapshot)');
    expect(summary).not.toContain('Unallocated cash');
  });

  it('uses cost-basis fee-drag valuation when ETF snapshot coverage is partial', () => {
    MOCK_HOLDINGS.splice(
      0,
      MOCK_HOLDINGS.length,
      {
        isin: 'IE00TEST1',
        shortName: 'IWDA',
        name: 'World',
        color: '#222222',
        acc: true,
        active: true,
        targetPct: 70,
        assetClass: 'equity',
        region: 'developed',
        foldInto: '',
        order: 1,
        ter: 1,
      } as any,
      {
        isin: 'IE00TEST2',
        shortName: 'EM',
        name: 'Emerging',
        color: '#333333',
        acc: true,
        active: true,
        targetPct: 30,
        assetClass: 'equity',
        region: 'emerging',
        foldInto: '',
        order: 2,
        ter: 1,
      } as any,
    );
    const pd = makePD({
      etfs: {
        IE00TEST1: makeEtf({ isin: 'IE00TEST1', shortName: 'IWDA', cost: 8000 }),
        IE00TEST2: makeEtf({ isin: 'IE00TEST2', shortName: 'EM', cost: 2000 }),
      },
      totalInv: 10000,
    });
    const snap: Snapshot = { date: '2026-06-01', acct1: 20000, etf_IE00TEST1: 15000 };
    renderPortfolio(pd, [snap]);
    const kpis = document.getElementById('port-kpis')!.textContent || '';
    expect(kpis).toContain('Annual fee drag');
    expect(kpis).toContain('100,00');
  });

  it('shows section headers and Total return after income and costs', () => {
    const snap: Snapshot = { date: '2026-06-01', acct1: 1200 };
    renderPortfolio(makePD(), [snap]);
    const summary = document.getElementById('port-summary')!.textContent!;
    expect(summary).toContain('PERFORMANCE');
    expect(summary).toContain('Income & costs');
    expect(summary).toContain('Total return');
    expect(summary.indexOf('Fees')).toBeLessThan(summary.indexOf('Total return'));
  });

  it('Total return equals unrealized plus realized plus dividends plus interest minus fees', () => {
    const snap: Snapshot = { date: '2026-06-01', acct1: 1200 };
    // pd: totalInv=1000, gain=200, realizedPnL=0, totalDivNet=25, totalInterest=0, totalFees=2
    // totalReturn = 200 + 0 + 25 + 0 - 2 = 223
    renderPortfolio(makePD(), [snap]);
    const summary = document.getElementById('port-summary')!.textContent!;
    expect(summary).toContain('223,00');
  });

  it('shows Total return as an amount only, without a percentage', () => {
    const snap: Snapshot = { date: '2026-06-01', acct1: 1200 };
    renderPortfolio(makePD(), [snap]);
    const summary = document.getElementById('port-summary')!.textContent!;
    expect(summary).toContain('Total return');
    expect(summary).not.toContain('223,00 (22,3%)');
  });

  it('shows gross dividend and interest rows so taxes read as separate deductions', () => {
    const snap: Snapshot = { date: '2026-06-01', acct1: 1200 };
    renderPortfolio(
      makePD({
        totalDivNet: 25,
        totalTax: 5,
        totalInterest: 10,
        totalIntGross: 12,
        totalIntTax: 2,
      }),
      [snap],
    );
    const summary = document.getElementById('port-summary')!.textContent!;
    expect(summary).toContain('Dividends (gross)');
    expect(summary).toContain('30,00');
    expect(summary).toContain('Interest received (gross)');
    expect(summary).toContain('12,00');
  });

  it('creates allocation charts on first render', () => {
    renderPortfolio(makePD(), []);
    expect(chartInstances.length).toBe(2);
    expect(chartFor('c-port-donut')!.disposed).toBe(false);
    expect(chartFor('c-port-drift')!.disposed).toBe(false);
  });

  it('reuses the chart instance on re-render', () => {
    renderPortfolio(makePD(), []);
    const chart = chartFor('c-port-donut');
    const drift = chartFor('c-port-drift');
    renderPortfolio(makePD(), []);
    expect(chartInstances.length).toBe(2);
    expect(chartFor('c-port-donut')).toBe(chart);
    expect(chartFor('c-port-drift')).toBe(drift);
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

  it('defaults holdings and chart order to largest allocation first', () => {
    const pd = makePD({
      etfs: {
        IE00TEST1: makeEtf({ cost: 1000, shortName: 'IWDA' }),
        IE00TEST2: makeEtf({ isin: 'IE00TEST2', shortName: 'EIMI', color: '#333', cost: 500 }),
        IE00TEST3: makeEtf({ isin: 'IE00TEST3', shortName: 'BOND', color: '#444', cost: 250 }),
      },
      totalInv: 1750,
    });
    renderPortfolio(pd, []);

    expect(costOption().yAxis.data).toEqual(['IWDA', 'EIMI', 'BOND']);

    const rows = Array.from(
      document.querySelectorAll('#port-table .hold-row:not(.th) .hold-name'),
    ).map((el) => el.textContent);
    expect(rows).toEqual(['IWDA', 'EIMI', 'BOND']);
  });

  it('shows the held/closed/all filter toggle', () => {
    renderPortfolio(makePD(), []);
    const filterToggle = document.getElementById('port-filter-toggle');
    expect(filterToggle).not.toBeNull();
    expect(filterToggle!.textContent).toContain('Held');
    expect(filterToggle!.textContent).toContain('Closed');
    expect(filterToggle!.textContent).toContain('All');
  });

  it('renders a compact holdings search input', () => {
    renderPortfolio(makePD(), []);
    const search = document.getElementById('port-holdings-search') as HTMLInputElement;
    expect(search).not.toBeNull();
    expect(search.className).toContain('holdings-search-input');
    expect(search.placeholder).toBe('Search ISIN or name');
  });

  it('keeps the holdings search focused while filtering', () => {
    const pd = makePD({
      etfs: {
        IE00TEST1: makeEtf(),
        IE00TEST2: makeEtf({ isin: 'IE00TEST2', shortName: 'EIMI', name: 'Emerging Markets' }),
      },
      totalInv: 2000,
    });
    renderPortfolio(pd, []);
    const search = document.getElementById('port-holdings-search') as HTMLInputElement;
    search.focus();
    search.value = 'em';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const nextSearch = document.getElementById('port-holdings-search') as HTMLInputElement;
    expect(document.activeElement).toBe(nextSearch);
    expect(nextSearch.value).toBe('em');
    expect(document.getElementById('port-table')!.textContent).toContain('EIMI');
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
    expect(driftOption().yAxis.data).toEqual(['IWDA']);
  });

  it('drift note mentions cost basis when no snapshot ETF values are present', () => {
    renderPortfolio(makePD(), []);
    const drift = document.getElementById('port-drift')!;
    expect(drift.innerHTML).toContain('cost basis');
    expect(drift.textContent).not.toContain('Allocation weights use');
  });

  it('drift note mentions market values when snapshot has etf_ keys', () => {
    const snap: Snapshot = { date: '2026-06-01', acct1: 1500, etf_IE00TEST1: 1500 };
    renderPortfolio(makePD(), [snap]);
    const drift = document.getElementById('port-drift')!;
    expect(drift.innerHTML).toContain('market values');
  });

  it('uses cost-basis allocation note when snapshot ETF values are partial', () => {
    MOCK_HOLDINGS.splice(
      0,
      MOCK_HOLDINGS.length,
      {
        isin: 'IE00TEST1',
        shortName: 'IWDA',
        name: 'World',
        color: '#222222',
        acc: true,
        active: true,
        targetPct: 50,
        assetClass: 'equity',
        region: 'developed',
        foldInto: '',
        order: 1,
      } as any,
      {
        isin: 'IE00TEST2',
        shortName: 'BOND',
        name: 'Bond',
        color: '#333333',
        acc: true,
        active: true,
        targetPct: 0,
        assetClass: 'bond',
        region: 'us',
        foldInto: '',
        order: 2,
      } as any,
    );
    const pd = makePD({
      etfs: {
        IE00TEST1: makeEtf({ isin: 'IE00TEST1', shortName: 'IWDA', cost: 1000 }),
        IE00TEST2: makeEtf({ isin: 'IE00TEST2', shortName: 'BOND', cost: 500 }),
      },
      totalInv: 1500,
    });
    const snap: Snapshot = { date: '2026-06-01', acct1: 3500, etf_IE00TEST1: 3000 };
    renderPortfolio(pd, [snap]);
    const note = document.getElementById('port-drift')!.innerHTML;
    expect(note).toContain('Allocation is based on purchase cost');
    expect(note).toContain('Actual from cost basis (partial ETF snapshot coverage)');
  });

  it('draws drift as diverging bars, largest gap first, with the alert band', () => {
    setRebalanceHoldings();
    const pd = makeRebalancePd({
      etfs: {
        IE00TEST1: makeEtf({ isin: 'IE00TEST1', shortName: 'IWDA', cost: 7000 }),
        IE00TEST2: makeEtf({ isin: 'IE00TEST2', shortName: 'EM', cost: 3000 }),
      },
      totalInv: 10000,
    });
    const snap: Snapshot = { date: '2026-06-01', acct1: 20000, etf_IE00TEST1: 9000 };
    renderPortfolio(pd, [snap]);
    const opt = driftOption();
    const values = opt.series[0].data.map((d: AnyRec) => d.value as number);
    const abs = values.map(Math.abs);
    expect(abs).toEqual([...abs].sort((a: number, b: number) => b - a));
    expect(opt.series[0].markArea.data).toEqual([[{ xAxis: -5 }, { xAxis: 5 }]]);
    expect(opt.xAxis.min).toBe(-opt.xAxis.max);
    for (const d of opt.series[0].data) {
      expect(d.label.position).toMatch(d.value < 0 ? /^(inside)?left$/i : /^(inside)?right$/i);
    }
    const tip = opt.tooltip.formatter({ dataIndex: 0 });
    expect(tip).toContain('Target');
    expect(tip).toContain('Actual');
    expect(tip).toMatch(/(Above|Below) target/);
    expect(opt.yAxis.axisLabel.formatter('', 0)).toMatch(/^\{n\|.+\}\n\{s\|.+ of .+\}$/);
    const header = document.querySelector('#port-drift .drift-title-status')!.textContent!;
    expect(header).toMatch(/^(On target|Moderate drift|High drift) · max /);
  });

  it('keeps nav drift badge and drift card max aligned for partial ETF snapshots', () => {
    setRebalanceHoldings();
    const pd = makeRebalancePd({
      etfs: {
        IE00TEST1: makeEtf({ isin: 'IE00TEST1', shortName: 'IWDA', cost: 7000 }),
        IE00TEST2: makeEtf({ isin: 'IE00TEST2', shortName: 'EM', cost: 3000 }),
      },
      totalInv: 10000,
    });
    const snap: Snapshot = { date: '2026-06-01', acct1: 20000, etf_IE00TEST1: 9000 };
    renderPortfolio(pd, [snap]);
    const max = getMaxDrift(pd, [snap]);
    expect(max).not.toBeNull();

    const driftText = document.getElementById('port-drift')!.textContent || '';
    const displayedMatch = driftText.match(/max\s+([0-9]+(?:,[0-9])?)%/);
    expect(displayedMatch).not.toBeNull();
    const displayed = parseFloat((displayedMatch![1] || '').replace(',', '.'));
    expect(displayed).toBeCloseTo(max!, 1);
  });

  it('does not render the allocation-weights note in the drift card', () => {
    renderPortfolio(makePD(), []);
    const drift = document.getElementById('port-drift')!;
    expect(drift.textContent).not.toContain('Allocation weights use');
    expect(document.getElementById('port-alloc-note')).toBeNull();
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
    expect(detail.textContent).toContain('Position');
    expect(detail.textContent).toContain('Allocation');
    expect(detail.textContent).toContain('Type');
    expect(detail.textContent).toContain('Accumulating');
  });

  it.each([
    { active: true, exited: false, position: 'Held', allocation: 'Active' },
    { active: false, exited: false, position: 'Held', allocation: 'Inactive' },
    { active: false, exited: true, position: 'Closed', allocation: 'Inactive' },
  ])('distinguishes position $position from allocation $allocation', (state) => {
    MOCK_HOLDINGS[0].active = state.active;
    renderPortfolio(
      makePD({
        etfs: { IE00TEST1: makeEtf({ active: state.active, exited: state.exited }) },
      }),
      [],
    );
    if (state.exited) document.querySelector<HTMLButtonElement>('[data-filter="closed"]')!.click();
    document.querySelector<HTMLElement>('#port-table .hold-row:not(.th)')!.click();
    const values = [...document.querySelectorAll('.hold-detail > div')].map((row) => [
      row.querySelector('.hold-detail-label')?.textContent,
      row.querySelector('.hold-detail-value')?.textContent,
    ]);
    expect(values).toContainEqual(['Position', state.position]);
    expect(values).toContainEqual(['Allocation', state.allocation]);
  });

  it('tap-to-expand shows market value and unrealized gain when snapshot has etf_ values', () => {
    const snap: Snapshot = { date: '2026-06-01', acct1: 1400, etf_IE00TEST1: 1400 };
    renderPortfolio(makePD(), [snap]);
    const table = document.getElementById('port-table')!;
    const row = table.querySelector('.hold-row:not(.th)') as HTMLElement;
    row.click();
    const detail = table.querySelector('.hold-detail') as HTMLElement;
    expect(detail).not.toBeNull();
    expect(detail.textContent).toContain('Market value');
    expect(detail.textContent).toContain('Unrealized P&L');
    expect(detail.innerHTML).toContain('hold-detail-value pos');
  });

  it('tap-to-expand shows placeholder market columns when no etf_ snapshot values', () => {
    renderPortfolio(makePD(), []);
    const table = document.getElementById('port-table')!;
    const row = table.querySelector('.hold-row:not(.th)') as HTMLElement;
    row.click();
    const detail = table.querySelector('.hold-detail') as HTMLElement;
    expect(detail).not.toBeNull();
    expect(detail.textContent).toContain('Market value');
    expect(detail.textContent).toContain('Unrealized P&L');
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

  it('supports keyboard expansion and updates aria-expanded on holdings rows', () => {
    renderPortfolio(makePD(), []);
    const table = document.getElementById('port-table')!;
    const row = table.querySelector('.hold-row:not(.th)') as HTMLElement;
    expect(row.getAttribute('aria-expanded')).toBe('false');
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(table.querySelector('.hold-detail')).not.toBeNull();
    expect(row.getAttribute('aria-expanded')).toBe('true');
    row.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(table.querySelector('.hold-detail')).toBeNull();
    expect(row.getAttribute('aria-expanded')).toBe('false');
  });

  it('re-render does not throw or duplicate KPI tiles or table rows', () => {
    renderPortfolio(makePD(), []);
    renderPortfolio(makePD(), []);
    const kpis = document.getElementById('port-kpis')!;
    expect(kpis.children.length).toBe(2); // Market value lead tile + "Costs and gains" group
    expect(kpis.querySelectorAll('.kpi-group .kpi-group-row').length).toBe(4);
    // Only one set of data rows (non-header, non-total, non-filter)
    const rows = document.getElementById('port-table')!.querySelectorAll('.hold-row:not(.th)');
    expect(rows.length).toBe(1);
  });

  it('chart option contains the correct labels and data', () => {
    renderPortfolio(makePD(), []);
    const opt = costOption();
    expect(opt.yAxis.data).toContain('IWDA');
    expect(opt.series[0].data[0].value).toBe(1000);
  });

  it('rounds only the trailing edge of allocation bars', () => {
    renderPortfolio(makePD(), []);
    expect(costOption().series[0].data[0].itemStyle.borderRadius).toEqual([0, 4, 4, 0]);
  });

  it('labels bars with their share and shows ISIN in the tooltip', () => {
    renderPortfolio(makePD(), []);
    const opt = costOption();
    expect(opt.series[0].label.formatter({ dataIndex: 0 })).toBe('100%');
    const html = opt.tooltip.formatter({ dataIndex: 0 });
    expect(html).toContain('IWDA');
    expect(html).toContain('IE00TEST1');
  });

  it('sizes the chart to its rows', () => {
    renderPortfolio(makePD(), []);
    const wrap = document.getElementById('c-port-donut')!.parentElement!;
    expect(wrap.style.getPropertyValue('--chart-fit-h')).toBe('140px');
  });

  it('integrates allocation percentage into the cost basis cell', () => {
    renderPortfolio(makePD(), []);
    const table = document.getElementById('port-table')!;
    expect(table.textContent).not.toContain('% of cost');
    expect(table.innerHTML).toContain('hold-inline-meta');
    expect(table.textContent).toContain('100%');
  });

  it('renders summary section with total invested and fees', () => {
    renderPortfolio(makePD(), []);
    const summary = document.getElementById('port-summary')!.textContent!;
    expect(summary).toContain('Invested capital');
    expect(summary).toContain('Fees');
    expect(summary).toContain('Dividends (gross)');
  });

  it('rebalance section is hidden when only one active holding', () => {
    // MOCK_HOLDINGS has a single holding; plan.length < 2 so section should not appear.
    renderPortfolio(makePD(), []);
    const drift = document.getElementById('port-drift')!;
    expect(drift.innerHTML).not.toContain('Rebalance with contributions');
  });

  it('rebalance section is hidden when held positions have no ETF snapshot values', () => {
    setRebalanceHoldings();
    const pd = makeRebalancePd();
    // No snapshot with ETF values: all drift rows are cost-basis mode.
    renderPortfolio(pd, []);
    const drift = document.getElementById('port-drift')!;
    expect(drift.innerHTML).not.toContain('Rebalance with contributions');
  });

  it('rebalance section appears when there are two or more active holdings', () => {
    setRebalanceHoldings();
    const pd = makeRebalancePd();
    renderPortfolio(pd, [makeRebalanceSnap()]);
    const drift = document.getElementById('port-drift')!;
    expect(drift.innerHTML).toContain('Rebalance with contributions');
  });

  it('rebalance picker renders five month-option buttons', () => {
    setRebalanceHoldings();
    const pd = makeRebalancePd();
    renderPortfolio(pd, [makeRebalanceSnap()]);
    const drift = document.getElementById('port-drift')!;
    const details = drift.querySelector('.rebalance-collapsible') as HTMLDetailsElement;
    expect(details).not.toBeNull();
    expect(details.hasAttribute('open')).toBe(false);
    const pickerBtns = drift.querySelectorAll('[data-rebalance-months]');
    expect(pickerBtns.length).toBe(5);
    expect((pickerBtns[0] as HTMLElement).className).toContain('btn');
    expect((pickerBtns[0] as HTMLElement).className).toContain('btn-ghost');
    const labels = Array.from(pickerBtns).map((b) => (b as HTMLElement).textContent?.trim());
    expect(labels).toContain('1 mo');
    expect(labels).toContain('1 yr');
  });

  it('rebalance section stays collapsed but flags a suggestion when drift is high', () => {
    setRebalanceHoldings();
    const pd = makeRebalancePd({
      etfs: {
        IE00TEST1: makeEtf({ isin: 'IE00TEST1', shortName: 'IWDA', cost: 9500 }),
        IE00TEST2: makeEtf({ isin: 'IE00TEST2', shortName: 'EM', cost: 500 }),
      },
    });
    const snap = makeRebalanceSnap({ etf_IE00TEST1: 9500, etf_IE00TEST2: 500 });
    renderPortfolio(pd, [snap]);
    const drift = document.getElementById('port-drift')!;
    const details = drift.querySelector('.rebalance-collapsible') as HTMLDetailsElement;
    expect(details).not.toBeNull();
    expect(details.hasAttribute('open')).toBe(false);
    const note = details.querySelector('.rebalance-summary-note')!;
    expect(note.textContent).toContain('Suggested');
    expect(note.classList.contains('is-suggested')).toBe(true);
  });

  it('renders rebalance guidance when all positions are closed but cash is present', () => {
    setRebalanceHoldings();
    const pd = makeRebalancePd({
      etfs: {
        IE00TEST1: makeEtf({
          isin: 'IE00TEST1',
          shortName: 'IWDA',
          cost: 0,
          shares: 0,
          exited: true,
        }),
        IE00TEST2: makeEtf({
          isin: 'IE00TEST2',
          shortName: 'EM',
          cost: 0,
          shares: 0,
          exited: true,
        }),
      },
      totalInv: 0,
    });
    const snap: Snapshot = { date: '2026-06-01', acct1: 5000 };
    renderPortfolio(pd, [snap]);
    const drift = document.getElementById('port-drift')!;
    expect(drift.innerHTML).toContain('Rebalance with contributions');
    expect(drift.querySelector('.rebalance-result')?.textContent).toMatch(
      /Max drift .+ → .+ after 3 months/,
    );
  });

  it('shows the target cadence amount alongside the suggested amount', () => {
    setRebalanceHoldings();
    const pd = makeRebalancePd();
    localStorage.setItem('drift-calibration-interval', 'weekly');
    renderPortfolio(pd, [makeRebalanceSnap()]);
    const drift = document.getElementById('port-drift')!;
    expect(drift.textContent || '').toMatch(/usual\s+80,77\s*€\/wk/);
    expect(drift.textContent || '').toMatch(/usual\s+34,62\s*€\/wk/);
  });

  it('rebalance picker click updates selected month and re-renders', () => {
    setRebalanceHoldings();
    const pd = makeRebalancePd();
    localStorage.removeItem('drift-rebalance-months');
    renderPortfolio(pd, [makeRebalanceSnap()]);
    const drift = document.getElementById('port-drift')!;

    // Click the "6 mo" button.
    const btn6 = drift.querySelector('[data-rebalance-months="6"]') as HTMLButtonElement;
    expect(btn6).not.toBeNull();
    btn6.click();

    expect(localStorage.getItem('drift-rebalance-months')).toBe('6');
    // After click the section should still be present (re-rendered).
    expect(document.getElementById('port-drift')!.innerHTML).toContain(
      'Rebalance with contributions',
    );
  });

  it('rebalance picker keeps section open after user opens it', () => {
    setRebalanceHoldings();
    const pd = makeRebalancePd();
    localStorage.removeItem('drift-rebalance-months');
    renderPortfolio(pd, [makeRebalanceSnap()]);
    const drift = document.getElementById('port-drift')!;
    const details = drift.querySelector('.rebalance-collapsible') as HTMLDetailsElement;
    expect(details.hasAttribute('open')).toBe(false);
    const summaryNote = drift.querySelector('.rebalance-summary-note') as HTMLElement;
    expect(summaryNote.textContent).toContain('Drift is moderate or low');
    details.open = true;

    const btn6 = drift.querySelector('[data-rebalance-months="6"]') as HTMLButtonElement;
    expect(btn6).not.toBeNull();
    btn6.click();

    const nextDetails = document.querySelector(
      '#port-drift .rebalance-collapsible',
    ) as HTMLDetailsElement;
    expect(nextDetails).not.toBeNull();
    expect(nextDetails.hasAttribute('open')).toBe(true);
    const nextSummaryNote = document.querySelector(
      '#port-drift .rebalance-summary-note',
    ) as HTMLElement;
    expect(nextSummaryNote.textContent).toContain('Drift is moderate or low');
  });

  it('rebalance note shows projected drift reduction', () => {
    setRebalanceHoldings();
    const pd = makeRebalancePd();
    renderPortfolio(pd, [makeRebalanceSnap()]);
    const drift = document.getElementById('port-drift')!;
    expect(drift.querySelector('.rebalance-result')?.textContent).toContain('Max drift');
    const tip = drift.querySelector('.rebalance-result .info-tip')?.getAttribute('data-tip') ?? '';
    expect(tip).toContain('What-if for new contributions only');
    expect(tip).toContain('actual results will vary');
    expect(drift.querySelector('.rebalance-note')?.textContent).toContain('no selling');
  });

  it('cadence select stores the interval and keeps the section open', () => {
    setRebalanceHoldings();
    const pd = makeRebalancePd();
    localStorage.removeItem('drift-calibration-interval');
    renderPortfolio(pd, [makeRebalanceSnap()]);
    const drift = document.getElementById('port-drift')!;
    (drift.querySelector('.rebalance-collapsible') as HTMLDetailsElement).open = true;
    const sel = drift.querySelector('[data-rebalance-interval]') as HTMLSelectElement;
    expect(Array.from(sel.options).map((o) => o.textContent)).toContain('Every 2 weeks');
    sel.value = 'weekly';
    sel.dispatchEvent(new Event('change'));
    expect(localStorage.getItem('drift-calibration-interval')).toBe('weekly');
    const next = document.querySelector('#port-drift .rebalance-collapsible') as HTMLDetailsElement;
    expect(next.open).toBe(true);
    expect((next.querySelector('[data-rebalance-interval]') as HTMLSelectElement).value).toBe(
      'weekly',
    );
    localStorage.removeItem('drift-calibration-interval');
  });

  it('rebalance rows expose explicit state labels and attributes', () => {
    setRebalanceHoldings();
    const pd = makeRebalancePd();
    renderPortfolio(pd, [makeRebalanceSnap()]);
    const drift = document.getElementById('port-drift')!;
    const overweightRow = drift.querySelector(
      '[data-rebalance-state="overweight"]',
    ) as HTMLElement | null;
    const underweightRow = drift.querySelector(
      '[data-rebalance-state="underweight"]',
    ) as HTMLElement | null;
    expect(overweightRow).not.toBeNull();
    expect(underweightRow).not.toBeNull();
    expect(drift.textContent).toContain('Overweight');
    expect(drift.textContent).toContain('Underweight');
  });

  it('sell advisory mentions reviewing tax and fee impact', () => {
    // Use a large portfolio where monthly contributions (500€/mo) cannot close
    // the entire underweight gap in 12 months — IWDA remains overweight, so the
    // sell advisory is triggered.
    // IWDA: 80000 (80%, target 70%) → overweight +10%
    // EM:   20000 (20%, target 30%) → underweight −10%
    // projectedTotal at 12 months = 106000, needToBuy[EM] = 106000*0.3-20000=11800
    // totalBudget = 6000 < 11800 → insufficient, IWDA stays overweight → sell warning.
    setRebalanceHoldings();
    const pd = makeRebalancePd({
      etfs: {
        IE00TEST1: makeEtf({ isin: 'IE00TEST1', shortName: 'IWDA', cost: 80000 }),
        IE00TEST2: makeEtf({ isin: 'IE00TEST2', shortName: 'EM', cost: 20000 }),
      },
      totalInv: 100000,
    });
    const snap = makeRebalanceSnap({ acct1: 100000, etf_IE00TEST1: 80000, etf_IE00TEST2: 20000 });
    renderPortfolio(pd, [snap]);
    const drift = document.getElementById('port-drift')!;
    expect(drift.querySelector('.rebalance-sell-note')?.textContent).toContain('stay above target');
    expect(drift.innerHTML).toContain('taxes');
    expect(drift.innerHTML).toContain('trading fees');
  });

  it('renders an on-target state when projected gap is neutral', () => {
    // 3 holdings so one can sit on-target while the others over/underweight drive redistribution.
    // IWDA: 60% target, 62% actual (+2pp overweight)
    // EM:   25% target, 25% actual ( 0pp on-target, locked)
    // Bond: 15% target, 13% actual (-2pp underweight)
    MOCK_HOLDINGS.splice(
      0,
      MOCK_HOLDINGS.length,
      {
        isin: 'IE00TEST1',
        shortName: 'IWDA',
        name: 'World',
        color: '#222222',
        acc: true,
        active: true,
        targetPct: 60,
        assetClass: 'equity',
        region: 'developed',
        foldInto: '',
        order: 1,
      } as any,
      {
        isin: 'IE00TEST2',
        shortName: 'EM',
        name: 'Emerging',
        color: '#333333',
        acc: true,
        active: true,
        targetPct: 25,
        assetClass: 'equity',
        region: 'emerging',
        foldInto: '',
        order: 2,
      } as any,
      {
        isin: 'IE00TEST3',
        shortName: 'Bond',
        name: 'Bond',
        color: '#444444',
        acc: false,
        active: true,
        targetPct: 15,
        assetClass: 'fixed income',
        region: 'global',
        foldInto: '',
        order: 3,
      } as any,
    );
    const pd = makePD({
      etfs: {
        IE00TEST1: makeEtf({ isin: 'IE00TEST1', shortName: 'IWDA', cost: 6200 }),
        IE00TEST2: makeEtf({ isin: 'IE00TEST2', shortName: 'EM', cost: 2500 }),
        IE00TEST3: makeEtf({ isin: 'IE00TEST3', shortName: 'Bond', cost: 1300 }),
      },
      totalInv: 10000,
    });
    const snap: Snapshot = {
      date: '2026-06-01',
      acct1: 10000,
      etf_IE00TEST1: 6200,
      etf_IE00TEST2: 2500,
      etf_IE00TEST3: 1300,
    };
    renderPortfolio(pd, [snap]);
    const drift = document.getElementById('port-drift')!;
    const onTarget = drift.querySelector('[data-rebalance-state="on-target"]');
    expect(onTarget).not.toBeNull();
    expect(drift.textContent).toContain('On target');
  });
});
