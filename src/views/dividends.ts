import { fmtEur2, fmtMon, fmtDay, esc, safeColor, kpiTile } from '../utils';
import type { PortfolioData, DivHistEntry, IntHistEntry, Transaction, Snapshot } from '../types';
import { T } from '../theme';
import { infoTip, attachInfoTips } from '../ui/infoTip';
import { attachEtfPopovers } from '../ui/etfPopover';
import { getAccounts, getHoldings } from '../store/config';
import type { SortState } from './tableSort';
import { applySort, bindSortableHeader } from './tableSort';
import type { ColumnDef } from './tableColumns';
import { renderTableHeader, renderTableRow, getSortGetters } from './tableColumns';
import { renderPagination } from './pagination';

const DIV_PAGE_SIZE = 12;
const ANNUAL_PAGE_SIZE = 8;
let _divPage = 1;
let _intPage = 1;
let _annualPage = 1;
let _divYear = '';
let _intYear = '';
let _expandedAnnualYear = '';
let _divTblSort: SortState = { key: null, dir: null };
let _intTblSort: SortState = { key: null, dir: null };
let _lastPd: PortfolioData | null = null;
let _lastTxs: Transaction[] = [];

/**
 * Renders the Dividends tab: gross/tax/net/interest KPI tiles plus the
 * dividend and interest history tables. Shows the empty state if no
 * dividend history exists yet.
 */
export function renderDividends(
  pd: PortfolioData | null,
  txs: Transaction[] = [],
  snaps: Snapshot[] = [],
): void {
  const hasPD = !!pd;
  const hasDiv = hasPD && pd.divHist.length > 0;

  document.getElementById('div-empty')!.style.display = hasPD ? 'none' : 'block';
  document.getElementById('div-content')!.style.display = hasPD ? 'block' : 'none';
  if (!hasPD) return;

  _lastPd = pd;
  _lastTxs = txs;
  _divPage = 1;
  _intPage = 1;
  _annualPage = 1;
  _divYear = '';
  _intYear = '';
  _expandedAnnualYear = '';

  const totalGross = pd.divHist.reduce((s, d) => s + d.gross, 0);
  const allIncomeDates = [
    ...pd.divHist.map((d) => d.date),
    ...pd.intHist.map((i) => i.date),
  ].sort();
  const has12mHistory =
    allIncomeDates.length > 1 &&
    (() => {
      const first = new Date(
        allIncomeDates[0].length === 7 ? `${allIncomeDates[0]}-01` : allIncomeDates[0],
      );
      const last = new Date(
        allIncomeDates[allIncomeDates.length - 1].length === 7
          ? `${allIncomeDates[allIncomeDates.length - 1]}-01`
          : allIncomeDates[allIncomeDates.length - 1],
      );
      return (last.getTime() - first.getTime()) / 86_400_000 >= 365;
    })();
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  const div12m = pd.divHist
    .filter((d) => new Date(d.date) >= cutoff)
    .reduce((sum, d) => sum + d.net, 0);
  const int12m = pd.intHist
    .filter((i) => new Date(i.date.length === 7 ? `${i.date}-01` : i.date) >= cutoff)
    .reduce((sum, i) => sum + i.net, 0);
  const incomeYield =
    has12mHistory && pd.totalInv > 0 ? (div12m / pd.totalInv) * 100 : null;
  const savingsBase = latestSavingsBalance(snaps);
  const savingsYield =
    has12mHistory && savingsBase !== null && savingsBase > 0 ? (int12m / savingsBase) * 100 : null;
  const combinedYield =
    has12mHistory && pd.totalInv > 0 && savingsBase !== null && savingsBase > 0
      ? ((div12m + int12m) / (pd.totalInv + savingsBase)) * 100
      : null;

  document.getElementById('div-kpis')!.innerHTML = `
    ${kpiTile({ label: `Gross dividends${infoTip('Before tax: Total distribution payments received from ETFs and stocks, before withholding tax is deducted.')}`, value: fmtEur2(totalGross) })}
    ${kpiTile({ label: 'Tax withheld', value: fmtEur2(Math.abs(pd.totalTax)), valueClass: pd.totalTax >= 0 ? 'neg' : 'pos', sub: 'on dividends' })}
    ${kpiTile({ label: 'Net received', value: fmtEur2(pd.totalDivNet), valueClass: 'pos', sub: 'dividends' })}
    ${kpiTile({ label: 'Gross interest', value: fmtEur2(pd.totalIntGross), sub: 'on cash savings' })}
    ${kpiTile({ label: 'Tax on savings', value: fmtEur2(pd.totalIntTax), valueClass: pd.totalIntTax > 0 ? 'neg' : 'ok', sub: 'withheld + refunds' })}
    ${kpiTile({ label: 'Net interest', value: fmtEur2(pd.totalInterest), valueClass: 'pos', sub: 'received' })}
    ${kpiTile({
      label: `Investment income yield (12m)${infoTip('Net dividends received in the last 12 months divided by ETF invested capital (cost basis). Scope is investment assets only.')}`,
      value: incomeYield === null ? '-' : `${incomeYield.toFixed(2).replace('.', ',')}%`,
      sub:
        incomeYield === null
          ? 'need 12 months of history'
          : 'net dividends / ETF cost basis',
    })}
    ${kpiTile({
      label: `Savings income yield (12m)${infoTip('Net interest received in the last 12 months divided by the latest savings-account balance snapshot. Scope is savings accounts only.')}`,
      value: savingsYield === null ? '-' : `${savingsYield.toFixed(2).replace('.', ',')}%`,
      sub:
        savingsYield === null
          ? savingsBase === null
            ? 'add a savings snapshot balance'
            : 'need 12 months of history'
          : 'net interest / latest savings balance',
    })}
    ${kpiTile({
      label: `Combined income yield (12m)${infoTip('Combined net dividends plus net interest in the last 12 months divided by ETF cost basis plus latest savings-account balance.')}`,
      value: combinedYield === null ? '-' : `${combinedYield.toFixed(2).replace('.', ',')}%`,
      sub:
        combinedYield === null
          ? 'requires investment + savings base'
          : 'net dividends + net interest / combined base',
    })}
  `;

  populateDivYearFilter(pd.divHist);
  attachDivFilterListeners(pd);
  renderDivTable(pd);

  populateIntYearFilter(pd.intHist);
  attachIntFilterListeners(pd);
  renderIntTable(pd);
  renderAnnualSummary(pd, txs);

  attachInfoTips(document.getElementById('subview-dividends')!);
}

function renderAnnualSummary(pd: PortfolioData, txs: Transaction[]): void {
  const byYear: Record<
    string,
    {
      grossDiv: number;
      divTax: number;
      netDiv: number;
      grossInt: number;
      intTax: number;
      netInt: number;
      realizedPnL: number;
    }
  > = {};
  const ensure = (year: string) =>
    (byYear[year] ??= {
      grossDiv: 0,
      divTax: 0,
      netDiv: 0,
      grossInt: 0,
      intTax: 0,
      netInt: 0,
      realizedPnL: 0,
    });
  for (const d of pd.divHist) {
    const y = d.date.slice(0, 4);
    const row = ensure(y);
    row.grossDiv += d.gross;
    row.divTax += d.tax;
    row.netDiv += d.net;
  }
  for (const i of pd.intHist) {
    const y = i.date.slice(0, 4);
    const row = ensure(y);
    row.grossInt += i.gross;
    row.intTax += i.tax;
    row.netInt += i.net;
  }
  for (const tx of txs) {
    if (tx.type !== 'SELL') continue;
    const y = tx.date.slice(0, 4);
    const row = ensure(y);
    row.realizedPnL += Math.abs(tx.amount) - Math.abs(tx.fee || 0);
  }

  const years = Object.keys(byYear).sort().reverse();
  const target = document.getElementById('div-annual');
  if (!target) return;
  if (!years.length) {
    target.innerHTML = '<p class="note">No yearly income data available yet.</p>';
    renderPagination('div-annual-pagination', 1, 1, () => {});
    return;
  }
  const totalPages = Math.max(1, Math.ceil(years.length / ANNUAL_PAGE_SIZE));
  if (_annualPage > totalPages) _annualPage = totalPages;
  const pageYears = years.slice((_annualPage - 1) * ANNUAL_PAGE_SIZE, _annualPage * ANNUAL_PAGE_SIZE);

  const rows = pageYears
    .map((y) => {
      const r = byYear[y];
      const taxable = r.netDiv + r.netInt + r.realizedPnL;
      const netIncome = r.netDiv + r.netInt + r.realizedPnL;
      const detailOpen = _expandedAnnualYear === y;
      return `<div class="tbl-row annual-row" role="row" data-annual-year="${y}">
        <div style="font-weight:500">${y}</div>
        <div style="text-align:right;color:${netIncome >= 0 ? 'var(--pos)' : 'var(--neg)'};font-weight:500">${fmtEur2(netIncome)}</div>
        <div style="text-align:right;font-weight:500">${fmtEur2(taxable)}</div>
      </div>
      ${
        detailOpen
          ? `<div class="annual-detail">
              <div><span class="hold-detail-label">Gross div</span><span class="hold-detail-value">${fmtEur2(r.grossDiv)}</span></div>
              <div><span class="hold-detail-label">Div tax</span><span class="hold-detail-value">${fmtEur2(r.divTax)}</span></div>
              <div><span class="hold-detail-label">Net div</span><span class="hold-detail-value">${fmtEur2(r.netDiv)}</span></div>
              <div><span class="hold-detail-label">Gross int</span><span class="hold-detail-value">${fmtEur2(r.grossInt)}</span></div>
              <div><span class="hold-detail-label">Int tax</span><span class="hold-detail-value">${fmtEur2(r.intTax)}</span></div>
              <div><span class="hold-detail-label">Net int</span><span class="hold-detail-value">${fmtEur2(r.netInt)}</span></div>
              <div><span class="hold-detail-label">Realized P&amp;L</span><span class="hold-detail-value ${r.realizedPnL >= 0 ? 'pos' : 'neg'}">${fmtEur2(r.realizedPnL)}</span></div>
            </div>`
          : ''
      }`;
    })
    .join('');
  target.innerHTML = `<div class="tbl" role="table" aria-label="Annual income summary">
    <div id="div-annual-table">
      <div class="tbl-row th annual-row" role="row">
        <div>Year</div>
        <div style="text-align:right">Net inc${infoTip('Net dividends + net interest + realized P&L for the year.')}</div>
        <div style="text-align:right">Taxable${infoTip('Net dividends + net interest + realized P&L. Expand row for full breakdown.')}</div>
      </div>
      ${rows}
    </div>
  </div>`;
  const annualEl = document.getElementById('div-annual-table') as
    | (HTMLElement & { _bound?: boolean })
    | null;
  if (annualEl && !annualEl._bound) {
    annualEl._bound = true;
    annualEl.addEventListener('click', (ev) => {
      const row = (ev.target as HTMLElement).closest('[data-annual-year]') as HTMLElement | null;
      if (!row) return;
      const y = row.dataset.annualYear || '';
      _expandedAnnualYear = _expandedAnnualYear === y ? '' : y;
      renderAnnualSummary(_lastPd!, _lastTxs);
    });
  }
  attachInfoTips(target);
  renderPagination('div-annual-pagination', _annualPage, totalPages, (p) => {
    _annualPage = p;
    _expandedAnnualYear = '';
    renderAnnualSummary(_lastPd!, _lastTxs);
  });
}

function latestSavingsBalance(snaps: Snapshot[]): number | null {
  const latest = snaps.length > 0 ? snaps[snaps.length - 1] : null;
  if (!latest) return null;
  const savings = getAccounts().filter((a) => (a.moneyType || '').toLowerCase() === 'savings');
  if (!savings.length) return null;
  const byLowerKey: Record<string, number> = {};
  for (const [k, v] of Object.entries(latest)) {
    if (typeof v === 'number') byLowerKey[k.toLowerCase()] = v;
  }
  let found = false;
  let sum = 0;
  for (const a of savings) {
    const key = (a.id || '').toLowerCase();
    if (!key) continue;
    if (key in byLowerKey) {
      found = true;
      sum += byLowerKey[key];
    }
  }
  return found ? sum : null;
}

function dividendColumns(pd: PortfolioData): ColumnDef<DivHistEntry>[] {
  // Build ISIN → name lookup from holdings config, falling back to position data
  const nameMap: Record<string, string> = {};
  for (const h of getHoldings()) {
    if (h.name) nameMap[h.isin] = h.name;
  }
  // Fill gaps from portfolio position names (from transactions)
  if (pd.etfs) {
    for (const [isin, pos] of Object.entries(pd.etfs)) {
      if (!nameMap[isin] && pos.name) nameMap[isin] = pos.name;
    }
  }

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
      cell: (d) =>
        `<div style="font-weight:500;font-size:12px"><span data-etf-isin="${esc(d.isin)}" data-etf-name="${esc(nameMap[d.isin] || '')}">${esc(d.shortName)}</span></div><div style="font-size:11px;color:var(--ink-3)">${fmtDay(d.date)}</div>`,
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
        `<span style="color:var(--neg)" aria-label="Tax ${fmtEur2(d.tax)}">${fmtEur2(d.tax)}</span>`,
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
  const columns = dividendColumns(pd);

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

  document.getElementById('div-history')!.innerHTML = hasDiv
    ? `
    <div class="tbl-row th div-row" role="row" id="div-table-header">
      ${renderTableHeader(columns, _divTblSort)}
    </div>${dRows}
    <div class="tbl-row div-row" style="border-top:1px solid var(--line-2);margin-top:4px">
      <div></div><div style="font-weight:500">${_divYear ? 'Year total' : 'Total'}</div>
      <div style="text-align:right;font-weight:500">${fmtEur2(totalGross)}</div>
      <div style="text-align:right;color:var(--neg)">${fmtEur2(totalTax)}</div>
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

  // Attach ETF info popovers on shortName spans
  const divHistEl = document.getElementById('div-history');
  if (divHistEl) attachEtfPopovers(divHistEl);

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
      label: 'Month',
      cell: (i) => fmtMon(i.date),
      sortValue: (i) => i.date,
    },
    {
      key: 'gross',
      label: 'Gross',
      align: 'right',
      sortValue: (i) => i.gross,
      cell: (i) => `<span style="color:var(--ink-2)">${fmtEur2(i.gross)}</span>`,
    },
    {
      key: 'tax',
      label: 'Tax',
      align: 'right',
      sortValue: (i) => i.tax,
      cell: (i) =>
        i.tax > 0
          ? `<span style="color:var(--neg)">${fmtEur2(i.tax)}</span>`
          : i.tax < 0
            ? `<span style="color:var(--pos)">${fmtEur2(i.tax)}</span>`
            : `<span style="color:var(--ink-3)">—</span>`,
    },
    {
      key: 'net',
      label: 'Net',
      align: 'right',
      sortValue: (i) => i.net,
      cell: (i) => `<span style="color:var(--pos);font-weight:500">${fmtEur2(i.net)}</span>`,
    },
  ];
}

function renderIntTable(pd: PortfolioData): void {
  const list = _intYear ? pd.intHist.filter((i) => i.date.startsWith(_intYear)) : pd.intHist;
  const totalGross = list.reduce((s, i) => s + i.gross, 0);
  const totalTax = list.reduce((s, i) => s + i.tax, 0);
  const totalNet = list.reduce((s, i) => s + i.net, 0);

  // Column definitions
  const columns = intColumns();

  // Apply sort (before pagination)
  const sorted = applySort(list, _intTblSort, getSortGetters(columns));

  const totalPages = Math.ceil(sorted.length / DIV_PAGE_SIZE);
  if (_intPage > totalPages) _intPage = Math.max(1, totalPages);
  const pageItems = sorted.slice((_intPage - 1) * DIV_PAGE_SIZE, _intPage * DIV_PAGE_SIZE);

  document.getElementById('div-interest')!.innerHTML =
    list.length > 0
      ? `<div class="tbl-row th int-row" role="row" id="int-table-header" style="border-bottom:1px solid var(--line);padding-bottom:4px;margin-bottom:2px">${renderTableHeader(columns, _intTblSort)}</div>` +
        pageItems
          .map((i) => `<div class="tbl-row int-row" role="row">${renderTableRow(columns, i)}</div>`)
          .join('') +
        `<div class="tbl-row int-row" role="row" style="border-top:1px solid var(--line-2);margin-top:4px">
        <div style="font-weight:500">${_intYear ? 'Year total' : 'Total'}</div>
        <div style="font-weight:500;text-align:right">${fmtEur2(totalGross)}</div>
        <div style="text-align:right;color:var(${totalTax > 0 ? '--neg' : '--pos'})">${fmtEur2(totalTax)}</div>
        <div style="font-weight:500;text-align:right;color:var(--pos)">${fmtEur2(totalNet)}</div></div>`
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
