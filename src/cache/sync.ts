/**
 * Incremental sync engine — fetches only new transactions since the last cursor.
 *
 * Transactions in the Google Sheet are append-only and date-sorted.
 * The sync cursor stores the last synced date + row count.
 * On sync we fetch only the tail (rows after the cursor) and merge.
 *
 * NOTE: Editing historical rows in the Google Sheet requires a "Force full resync"
 * since the cursor assumes append-only growth.
 */

import { readRange, ensureSheets } from '../sheets/api';
import { SHEET_TABS } from '../constants';
import { txKey } from '../sheets/transactions';
import { parseNum } from '../csv';
import type { Transaction } from '../types';
import type { SyncCursor } from './db';

const TAB = SHEET_TABS.TRANSACTIONS;
const RANGE = `${TAB}!A:N`;

/**
 * Parse a 14-column row into a Transaction.
 * Duplicated from sheets/transactions to avoid circular import issues;
 * kept in sync with the canonical parser there.
 */
function rowToTx(row: string[]): Transaction {
  return {
    id:       row[0] || '',
    date:     row[1] || '',
    source:   row[2] || '',
    type:     row[3] || '',
    name:     row[4] || '',
    isin:     row[5] || '',
    symbol:   row[5] || '',
    shares:   parseNum(String(row[6] ?? '')),
    price:    parseNum(String(row[7] ?? '')),
    amount:   parseNum(String(row[8] ?? '')),
    fee:      parseNum(String(row[9] ?? '')),
    tax:      parseNum(String(row[10] ?? '')),
    currency: row[11] || 'EUR',
    fxRate:   parseNum(String(row[12] ?? '')),
    note:     row[13] || '',
  };
}

/**
 * Fetch only transactions newer than the cursor.
 * If cursor is null, returns null (caller should do a full load).
 *
 * Strategy: read the tail of the sheet starting from the row after the cursor.
 * Google Sheets A1 notation: TAB!A{startRow}:N to read from startRow to end.
 */
export async function fetchDeltaTransactions(cursor: SyncCursor): Promise<Transaction[] | null> {
  try {
    await ensureSheets([TAB]);
    // startRow = cursor.rowCount + 2 (1-based, +1 for header, +1 for next row after last)
    const startRow = cursor.rowCount + 2; // header is row 1, data starts at row 2
    const tailRange = `${TAB}!A${startRow}:N`;
    const rows = await readRange(tailRange);
    if (!rows || rows.length === 0) return [];
    // Filter out empty rows and parse
    return rows.filter(r => r[1]).map(rowToTx);
  } catch {
    // Network error or other failure — return null to signal full sync needed
    return null;
  }
}

/**
 * Merge new delta transactions into an existing cached set.
 * Deduplicates using txKey — only genuinely new rows are appended.
 * Returns { merged, newCount, cursor }.
 */
export function mergeDelta(
  cached: Transaction[],
  delta: Transaction[],
): { merged: Transaction[]; newCount: number; cursor: SyncCursor } {
  const seen = new Set(cached.map(txKey));
  const genuinelyNew = delta.filter(t => !seen.has(txKey(t)));
  const merged = [...cached, ...genuinelyNew].sort((a, b) => a.date.localeCompare(b.date));
  const lastDate = merged.length > 0 ? merged[merged.length - 1].date : '';
  return {
    merged,
    newCount: genuinelyNew.length,
    cursor: { lastDate, rowCount: merged.length },
  };
}
