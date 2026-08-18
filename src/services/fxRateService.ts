/**
 * FX rate service — cache-first lookup backed by the Frankfurter provider.
 *
 * This is the single authoritative entry-point for all FX rate resolution in
 * the app. Callers should never import frankfurter.ts or the fxRates
 * repository directly; they should go through this module.
 *
 * Design:
 *   1. Check the local `fx_rates` SQLite cache.
 *   2. On cache miss, fetch from Frankfurter and persist to cache.
 *   3. On any network or provider error return `null` so the caller can
 *      degrade gracefully to existing offline behavior.
 *
 * All methods are async; the DB and fetch are async boundaries.
 */

import type { FxRateRecord } from '../types';
import { fetchRate, FrankfurterOfflineError, FrankfurterError } from './frankfurter';
import { getRate, upsertRate } from '../db/repositories/fxRates';
import {
  recordFxFetch,
  recordFxError,
  recordFxCacheHit,
  recordFxPrefetch,
} from '../db/repositories/fxTelemetry';

// ── Integration enablement ─────────────────────────────────────────

/** Module-level flag; set via configureFxService. Defaults to enabled. */
let _integrationEnabled = true;

/**
 * Configure the FX service at runtime. Call this from the settings store
 * whenever the `fx_integration_enabled` setting changes.
 *
 * When `enabled` is `false`, every `lookupRate` call returns `null`
 * immediately without touching the cache or the network. This keeps
 * single-currency users and explicitly opted-out setups completely offline.
 */
export function configureFxService(opts: { enabled: boolean }): void {
  _integrationEnabled = opts.enabled;
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Look up the FX rate for a currency pair on a specific calendar date.
 *
 * `date` must be `YYYY-MM-DD`. When Frankfurter is reached for the first time
 * for a pair/date, the result is stored in the local cache.
 *
 * Returns `null` when the provider is unreachable or returns an error — the
 * caller is expected to fall back to existing local behavior (e.g. the NaN
 * sentinel in fx.ts).
 */
export async function lookupRate(
  base: string,
  target: string,
  date: string,
): Promise<FxRateRecord | null> {
  if (!_integrationEnabled) return null;

  if (base === target) {
    // Identity rate — no fetch needed.
    const identity: FxRateRecord = {
      base,
      target,
      date,
      rate: 1,
      effectiveDate: date,
      fetchedAt: new Date().toISOString(),
    };
    return identity;
  }

  // 1. Cache hit.
  try {
    const cached = await getRate(base, target, date);
    if (cached !== null) {
      recordFxCacheHit().catch(() => {});
      return cached;
    }
  } catch {
    // Cache read failure should not block a live fetch attempt.
  }

  // 2. Live fetch.
  try {
    const record = await fetchRate(base, target, date);
    const now = new Date().toISOString();
    // Persist to cache and record telemetry in the background.
    upsertRate(record).catch(() => {});
    recordFxFetch(now).catch(() => {});
    return record;
  } catch (err) {
    if (err instanceof FrankfurterOfflineError || err instanceof FrankfurterError) {
      // Non-fatal: the app continues to work without external data.
      const now = new Date().toISOString();
      recordFxError(now, err.message).catch(() => {});
      console.warn(
        `[fxRateService] Could not fetch rate ${base}→${target} on ${date}: ${err.message}`,
      );
      return null;
    }
    // Unexpected error — rethrow.
    throw err;
  }
}

/**
 * Look up the FX rate for a snapshot month (`YYYY-MM`).
 *
 * The canonical rule is: use the last calendar day of the given month and let
 * Frankfurter's business-day fallback return the nearest prior trading day's
 * rate. This keeps the resolution rule completely hidden from users — they
 * enter balances and the app resolves the correct rate automatically.
 */
export async function lookupMonthEndRate(
  base: string,
  target: string,
  yearMonth: string,
): Promise<FxRateRecord | null> {
  const lastDay = lastDayOfMonth(yearMonth);
  if (!lastDay) {
    console.warn(`[fxRateService] Invalid yearMonth format: "${yearMonth}" (expected YYYY-MM)`);
    return null;
  }
  return lookupRate(base, target, lastDay);
}

export interface FxPrefetchResult {
  needed: boolean;
  disabled: boolean;
  attempted: number;
  resolved: number;
  failed: number;
  /** Resolved rates keyed by base currency (base → rate to target). */
  rates: Record<string, number>;
}

/**
 * Warm month-end cache entries for the provided base currencies.
 * Uses the same cache-first lookup path and records prefetch telemetry counters.
 */
export async function prefetchMonthEndRates(
  baseCurrencies: string[],
  target: string,
  yearMonth: string,
): Promise<FxPrefetchResult> {
  const normalizedTarget = (target || '').trim().toUpperCase();
  const normalizedBases = [
    ...new Set(
      baseCurrencies
        .map((cur) => (cur || '').trim().toUpperCase())
        .filter((cur) => !!cur && cur !== normalizedTarget),
    ),
  ];
  if (normalizedBases.length === 0) {
    return { needed: false, disabled: false, attempted: 0, resolved: 0, failed: 0, rates: {} };
  }
  if (!_integrationEnabled) {
    return { needed: true, disabled: true, attempted: 0, resolved: 0, failed: 0, rates: {} };
  }
  if (!lastDayOfMonth(yearMonth)) {
    console.warn(`[fxRateService] Invalid yearMonth format: "${yearMonth}" (expected YYYY-MM)`);
    return { needed: true, disabled: false, attempted: 0, resolved: 0, failed: 0, rates: {} };
  }

  let resolved = 0;
  let failed = 0;
  const rates: Record<string, number> = {};
  for (const base of normalizedBases) {
    const rate = await lookupMonthEndRate(base, normalizedTarget, yearMonth);
    if (rate) {
      resolved += 1;
      rates[base] = rate.rate;
    } else {
      failed += 1;
    }
  }
  recordFxPrefetch(normalizedBases.length, resolved, failed).catch(() => {});

  return {
    needed: true,
    disabled: false,
    attempted: normalizedBases.length,
    resolved,
    failed,
    rates,
  };
}

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Returns the last calendar day of a `YYYY-MM` month as a `YYYY-MM-DD` string,
 * or `null` if the input is not a valid `YYYY-MM` string.
 */
export function lastDayOfMonth(yearMonth: string): string | null {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) return null;
  const [year, month] = yearMonth.split('-').map(Number);
  // Day 0 of the next month is the last day of the current month.
  const last = new Date(year, month, 0);
  if (isNaN(last.getTime())) return null;
  const mm = String(last.getMonth() + 1).padStart(2, '0');
  const dd = String(last.getDate()).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}
