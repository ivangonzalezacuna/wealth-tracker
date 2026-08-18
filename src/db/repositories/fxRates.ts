/**
 * FX rate cache repository — CRUD operations for the fx_rates table.
 *
 * Records are keyed by (base_currency, quote_currency, date) where `date` is
 * the *requested* date. The provider's effective date (business-day fallback)
 * is stored separately in `effective_date`.
 */

import { getDb, persistDb } from '../connection';
import type { FxRateRecord } from '../../types';

// ── Row mapping ────────────────────────────────────────────────────

function rowToRecord(row: unknown[]): FxRateRecord {
  return {
    baseCurrency: String(row[0] ?? ''),
    quoteCurrency: String(row[1] ?? ''),
    date: String(row[2] ?? ''),
    rate: Number(row[3] ?? 0),
    effectiveDate: String(row[4] ?? ''),
    provider: String(row[5] ?? 'frankfurter'),
    fetchedAt: String(row[6] ?? ''),
  };
}

// ── Queries ────────────────────────────────────────────────────────

const SELECT_COLS = `base_currency, quote_currency, date, rate, effective_date, provider, fetched_at`;

/**
 * Retrieve a cached rate for the given currency pair and requested date.
 * Returns `undefined` when the cache has no entry for this key.
 */
export async function getFxRate(
  baseCurrency: string,
  quoteCurrency: string,
  date: string,
): Promise<FxRateRecord | undefined> {
  const db = await getDb();
  const result = db.exec(
    `SELECT ${SELECT_COLS} FROM fx_rates
     WHERE base_currency = ? AND quote_currency = ? AND date = ?`,
    [baseCurrency, quoteCurrency, date],
  );
  if (!result.length || !result[0].values.length) return undefined;
  return rowToRecord(result[0].values[0]);
}

/**
 * Insert or replace a single FX rate record.
 */
export async function upsertFxRate(record: FxRateRecord): Promise<void> {
  const db = await getDb();
  db.run(
    `INSERT OR REPLACE INTO fx_rates
       (base_currency, quote_currency, date, rate, effective_date, provider, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      record.baseCurrency,
      record.quoteCurrency,
      record.date,
      record.rate,
      record.effectiveDate,
      record.provider,
      record.fetchedAt,
    ],
  );
  await persistDb();
}

/**
 * Load all cached FX rate records, ordered by date ascending then currency pair.
 * Primarily used for backup export.
 */
export async function loadFxRates(): Promise<FxRateRecord[]> {
  const db = await getDb();
  const result = db.exec(
    `SELECT ${SELECT_COLS} FROM fx_rates
     ORDER BY date ASC, base_currency ASC, quote_currency ASC`,
  );
  if (!result.length) return [];
  return result[0].values.map(rowToRecord);
}

/**
 * Bulk-replace the entire fx_rates table from a backup restore.
 */
export async function restoreFxRates(records: FxRateRecord[]): Promise<void> {
  const db = await getDb();
  const stmt = db.prepare(
    `INSERT INTO fx_rates
       (base_currency, quote_currency, date, rate, effective_date, provider, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  try {
    db.run('BEGIN');
    db.run('DELETE FROM fx_rates');
    for (const r of records) {
      stmt.run([
        r.baseCurrency,
        r.quoteCurrency,
        r.date,
        r.rate,
        r.effectiveDate,
        r.provider,
        r.fetchedAt,
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

/**
 * Delete all cached FX rates (e.g. when the user wants to force a full refresh).
 */
export async function clearFxRates(): Promise<void> {
  const db = await getDb();
  db.run('DELETE FROM fx_rates');
  await persistDb();
}
