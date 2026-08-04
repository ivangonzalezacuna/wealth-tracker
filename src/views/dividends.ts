import { fmtEur2, fmtMon, fmtDay, esc, safeColor, kpiTile, fmtPctVal } from '../utils';
import type { PortfolioData, DivHistEntry, IntHistEntry, Transaction, Snapshot } from '../types';
import { T } from '../theme';
import { infoTip, attachInfoTips } from '../ui/infoTip';
import { attachEtfPopovers } from '../ui/etfPopover';
import { getAccounts, getCostBasisMethod, getHoldings } from '../store/config';
import { computeCostBasis } from '../model/costbasis';
import { dividendProjectionSeries, forecastMultiAccountSeries } from '../model/forecast';
import { trailingDividendYield } from '../model/insights';
import type { SortState } from './tableSort';
import { applySort, bindSortableHeader } from './tableSort';
import type { ColumnDef } from './tableColumns';
import { renderTableHeader, renderTableRow, getSortGetters } from './tableColumns';
import { renderPagination } from './pagination';
import Chart from 'chart.js/auto';
import { resolvedT } from '../theme';

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
  const incomeYield = has12mHistory && pd.totalInv > 0 ? (div12m / pd.totalInv) * 100 : null;
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
      sub: incomeYield === null ? 'need 12 months of history' : 'net dividends / ETF cost basis',
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
  renderDivProjection(pd, snaps);

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
  const realizedPnLByYear = computeRealizedPnLByYear(txs);
  for (const [year, realizedPnL] of Object.entries(realizedPnLByYear)) {
    const row = ensure(year);
    row.realizedPnL += realizedPnL;
  }

  const years = Object.keys(byYear).sort().reverse();
  const target = document.getElementById('div-annual');
  if (!target) return;
  if (!years.length) {
    target.innerHTML = '<p class="note">No yearly income data available yet.</p>';
    renderPagination('div-annual-pagination', 1, 1, () => {});
    return;
  }

  function computeRealizedPnLByYear(txs: Transaction[]): Record<string, number> {
    const method = getCostBasisMethod();
    const txsByYear = txs
      .filter((tx) => tx.date && (tx.type === 'BUY' || tx.type === 'SELL'))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    if (!txsByYear.length) return {};

    const years = Array.from(new Set(txsByYear.map((tx) => tx.date.slice(0, 4)))).sort();
    const out: Record<string, number> = {};
    let runningRealized = 0;
    for (const year of years) {
      const cumulative = txsByYear.filter((tx) => tx.date.slice(0, 4) <= year);
      const basisByIsin = computeCostBasis(cumulative, method);
      const totalRealized = Object.values(basisByIsin).reduce(
        (sum, basis) => sum + basis.realizedPnL,
        0,
      );
      out[year] = totalRealized - runningRealized;
      runningRealized = totalRealized;
    }
    return out;
  }
  const totalPages = Math.max(1, Math.ceil(years.length / ANNUAL_PAGE_SIZE));
  if (_annualPage > totalPages) _annualPage = totalPages;
  const pageYears = years.slice(
    (_annualPage - 1) * ANNUAL_PAGE_SIZE,
    _annualPage * ANNUAL_PAGE_SIZE,
  );

  const rows = pageYears
    .map((y) => {
      const r = byYear[y];
      const benefitsNet = r.netDiv + r.netInt + r.realizedPnL;
      const taxesPaid = r.divTax + r.intTax;
      const taxesPaidColor =
        taxesPaid > 0 ? 'var(--neg)' : taxesPaid < 0 ? 'var(--pos)' : 'var(--ink-3)';
      const detailOpen = _expandedAnnualYear === y;
      const detail = renderAnnualDetail(r);
      return `<div class="tbl-row annual-row" role="row" data-annual-year="${y}">
        <div style="font-weight:500">${y}</div>
        <div style="text-align:right;color:${taxesPaidColor}">${fmtEur2(taxesPaid)}</div>
        <div style="text-align:right;color:${benefitsNet >= 0 ? 'var(--pos)' : 'var(--neg)'};font-weight:500">${fmtEur2(benefitsNet)}</div>
      </div>
      ${detailOpen ? `<div class="annual-detail">${detail}</div>` : ''}`;
    })
    .join('');
  target.innerHTML = `<div class="tbl" role="table" aria-label="Annual income summary">
    <div id="div-annual-table">
      <div class="tbl-row th annual-row" role="row">
        <div>Year</div>
        <div style="text-align:right">Taxes paid${infoTip('Dividend taxes + savings-interest taxes paid during the year. Expand row for full breakdown.')}</div>
        <div style="text-align:right">Benefits (net)${infoTip('Net dividends + net savings interest + realized profit/loss from sells for the year.')}</div>
      </div>
      ${rows}
    </div>
  </div>`;
  const annualEl = document.getElementById('div-annual-table') as
    (HTMLElement & { _bound?: boolean }) | null;
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

  function renderAnnualDetail(r: {
    grossDiv: number;
    divTax: number;
    netDiv: number;
    grossInt: number;
    intTax: number;
    netInt: number;
    realizedPnL: number;
  }): string {
    const detailGroups = [
      {
        title: 'Dividends',
        items: [
          { label: 'Gross', value: r.grossDiv },
          { label: 'Taxes', value: r.divTax, className: taxToneClass(r.divTax) },
          { label: 'Net', value: r.netDiv, className: toneClass(r.netDiv) },
        ],
      },
      {
        title: 'Savings',
        items: [
          { label: 'Gross', value: r.grossInt },
          { label: 'Taxes', value: r.intTax, className: taxToneClass(r.intTax) },
          { label: 'Net', value: r.netInt, className: toneClass(r.netInt) },
        ],
      },
      {
        title: 'Profit / loss',
        items: [
          {
            label: 'Realized profit and loss from sells',
            value: r.realizedPnL,
            className: toneClass(r.realizedPnL),
          },
        ],
      },
    ];

    const groupsHtml = detailGroups
      .map((g) => {
        const itemsHtml = g.items
          .filter((i) => !isZero(i.value))
          .map(
            (i) =>
              `<div><span class="hold-detail-label">${i.label}</span><span class="hold-detail-value ${i.className || ''}">${fmtEur2(i.value)}</span></div>`,
          )
          .join('');
        if (!itemsHtml) return '';
        return `<div class="annual-detail-group"><div class="annual-detail-group-title">${g.title}</div>${itemsHtml}</div>`;
      })
      .join('');

    return (
      groupsHtml || '<div class="annual-detail-empty">No yearly breakdown available yet.</div>'
    );
  }

  function toneClass(value: number): 'pos' | 'neg' | '' {
    if (value > 0) return 'pos';
    if (value < 0) return 'neg';
    return '';
  }

  function taxToneClass(value: number): 'pos' | 'neg' | '' {
    if (value > 0) return 'neg';
    if (value < 0) return 'pos';
    return '';
  }

  function isZero(value: number): boolean {
    return Math.abs(value) < 1e-9;
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

// ── Dividend income projection ─────────────────────────────────────

const DIV_PROJ_YIELD_KEY = 'div:proj-yield';
let _divProjRange: '60' | '120' | '240' = '60';
let _divProjYield: number | null = null;
let _divProjChart: Chart | null = null;
let _divProjPd: PortfolioData | null = null;
let _divProjSnaps: Snapshot[] = [];

function _loadPersistedYield(): number | null {
  try {
    const raw = localStorage.getItem(DIV_PROJ_YIELD_KEY);
    if (raw === null) return null;
    const v = parseFloat(raw);
    return isFinite(v) && v >= 0 ? v : null;
  } catch {
    return null;
  }
}

function _savePersistedYield(value: number): void {
  try {
    localStorage.setItem(DIV_PROJ_YIELD_KEY, String(value));
  } catch {
    // ignore storage errors
  }
}

function renderDivProjection(pd: PortfolioData, snaps: Snapshot[]): void {
  const el = document.getElementById('div-projection');
  if (!el) return;

  _divProjPd = pd;
  _divProjSnaps = snaps;

  // Require at least 12 months of dividend history to show the projection
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  const div12m = pd.divHist.filter((d) => {
    const dateStr = d.date.length === 7 ? `${d.date}-01` : d.date;
    return new Date(dateStr) >= cutoff;
  });
  const has12mDiv = div12m.length > 0 && div12m.reduce((s, d) => s + d.net, 0) > 0;

  if (!has12mDiv) {
    el.innerHTML = `
      <div class="card" id="div-card-projection">
        <div class="card-header">
          <div class="card-title">Dividend income projection${infoTip('Forward projection of annual dividend income based on your portfolio forecast and a configurable yield rate. Requires at least 12 months of dividend history.')}</div>
        </div>
        <div class="card-body">
          <p class="note">At least 12 months of dividend history is needed to show the income projection.</p>
        </div>
      </div>`;
    return;
  }

  // Only count cost basis of distributing (non-acc) holdings for the yield denominator,
  // since acc holdings do not pay dividends and would artificially dilute the yield.
  const distInv = Object.values(pd.etfs)
    .filter((e) => !e.acc)
    .reduce((s, e) => s + e.cost, 0);

  // Use persisted yield if available, otherwise seed from trailing 12m calculation
  if (_divProjYield === null) {
    const persisted = _loadPersistedYield();
    _divProjYield =
      persisted !== null ? persisted : (trailingDividendYield(pd.divHist, distInv) ?? 0);
  }

  const calculatedYield = trailingDividendYield(pd.divHist, distInv) ?? 0;
  el.innerHTML = _renderDivProjCard(calculatedYield);
  attachInfoTips(el);
  _attachDivProjListeners(el, pd, snaps, calculatedYield);
  _renderDivProjChart(pd, snaps);
}

function _renderDivProjCard(calculatedYield: number): string {
  const yieldVal = _divProjYield ?? 0;
  const calcHint =
    calculatedYield > 0
      ? `<span style="font-size:12px;color:var(--ink-3)">Calculated from history: ${fmtPctVal(calculatedYield, 2)}</span>`
      : '';
  return `
    <div class="card" id="div-card-projection">
      <div class="card-header">
        <div class="card-title">Dividend income projection${infoTip('Forward projection of estimated annual dividend income based on your portfolio growth forecast and a configurable yield. The yield is seeded from your trailing 12-month dividend income divided by current invested capital. You can override it and your value will be remembered.')}</div>
      </div>
      <div class="card-body">
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <label for="div-proj-yield" style="font-size:13px;color:var(--ink-2)">Annual yield (%)</label>
            <input id="div-proj-yield" class="form-input form-input-sm" type="number" min="0" max="100" step="0.1" value="${yieldVal.toFixed(2)}" style="width:80px">
            ${calcHint}
            ${calculatedYield > 0 ? `<button id="div-proj-yield-reset" class="btn btn-sm btn-ghost">Reset to calculated</button>` : ''}
          </div>
          <div class="range-toggle" id="div-proj-range-toggle">
            <button class="btn btn-sm btn-ghost ${_divProjRange === '60' ? 'active' : ''}" data-proj-range="60">5Y</button>
            <button class="btn btn-sm btn-ghost ${_divProjRange === '120' ? 'active' : ''}" data-proj-range="120">10Y</button>
            <button class="btn btn-sm btn-ghost ${_divProjRange === '240' ? 'active' : ''}" data-proj-range="240">20Y</button>
          </div>
        </div>
        <div id="div-proj-eta" style="font-size:13px;color:var(--ink-2);margin-bottom:10px"></div>
        <div class="chart-wrap"><canvas id="c-div-proj"></canvas></div>
      </div>
    </div>`;
}

function _renderDivProjChart(pd: PortfolioData, snaps: Snapshot[]): void {
  if (_divProjChart) {
    _divProjChart.destroy();
    _divProjChart = null;
  }

  const canvas = document.getElementById('c-div-proj') as HTMLCanvasElement | null;
  if (!canvas) return;

  const yieldPct = _divProjYield ?? 0;
  const months = parseInt(_divProjRange);

  // Build portfolio forecast from latest snapshot + account settings
  const accounts = getAccounts();
  const latestSnap = snaps.length > 0 ? snaps[snaps.length - 1] : null;
  const startDate = latestSnap?.date ?? new Date().toISOString().slice(0, 7);

  const accountInputs = accounts.map((a) => ({
    current: latestSnap ? (latestSnap[a.id || ''] as number) || 0 : 0,
    annualReturnPct: a.annualReturnPct ?? 0,
    annualContrib: 0, // conservative: no contribution assumption for income projection
  }));

  const forecast = forecastMultiAccountSeries(accountInputs, months, startDate);
  const projection = dividendProjectionSeries(forecast, yieldPct);

  // Aggregate to annual buckets for the bar chart
  const annualMap: Record<string, number> = {};
  for (const p of projection) {
    const year = p.month.slice(0, 4);
    annualMap[year] = (annualMap[year] || 0) + p.monthlyIncome;
  }
  const labels = Object.keys(annualMap).sort();
  const data = labels.map((y) => Math.round(annualMap[y]));

  // ETA: first year projected income crosses a round threshold
  const lastAnnual = data.length > 0 ? data[data.length - 1] : 0;
  const etaEl = document.getElementById('div-proj-eta');
  if (etaEl) {
    if (yieldPct <= 0) {
      etaEl.textContent = 'Enter a yield above to see the projection.';
    } else {
      etaEl.textContent = `Projected annual dividend income in ${months / 12} years: ${fmtEur2(lastAnnual)} (at ${fmtPctVal(yieldPct)} yield)`;
    }
  }

  const C = resolvedT();
  _divProjChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Projected annual income',
          data,
          backgroundColor: C.pos,
          borderColor: C.pos,
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${fmtEur2(ctx.raw as number)}`,
          },
        },
      },
      scales: {
        y: {
          ticks: { color: C.ink4, callback: (v) => fmtEur2(v as number) },
          grid: { color: C.line },
        },
        x: { ticks: { color: C.ink4 }, grid: { color: C.line } },
      },
    },
  });
}

function _attachDivProjListeners(
  el: HTMLElement,
  pd: PortfolioData,
  snaps: Snapshot[],
  calculatedYield: number,
): void {
  // Yield input
  const yieldInput = el.querySelector('#div-proj-yield') as HTMLInputElement | null;
  if (yieldInput) {
    yieldInput.addEventListener('input', () => {
      _divProjYield = parseFloat(yieldInput.value) || 0;
      _savePersistedYield(_divProjYield);
      _renderDivProjChart(pd, snaps);
    });
  }

  // Reset to calculated button
  const resetBtn = el.querySelector('#div-proj-yield-reset') as HTMLButtonElement | null;
  if (resetBtn && yieldInput) {
    resetBtn.addEventListener('click', () => {
      _divProjYield = calculatedYield;
      _savePersistedYield(_divProjYield);
      yieldInput.value = _divProjYield.toFixed(2);
      _renderDivProjChart(pd, snaps);
    });
  }

  // Range toggle
  el.querySelector('#div-proj-range-toggle')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-proj-range]') as HTMLElement | null;
    if (!btn) return;
    const newRange = btn.dataset.projRange as '60' | '120' | '240';
    if (newRange === _divProjRange) return;
    _divProjRange = newRange;
    el.querySelectorAll('#div-proj-range-toggle [data-proj-range]').forEach((b) =>
      b.classList.toggle('active', (b as HTMLElement).dataset.projRange === newRange),
    );
    _renderDivProjChart(pd, snaps);
  });
}
