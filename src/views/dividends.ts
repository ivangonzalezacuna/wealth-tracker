// @ts-nocheck — DOM-heavy view; full strict typing deferred to framework migration
import { fmtEur2, fmtDay, esc, safeColor } from '../utils';
import type { PortfolioData } from '../types';
import { T } from '../theme';

const DIV_PAGE_SIZE = 12;
let _divPage = 1;
let _intPage = 1;
let _lastPd: PortfolioData | null = null;

export function renderDividends(pd: PortfolioData | null): void {
  const hasPD  = !!pd;
  const hasDiv = hasPD && pd.divHist.length > 0;

  document.getElementById('div-empty').style.display   = hasPD ? 'none'  : 'block';
  document.getElementById('div-content').style.display = hasPD ? 'block' : 'none';
  if (!hasPD) return;

  _lastPd = pd;
  _divPage = 1;
  _intPage = 1;

  const totalGross = pd.divHist.reduce((s, d) => s + d.gross, 0);

  document.getElementById('div-kpis').innerHTML = `
    <div class="kpi"><div class="kpi-label">Gross dividends</div><div class="kpi-val">${fmtEur2(totalGross)}</div></div>
    <div class="kpi"><div class="kpi-label">Tax withheld</div><div class="kpi-val neg">−${fmtEur2(pd.totalTax)}</div><div class="kpi-sub">Abgeltungsteuer</div></div>
    <div class="kpi"><div class="kpi-label">Net received</div><div class="kpi-val pos">${fmtEur2(pd.totalDivNet)}</div></div>
    <div class="kpi"><div class="kpi-label">TR interest</div><div class="kpi-val pos">${fmtEur2(pd.totalInterest)}</div><div class="kpi-sub">on cash savings</div></div>
  `;

  renderDivTable(pd);
  renderIntTable(pd);
}

function renderDivTable(pd: PortfolioData): void {
  const hasDiv = pd.divHist.length > 0;
  const totalGross = pd.divHist.reduce((s, d) => s + d.gross, 0);

  const list = pd.divHist;
  const totalPages = Math.ceil(list.length / DIV_PAGE_SIZE);
  if (_divPage > totalPages) _divPage = Math.max(1, totalPages);
  const pageItems = list.slice((_divPage - 1) * DIV_PAGE_SIZE, _divPage * DIV_PAGE_SIZE);

  const dRows = pageItems.map(d => `
    <div class="tbl-row" role="row" style="grid-template-columns:auto 1.5fr 1fr 1fr 1fr">
      <span class="leg-sq" style="background:${safeColor(d.color)};display:inline-block;margin-top:2px"></span>
      <div role="cell"><div style="font-weight:500;font-size:12px">${esc(d.ticker)}</div>
           <div style="font-size:11px;color:var(--ink-3)">${fmtDay(d.date)}</div></div>
      <div role="cell" style="color:var(--ink-2)">${fmtEur2(d.gross)}</div>
      <div role="cell" style="color:var(--neg)" aria-label="Tax −${d.tax.toFixed(2)}">−${fmtEur2(d.tax)}</div>
      <div role="cell" style="color:var(--pos);font-weight:500">${fmtEur2(d.net)}</div>
    </div>`).join('');

  document.getElementById('div-history').innerHTML = hasDiv ? `
    <div class="tbl-row th" role="row" style="grid-template-columns:auto 1.5fr 1fr 1fr 1fr">
      <div></div><div role="columnheader">ETF / Date</div><div role="columnheader">Gross</div><div role="columnheader">Tax</div><div role="columnheader">Net</div>
    </div>${dRows}
    <div class="tbl-row" style="grid-template-columns:auto 1.5fr 1fr 1fr 1fr;border-top:1px solid var(--line-2);margin-top:4px">
      <div></div><div style="font-weight:500">Total</div>
      <div style="font-weight:500">${fmtEur2(totalGross)}</div>
      <div style="color:var(--neg)">−${fmtEur2(pd.totalTax)}</div>
      <div style="color:var(--pos);font-weight:500">${fmtEur2(pd.totalDivNet)}</div>
    </div>` : '<p class="note">No dividends found in imported transactions yet.</p>';

  renderDivPagination(totalPages, pd);
}

function renderDivPagination(totalPages: number, pd: PortfolioData): void {
  const el = document.getElementById('div-pagination');
  if (!el) return;
  if (totalPages <= 1) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `
    <button class="btn btn-sm btn-ghost js-div-prev" ${_divPage <= 1 ? 'disabled' : ''}>←</button>
    <span class="page-info">${_divPage} / ${totalPages}</span>
    <button class="btn btn-sm btn-ghost js-div-next" ${_divPage >= totalPages ? 'disabled' : ''}>→</button>
  `;
  el.querySelector('.js-div-prev')?.addEventListener('click', () => {
    if (_divPage > 1) { _divPage--; renderDivTable(_lastPd || pd); }
  });
  el.querySelector('.js-div-next')?.addEventListener('click', () => {
    if (_divPage < totalPages) { _divPage++; renderDivTable(_lastPd || pd); }
  });
}

function renderIntTable(pd: PortfolioData): void {
  const list = pd.intHist;
  const totalPages = Math.ceil(list.length / DIV_PAGE_SIZE);
  if (_intPage > totalPages) _intPage = Math.max(1, totalPages);
  const pageItems = list.slice((_intPage - 1) * DIV_PAGE_SIZE, _intPage * DIV_PAGE_SIZE);

  document.getElementById('div-interest').innerHTML = list.length > 0
    ? pageItems.map(i =>
        `<div class="row"><div class="row-label">${fmtDay(i.date)}</div><div class="row-val ok">${fmtEur2(i.amount)}</div></div>`
      ).join('') +
      `<div class="row" style="border-top:1px solid var(--line-2);margin-top:4px">
        <div class="row-label" style="font-weight:500">Total interest</div>
        <div class="row-val ok" style="font-weight:500">${fmtEur2(pd.totalInterest)}</div></div>`
    : '<p class="note">No interest payments found in imported transactions.</p>';

  renderIntPagination(totalPages, pd);
}

function renderIntPagination(totalPages: number, pd: PortfolioData): void {
  const el = document.getElementById('int-pagination');
  if (!el) return;
  if (totalPages <= 1) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `
    <button class="btn btn-sm btn-ghost js-int-prev" ${_intPage <= 1 ? 'disabled' : ''}>←</button>
    <span class="page-info">${_intPage} / ${totalPages}</span>
    <button class="btn btn-sm btn-ghost js-int-next" ${_intPage >= totalPages ? 'disabled' : ''}>→</button>
  `;
  el.querySelector('.js-int-prev')?.addEventListener('click', () => {
    if (_intPage > 1) { _intPage--; renderIntTable(_lastPd || pd); }
  });
  el.querySelector('.js-int-next')?.addEventListener('click', () => {
    if (_intPage < totalPages) { _intPage++; renderIntTable(_lastPd || pd); }
  });
}
