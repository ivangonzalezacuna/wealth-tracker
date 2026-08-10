import { loadTransactions } from './db';
import {
  buildSecuritySuggestions,
  filterSecuritySuggestions,
  type SecuritySuggestions,
} from './model/securitySuggestions';
import type { Transaction } from './types';

function normalizeTransactions(transactions: Transaction[] | undefined): Transaction[] {
  return Array.isArray(transactions) ? transactions : [];
}

export function buildAppSecuritySuggestions(
  transactions: Transaction[] | undefined,
): SecuritySuggestions {
  return buildSecuritySuggestions(normalizeTransactions(transactions));
}

export function buildHoldingSecuritySuggestions(
  transactions: Transaction[] | undefined,
  existingIsins: string[] | undefined,
): SecuritySuggestions {
  return filterSecuritySuggestions(buildAppSecuritySuggestions(transactions), existingIsins);
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
