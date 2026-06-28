import type { EtfPosition } from '../types';

/** Floating-point tolerance for treating shares as zero (-> exited). */
const ZERO_THRESHOLD = 1e-6;

interface HoldingLike {
  shares: number;
  exited?: boolean;
  [key: string]: unknown;
}

/**
 * Split an etf list into held and exited positions.
 * Pure function — no side effects.
 *
 * - `exited`: positions with shares ~= 0 (fully sold).
 * - `held`: everything else, including `active:false` positions that still have shares > 0.
 */
export function splitHoldings<T extends HoldingLike>(etfList: T[]): { held: T[]; exited: T[] } {
  const held: T[] = [];
  const exited: T[] = [];

  for (const etf of etfList) {
    // A position is exited ONLY when shares ~= 0 (fully sold)
    const isExited = etf.exited === true || (etf.shares != null && Math.abs(etf.shares) < ZERO_THRESHOLD);
    if (isExited) {
      exited.push(etf);
    } else {
      held.push(etf);
    }
  }

  return { held, exited };
}
