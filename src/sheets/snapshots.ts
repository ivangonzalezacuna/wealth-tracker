/**
 * Snapshot persistence — one row per month in the "Snapshots" tab.
 *
 * Columns are derived from your configured accounts:
 *   date | <account keys…> | notes
 *
 * Reads by header name, so adding/removing accounts later never
 * misaligns saved rows (missing cols read as 0).
 */

import { readRange, writeRange, clearRange, ensureSheets } from './api';
import { SHEET_TABS, getACCTSList } from '../constants';
import { parseNum } from '../csv';
import type { Snapshot } from '../types';

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

/** Build the canonical header for a given account list. */
export function snapshotHeader(accts: AccountRef[]): string[] {
  return ['date', ...accts.map(a => a.key), 'notes'];
}

/** Convert a snapshot object to a sheet row, ordered by accts. */
export function snapToRow(snap: Snapshot, accts: AccountRef[]): (string | number)[] {
  return [snap.date, ...accts.map(a => (snap[a.key] as number) || 0), snap.notes || ''];
}

/** Convert a sheet row back to a snapshot object, reading by sheetHeader index. */
export function rowToSnap(row: (string | number | boolean)[], sheetHeader: string[], accts: AccountRef[]): Snapshot {
  const snap: Snapshot = { date: String(row[sheetHeader.indexOf('date')] ?? '') };
  for (const a of accts) {
    const idx = sheetHeader.indexOf(a.key);
    snap[a.key] = idx >= 0 ? (typeof row[idx] === 'number' ? row[idx] : parseNum(String(row[idx] ?? ''))) || 0 : 0;
  }
  const ni = sheetHeader.indexOf('notes');
  snap.notes = ni >= 0 ? String(row[ni] ?? '') : '';
  return snap;
}

/** Load all snapshots from the sheet, sorted ascending by date. */
export async function loadSnapshots(): Promise<Snapshot[]> {
  const accts = getACCTSList();
  const hdr = snapshotHeader(accts);
  const range = `${TAB}!A:${colLetter(hdr.length)}`;

  await ensureSheets([TAB]);
  const rows = await readRange(range);
  if (!rows.length) return [];
  // Use actual header from sheet for column mapping
  const sheetHdr = rows[0].map(c => (c || '').toString().trim().toLowerCase());
  const data = rows.slice(1);
  return data
    .filter(r => r[sheetHdr.indexOf('date')])
    .map(r => rowToSnap(r, sheetHdr, accts))
    .sort((a, b) => (a.date as string).localeCompare(b.date as string));
}

/**
 * Save all snapshots back to the sheet (full overwrite).
 * Always writes header + all rows sorted by date.
 *
 * Note: clearRange is not atomic with writeRange — a failure between them
 * can corrupt the tab. Clearing the wider range minimises risk; a fully
 * atomic snapshot write is a Phase 4 concern.
 */
export async function saveSnapshots(snaps: Snapshot[]): Promise<void> {
  const accts = getACCTSList();
  const hdr = snapshotHeader(accts);
  const liveColCount = hdr.length;

  await ensureSheets([TAB]);

  // Read current sheet header to determine existing width
  let existingWidth = 0;
  try {
    const existing = await readRange(`${TAB}!1:1`);
    if (existing.length > 0) {
      existingWidth = existing[0].length;
    }
  } catch {
    // Sheet may be empty — that's fine
  }

  // Clear a range wide enough to wipe any previously-written columns,
  // even if the account count has since shrunk.
  const clearWidth = Math.max(liveColCount, existingWidth);
  await clearRange(`${TAB}!A:${colLetter(clearWidth)}`);

  const sorted = [...snaps].sort((a, b) => (a.date as string).localeCompare(b.date as string));
  const values = [hdr, ...sorted.map(s => snapToRow(s, accts))];
  await writeRange(`${TAB}!A1`, values);
}
