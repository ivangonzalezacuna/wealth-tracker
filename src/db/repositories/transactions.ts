/**
 * Transaction repository - CRUD operations for the transactions table.
 * Mirrors the API surface of the old sheets/transactions.ts module.
 */

import { getDb, persistDb } from '../connection';
import type { Transaction, TxTypeValue } from '../../types';

/** Build a deduplication key for a transaction. */
export function txKey(t: Transaction): string {
  if (t.id) return t.id;
  return `${t.date}|${t.type}|${t.isin}|${t.amount}|${t.shares ?? ''}`;
}

/** Load all transactions, sorted by date ascending. */
export async function loadTransactions(): Promise<Transaction[]> {
  const db = await getDb();
  const result = db.exec(
    'SELECT rowid, id, date, source, type, name, isin, shares, price, amount, fee, tax, currency, fx_rate, note, category FROM transactions ORDER BY date ASC, rowid ASC',
  );
  if (result.length === 0) return [];
  return result[0].values.map(rowToTransaction);
}

/** Insert one transaction row. */
export async function insertTransaction(tx: Transaction): Promise<void> {
  const db = await getDb();
  db.run(
    'INSERT INTO transactions (id, date, source, type, name, isin, shares, price, amount, fee, tax, currency, fx_rate, note, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      tx.id,
      tx.date,
      tx.source || '',
      tx.type,
      tx.name || '',
      tx.isin || '',
      tx.shares || 0,
      tx.price || 0,
      tx.amount || 0,
      tx.fee || 0,
      tx.tax || 0,
      tx.currency || 'EUR',
      tx.fxRate || 0,
      tx.note || '',
      tx.category || '',
    ],
  );
  await persistDb();
}

/** Update one transaction row by SQLite rowid. */
export async function updateTransaction(rowId: number, tx: Transaction): Promise<void> {
  const db = await getDb();
  db.run(
    'UPDATE transactions SET id=?, date=?, source=?, type=?, name=?, isin=?, shares=?, price=?, amount=?, fee=?, tax=?, currency=?, fx_rate=?, note=?, category=? WHERE rowid=?',
    [
      tx.id,
      tx.date,
      tx.source || '',
      tx.type,
      tx.name || '',
      tx.isin || '',
      tx.shares || 0,
      tx.price || 0,
      tx.amount || 0,
      tx.fee || 0,
      tx.tax || 0,
      tx.currency || 'EUR',
      tx.fxRate || 0,
      tx.note || '',
      tx.category || '',
      rowId,
    ],
  );
  await persistDb();
}

/** Delete one transaction row by SQLite rowid. */
export async function deleteTransaction(rowId: number): Promise<void> {
  const db = await getDb();
  db.run('DELETE FROM transactions WHERE rowid = ?', [rowId]);
  await persistDb();
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
      'INSERT OR IGNORE INTO transactions (id, date, source, type, name, isin, shares, price, amount, fee, tax, currency, fx_rate, note, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    try {
      db.run('BEGIN');
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
          t.category || '',
        ]);
      }
      db.run('COMMIT');
    } catch (err) {
      db.run('ROLLBACK');
      throw err;
    } finally {
      stmt.free();
    }
    await persistDb();
  }

  const merged = [...existing, ...newTxs].sort((a, b) => a.date.localeCompare(b.date));
  return merged;
}

/**
 * Count incoming transactions that already exist (same txKey) but differ in
 * at least one data field (shares, price, fee, tax). These are broker
 * corrections that the append-only merge silently ignores.
 */
export function countAmendedRows(existing: Transaction[], incoming: Transaction[]): number {
  const existingMap = new Map(existing.map((t) => [txKey(t), t]));
  let count = 0;
  for (const t of incoming) {
    const stored = existingMap.get(txKey(t));
    if (!stored) continue;
    if (
      stored.shares !== t.shares ||
      stored.price !== t.price ||
      stored.fee !== t.fee ||
      stored.tax !== t.tax
    ) {
      count++;
    }
  }
  return count;
}

/**
 * Full overwrite of the transactions table - used by backup restore.
 */
export async function restoreTransactions(txs: Transaction[]): Promise<void> {
  const db = await getDb();
  const stmt = db.prepare(
    'INSERT INTO transactions (id, date, source, type, name, isin, shares, price, amount, fee, tax, currency, fx_rate, note, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  try {
    db.run('BEGIN');
    db.run('DELETE FROM transactions');
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
        t.category || '',
      ]);
    }
    db.run('COMMIT');
  } catch (err) {
    db.run('ROLLBACK');
    throw err;
  } finally {
    stmt.free();
  }
  await persistDb();
}

// ── Internal helpers ──────────────────────────────────────────────

function rowToTransaction(row: unknown[]): Transaction {
  return {
    rowId: Number(row[0]) || undefined,
    id: String(row[1] ?? ''),
    date: String(row[2] ?? ''),
    source: String(row[3] ?? ''),
    type: String(row[4] ?? '') as TxTypeValue,
    name: String(row[5] ?? ''),
    isin: String(row[6] ?? ''),
    shares: Number(row[7]) || 0,
    price: Number(row[8]) || 0,
    amount: Number(row[9]) || 0,
    fee: Number(row[10]) || 0,
    tax: Number(row[11]) || 0,
    currency: String(row[12] ?? 'EUR'),
    fxRate: Number(row[13]) || 0,
    note: String(row[14] ?? ''),
    category: String(row[15] ?? ''),
  };
}
