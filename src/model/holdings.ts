import type { EtfPosition, Holding } from '../types';
import { isValidISIN } from './isin';

/** Floating-point tolerance for treating shares as zero (-> exited). */
export const ZERO_THRESHOLD = 1e-6;

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

// ── Fee drag ──────────────────────────────────────────────────────

export interface FeeDragResult {
  /** Annual fee cost in EUR (sum of position_value * ter / 100). */
  annualCost: number;
  /** Annual fee cost as a fraction of total invested capital (0..1). */
  costPct: number;
  /** Number of positions that have a TER configured (ter > 0). */
  coveredCount: number;
}

/**
 * Compute annual fee drag from ETF positions and their configured TER values.
 *
 * For each held position, uses the market value when available, falling back
 * to cost basis. Positions without a TER on their Holding config are skipped.
 * Returns null when no holdings have a TER configured.
 */
export function computeFeeDrag(
  etfs: EtfPosition[],
  holdings: Holding[],
  snapEtfValues: Record<string, number>,
): FeeDragResult | null {
  const terMap = new Map<string, number>();
  for (const h of holdings) {
    if (h.ter && h.ter > 0) terMap.set(h.isin, h.ter);
  }

  if (terMap.size === 0) return null;

  let annualCost = 0;
  let totalBase = 0;
  let coveredCount = 0;

  for (const etf of etfs) {
    const ter = terMap.get(etf.isin);
    if (!ter) continue;
    // Prefer latest snapshot market value; fall back to cost basis
    const base = snapEtfValues[etf.isin] ?? etf.marketValue ?? etf.cost;
    if (!base || base <= 0) continue;
    annualCost += (base * ter) / 100;
    totalBase += base;
    coveredCount++;
  }

  if (coveredCount === 0) return null;

  return {
    annualCost,
    costPct: totalBase > 0 ? annualCost / totalBase : 0,
    coveredCount,
  };
}

// ── Holdings save-time validation ──────────────────────────────────

/** A short name should be a brief label for charts/legends.
 *  Letters, digits, spaces, dots, and hyphens only; 1-10 characters. */
const SHORT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 .\-]{0,9}$/;

export interface HoldingValidationError {
  index: number; // index into the holdings array (matches collectHoldings order)
  field: 'isin' | 'shortName';
  message: string;
}

/**
 * Validate a full holdings list before save. Checks, per row:
 *  - ISIN matches ISO 6166 shape (2 letters + 9 alphanumeric + 1 digit checksum position)
 *  - ISIN is unique across the list
 *  - shortName is short and identifier-shaped, not a free-text fund name
 * Returns a list of errors (empty = valid). Does not mutate input.
 */
export function validateHoldings(holdings: Holding[]): HoldingValidationError[] {
  const errors: HoldingValidationError[] = [];
  const seenIsin = new Map<string, number>(); // isin -> first index

  for (let i = 0; i < holdings.length; i++) {
    const h = holdings[i];

    // ISIN format
    if (!isValidISIN(h.isin)) {
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

    // Short name shape
    if (!SHORT_NAME_RE.test(h.shortName)) {
      errors.push({
        index: i,
        field: 'shortName',
        message: `Row ${i + 1}: Short name "${h.shortName}" must be 1-10 characters (letters, digits, spaces, dots, hyphens).`,
      });
    }
  }

  return errors;
}
