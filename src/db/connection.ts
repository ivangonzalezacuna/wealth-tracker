/**
 * SQLite database connection - singleton, persisted to IndexedDB.
 *
 * Uses sql.js (WASM) for in-browser SQLite. The database binary is saved
 * to IndexedDB after every write operation so it survives page reloads.
 *
 * On first load: creates the schema from scratch (fresh start, no migration
 * from Sheets). On subsequent loads: opens the persisted DB and applies any
 * pending schema migrations.
 */

import initSqlJs, { type Database } from 'sql.js';
import sqlWasmBrowserUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import { SCHEMA_VERSION, SCHEMA_DDL } from './schema';
import { MIGRATIONS } from './migrations';

// IndexedDB key where the raw database file is stored.
const IDB_DB_NAME = 'wealth-tracker-sqlite';
const IDB_STORE = 'db-store';
const IDB_KEY = 'main.db';

let _db: Database | null = null;
let _sqlPromise: ReturnType<typeof initSqlJs> | null = null;

// Promise chain serializing concurrent IDB writes (see persistDb).
let _persistChain: Promise<void> = Promise.resolve();

/** Get (or lazily create) the sql.js SQL engine. */
function getSqlJs(): ReturnType<typeof initSqlJs> {
  if (!_sqlPromise) {
    _sqlPromise = initSqlJs({
      // Use Vite-managed asset URL so JS and WASM always resolve from the same package version.
      locateFile: () => sqlWasmBrowserUrl,
    });
  }
  return _sqlPromise;
}

// ── IndexedDB helpers (raw, no idb-keyval dependency) ──────────────

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(): Promise<Uint8Array | null> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const store = tx.objectStore(IDB_STORE);
    const req = store.get(IDB_KEY);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function idbSet(data: Uint8Array): Promise<void> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    store.put(data, IDB_KEY);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

// ── Schema version bookkeeping ────────────────────────────────────

function getDbVersion(db: Database): number {
  const result = db.exec("SELECT value FROM meta WHERE key = 'schema_version'");
  if (result.length === 0 || result[0].values.length === 0) return 0;
  return parseInt(String(result[0].values[0][0]), 10) || 0;
}

function setDbVersion(db: Database, version: number): void {
  db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)", [
    String(version),
  ]);
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Open (or create) the database. Idempotent - returns the same instance
 * on repeated calls within a session.
 */
export async function getDb(): Promise<Database> {
  if (_db) return _db;

  const SQL = await getSqlJs();
  const existing = await idbGet();

  if (existing) {
    _db = new SQL.Database(existing);
    // Apply pending migrations
    const currentVersion = getDbVersion(_db);
    if (currentVersion < SCHEMA_VERSION) {
      applyMigrations(_db, currentVersion);
    }
  } else {
    // Fresh database
    _db = new SQL.Database();
    for (const stmt of SCHEMA_DDL) {
      _db.run(stmt);
    }
    setDbVersion(_db, SCHEMA_VERSION);
    await persistDb();
  }

  return _db;
}

/** Apply migrations from currentVersion+1 up to SCHEMA_VERSION. */
function applyMigrations(db: Database, currentVersion: number): void {
  for (let v = currentVersion + 1; v <= SCHEMA_VERSION; v++) {
    const stmts = MIGRATIONS[v];
    if (!stmts || stmts.length === 0) continue;
    db.run('BEGIN');
    try {
      for (const stmt of stmts) {
        db.run(stmt);
      }
      setDbVersion(db, v);
      db.run('COMMIT');
    } catch (err) {
      db.run('ROLLBACK');
      throw err;
    }
  }
}

/**
 * Persist a database state to IndexedDB.
 * Defaults to the live singleton and is also used to stage imported DBs
 * before swapping them into _db.
 *
 * All calls are serialized through _persistChain so that concurrent async
 * writers (settings, accounts, snapshots) never race on the IndexedDB store.
 * The DB export is taken at the moment the slot becomes available, capturing
 * the latest in-memory state including all preceding synchronous writes.
 */
export function persistDb(db: Database | null = _db): Promise<void> {
  if (!db) return Promise.resolve();
  // Capture the db reference now; the export happens when the slot opens.
  const capture = db;
  const slot = _persistChain.then(() => {
    const data = capture.export();
    return idbSet(data);
  });
  // Advance the chain regardless of success/failure so later callers are
  // never blocked by a transient error in an earlier slot.
  _persistChain = slot.then(
    () => {},
    () => {},
  );
  return slot;
}

/**
 * Export the full database as a Uint8Array (for Drive AppData upload).
 */
export function exportDb(): Uint8Array | null {
  if (!_db) return null;
  return _db.export();
}

/**
 * Replace the local database with a downloaded copy (from Drive AppData).
 * Re-initializes the singleton and persists to IndexedDB.
 *
 * By default, to guard against stale cloud content (CDN caching, replication
 * lag), locally edited rows are merged back after import:
 * - transactions: local-only rows are reinserted
 * - accounts/holdings/settings: local rows upsert over cloud rows by key
 * - snapshots: local-only rows are inserted when date is absent in cloud
 * Callers can disable this preservation when they need a true full replacement.
 *
 * The previous database is kept open until every step succeeds so that a
 * failure in mergeLocalTransactions or persistDb never leaves _db pointing
 * at a partially-initialised database while IndexedDB still holds the old
 * content.
 */
export async function importDb(
  data: Uint8Array,
  opts: { preserveLocalTransactions?: boolean } = {},
): Promise<void> {
  const SQL = await getSqlJs();
  const previousDb = _db;
  const preserveLocalTransactions = opts.preserveLocalTransactions !== false;

  // Ensure the local DB is up to date before reading its rows so that queries
  // referencing columns added by recent migrations (e.g. notes) don't fail.
  if (previousDb) {
    const localVersion = getDbVersion(previousDb);
    if (localVersion < SCHEMA_VERSION) {
      applyMigrations(previousDb, localVersion);
      await persistDb(previousDb);
    }
  }

  // Snapshot all local rows before replacing so we can merge them back into
  // the newly imported cloud DB, preserving any offline edits.
  let localTxRows: unknown[][] = [];
  let localAccountRows: unknown[][] = [];
  let localHoldingRows: unknown[][] = [];
  let localSnapshotRows: unknown[][] = [];
  let localSettingRows: unknown[][] = [];
  if (preserveLocalTransactions && previousDb) {
    localTxRows = getLocalTransactionRows(previousDb);
    localAccountRows = getLocalAccountRows(previousDb);
    localHoldingRows = getLocalHoldingRows(previousDb);
    localSnapshotRows = getLocalSnapshotRows(previousDb);
    localSettingRows = getLocalSettingRows(previousDb);
  }

  let newDb: Database | null = null;
  try {
    newDb = new SQL.Database(data);

    // Ensure schema is up to date after import
    const currentVersion = getDbVersion(newDb);
    if (currentVersion < SCHEMA_VERSION) {
      applyMigrations(newDb, currentVersion);
    }

    // Merge back local rows that the cloud copy doesn't have or is outdated on.
    if (localTxRows.length > 0) mergeLocalTransactions(newDb, localTxRows);
    if (localAccountRows.length > 0) mergeLocalAccounts(newDb, localAccountRows);
    if (localHoldingRows.length > 0) mergeLocalHoldings(newDb, localHoldingRows);
    if (localSnapshotRows.length > 0) mergeLocalSnapshots(newDb, localSnapshotRows);
    if (localSettingRows.length > 0) mergeLocalSettings(newDb, localSettingRows);

    // Persist the imported DB before swapping it into the live singleton.
    await persistDb(newDb);

    // All steps succeeded: swap the singleton.
    _db = newDb;
    previousDb?.close();
    newDb = null;
  } catch (err) {
    // Discard the failed new database; _db keeps pointing at the previous one.
    try {
      newDb?.close();
    } catch {
      /* ignore secondary close error */
    }
    throw err;
  }
}

/**
 * Read all transaction rows from a database as raw arrays (for re-insertion).
 */
function getLocalTransactionRows(db: Database): unknown[][] {
  const result = db.exec(
    'SELECT id, date, source, type, name, isin, shares, price, amount, fee, tax, currency, fx_rate, note, category FROM transactions ORDER BY date ASC, rowid ASC',
  );
  if (result.length === 0) return [];
  return result[0].values;
}

function getLocalAccountRows(db: Database): unknown[][] {
  const result = db.exec(
    'SELECT id, money_type, institution, label, color, is_primary_investment, "order", annual_return_pct, contrib_amount, contrib_interval, locked, locked_until, extra_contrib FROM accounts ORDER BY rowid ASC',
  );
  if (result.length === 0) return [];
  return result[0].values;
}

function getLocalHoldingRows(db: Database): unknown[][] {
  const result = db.exec(
    'SELECT isin, name, short_name, color, acc, active, target_pct, asset_class, region, fold_into, "order", ter, notes FROM holdings ORDER BY rowid ASC',
  );
  if (result.length === 0) return [];
  return result[0].values;
}

function getLocalSnapshotRows(db: Database): unknown[][] {
  const result = db.exec(
    'SELECT date, values_json, notes FROM snapshots ORDER BY date ASC, rowid ASC',
  );
  if (result.length === 0) return [];
  return result[0].values;
}

function getLocalSettingRows(db: Database): unknown[][] {
  const result = db.exec('SELECT key, value FROM settings ORDER BY rowid ASC');
  if (result.length === 0) return [];
  return result[0].values;
}

/**
 * INSERT OR IGNORE local-only transactions into the (newly imported) cloud DB.
 * Uses INSERT OR IGNORE so rows already present in the cloud DB are skipped,
 * while rows that only existed locally are preserved.
 */
function mergeLocalTransactions(db: Database, rows: unknown[][]): void {
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO transactions (id, date, source, type, name, isin, shares, price, amount, fee, tax, currency, fx_rate, note, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  for (const row of rows) {
    stmt.run(row as (string | number | null)[]);
  }
  stmt.free();
}

function mergeLocalAccounts(db: Database, rows: unknown[][]): void {
  const stmt = db.prepare(
    'INSERT INTO accounts (id, money_type, institution, label, color, is_primary_investment, "order", annual_return_pct, contrib_amount, contrib_interval, locked, locked_until, extra_contrib) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET money_type=excluded.money_type, institution=excluded.institution, label=excluded.label, color=excluded.color, is_primary_investment=excluded.is_primary_investment, "order"=excluded."order", annual_return_pct=excluded.annual_return_pct, contrib_amount=excluded.contrib_amount, contrib_interval=excluded.contrib_interval, locked=excluded.locked, locked_until=excluded.locked_until, extra_contrib=excluded.extra_contrib',
  );
  for (const row of rows) {
    stmt.run(row as (string | number | null)[]);
  }
  stmt.free();
}

function mergeLocalHoldings(db: Database, rows: unknown[][]): void {
  const stmt = db.prepare(
    'INSERT INTO holdings (isin, name, short_name, color, acc, active, target_pct, asset_class, region, fold_into, "order", ter, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(isin) DO UPDATE SET name=excluded.name, short_name=excluded.short_name, color=excluded.color, acc=excluded.acc, active=excluded.active, target_pct=excluded.target_pct, asset_class=excluded.asset_class, region=excluded.region, fold_into=excluded.fold_into, "order"=excluded."order", ter=excluded.ter, notes=excluded.notes',
  );
  for (const row of rows) {
    stmt.run(row as (string | number | null)[]);
  }
  stmt.free();
}

function mergeLocalSnapshots(db: Database, rows: unknown[][]): void {
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO snapshots (date, values_json, notes) VALUES (?, ?, ?)',
  );
  for (const row of rows) {
    stmt.run(row as (string | number | null)[]);
  }
  stmt.free();
}

function mergeLocalSettings(db: Database, rows: unknown[][]): void {
  const stmt = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
  );
  for (const row of rows) {
    stmt.run(row as (string | number | null)[]);
  }
  stmt.free();
}

/**
 * Completely destroy the local database (factory reset).
 */
export async function destroyDb(): Promise<void> {
  if (_db) {
    _db.close();
    _db = null;
  }
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    store.delete(IDB_KEY);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}
