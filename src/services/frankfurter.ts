/**
 * Frankfurter provider — pure HTTP fetcher for historical and latest FX rates.
 *
 * This module has no side effects: it only fetches from the Frankfurter API
 * and returns typed records. Caching and persistence are handled by
 * fxRateService.ts, not here.
 *
 * Frankfurter (https://frankfurter.dev) is ECB-backed and requires no API key.
 * On non-trading days (weekends, ECB holidays) the API silently returns the
 * most recent available rate and reflects the actual date in `effectiveDate`.
 *
 * Rate limits: no documented hard limit; the project treats this as an
 * on-demand helper (never background-polled) so usage is inherently bounded.
 */

import type { FxRateRecord } from '../types';

/** Base URL for the Frankfurter API. Overridable for testing. */
export const FRANKFURTER_BASE_URL = 'https://api.frankfurter.dev';

// ── Error types ────────────────────────────────────────────────────

export class FrankfurterError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'FrankfurterError';
  }
}

export class FrankfurterOfflineError extends FrankfurterError {
  constructor(cause?: unknown) {
    super(
      cause instanceof Error ? `Network error: ${cause.message}` : 'Network unavailable',
      undefined,
    );
    this.name = 'FrankfurterOfflineError';
  }
}

// ── Expected API response shapes ───────────────────────────────────

interface FrankfurterResponse {
  /** The base currency used for the conversion (e.g. "USD"). */
  base: string;
  /** The date of the rates, which may differ from the requested date. */
  date: string;
  /** Map from target currency code to rate value. */
  rates: Record<string, number>;
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Fetch the FX rate for a currency pair on a specific date.
 *
 * - Pass `"latest"` as `date` to retrieve the most recent available rate.
 * - For historical dates, pass a `YYYY-MM-DD` string. Frankfurter will return
 *   the rate for the nearest prior trading day when the requested date is a
 *   weekend or ECB holiday; `effectiveDate` in the returned record will
 *   reflect that actual date.
 *
 * Throws `FrankfurterOfflineError` on network failure and `FrankfurterError`
 * on HTTP errors or unexpected response shapes.
 */
export async function fetchRate(
  base: string,
  target: string,
  date: string,
  baseUrl: string = FRANKFURTER_BASE_URL,
): Promise<FxRateRecord> {
  const path = date === 'latest' ? 'latest' : date;
  const url = `${baseUrl}/${path}?from=${encodeURIComponent(base)}&to=${encodeURIComponent(target)}`;

  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new FrankfurterOfflineError(err);
  }

  if (!response.ok) {
    throw new FrankfurterError(
      `Frankfurter returned HTTP ${response.status} for ${base}/${target} on ${date}`,
      response.status,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new FrankfurterError('Frankfurter response was not valid JSON');
  }

  return parseFrankfurterResponse(base, target, date, body);
}

// ── Helpers ────────────────────────────────────────────────────────

function parseFrankfurterResponse(
  base: string,
  target: string,
  requestedDate: string,
  body: unknown,
): FxRateRecord {
  if (
    !body ||
    typeof body !== 'object' ||
    !('rates' in body) ||
    typeof (body as Record<string, unknown>).date !== 'string'
  ) {
    throw new FrankfurterError('Unexpected Frankfurter response shape');
  }

  const resp = body as FrankfurterResponse;
  const rate = resp.rates[target];
  if (typeof rate !== 'number' || !isFinite(rate) || rate <= 0) {
    throw new FrankfurterError(
      `Frankfurter response missing or invalid rate for target currency "${target}"`,
    );
  }

  return {
    base,
    target,
    date: requestedDate === 'latest' ? resp.date : requestedDate,
    rate,
    effectiveDate: resp.date,
    fetchedAt: new Date().toISOString(),
  };
}
