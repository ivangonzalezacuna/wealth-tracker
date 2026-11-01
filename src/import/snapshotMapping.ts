import type { Account } from '../types';
import { getSnapshotParser } from './snapshotParsers';
import { isAccountClosedInMonth } from '../model/accounts';

export const SNAPSHOT_MAPPINGS_KEY = 'snapshot_import_mappings';
export const TRADE_REPUBLIC_VALUATION = 'trade-republic:valuation';
export type SnapshotMappingMode = 'positions' | 'combined' | 'split';
interface InvestmentMapping {
  mode: SnapshotMappingMode;
  securitiesAccount: string;
  cashAccount?: string;
}
interface BalanceMapping {
  mode: 'balances';
  balanceAccounts: Record<string, string>;
  securitiesAccount?: never;
  cashAccount?: never;
}
export type SnapshotMapping = InvestmentMapping | BalanceMapping;
interface MappingSettings {
  version: 1;
  mappings: Record<string, unknown>;
}

function decode(raw?: string | null): MappingSettings {
  if (!raw) return { version: 1, mappings: {} };
  const parsed: unknown = JSON.parse(raw);
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('version' in parsed) ||
    parsed.version !== 1 ||
    !('mappings' in parsed) ||
    !parsed.mappings ||
    typeof parsed.mappings !== 'object' ||
    Array.isArray(parsed.mappings)
  )
    throw new Error(
      'Statement import preferences are invalid or use an unsupported version. Reset this mapping in Settings.',
    );
  return { version: 1, mappings: { ...parsed.mappings } };
}

export function validateSnapshotMapping(
  value: unknown,
  accounts: Account[],
  type = TRADE_REPUBLIC_VALUATION,
  month?: string,
): SnapshotMapping {
  const schema = getSnapshotParser(type).mapping;
  if (schema.kind === 'balances') {
    if (
      !value ||
      typeof value !== 'object' ||
      !('mode' in value) ||
      value.mode !== 'balances' ||
      !('balanceAccounts' in value) ||
      !value.balanceAccounts ||
      typeof value.balanceAccounts !== 'object' ||
      Array.isArray(value.balanceAccounts)
    )
      throw new Error('Set up the statement account mapping.');
    const balanceAccounts: Record<string, string> = {};
    const used = new Set<string>();
    for (const slot of schema.slots) {
      const key: unknown = Object.getOwnPropertyDescriptor(value.balanceAccounts, slot.key)?.value;
      const account = accounts.find((a) => (a.id || a.key) === key);
      if (
        typeof key !== 'string' ||
        !account ||
        (month && isAccountClosedInMonth(account, month)) ||
        !slot.moneyTypes.includes((account.moneyType || '').toLowerCase()) ||
        used.has(key)
      )
        throw new Error(`Choose a distinct eligible account for ${slot.label}.`);
      used.add(key);
      balanceAccounts[slot.key] = key;
    }
    return { mode: 'balances', balanceAccounts };
  }
  if (
    !value ||
    typeof value !== 'object' ||
    !('mode' in value) ||
    (value.mode !== 'positions' && value.mode !== 'combined' && value.mode !== 'split') ||
    !('securitiesAccount' in value) ||
    typeof value.securitiesAccount !== 'string'
  )
    throw new Error('Set up the statement account mapping.');
  const primary = accounts.find((a) => (a.id || a.key) === value.securitiesAccount);
  if (!primary || primary.moneyType?.toLowerCase() !== 'investment')
    throw new Error(
      'The saved securities account is no longer an investment account. Update the mapping.',
    );
  if (month && isAccountClosedInMonth(primary, month))
    throw new Error('The securities account is closed in the statement month. Update the mapping.');
  const mode = value.mode;
  if (mode !== 'split') return { mode, securitiesAccount: value.securitiesAccount };
  const cashId = 'cashAccount' in value ? value.cashAccount : undefined;
  const cash = accounts.find((a) => (a.id || a.key) === cashId);
  if (
    typeof cashId !== 'string' ||
    !cash ||
    (month && isAccountClosedInMonth(cash, month)) ||
    cashId === value.securitiesAccount ||
    !['cash', 'savings'].includes((cash.moneyType || '').toLowerCase())
  )
    throw new Error('Choose a separate cash or savings account for the cash balance.');
  return { mode, securitiesAccount: value.securitiesAccount, cashAccount: cashId };
}

export function getSnapshotMapping(
  raw: string | null | undefined,
  type: string,
  accounts: Account[],
): SnapshotMapping | undefined {
  let settings: MappingSettings;
  try {
    settings = decode(raw);
  } catch {
    throw new Error(
      'Statement import preferences could not be read. Reset or replace the mapping in Settings.',
    );
  }
  const mapping = settings.mappings[type];
  return mapping === undefined ? undefined : validateSnapshotMapping(mapping, accounts, type);
}

export function updateSnapshotMapping(
  raw: string | null | undefined,
  type: string,
  mapping: SnapshotMapping | null,
  accounts: Account[],
): string {
  // A corrupt root cannot safely preserve other entries: require an explicit reset.
  const settings = decode(raw);
  if (mapping) settings.mappings[type] = validateSnapshotMapping(mapping, accounts, type);
  else delete settings.mappings[type];
  return JSON.stringify(settings);
}
