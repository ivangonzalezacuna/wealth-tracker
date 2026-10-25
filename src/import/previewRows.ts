/**
 * Row classification for the CSV import preview: whether each parsed row is new or already
 * stored, which rows need attention, and which new SELLs would sell more shares than held.
 */
import { TxType } from '../types';
import type { Transaction } from '../types';
import { isAmended, txKey } from '../db/repositories/transactions';
import { ZERO_THRESHOLD } from '../model/holdings';

/** `duplicate` and `changed` rows are already stored; the append-only merge skips them. */
export type PreviewRowStatus = 'new' | 'duplicate' | 'changed';
export type PreviewIssue = 'unmapped' | 'number' | 'oversell';

export interface PreviewRow {
  /** Position in the parsed file (stable key for selection). */
  idx: number;
  tx: Transaction;
  status: PreviewRowStatus;
  unmapped: boolean;
  numberError: boolean;
}

const CANONICAL_TYPES = new Set<string>(Object.values(TxType));

export function isCanonicalType(type: string): boolean {
  return CANONICAL_TYPES.has(type);
}

export function classifyPreviewRows(
  existing: Transaction[],
  incoming: Transaction[],
  numberErrorRows?: ReadonlySet<Transaction>,
): PreviewRow[] {
  const stored = new Map(existing.map((t) => [txKey(t), t]));
  return incoming.map((tx, idx) => {
    const match = stored.get(txKey(tx));
    return {
      idx,
      tx,
      status: !match ? 'new' : isAmended(match, tx) ? 'changed' : 'duplicate',
      unmapped: !isCanonicalType(tx.type),
      numberError: !!numberErrorRows?.has(tx),
    };
  });
}

/** Rows that start excluded: unknown types would otherwise be stored under their raw name. */
export function defaultExcluded(rows: PreviewRow[]): Set<number> {
  return new Set(rows.filter((r) => r.status === 'new' && r.unmapped).map((r) => r.idx));
}

/**
 * Incoming SELLs that would sell more shares than are held once merged with the stored
 * ledger (the cost-basis engine rejects those). Share counts do not depend on the cost-basis
 * method, so a per-ISIN running total is enough. When an already stored SELL is pushed into
 * an oversell by an earlier incoming SELL, those incoming SELLs are flagged instead.
 */
export function findOversells(existing: Transaction[], incoming: Transaction[]): Set<Transaction> {
  const incomingSet = new Set(incoming);
  const merged = [...existing, ...incoming].sort((a, b) => a.date.localeCompare(b.date));
  const held = new Map<string, number>();
  const incomingSells = new Map<string, Transaction[]>();
  const flagged = new Set<Transaction>();
  for (const tx of merged) {
    const isin = tx.isin;
    if (!isin) continue;
    const shares = held.get(isin) ?? 0;
    if (tx.type === TxType.BUY) {
      const n = Math.abs(tx.shares || 0);
      if (n > 0) held.set(isin, shares + n);
    } else if (tx.type === TxType.SPLIT) {
      const ratio = Number(tx.shares);
      if (Number.isFinite(ratio) && ratio > ZERO_THRESHOLD && shares > 0)
        held.set(isin, shares * ratio);
    } else if (tx.type === TxType.SELL) {
      const n = Math.abs(tx.shares || 0);
      if (n <= 0) continue;
      if (incomingSet.has(tx)) {
        if (n > shares + ZERO_THRESHOLD) {
          flagged.add(tx);
          continue;
        }
        const list = incomingSells.get(isin) ?? [];
        list.push(tx);
        incomingSells.set(isin, list);
      } else if (n > shares + ZERO_THRESHOLD) {
        for (const sell of incomingSells.get(isin) ?? []) flagged.add(sell);
        continue;
      }
      held.set(isin, Math.max(0, shares - n));
    }
  }
  return flagged;
}
