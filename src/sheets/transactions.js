/**
 * Transaction persistence — stores parsed CSV rows in "Transactions" tab.
 * On re-import, deduplicates by transaction_id.
 *
 * Sheet layout (row 1 = header):
 * id | date | category | type | name | symbol | shares | price | amount | tax
 */

import { readRange, writeRange, clearRange, ensureSheets } from './api.js';
import { SHEET_TABS } from '../constants.js';

const TAB   = SHEET_TABS.TRANSACTIONS;
const HDR   = ['id','date','category','type','name','symbol','shares','price','amount','tax'];
const RANGE = `${TAB}!A:J`;

function rowToTx(row) {
  return {
    id:       row[0] || '',
    date:     row[1] || '',
    category: row[2] || '',
    type:     row[3] || '',
    name:     row[4] || '',
    symbol:   row[5] || '',
    shares:   parseFloat(row[6]) || 0,
    price:    parseFloat(row[7]) || 0,
    amount:   parseFloat(row[8]) || 0,
    tax:      parseFloat(row[9]) || 0,
  };
}

function txToRow(t) {
  return [t.id, t.date, t.category, t.type, t.name, t.symbol,
          t.shares, t.price, t.amount, t.tax];
}

/** Load all transactions from sheet. */
export async function loadTransactions() {
  await ensureSheets([TAB]);
  const rows = await readRange(RANGE);
  if (!rows.length) return [];
  const data = rows[0][0] === 'id' ? rows.slice(1) : rows;
  return data.filter(r => r[1]).map(rowToTx);
}

/**
 * Merge new transactions with existing ones (dedup by id).
 * Saves full merged set back to sheet.
 * Returns total count after merge.
 */
export async function mergeTransactions(existing, incoming) {
  const seen = new Map(existing.map(t => [t.id || t.date + t.amount, t]));
  for (const t of incoming) {
    const key = t.id || t.date + t.amount;
    seen.set(key, t);
  }
  const merged = [...seen.values()].sort((a, b) => a.date.localeCompare(b.date));
  await ensureSheets([TAB]);
  await clearRange(RANGE);
  const values = [HDR, ...merged.map(txToRow)];
  await writeRange(`${TAB}!A1`, values);
  return merged;
}

/** Save import date metadata to Meta tab. */
export async function saveImportMeta(date) {
  await ensureSheets([SHEET_TABS.META_INFO]);
  await writeRange(`${SHEET_TABS.META_INFO}!A1:B2`, [
    ['key', 'value'],
    ['last_import', date],
  ]);
}

/** Load import metadata. */
export async function loadImportMeta() {
  try {
    await ensureSheets([SHEET_TABS.META_INFO]);
    const rows = await readRange(`${SHEET_TABS.META_INFO}!A:B`);
    const meta = {};
    for (const row of rows.slice(1)) {
      if (row[0]) meta[row[0]] = row[1] || '';
    }
    return meta;
  } catch {
    return {};
  }
}
