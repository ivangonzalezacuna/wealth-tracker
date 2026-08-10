import type { Transaction } from '../types';

export interface SecuritySuggestionPair {
  isin: string;
  name: string;
}

export interface SecuritySuggestions {
  pairs: SecuritySuggestionPair[];
}

export function normalizeInstitution(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function buildSecuritySuggestions(
  transactions: Transaction[] | undefined,
): SecuritySuggestions {
  const byIsin = new Map<string, SecuritySuggestionPair>();
  for (const tx of Array.isArray(transactions) ? transactions : []) {
    const isin = tx.isin.trim().toUpperCase();
    const name = (tx.name || '').trim();
    if (!isin || !name) continue;
    byIsin.set(isin, { isin, name });
  }
  return {
    pairs: [...byIsin.values()].sort((a, b) => a.isin.localeCompare(b.isin)),
  };
}

export function filterSecuritySuggestions(
  suggestions: SecuritySuggestions | undefined,
  existingIsins: string[] | undefined,
): SecuritySuggestions {
  const excluded = new Set(
    (Array.isArray(existingIsins) ? existingIsins : []).map((isin) => isin.trim().toUpperCase()),
  );
  if (excluded.size === 0) return { pairs: [...(suggestions?.pairs ?? [])] };
  return {
    pairs: (suggestions?.pairs ?? []).filter((pair) => !excluded.has(pair.isin)),
  };
}
