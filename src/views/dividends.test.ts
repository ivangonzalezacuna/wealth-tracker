/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderDividends } from './dividends';
import type { PortfolioData } from '../types';

function makePD(overrides: Partial<PortfolioData> = {}): PortfolioData {
  return {
    etfs: {},
    divHist: [
      {
        date: '2026-01-15',
        isin: '',
        shortName: 'IWDA',
        color: '#111',
        gross: 12.5,
        tax: 3.13,
        net: 9.37,
      },
      {
        date: '2026-04-15',
        isin: '',
        shortName: 'IWDA',
        color: '#111',
        gross: 13.0,
        tax: 3.25,
        net: 9.75,
      },
    ],
    intHist: [{ date: '2026-02-01', gross: 4.5, tax: 0.3, net: 4.2, amount: 4.2 }],
    monthly: {},
    monthlyBy: {},
    months: [],
    totalInv: 0,
    totalDivNet: 19.12,
    totalTax: 6.38,
    totalFees: 0,
    totalInterest: 4.2,
    totalIntGross: 4.5,
    totalIntTax: 0.3,
    realizedPnL: 0,
    interestBySource: {},
    taxBySource: {},
    ...overrides,
  };
}

const DOM_FIXTURE = `
  <div id="div-empty"></div>
  <div id="div-content">
    <div id="div-kpis"></div>
    <div id="div-year-filter-bar"><select id="div-year-filter"></select></div>
    <div id="int-year-filter-bar"><select id="int-year-filter"></select></div>
    <div id="div-table-header"></div>
    <div id="div-history"></div>
    <div id="div-pagination"></div>
    <div id="int-table-header"></div>
    <div id="div-interest"></div>
    <div id="int-pagination"></div>
    <div id="div-annual"></div>
    <div id="div-annual-pagination"></div>
  </div>
  <div id="subview-dividends"></div>
`;

describe('renderDividends', () => {
  beforeEach(() => {
    document.body.innerHTML = DOM_FIXTURE;
  });

  it('shows the empty state and does not populate KPIs when pd is null', () => {
    renderDividends(null);
    expect((document.getElementById('div-empty') as HTMLElement).style.display).not.toBe('none');
    expect((document.getElementById('div-content') as HTMLElement).style.display).toBe('none');
    expect(document.getElementById('div-kpis')!.innerHTML).toBe('');
  });

  it('shows the empty state when pd has no dividend history', () => {
    renderDividends(makePD({ divHist: [], intHist: [] }));
    expect((document.getElementById('div-empty') as HTMLElement).style.display).toBe('block');
    expect((document.getElementById('div-content') as HTMLElement).style.display).toBe('none');
  });

  it('renders gross/tax/net/interest KPI tiles with correct formatted values', () => {
    renderDividends(makePD());
    const kpisEl = document.getElementById('div-kpis')!;
    const kpisText = kpisEl.textContent!;
    expect(kpisText).toContain('Gross dividends');
    expect(kpisText).toContain('25,50');
    expect(kpisText).toContain('Tax withheld');
    expect(kpisText).toContain('Net received');
    expect(kpisText).toContain('Gross interest');
    expect(kpisText).toContain('not tax filing guidance');
    expect(kpisText).not.toContain('Investment income yield (12m)');
    expect(kpisText).not.toContain('Savings income yield (12m)');
  });

  it('flips the Tax withheld tile to positive styling when totalTax < 0', () => {
    renderDividends(makePD({ totalTax: -1.5 }));
    expect(document.getElementById('div-kpis')!.innerHTML).toContain('pos');
  });

  it('renders one row per divHist entry in div-history', () => {
    renderDividends(makePD());
    const historyText = document.getElementById('div-history')!.textContent;
    expect(historyText).toContain('IWDA');
  });

  it('renders one row per intHist entry in div-interest', () => {
    renderDividends(makePD());
    const interestText = document.getElementById('div-interest')!.textContent!;
    expect(interestText).toContain('4,20');
  });

  it('hides dividend filter and pagination when there is no dividend source data', () => {
    renderDividends(makePD({ divHist: [] }));
    expect((document.getElementById('div-year-filter-bar') as HTMLElement).style.display).toBe(
      'none',
    );
    expect((document.getElementById('div-pagination') as HTMLElement).style.display).toBe('none');
    expect(document.getElementById('div-history')!.textContent).toContain(
      'No dividend payments recorded yet.',
    );
  });

  it('keeps dividend filter visible for empty selected-year results', () => {
    renderDividends(makePD());
    const select = document.getElementById('div-year-filter') as HTMLSelectElement;
    select.innerHTML = '<option value="">All years</option><option value="2030">2030</option>';
    select.value = '2030';
    select.dispatchEvent(new Event('change'));
    expect((document.getElementById('div-year-filter-bar') as HTMLElement).style.display).toBe('');
    expect(document.getElementById('div-history')!.textContent).toContain(
      'No dividend payments found for the selected year.',
    );
  });

  it('populates year filter with distinct years plus All years default', () => {
    const pd = makePD({
      divHist: [
        { date: '2025-06-01', isin: '', shortName: 'A', color: '#000', gross: 1, tax: 0, net: 1 },
        { date: '2026-01-15', isin: '', shortName: 'B', color: '#000', gross: 2, tax: 0, net: 2 },
        { date: '2026-04-15', isin: '', shortName: 'C', color: '#000', gross: 3, tax: 0, net: 3 },
      ],
    });
    renderDividends(pd);
    const select = document.getElementById('div-year-filter') as HTMLSelectElement;
    const options = Array.from(select.querySelectorAll('option'));
    expect(options[0].value).toBe('');
    expect(options[0].textContent).toBe('All years');
    // Years sorted in reverse order
    expect(options[1].value).toBe('2026');
    expect(options[2].value).toBe('2025');
  });

  it('does not throw or duplicate KPIs when called twice', () => {
    renderDividends(makePD());
    renderDividends(makePD());
    const kpisEl = document.getElementById('div-kpis')!;
    expect(kpisEl.children.length).toBe(7);
  });

  it('renders annual summary table', () => {
    renderDividends(makePD(), [
      {
        id: 'b1',
        date: '2026-03-15',
        source: 'trade_republic',
        type: 'BUY',
        name: 'ETF',
        isin: 'X',
        shares: 1,
        price: 5,
        amount: 5,
        fee: 0,
        tax: 0,
        currency: 'EUR',
        fxRate: 1,
      },
      {
        id: 's1',
        date: '2026-04-15',
        source: 'trade_republic',
        type: 'SELL',
        name: 'ETF',
        isin: 'X',
        shares: 1,
        price: 10,
        amount: 10,
        fee: 1,
        tax: 0,
        currency: 'EUR',
        fxRate: 1,
      },
    ]);
    expect(document.getElementById('div-annual')!.textContent).toContain('Year');
    expect(document.getElementById('div-annual')!.textContent).toContain('Benefits (net)');
    expect(document.getElementById('div-annual')!.textContent).toContain('Withheld / refunded');
    const annualRow = document.querySelector('[data-annual-year="2026"]') as HTMLElement;
    annualRow.click();
    expect(document.getElementById('div-annual')!.textContent).toContain(
      'Realized profit and loss from sells',
    );
    const groups = document.querySelectorAll('.annual-detail-group-title');
    expect(groups.length).toBe(3);
    expect(groups[0].textContent).toBe('Dividends');
    expect(groups[1].textContent).toBe('Savings');
    expect(groups[2].textContent).toBe('Profit / loss');
  });

  it('supports keyboard expansion and updates aria-expanded in the annual summary', () => {
    renderDividends(makePD(), [
      {
        id: 'b1',
        date: '2026-03-15',
        source: 'trade_republic',
        type: 'BUY',
        name: 'ETF',
        isin: 'X',
        shares: 1,
        price: 5,
        amount: 5,
        fee: 0,
        tax: 0,
        currency: 'EUR',
        fxRate: 1,
      },
    ]);
    const annualRow = document.querySelector('[data-annual-year="2026"]') as HTMLElement;
    expect(annualRow.getAttribute('aria-expanded')).toBe('false');
    annualRow.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(document.querySelector('.annual-detail')).not.toBeNull();
    const rerenderedRow = document.querySelector('[data-annual-year="2026"]') as HTMLElement;
    expect(rerenderedRow.getAttribute('aria-expanded')).toBe('true');
  });

  it('uses cost-basis realized P&L instead of raw sell proceeds in annual summary', () => {
    renderDividends(makePD({ divHist: [], intHist: [] }), [
      {
        id: 'b1',
        date: '2026-01-10',
        source: 'trade_republic',
        type: 'BUY',
        name: 'ETF',
        isin: 'X',
        shares: 1,
        price: 100,
        amount: 100,
        fee: 0,
        tax: 0,
        currency: 'EUR',
        fxRate: 1,
      },
      {
        id: 's1',
        date: '2026-02-10',
        source: 'trade_republic',
        type: 'SELL',
        name: 'ETF',
        isin: 'X',
        shares: 1,
        price: 100,
        amount: 100,
        fee: 0,
        tax: 0,
        currency: 'EUR',
        fxRate: 1,
      },
    ]);
    const annualRow = document.querySelector('[data-annual-year="2026"]') as HTMLElement;
    expect(annualRow).not.toBeNull();
    expect(annualRow.textContent).toContain('0,00');
  });

  it('renders yearly taxes in positive color when taxes are negative (refund)', () => {
    renderDividends(
      makePD({
        divHist: [
          {
            date: '2026-01-15',
            isin: '',
            shortName: 'IWDA',
            color: '#111',
            gross: 12.5,
            tax: 0,
            net: 12.5,
          },
        ],
        intHist: [{ date: '2026-02-01', gross: 4.5, tax: -1.25, net: 5.75, amount: 5.75 }],
      }),
    );
    const annualRow = document.querySelector('[data-annual-year="2026"]') as HTMLElement;
    const taxesCell = annualRow.children[1] as HTMLElement;
    expect(taxesCell.style.color).toBe('var(--pos)');
  });

  it('hides zero-value annual detail lines and empty groups', () => {
    renderDividends(
      makePD({
        divHist: [
          {
            date: '2026-01-15',
            isin: '',
            shortName: 'IWDA',
            color: '#111',
            gross: 12.5,
            tax: 0,
            net: 12.5,
          },
        ],
        intHist: [],
      }),
      [],
    );
    const annualRow = document.querySelector('[data-annual-year="2026"]') as HTMLElement;
    annualRow.click();
    const annualText = document.getElementById('div-annual')!.textContent || '';
    expect(annualText).toContain('Dividends');
    expect(annualText).not.toContain('Dividend taxes paid');
    expect(annualText).not.toContain('Profit / loss');
    expect(annualText).not.toContain('Realized profit and loss from sells');
  });

  it('renders pagination when divHist exceeds page size', () => {
    const entries = Array.from({ length: 15 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      isin: '',
      shortName: 'IWDA',
      color: '#111',
      gross: 10,
      tax: 2,
      net: 8,
    }));
    renderDividends(makePD({ divHist: entries }));
    const paginationEl = document.getElementById('div-pagination')!;
    expect(paginationEl.innerHTML).toContain('1 / 2');
    // Only 12 data rows should appear (PAGE_SIZE = 12) plus header row plus total row
    const rows = document.getElementById('div-history')!.querySelectorAll('.div-row:not(.th)');
    // 12 data rows + 1 total row = 13
    expect(rows.length).toBe(13);
  });
});
