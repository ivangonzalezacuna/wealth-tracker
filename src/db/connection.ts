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
import { SCHEMA_VERSION, SCHEMA_DDL } from './schema';
import { MIGRATIONS } from './migrations';

// IndexedDB key where the raw database file is stored.
const IDB_DB_NAME = 'wealth-tracker-sqlite';
const IDB_STORE = 'db-store';
const IDB_KEY = 'main.db';

let _db: Database | null = null;
let _sqlPromise: ReturnType<typeof initSqlJs> | null = null;

/** Get (or lazily create) the sql.js SQL engine. */
function getSqlJs(): ReturnType<typeof initSqlJs> {
  if (!_sqlPromise) {
    _sqlPromise = initSqlJs({
      // Serve the WASM binary from our own origin (public/ directory) to ensure
      // the JS glue code and WASM binary are always from the same sql.js version.
      locateFile: (file: string) => `/${file}`,
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
 * Persist the current database state to IndexedDB.
 * Call after any write operation (or batch of writes).
 */
export async function persistDb(): Promise<void> {
  if (!_db) return;
  const data = _db.export();
  await idbSet(data);
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
 */
export async function importDb(data: Uint8Array): Promise<void> {
  const SQL = await getSqlJs();
  if (_db) _db.close();
  _db = new SQL.Database(data);
  // Ensure schema is up to date after import
  const currentVersion = getDbVersion(_db);
  if (currentVersion < SCHEMA_VERSION) {
    applyMigrations(_db, currentVersion);
  }
  await persistDb();
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
