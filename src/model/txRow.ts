/** Row-to-Transaction mappers for old (10-col) and new (14-col) sheet formats. */

import { parseNum } from '../csv';
import type { Transaction } from '../types';

/**
 * Map a new 14-col sheet row to a Transaction object.
 * Columns: id | date | source | type | name | isin | shares | price | amount | fee | tax | currency | fxRate | note
 */
export function newRowToTx(row: (string | number | boolean)[]): Transaction {
  return {
    id: String(row[0] ?? ''),
    date: String(row[1] ?? ''),
    source: String(row[2] ?? ''),
    type: String(row[3] ?? ''),
    name: String(row[4] ?? ''),
    isin: String(row[5] ?? ''),
    shares: parseNum(String(row[6] ?? '')),
    price: parseNum(String(row[7] ?? '')),
    amount: parseNum(String(row[8] ?? '')),
    fee: parseNum(String(row[9] ?? '')),
    tax: parseNum(String(row[10] ?? '')),
    currency: String(row[11] ?? '') || 'EUR',
    fxRate: parseNum(String(row[12] ?? '')),
    note: String(row[13] ?? ''),
  };
}

/**
 * Map an old 10-col sheet row to the new 14-col Transaction shape.
 * Old: id | date | category | type | name | symbol | shares | price | amount | tax
 */
export function oldRowToTx(row: (string | number | boolean)[]): Transaction {
  return {
    id: String(row[0] ?? ''),
    date: String(row[1] ?? ''),
    source: 'trade_republic',
    category: String(row[2] ?? ''),
    type: String(row[3] ?? ''),
    name: String(row[4] ?? ''),
    isin: String(row[5] ?? ''),
    shares: parseNum(String(row[6] ?? '')),
    price: parseNum(String(row[7] ?? '')),
    amount: parseNum(String(row[8] ?? '')),
    fee: 0,
    tax: parseNum(String(row[9] ?? '')),
    currency: 'EUR',
    fxRate: 0,
    note: '',
  };
}
