import { loadTransactions } from './db';
import {
  buildSecuritySuggestions,
  filterSecuritySuggestions,
  type SecuritySuggestions,
} from './model/securitySuggestions';
import type { Transaction } from './types';

export function buildAppSecuritySuggestions(
  transactions: Transaction[] | undefined,
): SecuritySuggestions {
  return buildSecuritySuggestions(transactions);
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
  const loadedTransactions = await loadTransactions();
  const transactions = Array.isArray(loadedTransactions) ? loadedTransactions : [];
  return {
    transactions,
    suggestions: buildAppSecuritySuggestions(transactions),
  };
}
