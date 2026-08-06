/**
 * Config repository - CRUD for accounts, holdings, and settings tables.
 * Mirrors the persistence API of the old store/config.ts module.
 */

import { getDb, persistDb } from '../connection';
import type {
  Account,
  Holding,
  Settings,
  ContribInterval,
  Snapshot,
  Transaction,
} from '../../types';

// ── Accounts ──────────────────────────────────────────────────────

/** Load all accounts, sorted by order. */
export async function loadAccounts(): Promise<Account[]> {
  const db = await getDb();
  const result = db.exec(
    'SELECT id, money_type, institution, label, color, is_primary_investment, "order", annual_return_pct, contrib_amount, contrib_interval, locked, locked_until, extra_contrib FROM accounts ORDER BY "order" ASC',
  );
  if (result.length === 0) return [];
  return result[0].values.map(rowToAccount);
}

/** Save accounts (full replace). */
export async function saveAccounts(accounts: Account[]): Promise<void> {
  const db = await getDb();
  const stmt = db.prepare(
    'INSERT INTO accounts (id, money_type, institution, label, color, is_primary_investment, "order", annual_return_pct, contrib_amount, contrib_interval, locked, locked_until, extra_contrib) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  try {
    db.run('BEGIN');
    db.run('DELETE FROM accounts');
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
        a.locked ? 1 : 0,
        a.lockedUntil || '',
        a.extraContrib ?? 0,
      ]);
    }
    db.run('COMMIT');
  } catch (err) {
    db.run('ROLLBACK');
    throw err;
  } finally {
    stmt.free();
  }
  await persistDb();
}

// ── Holdings ──────────────────────────────────────────────────────

/** Load all holdings, sorted by order. */
export async function loadHoldings(): Promise<Holding[]> {
  const db = await getDb();
  const result = db.exec(
    'SELECT isin, name, short_name, color, acc, active, contrib_amount, contrib_interval, asset_class, region, fold_into, "order", ter FROM holdings ORDER BY "order" ASC',
  );
  if (result.length === 0) return [];
  return result[0].values.map(rowToHolding);
}

/** Save holdings (full replace). */
export async function saveHoldings(holdings: Holding[]): Promise<void> {
  const db = await getDb();
  const stmt = db.prepare(
    'INSERT INTO holdings (isin, name, short_name, color, acc, active, contrib_amount, contrib_interval, asset_class, region, fold_into, "order", ter) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  try {
    db.run('BEGIN');
    db.run('DELETE FROM holdings');
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
        h.ter ?? 0,
      ]);
    }
    db.run('COMMIT');
  } catch (err) {
    db.run('ROLLBACK');
    throw err;
  } finally {
    stmt.free();
  }
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
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  try {
    db.run('BEGIN');
    db.run('DELETE FROM settings');
    for (const [k, v] of Object.entries(settings)) {
      if (v !== null && v !== undefined) {
        stmt.run([k, String(v)]);
      }
    }
    db.run('COMMIT');
  } catch (err) {
    db.run('ROLLBACK');
    throw err;
  } finally {
    stmt.free();
  }
  await persistDb();
}

// ── Atomic full restore (backup restore) ─────────────────────────

/**
 * Atomically restore all five data tables from a backup in a single SQLite
 * transaction. Either all tables are replaced or none are (full rollback on
 * any error). Followed by a single persistDb() so the IDB binary is only
 * written once per restore operation.
 *
 * The caller is responsible for updating the IDB key-value cache and
 * Drive sync after this function returns successfully.
 */
export async function restoreAllData(data: {
  accounts: Account[];
  holdings: Holding[];
  settings: Settings;
  snapshots: Snapshot[];
  transactions: Transaction[];
}): Promise<void> {
  const db = await getDb();

  const accountStmt = db.prepare(
    'INSERT INTO accounts (id, money_type, institution, label, color, is_primary_investment, "order", annual_return_pct, contrib_amount, contrib_interval, locked, locked_until, extra_contrib) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const holdingStmt = db.prepare(
    'INSERT INTO holdings (isin, name, short_name, color, acc, active, contrib_amount, contrib_interval, asset_class, region, fold_into, "order", ter) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const settingsStmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  const snapshotStmt = db.prepare(
    'INSERT INTO snapshots (date, values_json, notes) VALUES (?, ?, ?)',
  );
  const txStmt = db.prepare(
    'INSERT INTO transactions (id, date, source, type, name, isin, shares, price, amount, fee, tax, currency, fx_rate, note, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );

  try {
    db.run('BEGIN');

    db.run('DELETE FROM accounts');
    for (const a of data.accounts) {
      accountStmt.run([
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
        a.locked ? 1 : 0,
        a.lockedUntil || '',
        a.extraContrib ?? 0,
      ]);
    }

    db.run('DELETE FROM holdings');
    for (const h of data.holdings) {
      holdingStmt.run([
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
        h.ter ?? 0,
      ]);
    }

    db.run('DELETE FROM settings');
    for (const [k, v] of Object.entries(data.settings)) {
      if (v !== null && v !== undefined) {
        settingsStmt.run([k, String(v)]);
      }
    }

    db.run('DELETE FROM snapshots');
    for (const snap of data.snapshots) {
      const { date, notes, ...values } = snap;
      snapshotStmt.run([date, JSON.stringify(values), notes || '']);
    }

    db.run('DELETE FROM transactions');
    for (const t of data.transactions) {
      txStmt.run([
        t.id,
        t.date,
        t.source || '',
        t.type,
        t.name,
        t.isin || '',
        t.shares,
        t.price,
        t.amount,
        t.fee || 0,
        t.tax || 0,
        t.currency || 'EUR',
        t.fxRate || 0,
        t.note || '',
        t.category || '',
      ]);
    }

    db.run('COMMIT');
  } catch (err) {
    db.run('ROLLBACK');
    throw err;
  } finally {
    accountStmt.free();
    holdingStmt.free();
    settingsStmt.free();
    snapshotStmt.free();
    txStmt.free();
  }

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

export interface ConfigHistoryEntry {
  id: number;
  timestamp: string;
  source: string;
  entity: string;
  summary: string;
}

/** Load the most recent N config history entries, newest first. */
export async function loadConfigHistory(limit = 50): Promise<ConfigHistoryEntry[]> {
  const db = await getDb();
  const result = db.exec(
    'SELECT id, timestamp, source, entity, summary FROM config_history ORDER BY id DESC LIMIT ?',
    [limit],
  );
  if (result.length === 0) return [];
  return result[0].values.map((row) => ({
    id: Number(row[0]),
    timestamp: String(row[1] ?? ''),
    source: String(row[2] ?? ''),
    entity: String(row[3] ?? ''),
    summary: String(row[4] ?? ''),
  }));
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
    locked: row[10] === 1 || row[10] === '1',
    lockedUntil: String(row[11] ?? ''),
    extraContrib: Number(row[12]) || 0,
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
    ter: Number(row[12]) || 0,
  };
}
