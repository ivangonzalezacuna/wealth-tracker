import { loadTransactions } from './db';
import { buildSecuritySuggestions, type SecuritySuggestions } from './model/securitySuggestions';
import { getHoldings } from './store/config';
import type { Holding, Transaction } from './types';

function normalizeTransactions(transactions: Transaction[] | undefined): Transaction[] {
  return Array.isArray(transactions) ? transactions : [];
}

export function buildAppSecuritySuggestions(
  transactions: Transaction[] | undefined,
  holdings: Holding[] = getHoldings(),
): SecuritySuggestions {
  return buildSecuritySuggestions(holdings, normalizeTransactions(transactions));
}

export async function loadAppSecuritySuggestions(): Promise<{
  transactions: Transaction[];
  suggestions: SecuritySuggestions;
}> {
  const transactions = normalizeTransactions(await loadTransactions());
  return {
    transactions,
    suggestions: buildAppSecuritySuggestions(transactions),
  };
}
