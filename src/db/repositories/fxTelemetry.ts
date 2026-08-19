/**
 * FX integration telemetry repository.
 *
 * Tracks lightweight operational status for the Frankfurter integration:
 * last successful fetch timestamp, last attempted request URL, last error,
 * cumulative request counts, cache hit counts, normalization counters, and
 * per-month counters. The data lives in a single-row `fx_telemetry` table
 * (id = 1) and a multi-row `fx_telemetry_monthly` table. Both are
 * intentionally excluded from backup/restore — they record operational
 * history for the current device, not user data.
 */

import { getDb, persistDb } from '../connection';
import type { FxTelemetry, FxTelemetryMonthly } from '../../types';

// ── Helpers ────────────────────────────────────────────────────────

/** Returns the current calendar month as a 'YYYY-MM' string. */
function currentYearMonth(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  return `${now.getFullYear()}-${mm}`;
}

// ── Reads ──────────────────────────────────────────────────────────

/** Load the current telemetry record. Returns a zeroed struct if the row is missing. */
export async function getFxTelemetry(): Promise<FxTelemetry> {
  const db = await getDb();
  const result = db.exec(
    `SELECT last_fetch_at, last_request_url, last_error_at, last_error, fetch_count, cache_hit_count,
            prefetch_attempt_count, prefetch_success_count, prefetch_failure_count,
            normalize_attempt_count, normalize_success_count, normalize_failure_count
       FROM fx_telemetry WHERE id = 1`,
  );
  if (result.length === 0 || result[0].values.length === 0) {
    return {
      lastFetchAt: '',
      lastRequestUrl: '',
      lastErrorAt: '',
      lastError: '',
      fetchCount: 0,
      cacheHitCount: 0,
      prefetchAttemptCount: 0,
      prefetchSuccessCount: 0,
      prefetchFailureCount: 0,
      normalizeAttemptCount: 0,
      normalizeSuccessCount: 0,
      normalizeFailureCount: 0,
    };
  }
  const row = result[0].values[0];
  return {
    lastFetchAt: String(row[0] ?? ''),
    lastRequestUrl: String(row[1] ?? ''),
    lastErrorAt: String(row[2] ?? ''),
    lastError: String(row[3] ?? ''),
    fetchCount: Number(row[4]) || 0,
    cacheHitCount: Number(row[5]) || 0,
    prefetchAttemptCount: Number(row[6]) || 0,
    prefetchSuccessCount: Number(row[7]) || 0,
    prefetchFailureCount: Number(row[8]) || 0,
    normalizeAttemptCount: Number(row[9]) || 0,
    normalizeSuccessCount: Number(row[10]) || 0,
    normalizeFailureCount: Number(row[11]) || 0,
  };
}

/** Load the monthly telemetry row for a given YYYY-MM. Returns zeroed struct if absent. */
export async function getFxTelemetryMonthly(month: string): Promise<FxTelemetryMonthly> {
  const db = await getDb();
  const result = db.exec(
    `SELECT month, fetch_count, cache_hit_count, error_count
       FROM fx_telemetry_monthly WHERE month = ?`,
    [month],
  );
  if (result.length === 0 || result[0].values.length === 0) {
    return { month, fetchCount: 0, cacheHitCount: 0, errorCount: 0 };
  }
  const row = result[0].values[0];
  return {
    month: String(row[0] ?? month),
    fetchCount: Number(row[1]) || 0,
    cacheHitCount: Number(row[2]) || 0,
    errorCount: Number(row[3]) || 0,
  };
}

// ── Writes ─────────────────────────────────────────────────────────

/**
 * Record a successful live fetch from the Frankfurter provider.
 * Increments `fetch_count` and `last_fetch_at` on the singleton row, and
 * increments `fetch_count` on the current month's row.
 */
export async function recordFxFetch(at: string): Promise<void> {
  const db = await getDb();
  db.run(
    `INSERT INTO fx_telemetry (id, last_fetch_at, fetch_count)
     VALUES (1, ?, 1)
     ON CONFLICT(id) DO UPDATE SET
       last_fetch_at = excluded.last_fetch_at,
       fetch_count = fetch_count + 1`,
    [at],
  );
  const month = currentYearMonth();
  db.run(
    `INSERT INTO fx_telemetry_monthly (month, fetch_count) VALUES (?, 1)
     ON CONFLICT(month) DO UPDATE SET fetch_count = fetch_count + 1`,
    [month],
  );
  await persistDb();
}

/**
 * Record the last attempted provider request URL.
 */
export async function recordFxRequest(url: string): Promise<void> {
  const db = await getDb();
  db.run(
    `INSERT INTO fx_telemetry (id, last_request_url)
     VALUES (1, ?)
     ON CONFLICT(id) DO UPDATE SET
       last_request_url = excluded.last_request_url`,
    [url],
  );
  await persistDb();
}

/**
 * Record a provider or network error.
 * Updates `last_error_at` and `last_error` on the singleton row, and
 * increments `error_count` on the current month's row.
 */
export async function recordFxError(at: string, message: string): Promise<void> {
  const db = await getDb();
  db.run(
    `INSERT INTO fx_telemetry (id, last_error_at, last_error)
     VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       last_error_at = excluded.last_error_at,
       last_error = excluded.last_error`,
    [at, message],
  );
  const month = currentYearMonth();
  db.run(
    `INSERT INTO fx_telemetry_monthly (month, error_count) VALUES (?, 1)
     ON CONFLICT(month) DO UPDATE SET error_count = error_count + 1`,
    [month],
  );
  await persistDb();
}

/**
 * Record a cache hit (request served from the local `fx_rates` table).
 * Increments `cache_hit_count` on the singleton row and on the current
 * month's row.
 */
export async function recordFxCacheHit(): Promise<void> {
  const db = await getDb();
  db.run(
    `INSERT INTO fx_telemetry (id, cache_hit_count)
     VALUES (1, 1)
     ON CONFLICT(id) DO UPDATE SET
       cache_hit_count = cache_hit_count + 1`,
  );
  const month = currentYearMonth();
  db.run(
    `INSERT INTO fx_telemetry_monthly (month, cache_hit_count) VALUES (?, 1)
     ON CONFLICT(month) DO UPDATE SET cache_hit_count = cache_hit_count + 1`,
    [month],
  );
  await persistDb();
}

/**
 * Record month-end FX prefetch outcomes.
 * Counters are cumulative and incremented by the provided values.
 */
export async function recordFxPrefetch(
  attempted: number,
  successful: number,
  failed: number,
): Promise<void> {
  const db = await getDb();
  db.run(
    `INSERT INTO fx_telemetry (
       id, prefetch_attempt_count, prefetch_success_count, prefetch_failure_count
     )
     VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       prefetch_attempt_count = prefetch_attempt_count + excluded.prefetch_attempt_count,
       prefetch_success_count = prefetch_success_count + excluded.prefetch_success_count,
       prefetch_failure_count = prefetch_failure_count + excluded.prefetch_failure_count`,
    [attempted, successful, failed],
  );
  await persistDb();
}

/**
 * Record snapshot FX normalization outcomes.
 * Called once per snapshot save; counters are cumulative.
 */
export async function recordFxNormalize(
  attempted: number,
  successful: number,
  failed: number,
): Promise<void> {
  const db = await getDb();
  db.run(
    `INSERT INTO fx_telemetry (
       id, normalize_attempt_count, normalize_success_count, normalize_failure_count
     )
     VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       normalize_attempt_count = normalize_attempt_count + excluded.normalize_attempt_count,
       normalize_success_count = normalize_success_count + excluded.normalize_success_count,
       normalize_failure_count = normalize_failure_count + excluded.normalize_failure_count`,
    [attempted, successful, failed],
  );
  await persistDb();
}
