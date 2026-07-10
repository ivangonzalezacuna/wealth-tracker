import { TxType } from '../../model/tx';
import type { ImportProfile } from '../../types';

/**
 * Built-in import profile for N26 CSV exports.
 *
 * Currently covers the N26 **Savings** (Instant Savings) export.
 * This profile can be extended in the future to support other N26 products
 * (e.g. current account, crypto) by adding additional type mappings.
 *
 * N26 savings CSV columns:
 *   Booking Date, Value Date, Partner Name, Partner Iban, Type,
 *   Payment Reference, Account Name, Amount (EUR), Original Amount,
 *   Original Currency, Exchange Rate
 *
 * Relevant transaction types for savings:
 *   - Interest: interest earned on savings balance
 *   - Tax: negative = tax paid (e.g. Kapitalertragsteuer), positive = refund
 *
 * Other N26 types (Credit Transfer, Debit Transfer, etc.) are not relevant
 * for portfolio tracking and are excluded via `skipUnmapped: true`.
 *
 * Note: For TAX-type rows, the tax value lives in the Amount column.
 * We rely on computePD to read `tx.amount` for TAX rows (no separate tax
 * column mapping needed — mapping tax globally would incorrectly set
 * tx.tax on INTEREST rows too).
 */
export const n26Profile: ImportProfile = {
  id: 'n26',
  label: 'N26',

  delimiter: 'auto',
  decimal: 'dot',
  dateFormat: 'YYYY-MM-DD',
  defaultCurrency: 'EUR',

  columns: {
    date: 'Booking Date',
    type: 'Type',
    name: 'Payment Reference',
    amount: 'Amount (EUR)',
  },

  typeMap: {
    INTEREST: TxType.INTEREST,
    TAX: TxType.TAX,
  },

  skipUnmapped: true,
  mergeTaxIntoInterest: true,

  // N26 CSVs have no unique transaction ID column.
  // Build a deterministic ID from date + type + amount to allow safe re-imports.
  idColumns: ['Booking Date', 'Type', 'Amount (EUR)'],

  match: {
    headerIncludes: ['Booking Date', 'Account Name', 'Amount (EUR)'],
  },
};
