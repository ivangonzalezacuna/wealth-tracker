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
import { newRowToTx } from '../model/txRow';
import type { Transaction } from '../types';
import type { SyncCursor } from './db';

const TAB = SHEET_TABS.TRANSACTIONS;
const RANGE = `${TAB}!A:N`;

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
    return rows.filter(r => r[1]).map(newRowToTx);
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
