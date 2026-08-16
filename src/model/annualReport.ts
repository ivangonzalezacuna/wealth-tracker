/**
 * Annual portfolio report — pure functions for building and rendering a
 * year-end summary of net worth, holdings, income, and taxable events.
 *
 * All functions are side-effect free and depend only on their parameters.
 */
import { TxType } from '../types';
import type { Transaction, Snapshot, Holding, Account } from '../types';
import { computeCostBasis } from './costbasis';
import { toBase } from '../fx';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AnnualReportAccount {
  label: string;
  value: number;
}

export interface AnnualReportHolding {
  isin: string;
  name: string;
  shares: number;
  costBasis: number;
  yearRealisedGain: number;
}

export interface AnnualReportDividend {
  isin: string;
  name: string;
  gross: number;
  tax: number;
  net: number;
}

export interface AnnualReportInterest {
  source: string;
  gross: number;
  tax: number;
  net: number;
}

export interface AnnualReport {
  year: number;
  generatedAt: string;
  accounts: AnnualReportAccount[];
  totalNetWorth: number;
  holdings: AnnualReportHolding[];
  dividends: AnnualReportDividend[];
  totalDividendGross: number;
  totalDividendTax: number;
  totalDividendNet: number;
  interest: AnnualReportInterest[];
  totalInterestGross: number;
  totalInterestTax: number;
  totalInterestNet: number;
  totalYearRealisedGains: number;
  totalTax: number;
}

// ── Build ──────────────────────────────────────────────────────────────────────

/**
 * Build an annual portfolio report for the given calendar year.
 *
 * Expects all transactions (not pre-filtered) and all snapshots so that the
 * cost-basis engine can work from the full trade history.
 */
export function buildAnnualReport(
  year: number,
  transactions: Transaction[],
  snapshots: Snapshot[],
  holdings: Holding[],
  accounts: Account[],
): AnnualReport {
  const yearStr = String(year);
  const yearStart = `${yearStr}-01-01`;
  const yearEnd = `${yearStr}-12-31`;

  // ── Portfolio snapshot: last snapshot on or before year end ──
  const snapsUntilYearEnd = snapshots.filter((s) => s.date <= yearEnd);
  const snap =
    snapsUntilYearEnd.length > 0 ? snapsUntilYearEnd[snapsUntilYearEnd.length - 1] : null;

  const accountRows: AnnualReportAccount[] = accounts.map((a) => ({
    label: a.label,
    value: snap ? (snap[a.id || ''] as number) || 0 : 0,
  }));
  const totalNetWorth = accountRows.reduce((s, a) => s + a.value, 0);

  // ── Cost basis: two-pass to extract year-specific realised gains ──
  const txsBeforeYear = transactions.filter((t) => t.date < yearStart);
  const txsThroughYear = transactions.filter((t) => t.date <= yearEnd);
  const prevBasis = computeCostBasis(txsBeforeYear);
  const yearBasis = computeCostBasis(txsThroughYear);

  const holdingMap = Object.fromEntries(holdings.map((h) => [h.isin, h]));
  const holdingRows: AnnualReportHolding[] = Object.entries(yearBasis)
    .map(([isin, cb]) => ({
      isin,
      name: holdingMap[isin]?.name || isin,
      shares: cb.shares,
      costBasis: cb.costBasis,
      yearRealisedGain: cb.realizedPnL - (prevBasis[isin]?.realizedPnL ?? 0),
    }))
    .filter((h) => h.shares > 0 || h.yearRealisedGain !== 0);

  const totalYearRealisedGains = holdingRows.reduce((s, h) => s + h.yearRealisedGain, 0);

  // ── Dividends for the year ──
  const yearTxs = transactions.filter((t) => t.date >= yearStart && t.date <= yearEnd);
  const divByIsin: Record<string, { gross: number; tax: number; net: number }> = {};
  for (const tx of yearTxs.filter((t) => t.type === TxType.DIVIDEND)) {
    const isin = tx.isin || '';
    const taxAbs = Math.abs(toBase(tx.tax || 0, tx.currency, tx.fxRate));
    const net = Math.abs(toBase(tx.amount, tx.currency, tx.fxRate));
    const gross = net + taxAbs;
    if (!divByIsin[isin]) divByIsin[isin] = { gross: 0, tax: 0, net: 0 };
    divByIsin[isin].gross += gross;
    divByIsin[isin].tax += taxAbs;
    divByIsin[isin].net += net;
  }
  const dividends: AnnualReportDividend[] = Object.entries(divByIsin).map(([isin, d]) => ({
    isin,
    name: holdingMap[isin]?.name || isin,
    ...d,
  }));
  const totalDividendGross = dividends.reduce((s, d) => s + d.gross, 0);
  const totalDividendTax = dividends.reduce((s, d) => s + d.tax, 0);
  const totalDividendNet = dividends.reduce((s, d) => s + d.net, 0);

  // ── Interest for the year (grouped by source) ──
  const intBySource: Record<string, { gross: number; tax: number; net: number }> = {};
  for (const tx of yearTxs.filter((t) => t.type === TxType.INTEREST)) {
    const src = tx.source || 'Unknown';
    // tx.tax is negative when Kapitalertragsteuer was deducted from the interest payment
    const taxRaw = toBase(tx.tax || 0, tx.currency, tx.fxRate);
    const net = toBase(tx.amount, tx.currency, tx.fxRate);
    const gross = net - taxRaw; // gross = net before deduction (taxRaw < 0 when tax was paid)
    const taxPaid = Math.abs(taxRaw);
    if (!intBySource[src]) intBySource[src] = { gross: 0, tax: 0, net: 0 };
    intBySource[src].gross += gross;
    intBySource[src].tax += taxPaid;
    intBySource[src].net += net;
  }
  const interest: AnnualReportInterest[] = Object.entries(intBySource).map(([source, i]) => ({
    source,
    ...i,
  }));
  const totalInterestGross = interest.reduce((s, i) => s + i.gross, 0);
  const totalInterestTax = interest.reduce((s, i) => s + i.tax, 0);
  const totalInterestNet = interest.reduce((s, i) => s + i.net, 0);

  // ── Total tax for the year ──
  const standaloneTax = yearTxs
    .filter((t) => t.type === TxType.TAX)
    .reduce((s, tx) => {
      const canonicalTax = tx.tax !== 0 ? tx.tax : tx.amount || 0;
      return s + Math.abs(toBase(canonicalTax, tx.currency, tx.fxRate));
    }, 0);
  const totalTax = totalDividendTax + totalInterestTax + standaloneTax;

  return {
    year,
    generatedAt: new Date().toISOString(),
    accounts: accountRows,
    totalNetWorth,
    holdings: holdingRows,
    dividends,
    totalDividendGross,
    totalDividendTax,
    totalDividendNet,
    interest,
    totalInterestGross,
    totalInterestTax,
    totalInterestNet,
    totalYearRealisedGains,
    totalTax,
  };
}

// ── HTML render ────────────────────────────────────────────────────────────────

function _esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _fmt(value: number, currency: string): string {
  const formatted = value.toLocaleString('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${formatted}\u00a0${currency}`;
}

function _tableRow(cells: string[], cls = ''): string {
  return `<tr${cls ? ` class="${cls}"` : ''}>${cells.map((c, i) => `<td${i > 0 ? ' class="num"' : ''}>${c}</td>`).join('')}</tr>`;
}

function _th(labels: string[]): string {
  return `<tr>${labels.map((l, i) => `<th${i > 0 ? ' class="num"' : ''}>${l}</th>`).join('')}</tr>`;
}

/**
 * Render a self-contained, print-ready HTML page for the given annual report.
 * No external CSS or JS dependencies — designed to be saved as a file and
 * opened in any browser for printing to PDF.
 */
export function renderAnnualReportHtml(report: AnnualReport, currency: string): string {
  const { year } = report;
  const generatedDate = new Date(report.generatedAt).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  // ── Accounts table ──
  const accountsRows = report.accounts
    .map((a) => _tableRow([_esc(a.label), _fmt(a.value, currency)]))
    .join('');

  // ── Holdings table (only ISINs with shares or realised gains this year) ──
  const holdingsRows = report.holdings
    .map((h) =>
      _tableRow([
        _esc(h.isin),
        _esc(h.name),
        h.shares.toLocaleString('de-DE', { minimumFractionDigits: 4, maximumFractionDigits: 8 }),
        _fmt(h.costBasis, currency),
        _fmt(h.yearRealisedGain, currency),
      ]),
    )
    .join('');

  // ── Dividends table ──
  const dividendsRows = report.dividends
    .map((d) =>
      _tableRow([
        _esc(d.isin),
        _esc(d.name),
        _fmt(d.gross, currency),
        _fmt(d.tax, currency),
        _fmt(d.net, currency),
      ]),
    )
    .join('');

  const dividendsSection =
    report.dividends.length > 0
      ? `<h2>Dividends</h2>
<table>
  <thead>${_th(['ISIN', 'Name', `Gross (${currency})`, `Tax (${currency})`, `Net (${currency})`])}</thead>
  <tbody>${dividendsRows}</tbody>
  <tfoot>${_tableRow(['', 'Total', _fmt(report.totalDividendGross, currency), _fmt(report.totalDividendTax, currency), _fmt(report.totalDividendNet, currency)], 'total')}</tfoot>
</table>`
      : '';

  // ── Interest table ──
  const interestRows = report.interest
    .map((i) =>
      _tableRow([
        _esc(i.source),
        _fmt(i.gross, currency),
        _fmt(i.tax, currency),
        _fmt(i.net, currency),
      ]),
    )
    .join('');

  const interestSection =
    report.interest.length > 0
      ? `<h2>Interest</h2>
<table>
  <thead>${_th(['Source / Account', `Gross (${currency})`, `Tax (${currency})`, `Net (${currency})`])}</thead>
  <tbody>${interestRows}</tbody>
  <tfoot>${_tableRow(['Total', _fmt(report.totalInterestGross, currency), _fmt(report.totalInterestTax, currency), _fmt(report.totalInterestNet, currency)], 'total')}</tfoot>
</table>`
      : '';

  // ── Realised gains table ──
  const gainsRows = report.holdings
    .filter((h) => h.yearRealisedGain !== 0)
    .map((h) => _tableRow([_esc(h.isin), _esc(h.name), _fmt(h.yearRealisedGain, currency)]))
    .join('');

  const gainsSection = gainsRows
    ? `<h2>Realised Gains &amp; Losses</h2>
<table>
  <thead>${_th(['ISIN', 'Name', `Gain / Loss (${currency})`])}</thead>
  <tbody>${gainsRows}</tbody>
  <tfoot>${_tableRow(['', 'Total', _fmt(report.totalYearRealisedGains, currency)], 'total')}</tfoot>
</table>`
    : '';

  // ── Tax summary ──
  const taxSummaryRows = [
    report.totalDividendTax > 0
      ? _tableRow(['Dividend withholding tax', _fmt(report.totalDividendTax, currency)])
      : '',
    report.totalInterestTax > 0
      ? _tableRow(['Interest withholding tax', _fmt(report.totalInterestTax, currency)])
      : '',
    report.totalTax - report.totalDividendTax - report.totalInterestTax > 0
      ? _tableRow([
          'Other taxes',
          _fmt(report.totalTax - report.totalDividendTax - report.totalInterestTax, currency),
        ])
      : '',
  ].join('');

  const taxSection =
    report.totalTax > 0
      ? `<h2>Tax Summary</h2>
<table>
  <thead>${_th(['Category', `Amount (${currency})`])}</thead>
  <tbody>${taxSummaryRows}</tbody>
  <tfoot>${_tableRow(['Total tax paid', _fmt(report.totalTax, currency)], 'total')}</tfoot>
</table>`
      : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Annual Portfolio Report ${year}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a;background:#fff;padding:2rem;max-width:960px;margin:0 auto;line-height:1.5}
    h1{font-size:2rem;font-weight:700;margin-bottom:.25rem}
    h2{font-size:1.05rem;font-weight:600;border-bottom:2px solid #1a1a1a;padding-bottom:.35rem;margin:2rem 0 .75rem}
    .meta{color:#666;font-size:.875rem;margin-bottom:2rem}
    .kpi-row{display:flex;gap:1.5rem;flex-wrap:wrap;margin:.5rem 0 1.25rem}
    .kpi{background:#f5f5f5;border-radius:6px;padding:.65rem 1rem;min-width:160px}
    .kpi-label{font-size:.75rem;color:#666;margin-bottom:.15rem}
    .kpi-value{font-size:1.2rem;font-weight:700;font-variant-numeric:tabular-nums}
    table{width:100%;border-collapse:collapse;font-size:.875rem;margin-bottom:1rem}
    th{text-align:left;font-weight:600;padding:6px 10px;border-bottom:1px solid #1a1a1a;color:#333;white-space:nowrap}
    th.num{text-align:right}
    td{padding:5px 10px;border-bottom:1px solid #e8e8e8;vertical-align:top}
    td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
    tr.total td{font-weight:600;border-top:1px solid #999;border-bottom:none}
    .disclaimer{margin-top:3rem;font-size:.75rem;color:#888;border-top:1px solid #e5e5e5;padding-top:1rem}
    @media print{body{padding:0}h2{page-break-inside:avoid}}
  </style>
</head>
<body>
  <h1>Annual Portfolio Report</h1>
  <p class="meta">Year: <strong>${year}</strong> &nbsp;|&nbsp; Generated: ${generatedDate}</p>

  <h2>Net Worth — Year End</h2>
  <div class="kpi-row">
    <div class="kpi">
      <div class="kpi-label">Total net worth</div>
      <div class="kpi-value">${_fmt(report.totalNetWorth, currency)}</div>
    </div>
    ${report.totalDividendNet > 0 ? `<div class="kpi"><div class="kpi-label">Dividend income (net)</div><div class="kpi-value">${_fmt(report.totalDividendNet, currency)}</div></div>` : ''}
    ${report.totalInterestNet > 0 ? `<div class="kpi"><div class="kpi-label">Interest income (net)</div><div class="kpi-value">${_fmt(report.totalInterestNet, currency)}</div></div>` : ''}
    ${report.totalTax > 0 ? `<div class="kpi"><div class="kpi-label">Total tax paid</div><div class="kpi-value">${_fmt(report.totalTax, currency)}</div></div>` : ''}
  </div>
  <table>
    <thead>${_th(['Account', `Value (${currency})`])}</thead>
    <tbody>${accountsRows}</tbody>
    <tfoot>${_tableRow(['Total', _fmt(report.totalNetWorth, currency)], 'total')}</tfoot>
  </table>

  ${
    report.holdings.length > 0
      ? `<h2>Holdings</h2>
  <table>
    <thead>${_th(['ISIN', 'Name', 'Shares held', `Cost basis (${currency})`, `Realised gain/loss ${year} (${currency})`])}</thead>
    <tbody>${holdingsRows}</tbody>
  </table>`
      : ''
  }

  ${dividendsSection}
  ${interestSection}
  ${gainsSection}
  ${taxSection}

  <p class="disclaimer">This report presents raw figures from your Wealth Tracker database for the calendar year ${year}. It makes no tax-law assumptions and applies no jurisdiction-specific rules. Verify all amounts with your broker statements before submitting any tax filing.</p>
</body>
</html>`;
}
