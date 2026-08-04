/**
 * Tax year summary CSV export.
 *
 * Produces a structured, human-readable CSV containing:
 *   1. Realized gains / losses (SELL transactions)
 *   2. Dividend income (DIVIDEND transactions)
 *   3. Interest income (INTEREST transactions)
 *   4. Fee and tax payments (FEE + TAX transactions)
 *   5. Totals summary
 *
 * No external dependencies. Each section starts with a comment line
 * (prefixed with #) so spreadsheet tools can skip it, but a human reader
 * can still understand the structure.
 */

import { TxType } from './types';
import type { Transaction } from './types';

// ── Helpers ───────────────────────────────────────────────────────

/** Escape a CSV field: wrap in quotes if it contains a comma, quote, or newline. */
function csvField(value: string | number | null | undefined): string {
  const s = value == null ? '' : String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function csvRow(fields: (string | number | null | undefined)[]): string {
  return fields.map(csvField).join(',');
}

function fmt(n: number): string {
  return n.toFixed(2);
}

// ── Per-SELL realized P&L computation ─────────────────────────────

interface SellRecord {
  date: string;
  isin: string;
  name: string;
  shares: number;
  proceeds: number;
  costBasis: number;
  gainLoss: number;
  currency: string;
}

/**
 * Compute per-SELL realized gain/loss using the average-cost method.
 * For each SELL in the target year, replay all prior (and same-day) transactions
 * for that ISIN to determine the average cost at the point of sale.
 *
 * This mirrors the avg-cost logic in src/model/costbasis.ts.
 */
function computeSellRecords(allTxs: Transaction[], year: number): SellRecord[] {
  // Group all BUY/SELL by ISIN
  const byIsin: Record<string, Transaction[]> = {};
  for (const tx of allTxs) {
    if (tx.type !== TxType.BUY && tx.type !== TxType.SELL) continue;
    const key = tx.isin || '';
    if (!key) continue;
    (byIsin[key] = byIsin[key] || []).push(tx);
  }

  const records: SellRecord[] = [];

  for (const [isin, txs] of Object.entries(byIsin)) {
    // Sort chronologically (same order as the cost-basis engine)
    const sorted = txs.slice().sort((a, b) => a.date.localeCompare(b.date));

    let shares = 0;
    let costBasis = 0;

    for (const tx of sorted) {
      const fee = Math.abs(tx.fee || 0);

      if (tx.type === TxType.BUY) {
        const cost = Math.abs(tx.amount) + fee;
        shares += Math.abs(tx.shares || 0);
        costBasis += cost;
      } else if (tx.type === TxType.SELL) {
        const sharesSold = Math.abs(tx.shares || 0);
        const proceeds = Math.abs(tx.amount) - fee;
        let soldCost = 0;

        if (shares > 1e-9 && sharesSold > 0) {
          const avg = costBasis / shares;
          soldCost = avg * sharesSold;
          shares -= sharesSold;
          costBasis -= soldCost;
          if (shares < 1e-9) {
            shares = 0;
            costBasis = 0;
          }
          if (costBasis < 0) costBasis = 0;
        }

        // Only include SELL transactions in the target year
        if (tx.date.startsWith(String(year))) {
          records.push({
            date: tx.date,
            isin,
            name: tx.name || '',
            shares: sharesSold,
            proceeds,
            costBasis: soldCost,
            gainLoss: proceeds - soldCost,
            currency: tx.currency || 'EUR',
          });
        }
      }
    }
  }

  records.sort((a, b) => a.date.localeCompare(b.date));
  return records;
}

// ── Main export function ───────────────────────────────────────────

export interface TaxSummaryOptions {
  year: number;
  txs: Transaction[];
}

/**
 * Build a tax year summary CSV string for the given year.
 * Returns the full CSV content ready to be saved as a file.
 */
export function buildTaxSummaryCsv({ year, txs }: TaxSummaryOptions): string {
  const lines: string[] = [];

  const exportedAt = new Date().toISOString().slice(0, 10);
  lines.push(`# Wealth Tracker - Tax Year Summary`);
  lines.push(`# Tax year: ${year}`);
  lines.push(`# Exported: ${exportedAt}`);
  lines.push(
    `# Note: All amounts in the original transaction currency. Cost basis uses the average-cost method.`,
  );
  lines.push('');

  const yearTxs = txs.filter((tx) => tx.date.startsWith(String(year)));

  // ── Section 1: Realized gains / losses ──────────────────────────
  lines.push('# SECTION 1: Realized Gains / Losses');
  lines.push(
    csvRow([
      'Date',
      'ISIN',
      'Name',
      'Shares Sold',
      'Proceeds',
      'Cost Basis',
      'Gain/Loss',
      'Currency',
    ]),
  );

  const sellRecords = computeSellRecords(txs, year);
  let totalGainLoss = 0;
  for (const r of sellRecords) {
    lines.push(
      csvRow([
        r.date,
        r.isin,
        r.name,
        fmt(r.shares),
        fmt(r.proceeds),
        fmt(r.costBasis),
        fmt(r.gainLoss),
        r.currency,
      ]),
    );
    totalGainLoss += r.gainLoss;
  }
  if (sellRecords.length === 0) {
    lines.push('# (no SELL transactions in this year)');
  }
  lines.push(csvRow(['', '', 'TOTAL', '', '', '', fmt(totalGainLoss), '']));
  lines.push('');

  // ── Section 2: Dividend income ───────────────────────────────────
  lines.push('# SECTION 2: Dividend Income');
  lines.push(
    csvRow(['Date', 'ISIN', 'Name', 'Gross Amount', 'Tax Withheld', 'Net Amount', 'Currency']),
  );

  const divTxs = yearTxs.filter((tx) => tx.type === TxType.DIVIDEND);
  let totalDivGross = 0;
  let totalDivTax = 0;
  let totalDivNet = 0;
  for (const tx of divTxs) {
    const taxAbs = Math.abs(tx.tax || 0);
    const net = Math.abs(tx.amount);
    const gross = net + taxAbs;
    lines.push(
      csvRow([
        tx.date,
        tx.isin || '',
        tx.name || '',
        fmt(gross),
        fmt(taxAbs),
        fmt(net),
        tx.currency || 'EUR',
      ]),
    );
    totalDivGross += gross;
    totalDivTax += taxAbs;
    totalDivNet += net;
  }
  if (divTxs.length === 0) {
    lines.push('# (no DIVIDEND transactions in this year)');
  }
  lines.push(csvRow(['', '', 'TOTAL', fmt(totalDivGross), fmt(totalDivTax), fmt(totalDivNet), '']));
  lines.push('');

  // ── Section 3: Interest income ───────────────────────────────────
  lines.push('# SECTION 3: Interest Income');
  lines.push(
    csvRow(['Date', 'Account / Source', 'Gross Amount', 'Tax Withheld', 'Net Amount', 'Currency']),
  );

  const intTxs = yearTxs.filter((tx) => tx.type === TxType.INTEREST);
  let totalIntGross = 0;
  let totalIntTax = 0;
  let totalIntNet = 0;
  for (const tx of intTxs) {
    const taxAbs = Math.abs(tx.tax || 0);
    const net = Math.abs(tx.amount);
    const gross = net + taxAbs;
    lines.push(
      csvRow([
        tx.date,
        tx.source || tx.name || '',
        fmt(gross),
        fmt(taxAbs),
        fmt(net),
        tx.currency || 'EUR',
      ]),
    );
    totalIntGross += gross;
    totalIntTax += taxAbs;
    totalIntNet += net;
  }
  if (intTxs.length === 0) {
    lines.push('# (no INTEREST transactions in this year)');
  }
  lines.push(csvRow(['', 'TOTAL', fmt(totalIntGross), fmt(totalIntTax), fmt(totalIntNet), '']));
  lines.push('');

  // ── Section 4: Fees and taxes ────────────────────────────────────
  lines.push('# SECTION 4: Fees and Taxes');
  lines.push(csvRow(['Date', 'Type', 'Description', 'Amount', 'Currency']));

  const feesTaxTxs = yearTxs.filter((tx) => tx.type === TxType.FEE || tx.type === TxType.TAX);
  let totalFeesTax = 0;
  for (const tx of feesTaxTxs) {
    const amount = Math.abs(tx.amount);
    lines.push(
      csvRow([tx.date, tx.type, tx.name || tx.source || '', fmt(amount), tx.currency || 'EUR']),
    );
    totalFeesTax += amount;
  }
  if (feesTaxTxs.length === 0) {
    lines.push('# (no FEE or TAX transactions in this year)');
  }
  lines.push(csvRow(['', '', 'TOTAL', fmt(totalFeesTax), '']));
  lines.push('');

  // ── Section 5: Summary ───────────────────────────────────────────
  lines.push('# SECTION 5: Summary');
  lines.push(csvRow(['Category', 'Amount']));
  lines.push(csvRow(['Realized gain/loss', fmt(totalGainLoss)]));
  lines.push(csvRow(['Total dividends (net)', fmt(totalDivNet)]));
  lines.push(csvRow(['Total dividend tax withheld', fmt(totalDivTax)]));
  lines.push(csvRow(['Total interest (net)', fmt(totalIntNet)]));
  lines.push(csvRow(['Total interest tax withheld', fmt(totalIntTax)]));
  lines.push(csvRow(['Total fees and taxes paid', fmt(totalFeesTax)]));

  return lines.join('\n');
}
