/**
 * Transaction persistence — stores parsed CSV rows in "Transactions" tab.
 * On re-import, deduplicates by transaction key and appends only new rows.
 * Never clears/rewrites — append-only to prevent data loss on partial failures.
 *
 * Sheet layout (row 1 = header):
 * id | date | source | type | name | isin | shares | price | amount | fee | tax | currency | fxRate | note
 *
 * Backward compat: reads old 10-column format and migrates to 14 columns.
 */

import { readRange, writeRange, appendRows, ensureSheets } from './api';
import { SHEET_TABS } from '../constants';
import { parseNum } from '../csv';

const TAB   = SHEET_TABS.TRANSACTIONS;
const NEW_HDR = ['id','date','source','type','name','isin','shares','price','amount','fee','tax','currency','fxRate','note'];
const NEW_RANGE = `${TAB}!A:N`;

/** Old 10-column header for migration detection. */
const OLD_HDR = ['id','date','category','type','name','symbol','shares','price','amount','tax'];

/** Build a deduplication key for a transaction. Uses id when present,
 *  otherwise a delimited composite to avoid same-day/same-amount collisions.
 *  NOTE: txKey semantics are unchanged — new fields do NOT enter the key. */
export function txKey(t) {
  if (t.id) return t.id;
  const sym = t.isin || t.symbol || '';
  return `${t.date}|${t.type}|${sym}|${t.amount}`;
}

/**
 * Detect whether a header row is the old 10-column format.
 * @param {string[]} hdr
 * @returns {boolean}
 */
function isOldHeader(hdr) {
  if (!hdr || hdr.length < 10) return false;
  const norm = hdr.map(h => (h || '').trim().toLowerCase());
  return norm.includes('symbol') || norm.includes('category');
}

/**
 * Map an old 10-col row to the new 14-col shape.
 * Old: id | date | category | type | name | symbol | shares | price | amount | tax
 * New: id | date | source | type | name | isin | shares | price | amount | fee | tax | currency | fxRate | note
 * @param {any[]} row
 * @returns {object}
 */
function oldRowToTx(row) {
  return {
    id:       row[0] || '',
    date:     row[1] || '',
    source:   'trade_republic',
    category: row[2] || '',
    type:     row[3] || '',
    name:     row[4] || '',
    isin:     row[5] || '',
    symbol:   row[5] || '',
    shares:   parseNum(String(row[6] ?? '')),
    price:    parseNum(String(row[7] ?? '')),
    amount:   parseNum(String(row[8] ?? '')),
    fee:      0,
    tax:      parseNum(String(row[9] ?? '')),
    currency: 'EUR',
    fxRate:   0,
    note:     '',
  };
}

/**
 * Map a new 14-col row to a transaction object.
 * @param {any[]} row
 * @returns {object}
 */
function newRowToTx(row) {
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

function txToRow(t) {
  return [
    t.id, t.date, t.source || '', t.type, t.name, t.isin || t.symbol || '',
    t.shares, t.price, t.amount, t.fee || 0, t.tax || 0,
    t.currency || 'EUR', t.fxRate || '', t.note || '',
  ];
}

/** Load all transactions from sheet (auto-detects old/new format). */
export async function loadTransactions() {
  await ensureSheets([TAB]);
  const rows = await readRange(NEW_RANGE);
  if (!rows.length) return [];

  const hdr = rows[0];
  const dataRows = (hdr && (hdr[0] || '').toString().toLowerCase() === 'id') ? rows.slice(1) : rows;
  const useOld = isOldHeader(hdr);

  const parser = useOld ? oldRowToTx : newRowToTx;
  return dataRows.filter(r => r[1]).map(parser);
}

/**
 * Merge new transactions with existing ones (append-only, never clears).
 * Deduplicates using txKey — only genuinely new rows are appended.
 * Returns the full merged set sorted by date.
 */
export async function mergeTransactions(existing, incoming) {
  const seen = new Set(existing.map(txKey));
  const newTxs = incoming.filter(t => !seen.has(txKey(t)));

  if (newTxs.length > 0) {
    await ensureSheets([TAB]);
    // Ensure new header exists (write migration on first write)
    if (existing.length === 0) {
      await writeRange(`${TAB}!A1`, [NEW_HDR]);
    }
    const sortedNew = [...newTxs].sort((a, b) => a.date.localeCompare(b.date));
    await appendRows(NEW_RANGE, sortedNew.map(txToRow));
  }

  const merged = [...existing, ...newTxs].sort((a, b) => a.date.localeCompare(b.date));
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
