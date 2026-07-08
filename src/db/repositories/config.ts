/**
 * Config repository - CRUD for accounts, holdings, and settings tables.
 * Mirrors the persistence API of the old store/config.ts module.
 */

import { getDb, persistDb } from '../connection';
import type { Account, Holding, Settings, ContribInterval } from '../../types';

// ── Accounts ──────────────────────────────────────────────────────

/** Load all accounts, sorted by order. */
export async function loadAccounts(): Promise<Account[]> {
  const db = await getDb();
  const result = db.exec(
    'SELECT id, money_type, institution, label, color, is_primary_investment, "order", annual_return_pct, contrib_amount, contrib_interval FROM accounts ORDER BY "order" ASC',
  );
  if (result.length === 0) return [];
  return result[0].values.map(rowToAccount);
}

/** Save accounts (full replace). */
export async function saveAccounts(accounts: Account[]): Promise<void> {
  const db = await getDb();
  db.run('DELETE FROM accounts');
  const stmt = db.prepare(
    'INSERT INTO accounts (id, money_type, institution, label, color, is_primary_investment, "order", annual_return_pct, contrib_amount, contrib_interval) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  for (const a of accounts) {
    stmt.run([
      a.id || a.key || '',
      a.moneyType || '',
      a.institution || '',
      a.label || '',
      a.color || '',
      a.isPrimaryInvestment ? 1 : 0,
      a.order ?? 0,
      a.annualReturnPct ?? 0,
      a.contribAmount ?? 0,
      a.contribInterval || 'monthly',
    ]);
  }
  stmt.free();
  await persistDb();
}

// ── Holdings ──────────────────────────────────────────────────────

/** Load all holdings, sorted by order. */
export async function loadHoldings(): Promise<Holding[]> {
  const db = await getDb();
  const result = db.exec(
    'SELECT isin, name, short_name, color, acc, active, contrib_amount, contrib_interval, asset_class, region, fold_into, "order" FROM holdings ORDER BY "order" ASC',
  );
  if (result.length === 0) return [];
  return result[0].values.map(rowToHolding);
}

/** Save holdings (full replace). */
export async function saveHoldings(holdings: Holding[]): Promise<void> {
  const db = await getDb();
  db.run('DELETE FROM holdings');
  const stmt = db.prepare(
    'INSERT INTO holdings (isin, name, short_name, color, acc, active, contrib_amount, contrib_interval, asset_class, region, fold_into, "order") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  for (const h of holdings) {
    stmt.run([
      h.isin,
      h.name || '',
      h.shortName || '',
      h.color || '',
      h.acc ? 1 : 0,
      h.active ? 1 : 0,
      h.contribAmount ?? 0,
      h.contribInterval || 'weekly',
      h.assetClass || '',
      h.region || '',
      h.foldInto || '',
      h.order ?? 0,
    ]);
  }
  stmt.free();
  await persistDb();
}

// ── Settings ──────────────────────────────────────────────────────

/** Load all settings as a key-value object. */
export async function loadSettings(): Promise<Settings> {
  const db = await getDb();
  const result = db.exec('SELECT key, value FROM settings');
  if (result.length === 0) return {};
  const settings: Settings = {};
  for (const row of result[0].values) {
    settings[String(row[0])] = String(row[1] ?? '');
  }
  return settings;
}

/** Set a single setting. */
export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
  await persistDb();
}

/** Delete a single setting. */
export async function deleteSetting(key: string): Promise<void> {
  const db = await getDb();
  db.run('DELETE FROM settings WHERE key = ?', [key]);
  await persistDb();
}

/** Full replace of all settings (backup restore). */
export async function replaceAllSettings(settings: Settings): Promise<void> {
  const db = await getDb();
  db.run('DELETE FROM settings');
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(settings)) {
    if (v !== null && v !== undefined) {
      stmt.run([k, String(v)]);
    }
  }
  stmt.free();
  await persistDb();
}

// ── Config history (audit log) ────────────────────────────────────

/** Append an audit log entry. */
export async function logConfigChange(entity: string, summary: string): Promise<void> {
  const db = await getDb();
  const timestamp = new Date().toISOString();
  db.run('INSERT INTO config_history (timestamp, source, entity, summary) VALUES (?, ?, ?, ?)', [
    timestamp,
    'web',
    entity,
    summary,
  ]);
  await persistDb();
}

// ── Internal helpers ──────────────────────────────────────────────

function rowToAccount(row: unknown[]): Account {
  return {
    id: String(row[0] ?? ''),
    moneyType: String(row[1] ?? ''),
    institution: String(row[2] ?? ''),
    label: String(row[3] ?? ''),
    color: String(row[4] ?? ''),
    isPrimaryInvestment: row[5] === 1 || row[5] === '1',
    order: Number(row[6]) || 0,
    annualReturnPct: Number(row[7]) || 0,
    contribAmount: Number(row[8]) || 0,
    contribInterval: (String(row[9] ?? 'monthly') as ContribInterval) || 'monthly',
  };
}

function rowToHolding(row: unknown[]): Holding {
  return {
    isin: String(row[0] ?? ''),
    name: String(row[1] ?? ''),
    shortName: String(row[2] ?? ''),
    color: String(row[3] ?? ''),
    acc: row[4] === 1 || row[4] === '1',
    active: row[5] === 1 || row[5] === '1',
    contribAmount: Number(row[6]) || 0,
    contribInterval: (String(row[7] ?? 'weekly') as ContribInterval) || 'weekly',
    assetClass: String(row[8] ?? ''),
    region: String(row[9] ?? ''),
    foldInto: String(row[10] ?? ''),
    order: Number(row[11]) || 0,
  };
}
