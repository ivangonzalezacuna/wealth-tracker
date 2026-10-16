import type { Account } from '../types';
import type { SnapshotStatement } from './snapshotStatement';
import { getSnapshotParser } from './snapshotParsers';
import { validateSnapshotMapping, type SnapshotMapping } from './snapshotMapping';

export interface SnapshotProposal {
  key: string;
  label: string;
  value: number;
  isin?: string;
}

export function validateStatementMonth(
  date: string,
  month: string,
  current: string,
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'A verified valuation date is required.';
  const [year, mm, day] = date.split('-').map(Number);
  if (mm < 1 || mm > 12 || day !== new Date(Date.UTC(year, mm, 0)).getUTCDate())
    return 'Only month-end statement valuations can be imported.';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month >= current)
    return 'Choose a completed snapshot month.';
  if (date.slice(0, 7) !== month)
    return 'Statement date does not match the snapshot month. Select the document month explicitly.';
  return null;
}

export function proposeStatement(
  statement: SnapshotStatement,
  accounts: Account[],
  mode: 'positions' | 'combined' | 'split',
  primaryKey: string,
  cashKey: string,
): SnapshotProposal[] {
  const primary = accounts.find((a) => (a.id || a.key) === primaryKey);
  if (!primary?.isPrimaryInvestment || primary.moneyType?.toLowerCase() !== 'investment')
    throw new Error('Select the configured primary investment account for ETF values.');
  const reserved = new Set(accounts.map((a) => a.id || a.key));
  const proposals: SnapshotProposal[] = statement.positions.map((p) => {
    if (reserved.has(`etf_${p.isin}`))
      throw new Error('An ETF identifier conflicts with a configured account key.');
    return { key: `etf_${p.isin}`, isin: p.isin, label: p.name, value: p.value };
  });
  if (mode === 'positions') return proposals;
  if (mode === 'combined') {
    if (statement.total === undefined)
      throw new Error('A verified combined total is unavailable. Choose positions only.');
    proposals.unshift({
      key: primaryKey,
      label: `${primary.label}: securities + cash`,
      value: statement.total,
    });
  } else {
    const cash = accounts.find((a) => (a.id || a.key) === cashKey);
    if (
      !cash ||
      cashKey === primaryKey ||
      !['cash', 'savings'].includes((cash.moneyType || '').toLowerCase())
    )
      throw new Error('Select a separate cash or savings account.');
    if (statement.securities === undefined || statement.cash === undefined)
      throw new Error(
        'Verified securities and cash totals are unavailable. Choose positions only.',
      );
    proposals.unshift(
      { key: primaryKey, label: `${primary.label}: securities only`, value: statement.securities },
      { key: cashKey, label: `${cash.label}: cash only`, value: statement.cash },
    );
  }

  return proposals;
}

export function proposeMappedStatement(
  statement: SnapshotStatement,
  accounts: Account[],
  mapping: SnapshotMapping,
): SnapshotProposal[] {
  mapping = validateSnapshotMapping(mapping, accounts, statement.documentType);
  if (mapping.mode !== 'balances') {
    const partial =
      statement.securities === undefined ||
      statement.cash === undefined ||
      statement.total === undefined;
    return proposeStatement(
      statement,
      accounts,
      partial ? 'positions' : mapping.mode,
      mapping.securitiesAccount,
      mapping.cashAccount || '',
    );
  }
  const schema = getSnapshotParser(statement.documentType).mapping;
  if (schema.kind !== 'balances') throw new Error('This report requires an investment mapping.');
  return schema.slots.map((slot) => {
    const value = statement.balances?.[slot.key];
    if (value === undefined || !Number.isFinite(value))
      throw new Error(`A verified ${slot.label} balance is unavailable. No values filled.`);
    return { key: mapping.balanceAccounts[slot.key], label: slot.label, value };
  });
}
