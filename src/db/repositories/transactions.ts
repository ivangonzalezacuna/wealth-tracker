/**
 * Transaction repository - CRUD operations for the transactions table.
 * Mirrors the API surface of the old sheets/transactions.ts module.
 */

import { getDb, persistDb } from '../connection';
import type { Transaction } from '../../types';

/** Build a deduplication key for a transaction. */
export function txKey(t: Transaction): string {
  if (t.id) return t.id;
  return `${t.date}|${t.type}|${t.isin}|${t.amount}|${t.shares ?? ''}`;
}

/** Load all transactions, sorted by date ascending. */
export async function loadTransactions(): Promise<Transaction[]> {
  const db = await getDb();
  const result = db.exec(
    'SELECT id, date, source, type, name, isin, shares, price, amount, fee, tax, currency, fx_rate, note FROM transactions ORDER BY date ASC',
  );
  if (result.length === 0) return [];
  return result[0].values.map(rowToTransaction);
}

/**
 * Merge incoming transactions with existing ones (append-only dedup).
 * Only genuinely new transactions (by txKey) are inserted.
 * Returns the full merged set sorted by date.
 */
export async function mergeTransactions(
  existing: Transaction[],
  incoming: Transaction[],
): Promise<Transaction[]> {
  const seen = new Set(existing.map(txKey));
  const newTxs = incoming.filter((t) => !seen.has(txKey(t)));

  if (newTxs.length > 0) {
    const db = await getDb();
    const stmt = db.prepare(
      'INSERT OR IGNORE INTO transactions (id, date, source, type, name, isin, shares, price, amount, fee, tax, currency, fx_rate, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    for (const t of newTxs) {
      stmt.run([
        t.id,
        t.date,
        t.source || '',
        t.type,
        t.name,
        t.isin || '',
        t.shares,
        t.price,
        t.amount,
        t.fee || 0,
        t.tax || 0,
        t.currency || 'EUR',
        t.fxRate || 0,
        t.note || '',
      ]);
    }
    stmt.free();
    await persistDb();
  }

  const merged = [...existing, ...newTxs].sort((a, b) => a.date.localeCompare(b.date));
  return merged;
}

/**
 * Full overwrite of the transactions table - used by backup restore.
 */
export async function restoreTransactions(txs: Transaction[]): Promise<void> {
  const db = await getDb();
  db.run('DELETE FROM transactions');
  const stmt = db.prepare(
    'INSERT INTO transactions (id, date, source, type, name, isin, shares, price, amount, fee, tax, currency, fx_rate, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  for (const t of txs) {
    stmt.run([
      t.id,
      t.date,
      t.source || '',
      t.type,
      t.name,
      t.isin || '',
      t.shares,
      t.price,
      t.amount,
      t.fee || 0,
      t.tax || 0,
      t.currency || 'EUR',
      t.fxRate || 0,
      t.note || '',
    ]);
  }
  stmt.free();
  await persistDb();
}

// ── Internal helpers ──────────────────────────────────────────────

function rowToTransaction(row: unknown[]): Transaction {
  return {
    id: String(row[0] ?? ''),
    date: String(row[1] ?? ''),
    source: String(row[2] ?? ''),
    type: String(row[3] ?? ''),
    name: String(row[4] ?? ''),
    isin: String(row[5] ?? ''),
    shares: Number(row[6]) || 0,
    price: Number(row[7]) || 0,
    amount: Number(row[8]) || 0,
    fee: Number(row[9]) || 0,
    tax: Number(row[10]) || 0,
    currency: String(row[11] ?? 'EUR'),
    fxRate: Number(row[12]) || 0,
    note: String(row[13] ?? ''),
  };
}
