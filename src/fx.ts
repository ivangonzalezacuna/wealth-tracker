/**
 * ─── FX normalization ────────────────────────────────────────────────────────
 *
 * The app operates with one canonical calculation/display currency (APP_CURRENCY).
 * Transactions in other currencies carry `fxRate` — the multiplier that converts
 * one unit of `transaction.currency` into one unit of APP_CURRENCY.
 *
 * Example: a USD transaction with fxRate = 0.92 means 1 USD → 0.92 EUR.
 *   amountInBase = amount * fxRate
 *
 * When fxRate is missing or invalid for a non-base transaction, a warning is
 * emitted and NaN is returned so callers must handle bad data explicitly.
 *
 * ─── External FX lookup ──────────────────────────────────────────────────────
 *
 * `resolveRate` and `resolveMonthEndRate` delegate to the fxRateService, which
 * checks the local SQLite cache first and falls back to Frankfurter on a miss.
 * Both return `null` when offline or when the provider is unavailable, so
 * callers must handle the null case and fall back to their own logic.
 *
 * FUTURE INTEGRATION POINT: snapshot save — when snapshot normalization is
 * wired up (Phase 4), call `resolveMonthEndRate(accountCurrency, APP_CURRENCY,
 * snapshotYearMonth)` during snapshot storage to obtain the FX context that
 * converts the account-currency balance to the reporting currency.
 */

import { lookupRate, lookupMonthEndRate } from './services/fxRateService';
import type { FxRateRecord } from './types';

/** Canonical calculation and display currency for the app. */
export const APP_CURRENCY = 'EUR';

/**
 * Convert a monetary value from `currency` to APP_CURRENCY using `fxRate`.
 *
 * - If `currency` matches APP_CURRENCY (or is empty/falsy), the value is
 *   returned as-is — no conversion needed.
 * - If `currency` differs from APP_CURRENCY and `fxRate` is a valid positive
 *   finite number, the value is multiplied by `fxRate`.
 * - If `currency` differs from APP_CURRENCY but `fxRate` is zero, negative,
 *   or non-finite, a warning is emitted and NaN is returned.
 */
export function toBase(amount: number, currency: string, fxRate: number): number {
  const cur = currency || APP_CURRENCY;
  if (cur === APP_CURRENCY) return amount;
  if (!fxRate || fxRate <= 0 || !isFinite(fxRate)) {
    console.warn(
      `[FX] Non-base transaction (${cur}) has invalid fxRate=${fxRate}; ` +
        `using NaN sentinel — portfolio calculations may be incorrect.`,
    );
    return Number.NaN;
  }
  return amount * fxRate;
}

/**
 * Resolve the FX rate for a currency pair on a specific calendar date via the
 * cache-first fxRateService. Returns `null` when the provider is unreachable
 * or returns an error — callers should degrade gracefully.
 *
 * When `currency` equals `APP_CURRENCY` the function returns `null`
 * immediately: no conversion is needed, so no lookup is performed.
 */
export async function resolveRate(currency: string, date: string): Promise<FxRateRecord | null> {
  const cur = currency || APP_CURRENCY;
  if (cur === APP_CURRENCY) return null;
  return lookupRate(cur, APP_CURRENCY, date);
}

/**
 * Resolve the month-end FX rate for a currency pair for a given `YYYY-MM`
 * snapshot month. Returns `null` when the provider is unreachable.
 *
 * When `currency` equals `APP_CURRENCY` the function returns `null`
 * immediately.
 */
export async function resolveMonthEndRate(
  currency: string,
  yearMonth: string,
): Promise<FxRateRecord | null> {
  const cur = currency || APP_CURRENCY;
  if (cur === APP_CURRENCY) return null;
  return lookupMonthEndRate(cur, APP_CURRENCY, yearMonth);
}
