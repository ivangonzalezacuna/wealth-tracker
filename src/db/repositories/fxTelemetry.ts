/**
 * FX integration telemetry repository.
 *
 * Tracks lightweight operational status for the Frankfurter integration:
 * last successful fetch timestamp, last error, cumulative request counts, and
 * cache hit counts. The data lives in a single-row `fx_telemetry` table
 * (id = 1) and is intentionally excluded from backup/restore — it records
 * operational history for the current device, not user data.
 */

import { getDb, persistDb } from '../connection';
import type { FxTelemetry } from '../../types';

// ── Reads ──────────────────────────────────────────────────────────

/** Load the current telemetry record. Returns a zeroed struct if the row is missing. */
export async function getFxTelemetry(): Promise<FxTelemetry> {
  const db = await getDb();
  const result = db.exec(
    `SELECT last_fetch_at, last_error_at, last_error, fetch_count, cache_hit_count,
            prefetch_attempt_count, prefetch_success_count, prefetch_failure_count
       FROM fx_telemetry WHERE id = 1`,
  );
  if (result.length === 0 || result[0].values.length === 0) {
    return {
      lastFetchAt: '',
      lastErrorAt: '',
      lastError: '',
      fetchCount: 0,
      cacheHitCount: 0,
      prefetchAttemptCount: 0,
      prefetchSuccessCount: 0,
      prefetchFailureCount: 0,
    };
  }
  const row = result[0].values[0];
  return {
    lastFetchAt: String(row[0] ?? ''),
    lastErrorAt: String(row[1] ?? ''),
    lastError: String(row[2] ?? ''),
    fetchCount: Number(row[3]) || 0,
    cacheHitCount: Number(row[4]) || 0,
    prefetchAttemptCount: Number(row[5]) || 0,
    prefetchSuccessCount: Number(row[6]) || 0,
    prefetchFailureCount: Number(row[7]) || 0,
  };
}

// ── Writes ─────────────────────────────────────────────────────────

/**
 * Record a successful live fetch from the Frankfurter provider.
 * Increments `fetch_count` and updates `last_fetch_at`.
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
  await persistDb();
}

/**
 * Record a provider or network error.
 * Updates `last_error_at` and `last_error`; does not increment `fetch_count`.
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
  await persistDb();
}

/**
 * Record a cache hit (request served from the local `fx_rates` table).
 * Increments `cache_hit_count`.
 */
export async function recordFxCacheHit(): Promise<void> {
  const db = await getDb();
  db.run(
    `INSERT INTO fx_telemetry (id, cache_hit_count)
     VALUES (1, 1)
     ON CONFLICT(id) DO UPDATE SET
       cache_hit_count = cache_hit_count + 1`,
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
