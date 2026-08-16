/**
 * Annual portfolio report: pure functions for building and rendering a
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
  reportStartDate: string;
  reportEndDate: string;
  hasReachedYearEnd: boolean;
  hasClosingSnapshotAtYearEnd: boolean;
  isFullYearReport: boolean;
  isPartialYearReport: boolean;
  accounts: AnnualReportAccount[];
  /** Net worth at the last snapshot on or before the year start (31 Dec of prior year). */
  openingNetWorth: number;
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
  /** Standalone TAX transactions only (excludes dividend/interest withholding). */
  standaloneTaxTotal: number;
  /** Sum of all taxes: dividend withholding tax + interest withholding tax + standalone TAX rows. Negative when refunds exceed taxes paid. */
  totalTax: number;
}

// ── Build ──────────────────────────────────────────────────────────────────────

/**
 * Build an annual portfolio report for the given calendar year.
 *
 * Expects all transactions (not pre-filtered) and all snapshots so that the
 * cost-basis engine can work from the full trade history.
 *
 * @param method - Cost-basis method to use (defaults to 'avgco').
 */
export function buildAnnualReport(
  year: number,
  transactions: Transaction[],
  snapshots: Snapshot[],
  holdings: Holding[],
  accounts: Account[],
  method: 'avgco' | 'fifo' | 'lifo' | 'hifo' = 'avgco',
): AnnualReport {
  const yearStr = String(year);
  const prevYearEnd = `${year - 1}-12-31`;
  const yearStart = `${yearStr}-01-01`;
  const yearEnd = `${yearStr}-12-31`;
  const today = new Date().toISOString().slice(0, 10);

  // ── Opening net worth: last snapshot on or before the previous year end ──
  const snapsBeforeYear = snapshots.filter((s) => s.date <= prevYearEnd);
  const openingSnap =
    snapsBeforeYear.length > 0 ? snapsBeforeYear[snapsBeforeYear.length - 1] : null;
  const openingNetWorth = accounts.reduce(
    (s, a) => s + (openingSnap ? (openingSnap[a.id || ''] as number) || 0 : 0),
    0,
  );

  // ── Closing net worth: last snapshot on or before year end ──
  const snapsUntilYearEnd = snapshots.filter((s) => s.date <= yearEnd);
  const snap =
    snapsUntilYearEnd.length > 0 ? snapsUntilYearEnd[snapsUntilYearEnd.length - 1] : null;
  const hasReachedYearEnd = today >= yearEnd;
  const hasClosingSnapshotAtYearEnd = !!snap && snap.date === yearEnd;
  const isFullYearReport = hasReachedYearEnd && hasClosingSnapshotAtYearEnd;
  const isPartialYearReport = !isFullYearReport;
  const reportEndDate = snap?.date || (hasReachedYearEnd ? yearEnd : today);

  const accountRows: AnnualReportAccount[] = accounts.map((a) => ({
    label: a.label,
    value: snap ? (snap[a.id || ''] as number) || 0 : 0,
  }));
  const totalNetWorth = accountRows.reduce((s, a) => s + a.value, 0);

  // ── Cost basis: two-pass to extract year-specific realised gains ──
  const txsBeforeYear = transactions.filter((t) => t.date < yearStart);
  const txsThroughYear = transactions.filter((t) => t.date <= yearEnd);
  const prevBasis = computeCostBasis(txsBeforeYear, method);
  const yearBasis = computeCostBasis(txsThroughYear, method);

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
    // tx.tax is negative when withheld (paid), positive when refunded — keep the signed value
    const taxSigned = -toBase(tx.tax || 0, tx.currency, tx.fxRate); // negate: negative tx.tax → positive tax paid
    const net = Math.abs(toBase(tx.amount, tx.currency, tx.fxRate));
    const gross = net + taxSigned;
    if (!divByIsin[isin]) divByIsin[isin] = { gross: 0, tax: 0, net: 0 };
    divByIsin[isin].gross += gross;
    divByIsin[isin].tax += taxSigned;
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
    const taxSigned = -taxRaw; // negate: negative taxRaw → positive tax paid; positive taxRaw → refund (negative)
    if (!intBySource[src]) intBySource[src] = { gross: 0, tax: 0, net: 0 };
    intBySource[src].gross += gross;
    intBySource[src].tax += taxSigned;
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
  const standaloneTaxTotal = yearTxs
    .filter((t) => t.type === TxType.TAX)
    .reduce((s, tx) => {
      const canonicalTax = tx.tax !== 0 ? tx.tax : tx.amount || 0;
      // Keep sign: positive = tax paid, negative = refund received
      return s + toBase(canonicalTax, tx.currency, tx.fxRate);
    }, 0);
  const totalTax = totalDividendTax + totalInterestTax + standaloneTaxTotal;

  return {
    year,
    generatedAt: new Date().toISOString(),
    reportStartDate: yearStart,
    reportEndDate,
    hasReachedYearEnd,
    hasClosingSnapshotAtYearEnd,
    isFullYearReport,
    isPartialYearReport,
    accounts: accountRows,
    openingNetWorth,
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
    standaloneTaxTotal,
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

function _rowsWhen(items: Array<{ when: boolean; cells: string[] }>): string {
  return items
    .filter((item) => item.when)
    .map((item) => _tableRow(item.cells))
    .join('');
}

function _tableSection(
  title: string,
  headers: string[],
  bodyRows: string,
  footerCells: string[],
  options?: { note?: string; sectionClass?: string },
): string {
  const noteHtml = options?.note ? `<p class="note">${options.note}</p>` : '';
  const sectionClass = options?.sectionClass ? ` ${options.sectionClass}` : '';
  return `<section class="doc-section${sectionClass}">
<h2>${title}</h2>
${noteHtml}<table>
  <thead>${_th(headers)}</thead>
  <tbody>${bodyRows}</tbody>
  <tfoot>${_tableRow(footerCells, 'total')}</tfoot>
</table>
</section>`;
}

/**
 * Render a self-contained, print-ready HTML page for the given annual report.
 * No external CSS or JS dependencies — designed to be saved as a file and
 * opened in any browser for printing to PDF.
 *
 * The document is frozen to the app's light-theme palette and targets A4 portrait.
 */
export function renderAnnualReportHtml(report: AnnualReport, currency: string): string {
  const { year } = report;
  const generatedDate = new Date(report.generatedAt).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
  const periodStartDate = new Date(report.reportStartDate).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const periodEndDate = new Date(report.reportEndDate).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const reportScopeLabel = report.isPartialYearReport ? 'Partial report' : 'Full-year report';
  const reportTitle = `Annual Portfolio Report ${year}${report.isPartialYearReport ? ' (Partial)' : ''}`;

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

  const dividendsSection = report.dividends.length
    ? _tableSection(
        'Dividends',
        [
          'ISIN',
          'Name',
          `Gross (${currency})`,
          `Withholding tax (${currency})`,
          `Net (${currency})`,
        ],
        dividendsRows,
        [
          '',
          'Total',
          _fmt(report.totalDividendGross, currency),
          _fmt(report.totalDividendTax, currency),
          _fmt(report.totalDividendNet, currency),
        ],
      )
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

  const interestSection = report.interest.length
    ? _tableSection(
        'Interest',
        [
          'Source / Account',
          `Gross (${currency})`,
          `Withholding tax (${currency})`,
          `Net (${currency})`,
        ],
        interestRows,
        [
          'Total',
          _fmt(report.totalInterestGross, currency),
          _fmt(report.totalInterestTax, currency),
          _fmt(report.totalInterestNet, currency),
        ],
      )
    : '';

  // ── Realised gains table ──
  const gainsRows = report.holdings
    .filter((h) => h.yearRealisedGain !== 0)
    .map((h) => _tableRow([_esc(h.isin), _esc(h.name), _fmt(h.yearRealisedGain, currency)]))
    .join('');

  const gainsSection = gainsRows
    ? _tableSection(
        'Realised Gains &amp; Losses',
        ['ISIN', 'Name', `Gain / Loss (${currency})`],
        gainsRows,
        ['', 'Total', _fmt(report.totalYearRealisedGains, currency)],
      )
    : '';

  // ── Tax summary ──
  const taxSummaryRows = _rowsWhen([
    {
      when: report.totalDividendTax !== 0,
      cells: ['Dividend withholding tax', _fmt(report.totalDividendTax, currency)],
    },
    {
      when: report.totalInterestTax !== 0,
      cells: ['Interest withholding tax', _fmt(report.totalInterestTax, currency)],
    },
    {
      when: report.standaloneTaxTotal !== 0,
      cells: ['Other tax transactions', _fmt(report.standaloneTaxTotal, currency)],
    },
  ]);

  const taxSection = report.totalTax
    ? _tableSection(
        'Tax Summary',
        ['Category', `Amount (${currency})`],
        taxSummaryRows,
        ['Total taxes (signed)', _fmt(report.totalTax, currency)],
        {
          note: 'Tax sign convention: positive values = tax paid, negative values = tax refund received back.',
        },
      )
    : '';

  // ── Compact yearly summary ──
  const networthChange = report.totalNetWorth - report.openingNetWorth;
  const networthChangeSign = networthChange >= 0 ? '+' : '';
  const summaryBreakdownRows = _rowsWhen([
    {
      when: report.totalDividendGross > 0,
      cells: ['Dividend income - gross', _fmt(report.totalDividendGross, currency)],
    },
    {
      when: report.totalDividendTax !== 0,
      cells: ['Dividend withholding tax (signed)', _fmt(report.totalDividendTax, currency)],
    },
    {
      when: report.totalDividendNet > 0,
      cells: ['Dividend income - net', _fmt(report.totalDividendNet, currency)],
    },
    {
      when: report.totalInterestGross > 0,
      cells: ['Interest income - gross', _fmt(report.totalInterestGross, currency)],
    },
    {
      when: report.totalInterestTax !== 0,
      cells: ['Interest withholding tax (signed)', _fmt(report.totalInterestTax, currency)],
    },
    {
      when: report.totalInterestNet > 0,
      cells: ['Interest income - net', _fmt(report.totalInterestNet, currency)],
    },
    {
      when: report.totalYearRealisedGains !== 0,
      cells: ['Realised gains / losses', _fmt(report.totalYearRealisedGains, currency)],
    },
    {
      when: report.standaloneTaxTotal !== 0,
      cells: ['Standalone tax transactions (signed)', _fmt(report.standaloneTaxTotal, currency)],
    },
    {
      when: report.totalTax !== 0,
      cells: ['Total taxes (signed)', _fmt(report.totalTax, currency)],
    },
  ]);
  const summaryTotalsRows = [
    _tableRow(['Report period', `${periodStartDate} → ${periodEndDate}`]),
    _tableRow(['Report scope', reportScopeLabel]),
    _tableRow(['Opening net worth (prior year-end)', _fmt(report.openingNetWorth, currency)]),
    _tableRow([
      report.isPartialYearReport
        ? `Net worth at report end (${report.reportEndDate})`
        : 'Closing net worth (year-end)',
      _fmt(report.totalNetWorth, currency),
    ]),
    _tableRow(['Net worth change', `${networthChangeSign}${_fmt(networthChange, currency)}`]),
    _tableRow([
      `Holdings at report end (ISINs)`,
      String(report.holdings.filter((h) => h.shares > 0).length),
    ]),
    _tableRow([`Accounts reported`, String(report.accounts.length)]),
  ].join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${reportTitle}</title>
  <style>
    /* ── Reset ── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    /* ── Light-theme palette (frozen — standalone document) ── */
    :root {
      --bg:       #f5f4f0;
      --surface:  #ffffff;
      --surface-2:#faf9f6;
      --ink:      #0b0b0b;
      --ink-2:    #52514e;
      --ink-3:    #6b6a65;
      --line:     #e0ddd6;
      --line-2:   #ccc9c0;
      --brand:    #185fa5;
      --pos:      #0f6e56;
      --neg:      #a32d2d;
    }

    /* ── A4 page model ── */
    @page {
      size: A4 portrait;
      margin: 18mm 15mm 20mm 15mm;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      font-size: 10pt;
      line-height: 1.45;
      color: var(--ink);
      background: var(--surface);
      /* screen preview margins; @page takes over for print */
      max-width: 210mm;
      margin: 0 auto;
      padding: 18mm 15mm 20mm;
    }

    /* ── Document header ── */
    .doc-header { margin-bottom: 1.6rem; border-bottom: 2px solid var(--ink); padding-bottom: .7rem; }
    .doc-title  { font-size: 18pt; font-weight: 700; letter-spacing: -.3px; }
    .doc-meta   { font-size: 8.5pt; color: var(--ink-3); margin-top: .3rem; }

    /* ── Sections ── */
    .doc-section { margin-top: 1.4rem; page-break-inside: avoid; }
    /* Allow sections with large tables to break across pages */
    .doc-section.allow-break { page-break-inside: auto; }

    h2 {
      font-size: 9.5pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .5px;
      color: var(--brand);
      border-bottom: 1px solid var(--line-2);
      padding-bottom: .3rem;
      margin-bottom: .6rem;
      page-break-after: avoid;
    }

    /* ── Summary grid ── */
    .summary-table { width: 100%; border-collapse: collapse; margin-bottom: .5rem; }
    .summary-table td { padding: 3.5px 6px; border-bottom: 1px solid var(--line); font-size: 9pt; vertical-align: top; }
    .summary-table td:last-child { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; font-weight: 600; }
    .summary-block-label {
      margin: .2rem 0 .35rem;
      font-size: 8.5pt;
      color: var(--ink-3);
      text-transform: uppercase;
      letter-spacing: .4px;
      font-weight: 700;
    }
    .note { margin: .35rem 0 .6rem; color: var(--ink-3); font-size: 8pt; }

    /* ── Data tables ── */
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 8.5pt;
      margin-bottom: .5rem;
    }
    thead { display: table-header-group; } /* repeat header on page breaks */
    th {
      text-align: left;
      font-weight: 700;
      padding: 5px 7px;
      background: var(--surface-2);
      border-top: 1px solid var(--line-2);
      border-bottom: 1px solid var(--line-2);
      color: var(--ink-2);
      white-space: nowrap;
    }
    th.num { text-align: right; }
    td {
      padding: 4px 7px;
      border-bottom: 1px solid var(--line);
      vertical-align: top;
      overflow-wrap: anywhere;
    }
    td.num {
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    tr.total td {
      font-weight: 700;
      background: var(--surface-2);
      border-top: 1px solid var(--line-2);
      border-bottom: none;
    }
    /* Keep table rows together where possible */
    tbody tr { page-break-inside: avoid; }

    /* ── ISIN column: fixed narrow width so names get more space ── */
    .col-isin { width: 9em; white-space: nowrap; }
    .col-shares { width: 7em; }
    .col-num { width: 8em; }

    /* ── Disclaimer ── */
    .disclaimer {
      margin-top: 2rem;
      font-size: 7.5pt;
      color: var(--ink-3);
      border-top: 1px solid var(--line);
      padding-top: .7rem;
      page-break-inside: avoid;
    }

    /* ── Screen-only helpers ── */
    @media screen {
      body { padding: 24px 32px; box-shadow: 0 2px 12px rgba(0,0,0,.08); }
    }
  </style>
</head>
<body>
  <div class="doc-header">
    <div class="doc-title">${reportTitle}</div>
    <div class="doc-meta">Generated: ${generatedDate} • ${reportScopeLabel} • Period: ${periodStartDate} – ${periodEndDate}</div>
  </div>

  <section class="doc-section">
    <h2>Yearly Summary</h2>
    <div class="summary-block-label">Period breakdown</div>
    <table class="summary-table">
      <tbody>${summaryBreakdownRows || _tableRow(['No period breakdown metrics recorded', '—'])}</tbody>
    </table>
    <div class="summary-block-label">Final report totals</div>
    <table class="summary-table">
      <tbody>${summaryTotalsRows}</tbody>
    </table>
  </section>

  <section class="doc-section">
    <h2>${report.isPartialYearReport ? `Net Worth by Account at Report End (${report.reportEndDate})` : 'Year-End Net Worth by Account'}</h2>
    <table>
      <thead>${_th(['Account', `Value (${currency})`])}</thead>
      <tbody>${accountsRows}</tbody>
      <tfoot>${_tableRow(['Total', _fmt(report.totalNetWorth, currency)], 'total')}</tfoot>
    </table>
  </section>

  ${
    report.holdings.length > 0
      ? `<section class="doc-section allow-break">
  <h2>${report.isPartialYearReport ? `Holdings at Report End (${report.reportEndDate})` : 'Holdings at Year-End'}</h2>
  <table>
    <colgroup>
      <col class="col-isin"><col><col class="col-shares"><col class="col-num"><col class="col-num">
    </colgroup>
    <thead>${_th(['ISIN', 'Name', 'Shares held', `Cost basis (${currency})`, `Realised gain/loss ${year} (${currency})`])}</thead>
    <tbody>${holdingsRows}</tbody>
  </table>
</section>`
      : ''
  }

  ${dividendsSection}
  ${interestSection}
  ${gainsSection}
  ${taxSection}

  <p class="disclaimer">This report presents raw figures from your Wealth Tracker database for the calendar year ${year}. It makes no tax-law assumptions and applies no jurisdiction-specific rules. Amounts are expressed in ${currency} at the exchange rates recorded at transaction time. Verify all amounts with your broker statements before submitting any tax filing.</p>
</body>
</html>`;
}
