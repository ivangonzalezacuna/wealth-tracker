/**
 * Incremental sync - fetches only new transactions since the last cursor.
 * NOTE: Editing historical sheet rows requires "Force full resync" (cursor assumes append-only).
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
 *
 * Append-only assumption guard: before trusting an empty tail read as "no
 * new transactions," this also does a cheap check of the sheet's current
 * total data-row count (a single-column read). If that count is now lower
 * than the cursor's rowCount, historical rows were edited/deleted directly
 * in Sheets since the last sync - the append-only assumption this cursor
 * relies on no longer holds, so this returns null to force a full resync
 * rather than silently keeping a stale cache.
 */
export async function fetchDeltaTransactions(cursor: SyncCursor): Promise<Transaction[] | null> {
  try {
    await ensureSheets([TAB]);

    const countRows = await readRange(`${TAB}!A:A`);
    const currentDataRowCount = Math.max(countRows.length - 1, 0); // minus header
    if (currentDataRowCount < cursor.rowCount) return null;

    // startRow = cursor.rowCount + 2 (1-based, +1 for header, +1 for next row after last)
    const startRow = cursor.rowCount + 2; // header is row 1, data starts at row 2
    const tailRange = `${TAB}!A${startRow}:N`;
    const rows = await readRange(tailRange);
    if (!rows || rows.length === 0) return [];
    // Filter out empty rows and parse
    return rows.filter((r) => r[1]).map(newRowToTx);
  } catch {
    // Network error or other failure - return null to signal full sync needed
    return null;
  }
}

/**
 * Merge new delta transactions into an existing cached set.
 * Deduplicates using txKey - only genuinely new rows are appended.
 * Returns { merged, newCount, cursor }.
 */
export function mergeDelta(
  cached: Transaction[],
  delta: Transaction[],
): { merged: Transaction[]; newCount: number; cursor: SyncCursor } {
  const seen = new Set(cached.map(txKey));
  const genuinelyNew = delta.filter((t) => !seen.has(txKey(t)));
  const merged = [...cached, ...genuinelyNew].sort((a, b) => a.date.localeCompare(b.date));
  const lastDate = merged.length > 0 ? merged[merged.length - 1].date : '';
  // rowCount must track the sheet's actual physical row count (cached rows
  // + however many rows the tail read returned), not merged.length. If any
  // delta row collided with an existing txKey (deduped away), merged.length
  // would undercount the real sheet, and fetchDeltaTransactions - which
  // treats cursor.rowCount as a literal row offset for its next tail read -
  // would then re-read that same already-seen row on every future sync.
  return {
    merged,
    newCount: genuinelyNew.length,
    cursor: { lastDate, rowCount: cached.length + delta.length },
  };
}
