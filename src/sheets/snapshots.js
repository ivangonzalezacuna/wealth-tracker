/**
 * Snapshot persistence — one row per month in the "Snapshots" tab.
 *
 * Sheet layout (row 1 = header):
 * date | tr_portfolio | tr_cash | n26 | bav | avd | notes
 */

import { readRange, writeRange, clearRange, ensureSheets } from './api.js';
import { SHEET_TABS } from '../constants.js';

const TAB  = SHEET_TABS.SNAPSHOTS;
const HDR  = ['date','tr_portfolio','tr_cash','n26','bav','avd','notes'];
const RANGE = `${TAB}!A:G`;

function rowToSnap(row) {
  return {
    date:         row[0] || '',
    tr_portfolio: parseFloat(row[1]) || 0,
    tr_cash:      parseFloat(row[2]) || 0,
    n26:          parseFloat(row[3]) || 0,
    bav:          parseFloat(row[4]) || 0,
    avd:          parseFloat(row[5]) || 0,
    notes:        row[6] || '',
  };
}

function snapToRow(s) {
  return [
    s.date,
    s.tr_portfolio || 0,
    s.tr_cash      || 0,
    s.n26          || 0,
    s.bav          || 0,
    s.avd          || 0,
    s.notes        || '',
  ];
}

/** Load all snapshots from the sheet, sorted ascending by date. */
export async function loadSnapshots() {
  await ensureSheets([TAB]);
  const rows = await readRange(RANGE);
  if (!rows.length) return [];
  // Skip header row
  const data = rows[0][0] === 'date' ? rows.slice(1) : rows;
  return data
    .filter(r => r[0])
    .map(rowToSnap)
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
