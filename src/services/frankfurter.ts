/**
 * Frankfurter provider — pure HTTP fetcher for historical and latest FX rates.
 *
 * This module has no side effects: it only fetches from the Frankfurter API
 * and returns typed records. Caching and persistence are handled by
 * fxRateService.ts, not here.
 *
 * Frankfurter v2 (https://frankfurter.dev) is a multi-provider blended API and
 * requires no API key. On non-trading days the API returns the most recent
 * available rate; `effectiveDate` in the returned record reflects the actual date.
 *
 * Single-pair endpoint: GET /v2/rate/{base}/{quote}[?date=YYYY-MM-DD]
 * Response: a single Rate object — { date, base, quote, rate }.
 * Without a date param the latest rate is returned.
 *
 * Rate limits: no documented hard limit; the project treats this as an
 * on-demand helper (never background-polled) so usage is inherently bounded.
 */

import type { FxRateRecord } from '../types';

/** Base URL for the Frankfurter v2 API. Overridable for testing. */
export const FRANKFURTER_BASE_URL = 'https://api.frankfurter.dev/v2';

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

// ── Expected API response shape ────────────────────────────────────

/** Single-pair Rate object returned by GET /v2/rate/{base}/{quote}. */
interface FrankfurterRateResponse {
  date: string;
  base: string;
  quote: string;
  rate: number;
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Fetch the FX rate for a currency pair on a specific date using the
 * Frankfurter v2 single-pair endpoint (`GET /v2/rate/{base}/{quote}`).
 *
 * - Pass `"latest"` as `date` to retrieve the most recent available rate
 *   (no `date=` parameter is sent).
 * - For historical dates, pass a `YYYY-MM-DD` string. Frankfurter will return
 *   the rate for the nearest prior trading day when the requested date is a
 *   weekend or holiday; `effectiveDate` in the returned record will reflect
 *   that actual date.
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
  let url = `${baseUrl}/rate/${encodeURIComponent(base)}/${encodeURIComponent(target)}`;
  if (date !== 'latest') url += `?date=${encodeURIComponent(date)}`;

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
    typeof (body as Record<string, unknown>).date !== 'string' ||
    typeof (body as Record<string, unknown>).rate !== 'number'
  ) {
    throw new FrankfurterError('Unexpected Frankfurter response shape');
  }

  const { date: effectiveDate, rate } = body as FrankfurterRateResponse;

  if (!isFinite(rate) || rate <= 0) {
    throw new FrankfurterError(
      `Frankfurter response has invalid rate for target currency "${target}"`,
    );
  }

  return {
    base,
    target,
    date: requestedDate === 'latest' ? effectiveDate : requestedDate,
    rate,
    effectiveDate,
    fetchedAt: new Date().toISOString(),
  };
}
