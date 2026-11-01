import type { Database } from 'sql.js';
import type { Account, ContribInterval, Settings, Snapshot } from '../types';
import { validateAccountLifecycle, validateClosedPeriods } from '../model/accounts';
import {
  ETF_VALUATION_SCHEMA,
  isScopedValuationMode,
  validateSnapshotPositions,
} from '../model/snapshotPositions';

export const ACCOUNT_COLUMNS =
  'id, money_type, institution, country, "group", label, color, is_primary_investment, "order", annual_return_pct, contrib_amount, contrib_interval, locked, locked_until, extra_contrib, currency, closed_periods_json';
export const ACCOUNT_INSERT = `INSERT INTO accounts (${ACCOUNT_COLUMNS}) VALUES (${Array(17).fill('?').join(', ')})`;

export function accountValues(a: Account): (string | number)[] {
  return [
    a.id || a.key || '',
    a.moneyType || '',
    a.institution || '',
    a.country || '',
    a.group || '',
    a.label || '',
    a.color || '',
    a.isPrimaryInvestment ? 1 : 0,
    a.order ?? 0,
    a.annualReturnPct ?? 0,
    a.contribAmount ?? 0,
    a.contribInterval || 'monthly',
    a.locked ? 1 : 0,
    a.lockedUntil || '',
    a.extraContrib ?? 0,
    a.currency || 'EUR',
    JSON.stringify(a.closedPeriods || []),
  ];
}

export function readAccount(row: unknown[]): Account {
  const periods: unknown = JSON.parse(String(row[16] ?? '[]'));
  const error = validateClosedPeriods(periods);
  if (error) throw new Error(`Account ${row[0]}: ${error}`);
  return {
    id: String(row[0] ?? ''),
    moneyType: String(row[1] ?? ''),
    institution: String(row[2] ?? ''),
    country: String(row[3] ?? ''),
    group: String(row[4] ?? ''),
    label: String(row[5] ?? ''),
    color: String(row[6] ?? ''),
    isPrimaryInvestment: row[7] === 1 || row[7] === '1',
    order: Number(row[8]) || 0,
    annualReturnPct: Number(row[9]) || 0,
    contribAmount: Number(row[10]) || 0,
    contribInterval: (String(row[11] ?? 'monthly') as ContribInterval) || 'monthly',
    locked: row[12] === 1 || row[12] === '1',
    lockedUntil: String(row[13] ?? ''),
    extraContrib: Number(row[14]) || 0,
    currency: String(row[15] ?? 'EUR') || 'EUR',
    ...(Array.isArray(periods) && periods.length ? { closedPeriods: periods } : {}),
  };
}

export function readFinancialData(db: Database): {
  accounts: Account[];
  snapshots: Snapshot[];
  settings: Settings;
} {
  const accounts = (
    db.exec(`SELECT ${ACCOUNT_COLUMNS} FROM accounts ORDER BY "order" ASC`)[0]?.values || []
  ).map(readAccount);
  const snapshots = (
    db.exec('SELECT date, values_json, notes FROM snapshots ORDER BY date ASC')[0]?.values || []
  ).map((row): Snapshot => ({
    ...JSON.parse(String(row[1])),
    date: String(row[0]),
    notes: String(row[2] || ''),
  }));
  const settings = Object.fromEntries(
    (db.exec('SELECT key, value FROM settings')[0]?.values || []).map((row) => [
      String(row[0]),
      String(row[1] ?? ''),
    ]),
  );
  return { accounts, snapshots, settings };
}

export function validateFinancialData(data: {
  accounts: Account[];
  snapshots: Snapshot[];
  settings: Settings;
}): void {
  if (
    data.settings.etf_valuation_schema &&
    data.settings.etf_valuation_schema !== ETF_VALUATION_SCHEMA
  )
    throw new Error('Unsupported ETF valuation format. Update the app before using this data.');
  const lifecycleError = validateAccountLifecycle(data.accounts, data.snapshots);
  if (lifecycleError) throw new Error(lifecycleError);
  const scoped = isScopedValuationMode(data.settings);
  for (const snapshot of data.snapshots) {
    const error = validateSnapshotPositions(snapshot, data.accounts, scoped);
    if (error) throw new Error(error);
  }
}

export function validateSettingsChange(
  current: ReturnType<typeof readFinancialData>,
  settings: Settings,
): void {
  if (isScopedValuationMode(current.settings) && !isScopedValuationMode(settings))
    throw new Error('Account-linked ETF valuations cannot be switched back to the legacy format.');
  validateFinancialData({ ...current, settings });
}
