import type { Holding, Transaction } from '../types';

export interface KnownSecurityPair {
  isin: string;
  name: string;
}

export interface KnownSecuritySuggestions {
  pairs: KnownSecurityPair[];
  byIsin: Record<string, KnownSecurityPair>;
  byName: Record<string, KnownSecurityPair>;
}

function normalizeIsin(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function normalizeInstitution(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function buildKnownSecuritySuggestions(
  holdings: Holding[] | undefined,
  transactions: Transaction[] | undefined,
): KnownSecuritySuggestions {
  const byIsin = new Map<string, KnownSecurityPair>();
  const byName = new Map<string, KnownSecurityPair>();

  const addPair = (isinRaw: string, nameRaw: string): void => {
    const isin = normalizeIsin(isinRaw);
    const name = nameRaw.trim().replace(/\s+/g, ' ');
    const nameKey = normalizeName(name);
    if (!isin || !name || !nameKey) return;

    const existingByIsin = byIsin.get(isin);
    if (!existingByIsin) byIsin.set(isin, { isin, name });
    const canonical = byIsin.get(isin)!;

    if (!byName.has(nameKey)) byName.set(nameKey, canonical);
  };

  for (const holding of Array.isArray(holdings) ? holdings : []) {
    addPair(holding.isin || '', holding.name || holding.shortName || '');
  }
  for (const tx of Array.isArray(transactions) ? transactions : []) {
    addPair(tx.isin || '', tx.name || '');
  }

  const pairs = Array.from(byIsin.values()).sort((a, b) => a.name.localeCompare(b.name));
  const byIsinRecord: Record<string, KnownSecurityPair> = {};
  const byNameRecord: Record<string, KnownSecurityPair> = {};
  for (const pair of pairs) byIsinRecord[pair.isin] = pair;
  for (const [key, pair] of byName.entries()) byNameRecord[key] = pair;
  return { pairs, byIsin: byIsinRecord, byName: byNameRecord };
}

export function normalizeSuggestionName(value: string): string {
  return normalizeName(value);
}
