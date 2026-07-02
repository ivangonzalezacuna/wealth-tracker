// @ts-nocheck - DOM-heavy view; full strict typing deferred to framework migration
import { fmtEur2, fmtDay, esc, safeColor } from '../utils';
import type { PortfolioData, DivHistEntry, IntHistEntry } from '../types';
import { T } from '../theme';
import { infoTip, attachInfoTips } from '../ui/infoTip';
import type { SortState } from './tableSort';
import { applySort, bindSortableHeader } from './tableSort';
import type { ColumnDef } from './tableColumns';
import { renderTableHeader, renderTableRow, getSortGetters } from './tableColumns';
import { renderPagination } from './pagination';

const DIV_PAGE_SIZE = 12;
let _divPage = 1;
let _intPage = 1;
let _divYear = '';
let _intYear = '';
let _divTblSort: SortState = { key: null, dir: null };
let _intTblSort: SortState = { key: null, dir: null };
let _lastPd: PortfolioData | null = null;

export function renderDividends(pd: PortfolioData | null): void {
  const hasPD = !!pd;
  const hasDiv = hasPD && pd.divHist.length > 0;

  document.getElementById('div-empty').style.display = hasPD ? 'none' : 'block';
  document.getElementById('div-content').style.display = hasPD ? 'block' : 'none';
  if (!hasPD) return;

  _lastPd = pd;
  _divPage = 1;
  _intPage = 1;
  _divYear = '';
  _intYear = '';

  const totalGross = pd.divHist.reduce((s, d) => s + d.gross, 0);

  document.getElementById('div-kpis').innerHTML = `
    <div class="kpi"><div class="kpi-label">Gross dividends${infoTip('Before tax: Total distribution payments received from ETFs and stocks, before withholding tax is deducted.')}</div><div class="kpi-val">${fmtEur2(totalGross)}</div></div>
    <div class="kpi"><div class="kpi-label">Tax withheld</div><div class="kpi-val neg">−${fmtEur2(pd.totalTax)}</div><div class="kpi-sub">Abgeltungsteuer</div></div>
    <div class="kpi"><div class="kpi-label">Net received</div><div class="kpi-val pos">${fmtEur2(pd.totalDivNet)}</div></div>
    <div class="kpi"><div class="kpi-label">TR interest</div><div class="kpi-val pos">${fmtEur2(pd.totalInterest)}</div><div class="kpi-sub">on cash savings</div></div>
  `;

  populateDivYearFilter(pd.divHist);
  attachDivFilterListeners(pd);
  renderDivTable(pd);

  populateIntYearFilter(pd.intHist);
  attachIntFilterListeners(pd);
  renderIntTable(pd);

  attachInfoTips(document.getElementById('subview-dividends')!);
}

function dividendColumns(): ColumnDef<DivHistEntry>[] {
  return [
    {
      key: 'swatch',
      label: '',
      raw: true,
      cell: (d) =>
        `<span class="leg-sq" style="background:${safeColor(d.color)};display:inline-block;margin-top:2px"></span>`,
    },
    {
      key: 'date',
      label: 'ETF / Date',
      sortValue: (d) => d.date,
      cell: (d) =>
        `<div style="font-weight:500;font-size:12px">${esc(d.ticker)}</div><div style="font-size:11px;color:var(--ink-3)">${fmtDay(d.date)}</div>`,
    },
    {
      key: 'gross',
      label: 'Gross',
      align: 'right',
      sortValue: (d) => d.gross,
      cell: (d) => `<span style="color:var(--ink-2)">${fmtEur2(d.gross)}</span>`,
    },
    {
      key: 'tax',
      label: 'Tax',
      align: 'right',
      sortValue: (d) => d.tax,
      cell: (d) =>
        `<span style="color:var(--neg)" aria-label="Tax \u2212${d.tax.toFixed(2)}">\u2212${fmtEur2(d.tax)}</span>`,
    },
    {
      key: 'net',
      label: 'Net',
      align: 'right',
      sortValue: (d) => d.net,
      cell: (d) => `<span style="color:var(--pos);font-weight:500">${fmtEur2(d.net)}</span>`,
    },
  ];
}

function renderDivTable(pd: PortfolioData): void {
  const list = _divYear ? pd.divHist.filter((d) => d.date.startsWith(_divYear)) : pd.divHist;
  const hasDiv = list.length > 0;
  const totalGross = list.reduce((s, d) => s + d.gross, 0);
  const totalTax = list.reduce((s, d) => s + d.tax, 0);
  const totalNet = list.reduce((s, d) => s + d.net, 0);

  // Column definitions
  const columns = dividendColumns();

  // Apply sort (before pagination)
  const sorted = applySort(list, _divTblSort, getSortGetters(columns));

  const totalPages = Math.ceil(sorted.length / DIV_PAGE_SIZE);
  if (_divPage > totalPages) _divPage = Math.max(1, totalPages);
  const pageItems = sorted.slice((_divPage - 1) * DIV_PAGE_SIZE, _divPage * DIV_PAGE_SIZE);

  const dRows = pageItems
    .map(
      (d) => `
    <div class="tbl-row div-row" role="row">
      ${renderTableRow(columns, d)}
    </div>`,
    )
    .join('');

  document.getElementById('div-history').innerHTML = hasDiv
    ? `
    <div class="tbl-row th div-row" role="row" id="div-table-header">
      ${renderTableHeader(columns, _divTblSort)}
    </div>${dRows}
    <div class="tbl-row div-row" style="border-top:1px solid var(--line-2);margin-top:4px">
      <div></div><div style="font-weight:500">${_divYear ? 'Year total' : 'Total'}</div>
      <div style="text-align:right;font-weight:500">${fmtEur2(totalGross)}</div>
      <div style="text-align:right;color:var(--neg)">\u2212${fmtEur2(totalTax)}</div>
      <div style="text-align:right;color:var(--pos);font-weight:500">${fmtEur2(totalNet)}</div>
    </div>`
    : '<p class="note">No dividends found in imported transactions yet.</p>';

  // Bind sort handler on header row
  const divHeaderEl = document.getElementById('div-table-header');
  if (divHeaderEl) {
    bindSortableHeader(divHeaderEl, _divTblSort, (newState) => {
      _divTblSort = newState;
      _divPage = 1;
      renderDivTable(pd);
    });
  }

  renderDivPagination(totalPages, pd);
}

function renderDivPagination(totalPages: number, pd: PortfolioData): void {
  renderPagination('div-pagination', _divPage, totalPages, (p) => {
    _divPage = p;
    renderDivTable(_lastPd || pd);
  });
}

function intColumns(): ColumnDef<IntHistEntry>[] {
  return [
    {
      key: 'date',
      label: 'Date',
      cell: (i) => fmtDay(i.date),
      sortValue: (i) => i.date,
    },
    {
      key: 'amount',
      label: 'Amount',
      align: 'right',
      sortValue: (i) => i.amount,
      cell: (i) => fmtEur2(i.amount),
      cellClass: () => 'ok',
    },
  ];
}

function renderIntTable(pd: PortfolioData): void {
  const list = _intYear ? pd.intHist.filter((i) => i.date.startsWith(_intYear)) : pd.intHist;
  const totalInterest = list.reduce((s, i) => s + i.amount, 0);

  // Column definitions
  const columns = intColumns();

  // Apply sort (before pagination)
  const sorted = applySort(list, _intTblSort, getSortGetters(columns));

  const totalPages = Math.ceil(sorted.length / DIV_PAGE_SIZE);
  if (_intPage > totalPages) _intPage = Math.max(1, totalPages);
  const pageItems = sorted.slice((_intPage - 1) * DIV_PAGE_SIZE, _intPage * DIV_PAGE_SIZE);

  document.getElementById('div-interest').innerHTML =
    list.length > 0
      ? `<div class="tbl-row th int-row" role="row" id="int-table-header" style="border-bottom:1px solid var(--line);padding-bottom:4px;margin-bottom:2px">${renderTableHeader(columns, _intTblSort)}</div>` +
        pageItems
          .map((i) => `<div class="tbl-row int-row" role="row">${renderTableRow(columns, i)}</div>`)
          .join('') +
        `<div class="tbl-row int-row" role="row" style="border-top:1px solid var(--line-2);margin-top:4px">
        <div style="font-weight:500">${_intYear ? 'Year total' : 'Total interest'}</div>
        <div style="font-weight:500;text-align:right;color:var(--pos)">${fmtEur2(totalInterest)}</div></div>`
      : '<p class="note">No interest payments found in imported transactions.</p>';

  // Bind sort handler on header row
  const intHeaderEl = document.getElementById('int-table-header');
  if (intHeaderEl) {
    bindSortableHeader(intHeaderEl, _intTblSort, (newState) => {
      _intTblSort = newState;
      _intPage = 1;
      renderIntTable(pd);
    });
  }

  renderIntPagination(totalPages, pd);
}

function renderIntPagination(totalPages: number, pd: PortfolioData): void {
  renderPagination('int-pagination', _intPage, totalPages, (p) => {
    _intPage = p;
    renderIntTable(_lastPd || pd);
  });
}

function populateDivYearFilter(divHist: PortfolioData['divHist']): void {
  const select = document.getElementById('div-year-filter');
  if (!select) return;
  const years = [...new Set(divHist.map((d) => d.date.slice(0, 4)))].sort().reverse();
  const current = (select as HTMLSelectElement).value;
  select.innerHTML =
    '<option value="">All years</option>' +
    years
      .map((y) => `<option value="${y}" ${y === current ? 'selected' : ''}>${y}</option>`)
      .join('');
}

function attachDivFilterListeners(pd: PortfolioData): void {
  const yearEl = document.getElementById('div-year-filter') as
    (HTMLSelectElement & { _bound?: boolean }) | null;
  if (yearEl && !yearEl._bound) {
    yearEl._bound = true;
    yearEl.addEventListener('change', () => {
      _divYear = yearEl.value;
      _divPage = 1;
      renderDivTable(_lastPd || pd);
    });
  }
}

function populateIntYearFilter(intHist: PortfolioData['intHist']): void {
  const select = document.getElementById('int-year-filter');
  if (!select) return;
  const years = [...new Set(intHist.map((i) => i.date.slice(0, 4)))].sort().reverse();
  const current = (select as HTMLSelectElement).value;
  select.innerHTML =
    '<option value="">All years</option>' +
    years
      .map((y) => `<option value="${y}" ${y === current ? 'selected' : ''}>${y}</option>`)
      .join('');
}

function attachIntFilterListeners(pd: PortfolioData): void {
  const yearEl = document.getElementById('int-year-filter') as
    (HTMLSelectElement & { _bound?: boolean }) | null;
  if (yearEl && !yearEl._bound) {
    yearEl._bound = true;
    yearEl.addEventListener('change', () => {
      _intYear = yearEl.value;
      _intPage = 1;
      renderIntTable(_lastPd || pd);
    });
  }
}
