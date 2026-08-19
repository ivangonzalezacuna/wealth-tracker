import { getDb, persistDb } from '../connection';
import type { FmpTelemetry } from '../../types';

function currentDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getFmpTelemetry(): Promise<FmpTelemetry> {
  const db = await getDb();
  const result = db.exec(
    `SELECT last_fetch_at, last_request_url, last_error_at, last_error, fetch_count,
            cache_hit_count, error_count, daily_fetch_date, daily_fetch_count
       FROM fmp_telemetry
      WHERE id = 1`,
  );
  if (result.length === 0 || result[0].values.length === 0) {
    return zeroTelemetry();
  }
  const row = result[0].values[0];
  return {
    lastFetchAt: String(row[0] ?? ''),
    lastRequestUrl: String(row[1] ?? ''),
    lastErrorAt: String(row[2] ?? ''),
    lastError: String(row[3] ?? ''),
    fetchCount: Number(row[4]) || 0,
    cacheHitCount: Number(row[5]) || 0,
    errorCount: Number(row[6]) || 0,
    dailyFetchDate: String(row[7] ?? ''),
    dailyFetchCount: Number(row[8]) || 0,
  };
}

export async function recordFmpFetch(at: string, url: string): Promise<void> {
  const db = await getDb();
  const today = currentDate();
  const current = await getFmpTelemetry();
  const dailyFetchCount = current.dailyFetchDate === today ? current.dailyFetchCount + 1 : 1;
  db.run(
    `INSERT INTO fmp_telemetry (
       id, last_fetch_at, last_request_url, fetch_count, daily_fetch_date, daily_fetch_count
     ) VALUES (1, ?, ?, 1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       last_fetch_at = excluded.last_fetch_at,
       last_request_url = excluded.last_request_url,
       fetch_count = fmp_telemetry.fetch_count + 1,
       daily_fetch_date = excluded.daily_fetch_date,
       daily_fetch_count = excluded.daily_fetch_count`,
    [at, url, today, dailyFetchCount],
  );
  await persistDb();
}

export async function recordFmpCacheHit(): Promise<void> {
  const db = await getDb();
  db.run(
    `INSERT INTO fmp_telemetry (id, cache_hit_count)
     VALUES (1, 1)
     ON CONFLICT(id) DO UPDATE SET
       cache_hit_count = fmp_telemetry.cache_hit_count + 1`,
  );
  await persistDb();
}

export async function recordFmpError(at: string, message: string): Promise<void> {
  const db = await getDb();
  db.run(
    `INSERT INTO fmp_telemetry (id, last_error_at, last_error, error_count)
     VALUES (1, ?, ?, 1)
     ON CONFLICT(id) DO UPDATE SET
       last_error_at = excluded.last_error_at,
       last_error = excluded.last_error,
       error_count = fmp_telemetry.error_count + 1`,
    [at, message],
  );
  await persistDb();
}

export async function getDailyFetchCount(): Promise<number> {
  try {
    const telemetry = await getFmpTelemetry();
    return telemetry.dailyFetchDate === currentDate() ? telemetry.dailyFetchCount : 0;
  } catch {
    return 0;
  }
}

export async function resetFmpTelemetry(): Promise<void> {
  const db = await getDb();
  db.run(
    `INSERT INTO fmp_telemetry (
       id, last_fetch_at, last_request_url, last_error_at, last_error,
       fetch_count, cache_hit_count, error_count, daily_fetch_date, daily_fetch_count
     ) VALUES (1, '', '', '', '', 0, 0, 0, '', 0)
     ON CONFLICT(id) DO UPDATE SET
       last_fetch_at = '',
       last_request_url = '',
       last_error_at = '',
       last_error = '',
       fetch_count = 0,
       cache_hit_count = 0,
       error_count = 0,
       daily_fetch_date = '',
       daily_fetch_count = 0`,
  );
  await persistDb();
}

function zeroTelemetry(): FmpTelemetry {
  return {
    lastFetchAt: '',
    lastRequestUrl: '',
    lastErrorAt: '',
    lastError: '',
    fetchCount: 0,
    cacheHitCount: 0,
    errorCount: 0,
    dailyFetchDate: '',
    dailyFetchCount: 0,
  };
}
