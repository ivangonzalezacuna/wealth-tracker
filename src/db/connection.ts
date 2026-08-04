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

// Serializes all persistDb() calls so concurrent async writers never race
// on IndexedDB. Each call waits for the previous persist to complete before
// exporting and writing the next snapshot. Errors propagate to the caller
// without poisoning the chain.
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
 * Ensure the live database has all schema migrations applied.
 * Useful for long-lived sessions whose in-memory DB may predate the latest schema.
 */
export async function ensureCurrentSchema(): Promise<void> {
  const db = await getDb();
  const currentVersion = getDbVersion(db);
  if (currentVersion >= SCHEMA_VERSION) return;
  applyMigrations(db, currentVersion);
  await persistDb(db);
}

/**
 * Export the full database as a Uint8Array (for Drive AppData upload).
 */
export function exportDb(): Uint8Array | null {
  if (!_db) return null;
  return _db.export();
}

/**
 * Run an async callback inside a SQLite savepoint.
 * If the callback throws, the savepoint is rolled back and the error
 * is re-thrown. If it succeeds, the savepoint is released (committed).
 * Savepoints are reentrant, so this works even if individual operations
 * already use BEGIN/COMMIT internally - those inner transactions will
 * commit normally and their changes accumulate within the savepoint.
 * If the savepoint is released successfully, the caller is responsible
 * for calling persistDb() to flush to IndexedDB.
 */
export async function runInSavepoint(name: string, fn: () => Promise<void>): Promise<void> {
  const db = await getDb();
  db.run(`SAVEPOINT ${name}`);
  try {
    await fn();
    db.run(`RELEASE SAVEPOINT ${name}`);
  } catch (err) {
    try {
      db.run(`ROLLBACK TO SAVEPOINT ${name}`);
    } catch {
      throw err;
    }
    try {
      db.run(`RELEASE SAVEPOINT ${name}`);
    } catch {
      throw err;
    }
    throw err;
  }
}

/**
 * Replace the local database with a downloaded copy (from Drive AppData).
 * Re-initializes the singleton and persists to IndexedDB.
 *
 * To guard against stale cloud content (CDN caching, replication lag),
 * any transactions that exist locally but NOT in the cloud DB are
 * re-inserted after the import so data is never silently lost.
 *
 * The previous database is kept open until every step succeeds so that a
 * failure in mergeLocalTransactions or persistDb never leaves _db pointing
 * at a partially-initialised database while IndexedDB still holds the old
 * content.
 */
export async function importDb(data: Uint8Array): Promise<void> {
  const SQL = await getSqlJs();
  const previousDb = _db;

  // Snapshot local transaction IDs before replacing, so we can merge back
  // any that are missing from the cloud copy.
  const localTxRows = previousDb ? getLocalTransactionRows(previousDb) : [];

  let newDb: Database | null = null;
  try {
    newDb = new SQL.Database(data);

    // Ensure schema is up to date after import
    const currentVersion = getDbVersion(newDb);
    if (currentVersion < SCHEMA_VERSION) {
      applyMigrations(newDb, currentVersion);
    }

    // Merge back local-only transactions that the cloud copy doesn't have.
    if (localTxRows.length > 0) {
      mergeLocalTransactions(newDb, localTxRows);
    }

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
    'SELECT id, date, source, type, name, isin, shares, price, amount, fee, tax, currency, fx_rate, note, category FROM transactions',
  );
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
