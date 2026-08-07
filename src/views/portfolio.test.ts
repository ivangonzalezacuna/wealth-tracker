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
  getAlertSettings: () => ({ driftThresholdPct: 5 }),
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
      contribAmount: 70,
      contribInterval: 'monthly',
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
      contribAmount: 30,
      contribInterval: 'monthly',
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
    <canvas id="c-port-donut"></canvas>
    <div id="port-donut-legend"></div>
    <canvas id="c-port-alloc-class"></canvas>
    <div id="port-alloc-class-legend"></div>
    <canvas id="c-port-alloc-region"></canvas>
    <div id="port-alloc-region-legend"></div>
    <div id="port-summary"></div>
    <div id="port-drift"></div>
    <div id="port-pagination"></div>
  </div>
`;

describe('renderPortfolio', () => {
  beforeEach(() => {
    document.body.innerHTML = DOM_FIXTURE;
    chartInstances.length = 0;
    localStorage.removeItem('drift-rebalance-months');
    MOCK_HOLDINGS.splice(0, MOCK_HOLDINGS.length, {
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

  it('hides Account value row when it equals Market value (no unallocated cash)', () => {
    const snap: Snapshot = { date: '2026-06-01', acct1: 1200, etf_IE00TEST1: 1200 };
    renderPortfolio(makePD(), [snap]);
    const summary = document.getElementById('port-summary')!.textContent!;
    expect(summary).toContain('Market value (positions)');
    expect(summary).not.toContain('Account value (snapshot)');
    expect(summary).not.toContain('Unallocated cash');
  });

  it('shows section headers and Total return after income and costs', () => {
    const snap: Snapshot = { date: '2026-06-01', acct1: 1200 };
    renderPortfolio(makePD(), [snap]);
    const summary = document.getElementById('port-summary')!.textContent!;
    expect(summary).toContain('PERFORMANCE');
    expect(summary).toContain('INCOME & COSTS');
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

    const labels = (chartInstances[0].config as { data: { labels: [string, string][] } }).data
      .labels;
    expect(labels.map((l) => l[0])).toEqual(['IWDA', 'EIMI', 'BOND']);

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
    expect(drift.innerHTML).toContain('IWDA');
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

  it('falls back to cost-basis allocation when snapshot ETF values are partial', () => {
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
        contribAmount: 50,
        contribInterval: 'weekly',
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
        contribAmount: 0,
        contribInterval: 'weekly',
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
    const note = document.getElementById('port-drift')!.textContent || '';
    expect(note).toContain('Allocation is based on purchase cost');
    expect(note).toContain('Actual from market values');
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
    expect(detail.textContent).toContain('Status');
    expect(detail.textContent).toContain('Type');
    expect(detail.textContent).toContain('Accumulating');
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

  it('re-render does not throw or duplicate KPI tiles or table rows', () => {
    renderPortfolio(makePD(), []);
    renderPortfolio(makePD(), []);
    const kpis = document.getElementById('port-kpis')!;
    expect(kpis.children.length).toBe(5); // Total invested, Market value, Unrealized P&L, Realized P&L, Annual fee drag
    // Only one set of data rows (non-header, non-total, non-filter)
    const rows = document.getElementById('port-table')!.querySelectorAll('.hold-row:not(.th)');
    expect(rows.length).toBe(1);
  });

  it('chart config contains the correct labels and data', () => {
    renderPortfolio(makePD(), []);
    expect(chartInstances.length).toBe(1);
    const config = chartInstances[0].config as {
      data: { labels: [string, string][]; datasets: unknown[] };
    };
    expect(config.data.labels.map((l) => l[0])).toContain('IWDA');
    expect(config.data.datasets[0]).toHaveProperty('data');
  });

  it('uses a square leading edge and the existing trailing radius for allocation bars', () => {
    renderPortfolio(makePD(), []);
    const config = chartInstances[0].config as {
      data: { datasets: Array<{ borderRadius: unknown; borderSkipped: unknown }> };
    };
    expect(config.data.datasets[0].borderRadius).toEqual({
      topLeft: 0,
      bottomLeft: 0,
      topRight: 4,
      bottomRight: 4,
    });
    expect(config.data.datasets[0].borderSkipped).toBe(false);
  });

  it('renders donut legend with short name and percentage', () => {
    renderPortfolio(makePD(), []);
    const legend = document.getElementById('port-donut-legend')!.textContent!;
    expect(legend).toContain('IWDA');
    expect(legend).toContain('100%');
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
    expect(drift.innerHTML).not.toContain('Contribution rebalance');
  });

  it('rebalance section is hidden when held positions have no ETF snapshot values', () => {
    setRebalanceHoldings();
    const pd = makeRebalancePd();
    // No snapshot with ETF values: all drift rows are cost-basis mode.
    renderPortfolio(pd, []);
    const drift = document.getElementById('port-drift')!;
    expect(drift.innerHTML).not.toContain('Contribution rebalance');
  });

  it('rebalance section appears when there are two or more active holdings', () => {
    setRebalanceHoldings();
    const pd = makeRebalancePd();
    renderPortfolio(pd, [makeRebalanceSnap()]);
    const drift = document.getElementById('port-drift')!;
    expect(drift.innerHTML).toContain('Contribution rebalance');
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

  it('rebalance section opens by default when drift is high', () => {
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
    expect(details.hasAttribute('open')).toBe(true);
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
    expect(drift.innerHTML).toContain('Contribution rebalance');
    expect(drift.textContent).toContain('reduce max drift from');
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
    expect(document.getElementById('port-drift')!.innerHTML).toContain('Contribution rebalance');
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
    expect(summaryNote.textContent).toContain('Optional when drift is moderate or low');
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
    expect(nextSummaryNote.textContent).toContain('Optional when drift is moderate or low');
  });

  it('rebalance note shows projected drift reduction', () => {
    setRebalanceHoldings();
    const pd = makeRebalancePd();
    renderPortfolio(pd, [makeRebalanceSnap()]);
    const drift = document.getElementById('port-drift')!;
    expect(drift.textContent).toContain('reduce max drift from');
    expect(drift.textContent).toContain('scenario estimate');
    expect(drift.textContent).toContain('actual results will vary');
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
    setRebalanceHoldings();
    const pd = makeRebalancePd({
      etfs: {
        IE00TEST1: makeEtf({ isin: 'IE00TEST1', shortName: 'IWDA', cost: 9500 }),
        IE00TEST2: makeEtf({ isin: 'IE00TEST2', shortName: 'EM', cost: 500 }),
      },
      totalInv: 10000,
    });
    const snap = makeRebalanceSnap({ etf_IE00TEST1: 9500, etf_IE00TEST2: 500 });
    renderPortfolio(pd, [snap]);
    const drift = document.getElementById('port-drift')!;
    expect(drift.textContent).toContain('taxes');
    expect(drift.textContent).toContain('trading fees');
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
        contribAmount: 60,
        contribInterval: 'monthly',
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
        contribAmount: 25,
        contribInterval: 'monthly',
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
        contribAmount: 15,
        contribInterval: 'monthly',
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
