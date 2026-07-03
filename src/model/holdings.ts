import type { EtfPosition, Holding } from '../types';

/** Floating-point tolerance for treating shares as zero (-> exited). */
const ZERO_THRESHOLD = 1e-6;

interface HoldingLike {
  shares: number;
  exited?: boolean;
  [key: string]: unknown;
}

/**
 * Split an etf list into held and exited positions.
 * - `exited`: shares ~= 0 (fully sold).
 * - `held`: everything else, including inactive positions that still hold shares.
 */
export function splitHoldings<T extends HoldingLike>(etfList: T[]): { held: T[]; exited: T[] } {
  const held: T[] = [];
  const exited: T[] = [];

  for (const etf of etfList) {
    // A position is exited ONLY when shares ~= 0 (fully sold)
    const isExited =
      etf.exited === true || (etf.shares != null && Math.abs(etf.shares) < ZERO_THRESHOLD);
    if (isExited) {
      exited.push(etf);
    } else {
      held.push(etf);
    }
  }

  return { held, exited };
}

// ── Holdings save-time validation ──────────────────────────────────

/** ISO 6166: 2 uppercase letters (country code) + 9 alphanumeric chars + 1 numeric check digit. */
const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

/** A ticker should be a short identifier, not a fund name. Letters, digits,
 *  spaces, dots, and hyphens only; 1–10 characters. This intentionally
 *  rejects long descriptive strings like "MSCI EM USD" (11 chars, but the
 *  real-world failure mode is typically 15+ chars / multiple words) while
 *  still accepting legitimate multi-word-but-short tickers if any exist. */
const TICKER_RE = /^[A-Z0-9][A-Z0-9 .\-]{0,9}$/;

export interface HoldingValidationError {
  index: number; // index into the holdings array (matches collectHoldings order)
  field: 'isin' | 'ticker';
  message: string;
}

/**
 * Validate a full holdings list before save. Checks, per row:
 *  - ISIN matches ISO 6166 shape (2 letters + 9 alphanumeric + 1 digit checksum position)
 *  - ISIN is unique across the list
 *  - ticker is short and identifier-shaped, not a free-text fund name
 * Returns a list of errors (empty = valid). Does not mutate input.
 */
export function validateHoldings(holdings: Holding[]): HoldingValidationError[] {
  const errors: HoldingValidationError[] = [];
  const seenIsin = new Map<string, number>(); // isin -> first index

  for (let i = 0; i < holdings.length; i++) {
    const h = holdings[i];

    // ISIN format
    if (!ISIN_RE.test(h.isin)) {
      errors.push({
        index: i,
        field: 'isin',
        message: `Row ${i + 1}: ISIN "${h.isin}" is not a valid 12-character ISO 6166 identifier.`,
      });
    } else {
      // Duplicate check (only if format is valid)
      const prev = seenIsin.get(h.isin);
      if (prev !== undefined) {
        errors.push({
          index: i,
          field: 'isin',
          message: `Row ${i + 1}: duplicate ISIN "${h.isin}" (first seen in row ${prev + 1}).`,
        });
      } else {
        seenIsin.set(h.isin, i);
      }
    }

    // Ticker shape
    if (!TICKER_RE.test(h.ticker)) {
      errors.push({
        index: i,
        field: 'ticker',
        message: `Row ${i + 1}: Ticker "${h.ticker}" must be 1–10 characters (letters, digits, spaces, dots, hyphens).`,
      });
    }
  }

  return errors;
}
