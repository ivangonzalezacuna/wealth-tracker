/**
 * FX rates repository — CRUD for the `fx_rates` cache table.
 *
 * The table stores historical FX rates fetched from Frankfurter. Records are
 * keyed by (base, target, date) so the same pair/date is never fetched twice.
 * `effectiveDate` captures the provider's actual date (may differ from the
 * requested date when it falls on a non-trading day).
 */

import { getDb, persistDb } from '../connection';
import type { FxRateRecord } from '../../types';

// ── Reads ──────────────────────────────────────────────────────────

/**
 * Look up a cached FX rate for the given base/target currency pair and date.
 * Returns `null` when no cache entry exists for the requested combination.
 */
export async function getRate(
  base: string,
  target: string,
  date: string,
): Promise<FxRateRecord | null> {
  const db = await getDb();
  const result = db.exec(
    'SELECT base, target, date, rate, effective_date, fetched_at FROM fx_rates WHERE base = ? AND target = ? AND date = ?',
    [base, target, date],
  );
  if (result.length === 0 || result[0].values.length === 0) return null;
  return rowToFxRateRecord(result[0].values[0]);
}

/**
 * Bulk cache lookup for multiple (base, target, date) triples. Only returns
 * rows that are actually present in the cache — missing pairs are simply
 * absent from the result array, so callers can diff against their request list.
 */
export async function getRatesForPairs(
  pairs: Array<{ base: string; target: string; date: string }>,
): Promise<FxRateRecord[]> {
  if (pairs.length === 0) return [];
  const db = await getDb();

  const placeholders = pairs.map(() => '(?, ?, ?)').join(', ');
  const params = pairs.flatMap((p) => [p.base, p.target, p.date]);
  const result = db.exec(
    `SELECT base, target, date, rate, effective_date, fetched_at FROM fx_rates WHERE (base, target, date) IN (${placeholders})`,
    params,
  );
  if (result.length === 0) return [];
  return result[0].values.map(rowToFxRateRecord);
}

// ── Writes ─────────────────────────────────────────────────────────

/**
 * Insert or replace a single FX rate record in the cache.
 * If a record for the same (base, target, date) already exists it is
 * overwritten — this allows refreshing stale entries.
 */
export async function upsertRate(record: FxRateRecord): Promise<void> {
  const db = await getDb();
  db.run(
    'INSERT OR REPLACE INTO fx_rates (base, target, date, rate, effective_date, fetched_at) VALUES (?, ?, ?, ?, ?, ?)',
    [record.base, record.target, record.date, record.rate, record.effectiveDate, record.fetchedAt],
  );
  await persistDb();
}

// ── Bulk restore (backup import) ───────────────────────────────────

/**
 * Replace the entire `fx_rates` table from a backup payload.
 * Called from the backup restore path — runs inside the caller's transaction
 * if the caller manages one, otherwise opens its own.
 */
export async function restoreAllFxRates(records: FxRateRecord[]): Promise<void> {
  const db = await getDb();
  const stmt = db.prepare(
    'INSERT INTO fx_rates (base, target, date, rate, effective_date, fetched_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  try {
    db.run('BEGIN');
    db.run('DELETE FROM fx_rates');
    for (const r of records) {
      stmt.run([r.base, r.target, r.date, r.rate, r.effectiveDate, r.fetchedAt]);
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

/** Load all cached FX rate records (for backup export). */
export async function loadAllFxRates(): Promise<FxRateRecord[]> {
  const db = await getDb();
  const result = db.exec(
    'SELECT base, target, date, rate, effective_date, fetched_at FROM fx_rates',
  );
  if (result.length === 0) return [];
  return result[0].values.map(rowToFxRateRecord);
}

// ── Helpers ────────────────────────────────────────────────────────

function rowToFxRateRecord(row: unknown[]): FxRateRecord {
  return {
    base: String(row[0] ?? ''),
    target: String(row[1] ?? ''),
    date: String(row[2] ?? ''),
    rate: Number(row[3]) || 0,
    effectiveDate: String(row[4] ?? ''),
    fetchedAt: String(row[5] ?? ''),
  };
}
