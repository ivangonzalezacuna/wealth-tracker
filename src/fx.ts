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
 * emitted and the raw amount is returned as a fallback. This makes the problem
 * visible rather than silently producing wrong numbers.
 */

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
 *   or non-finite, a warning is emitted and the raw value is returned so that
 *   the error is surfaced rather than silently ignored.
 */
export function toBase(amount: number, currency: string, fxRate: number): number {
  const cur = currency || APP_CURRENCY;
  if (cur === APP_CURRENCY) return amount;
  if (!fxRate || fxRate <= 0 || !isFinite(fxRate)) {
    console.warn(
      `[FX] Non-base transaction (${cur}) has invalid fxRate=${fxRate}; ` +
        `using raw amount — portfolio calculations may be incorrect.`,
    );
    return amount;
  }
  return amount * fxRate;
}
