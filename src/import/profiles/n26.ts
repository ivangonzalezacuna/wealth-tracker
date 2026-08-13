import { TxType } from '../../types';
import type { ImportProfile } from '../../types';

/**
 * Built-in import profile for N26 CSV exports.
 *
 * Currently covers the N26 savings export. Other N26 products can be added
 * later by extending the type mappings.
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
  idColumns: ['Booking Date', 'Type', 'Amount (EUR)'],
  match: {
    headerIncludes: ['Booking Date', 'Account Name', 'Amount (EUR)'],
  },
};
