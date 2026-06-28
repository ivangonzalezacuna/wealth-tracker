/**
 * Snapshot persistence — one row per month in the "Snapshots" tab.
 *
 * Columns are derived from your configured accounts:
 *   date | <account keys…> | notes
 *
 * Reads by header name, so adding/removing accounts later never
 * misaligns saved rows (missing cols read as 0).
 */

import { readRange, writeRange, clearRange, ensureSheets } from './api.js';
import { SHEET_TABS, ACCTS } from '../constants.js';

const TAB   = SHEET_TABS.SNAPSHOTS;
const HDR   = ['date', ...ACCTS.map(a => a.key), 'notes'];
const COLS  = HDR.length;
const RANGE = `${TAB}!A:${String.fromCharCode(64 + COLS)}`;

function rowToSnap(row, hdr) {
  const snap = { date: row[hdr.indexOf('date')] || '' };
  for (const a of ACCTS) {
    const idx = hdr.indexOf(a.key);
    snap[a.key] = idx >= 0 ? (parseFloat(row[idx]) || 0) : 0;
  }
  const ni = hdr.indexOf('notes');
  snap.notes = ni >= 0 ? (row[ni] || '') : '';
  return snap;
}

function snapToRow(s) {
  return [s.date, ...ACCTS.map(a => s[a.key] || 0), s.notes || ''];
}

/** Load all snapshots from the sheet, sorted ascending by date. */
export async function loadSnapshots() {
  await ensureSheets([TAB]);
  const rows = await readRange(RANGE);
  if (!rows.length) return [];
  // Use actual header from sheet for column mapping
  const hdr = rows[0].map(c => (c || '').toString().trim().toLowerCase());
  const data = rows.slice(1);
  return data
    .filter(r => r[hdr.indexOf('date')])
    .map(r => rowToSnap(r, hdr))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Save all snapshots back to the sheet (full overwrite).
 * Always writes header + all rows sorted by date.
 */
export async function saveSnapshots(snaps) {
  await ensureSheets([TAB]);
  await clearRange(RANGE);
  const sorted = [...snaps].sort((a, b) => a.date.localeCompare(b.date));
  const values = [HDR, ...sorted.map(snapToRow)];
  await writeRange(`${TAB}!A1`, values);
}
