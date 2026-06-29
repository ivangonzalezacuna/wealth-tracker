import type { Account, Snapshot } from '../types';

/** Returns an error string if the primary-investment flagging is invalid, else null. */
export function validatePrimaryInvestment(accounts: Account[]): string | null {
  const primary = accounts.filter(a => a.isPrimaryInvestment);
  if (primary.length > 1) {
    return 'Only one account can be the primary investment account.';
  }
  const bad = primary.find(a => (a.moneyType || '').toLowerCase() !== 'investment');
  if (bad) {
    return `"${bad.label || bad.id}" is marked primary investment but its type is not "investment".`;
  }
  return null;
}

/** Current market value of the primary investment account(s) from a snapshot. */
export function primaryInvestmentValue(snap: Snapshot | null, accounts: Account[]): number | null {
  if (!snap) return null;
  const primary = accounts.filter(a => a.isPrimaryInvestment);
  if (!primary.length) return null;
  return primary.reduce((sum, a) => sum + ((snap[a.id || ''] as number) || 0), 0) || null;
}
