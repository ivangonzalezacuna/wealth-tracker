/**
 * Database schema - SQLite table definitions for the wealth tracker.
 *
 * Tables mirror the existing data models (Transaction, Account, Holding,
 * Snapshot, Settings) that previously lived in Google Sheets tabs.
 */

/** Schema version - bump when DDL changes require a migration. */
export const SCHEMA_VERSION = 1;

/**
 * SQL statements executed on first database creation (version 0 → 1).
 * Each statement is executed separately so individual failures are clear.
 */
export const SCHEMA_DDL: string[] = [
  // ── Transactions ──────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    isin TEXT NOT NULL DEFAULT '',
    symbol TEXT NOT NULL DEFAULT '',
    shares REAL NOT NULL DEFAULT 0,
    price REAL NOT NULL DEFAULT 0,
    amount REAL NOT NULL DEFAULT 0,
    fee REAL NOT NULL DEFAULT 0,
    tax REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'EUR',
    fx_rate REAL NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date)`,
  `CREATE INDEX IF NOT EXISTS idx_tx_isin ON transactions(isin)`,

  // ── Accounts ──────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    money_type TEXT NOT NULL DEFAULT '',
    institution TEXT NOT NULL DEFAULT '',
    label TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '',
    is_primary_investment INTEGER NOT NULL DEFAULT 0,
    "order" INTEGER NOT NULL DEFAULT 0,
    annual_return_pct REAL NOT NULL DEFAULT 0,
    contrib_amount REAL NOT NULL DEFAULT 0,
    contrib_interval TEXT NOT NULL DEFAULT 'monthly'
  )`,

  // ── Holdings ──────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS holdings (
    isin TEXT PRIMARY KEY,
    ticker TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '',
    acc INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    contrib_amount REAL NOT NULL DEFAULT 0,
    contrib_interval TEXT NOT NULL DEFAULT 'weekly',
    asset_class TEXT NOT NULL DEFAULT '',
    region TEXT NOT NULL DEFAULT '',
    fold_into TEXT NOT NULL DEFAULT '',
    "order" INTEGER NOT NULL DEFAULT 0
  )`,

  // ── Snapshots ─────────────────────────────────────────────────
  // Dynamic account columns are stored as JSON in `values` for flexibility.
  `CREATE TABLE IF NOT EXISTS snapshots (
    date TEXT PRIMARY KEY,
    values_json TEXT NOT NULL DEFAULT '{}',
    notes TEXT NOT NULL DEFAULT ''
  )`,

  // ── Settings (key-value) ──────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  )`,

  // ── Config history (audit log) ────────────────────────────────
  `CREATE TABLE IF NOT EXISTS config_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'web',
    entity TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT ''
  )`,

  // ── Meta (internal bookkeeping) ───────────────────────────────
  `CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  )`,
];
