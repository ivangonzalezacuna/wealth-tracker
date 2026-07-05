/**
 * Snapshot persistence - one row per month in the "Snapshots" tab.
 *
 * Columns are derived from your configured accounts:
 *   date | <account keys…> | notes
 *
 * Reads by header name, so adding/removing accounts later never
 * misaligns saved rows (missing cols read as 0).
 */

import { readRange, writeRange, appendRows, clearRange, ensureSheets } from './api';
import { SHEET_TABS, getACCTSList } from '../constants';
import { parseNum } from '../csv';
import type { Snapshot } from '../types';

/** Pure: raw sheet rows → snapshots. Account keys come from the sheet header,
 *  so this is independent of whether the config store has loaded yet. */
export function parseSnapshotRows(rows: (string | number | boolean)[][]): Snapshot[] {
  if (!rows.length) return [];
  const sheetHdr = rows[0].map((c) => (c ?? '').toString().trim().toLowerCase());
  const dateIdx = sheetHdr.indexOf('date');
  if (dateIdx < 0) return [];
  const accts = sheetHdr
    .filter((h) => h && h !== 'date' && h !== 'notes')
    .map((key) => ({ key, label: key, color: '' }));
  return rows
    .slice(1)
    .filter((r) => r[dateIdx])
    .map((r) => rowToSnap(r, sheetHdr, accts))
    .sort((a, b) => (a.date as string).localeCompare(b.date as string));
}

interface AccountRef {
  key: string;
  label: string;
  color: string;
}

/** Convert a 1-based column index to A1-notation letters (1→A, 26→Z, 27→AA, etc.) */
function colLetter(n: number): string {
  let s = '';
  while (n > 0) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

const TAB = SHEET_TABS.SNAPSHOTS;

/** Given the sheet's current header (lowercased keys) and the live account keys,
 *  return the header to persist: existing order preserved, missing account keys
 *  appended before `notes`. Pure; no I/O. */
export function reconcileSnapshotHeader(currentHeader: string[], liveKeys: string[]): string[] {
  const cur = currentHeader.map((h) => (h ?? '').toString().trim().toLowerCase());
  if (cur.length === 0 || cur[0] !== 'date') return ['date', ...liveKeys, 'notes'];
  const hasNotes = cur.includes('notes');
  const body = cur.filter((h) => h !== 'date' && h !== 'notes');
  for (const k of liveKeys) if (!body.includes(k)) body.push(k);
  return ['date', ...body, ...(hasNotes ? ['notes'] : ['notes'])];
}

/** Build a sheet row for `snap` aligned to `header` (array of column keys incl. 'date'/'notes'). */
export function snapToRowForHeader(
  snap: Snapshot,
  header: string[],
  liveKeys: string[] = [],
): (string | number)[] {
  const hasLiveKeys = liveKeys.length > 0;
  return header.map((col) => {
    if (col === 'date') return snap.date;
    if (col === 'notes') return snap.notes || '';
    if (snap[col] !== undefined) return (snap[col] as number) || 0;
    // Absent from this snapshot: '' for a retired column (never imply a
    // deleted account had a real €0 balance), 0 for a live account with
    // simply no value yet.
    if (!hasLiveKeys) return 0;
    return liveKeys.includes(col) ? 0 : '';
  });
}

/** Build the canonical header for a given account list. */
export function snapshotHeader(accts: AccountRef[]): string[] {
  return ['date', ...accts.map((a) => a.key), 'notes'];
}

/** Convert a snapshot object to a sheet row, ordered by accts. */
export function snapToRow(snap: Snapshot, accts: AccountRef[]): (string | number)[] {
  return [snap.date, ...accts.map((a) => (snap[a.key] as number) || 0), snap.notes || ''];
}

/** Convert a sheet row back to a snapshot object, reading by sheetHeader index. */
export function rowToSnap(
  row: (string | number | boolean)[],
  sheetHeader: string[],
  accts: AccountRef[],
): Snapshot {
  const snap: Snapshot = { date: String(row[sheetHeader.indexOf('date')] ?? '') };
  for (const a of accts) {
    const idx = sheetHeader.indexOf(a.key);
    snap[a.key] =
      idx >= 0
        ? (typeof row[idx] === 'number' ? row[idx] : parseNum(String(row[idx] ?? ''))) || 0
        : 0;
  }
  const ni = sheetHeader.indexOf('notes');
  snap.notes = ni >= 0 ? String(row[ni] ?? '') : '';
  return snap;
}

/** Load all snapshots from the sheet, sorted ascending by date. */
export async function loadSnapshots(): Promise<Snapshot[]> {
  await ensureSheets([TAB]);
  const rows = await readRange(TAB); // whole used range - width-independent
  return parseSnapshotRows(rows);
}

/**
 * Per-row upsert: write a single snapshot month in place (or append).
 * Never calls clearRange - a failure touches at most the single row being saved.
 * This is the monthly save path.
 */
export async function upsertSnapshot(snap: Snapshot): Promise<void> {
  await ensureSheets([TAB]);

  // 1. Read current header row
  let current: (string | number | boolean)[] = [];
  try {
    const hdrRows = await readRange(`${TAB}!1:1`);
    if (hdrRows.length > 0) current = hdrRows[0];
  } catch {
    // Sheet may be empty - that's fine
  }

  // 2. Compute desired header (append-only)
  const liveKeys = getACCTSList().map((a) => a.key);
  const desired = reconcileSnapshotHeader(current.map(String), liveKeys);

  // 3. Write header only if it changed (new column appended, or empty sheet)
  const currentNorm = current.map((c) => String(c).trim().toLowerCase());
  if (JSON.stringify(currentNorm) !== JSON.stringify(desired)) {
    await writeRange(`${TAB}!A1`, [desired]);
  }

  // 4. Find the row for this month's date
  const col = await readRange(`${TAB}!A:A`);
  const rowIdx = col.findIndex((r, i) => i > 0 && String(r[0]) === snap.date);

  // 5. Build the row aligned to the desired header
  const row = snapToRowForHeader(snap, desired, liveKeys);

  // 6. Update in place or append
  if (rowIdx > 0) {
    // rowIdx is 0-based over all rows incl. header; sheet row = rowIdx + 1
    await writeRange(`${TAB}!A${rowIdx + 1}:${colLetter(desired.length)}${rowIdx + 1}`, [row]);
  } else {
    // Append - new month
    await appendRows(`${TAB}!A:${colLetter(desired.length)}`, [row]);
  }
}

/**
 * Save all snapshots back to the sheet (full overwrite - write-first-safe).
 * Writes the full table first, then clears only stale cells beyond the new extent.
 *
 * NOTE: The monthly save path uses `upsertSnapshot` instead.
 * This function is for deliberate full rebuilds or delete operations only.
 */
export async function saveSnapshots(snaps: Snapshot[]): Promise<void> {
  const accts = getACCTSList();
  const hdr = snapshotHeader(accts);
  const liveColCount = hdr.length;

  await ensureSheets([TAB]);

  // Read current sheet dimensions
  let existingWidth = 0;
  let existingHeight = 0;
  try {
    const existing = await readRange(`${TAB}!1:1`);
    if (existing.length > 0) {
      existingWidth = existing[0].length;
    }
  } catch {
    // Sheet may be empty - that's fine
  }
  try {
    const colA = await readRange(`${TAB}!A:A`);
    existingHeight = colA.length;
  } catch {
    // Sheet may be empty - that's fine
  }

  // Write full table first (overwrite in place)
  const sorted = [...snaps].sort((a, b) => (a.date as string).localeCompare(b.date as string));
  const values = [hdr, ...sorted.map((s) => snapToRow(s, accts))];
  await writeRange(`${TAB}!A1`, values);

  // Clear only stale rows beyond the new extent
  const newRows = values.length;
  const staleBelow = Math.max(existingHeight - newRows, 0);
  if (staleBelow > 0) {
    await clearRange(
      `${TAB}!A${newRows + 1}:${colLetter(Math.max(liveColCount, existingWidth))}${existingHeight}`,
    );
  }
}
