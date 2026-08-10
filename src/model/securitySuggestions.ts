import type { Holding, Transaction } from '../types';

export interface SecuritySuggestions {
  isins: string[];
  names: string[];
}

export function normalizeInstitution(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function buildSecuritySuggestions(
  holdings: Holding[] | undefined,
  transactions: Transaction[] | undefined,
): SecuritySuggestions {
  const isinSet = new Set<string>();
  const nameSet = new Set<string>();
  for (const h of Array.isArray(holdings) ? holdings : []) {
    if (h.isin) isinSet.add(h.isin.trim().toUpperCase());
    const name = (h.name || h.shortName || '').trim();
    if (name) nameSet.add(name);
  }
  for (const tx of Array.isArray(transactions) ? transactions : []) {
    if (tx.isin) isinSet.add(tx.isin.trim().toUpperCase());
    const name = (tx.name || '').trim();
    if (name) nameSet.add(name);
  }
  return { isins: [...isinSet].sort(), names: [...nameSet].sort() };
}
