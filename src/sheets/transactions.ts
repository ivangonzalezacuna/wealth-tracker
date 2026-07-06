/** Transaction persistence (append-only). Deduplicates on re-import. Reads old 10-col format. */

import {
  readRange,
  writeRange,
  appendRows,
  ensureSheets,
  batchWriteRanges,
  blankRows,
} from './api';
import { SHEET_TABS } from '../constants';
import { newRowToTx, oldRowToTx } from '../model/txRow';
import type { Transaction } from '../types';

const TAB = SHEET_TABS.TRANSACTIONS;
const NEW_HDR = [
  'id',
  'date',
  'source',
  'type',
  'name',
  'isin',
  'shares',
  'price',
  'amount',
  'fee',
  'tax',
  'currency',
  'fxRate',
  'note',
];
const NEW_RANGE = `${TAB}!A:N`;

/** Old 10-column header for migration detection. */
const OLD_HDR = [
  'id',
  'date',
  'category',
  'type',
  'name',
  'symbol',
  'shares',
  'price',
  'amount',
  'tax',
];

/** Build a deduplication key for a transaction. Uses id when present,
 *  otherwise a delimited composite (including shares) to reduce collisions
 *  for id-less transactions with the same date/type/symbol/amount. */
export function txKey(t: Transaction): string {
  if (t.id) return t.id;
  const sym = t.isin || t.symbol || '';
  return `${t.date}|${t.type}|${sym}|${t.amount}|${t.shares ?? ''}`;
}

/**
 * Detect whether a header row is the old 10-column format.
 */
function isOldHeader(hdr: (string | number | boolean)[]): boolean {
  if (!hdr || hdr.length < 10) return false;
  const norm = hdr.map((h) => (h || '').toString().trim().toLowerCase());
  return norm.includes('symbol') || norm.includes('category');
}

function txToRow(t: Transaction): (string | number)[] {
  return [
    t.id,
    t.date,
    t.source || '',
    t.type,
    t.name,
    t.isin || t.symbol || '',
    t.shares,
    t.price,
    t.amount,
    t.fee || 0,
    t.tax || 0,
    t.currency || 'EUR',
    t.fxRate || '',
    t.note || '',
  ];
}

/** Load all transactions from sheet (auto-detects old/new format). */
export async function loadTransactions(): Promise<Transaction[]> {
  await ensureSheets([TAB]);
  const rows = await readRange(NEW_RANGE);
  if (!rows.length) return [];

  const hdr = rows[0];
  const dataRows = hdr && (hdr[0] || '').toString().toLowerCase() === 'id' ? rows.slice(1) : rows;
  const useOld = isOldHeader(hdr);

  const parser = useOld ? oldRowToTx : newRowToTx;
  return dataRows.filter((r) => r[1]).map(parser);
}

/**
 * Merge new transactions with existing ones (append-only, never clears).
 * Deduplicates using txKey - only genuinely new rows are appended.
 * Returns the full merged set sorted by date.
 */
export async function mergeTransactions(
  existing: Transaction[],
  incoming: Transaction[],
): Promise<Transaction[]> {
  const seen = new Set(existing.map(txKey));
  const newTxs = incoming.filter((t) => !seen.has(txKey(t)));

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

/** Full overwrite of the Transactions tab - used only by backup restore.
 *  Distinct from mergeTransactions (dedup-append, routine CSV import). */
export async function restoreTransactions(txs: Transaction[]): Promise<void> {
  await ensureSheets([TAB]);
  let existingHeight = 0;
  try {
    existingHeight = (await readRange(`${TAB}!A:A`)).length;
  } catch {
    /* empty sheet */
  }
  const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date));
  const values = [NEW_HDR, ...sorted.map(txToRow)];
  // Write and blank-out are sent as one atomic batchWriteRanges request -
  // see the comment on setAccounts in store/config.ts for why two
  // sequential writeRange/clearRange calls are unsafe here.
  const staleBelow = Math.max(existingHeight - values.length, 0);
  if (staleBelow > 0) {
    await batchWriteRanges([
      { range: NEW_RANGE, values },
      {
        range: `${TAB}!A${values.length + 1}:N${existingHeight}`,
        values: blankRows(staleBelow, NEW_HDR.length),
      },
    ]);
  } else {
    await writeRange(NEW_RANGE, values);
  }
}

/** Save import date metadata to Meta tab. */
export async function saveImportMeta(date: string): Promise<void> {
  await ensureSheets([SHEET_TABS.META_INFO]);
  await writeRange(`${SHEET_TABS.META_INFO}!A1:B2`, [
    ['key', 'value'],
    ['last_import', date],
  ]);
}

/** Load import metadata. */
export async function loadImportMeta(): Promise<Record<string, string>> {
  try {
    await ensureSheets([SHEET_TABS.META_INFO]);
    const rows = await readRange(`${SHEET_TABS.META_INFO}!A:B`);
    const meta: Record<string, string> = {};
    for (const row of rows.slice(1)) {
      if (row[0]) meta[String(row[0])] = String(row[1] ?? '');
    }
    return meta;
  } catch {
    return {};
  }
}
