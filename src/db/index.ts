/**
 * Database repository layer - re-exports all repository modules.
 *
 * Import from here for a clean single-import entry point:
 *   import { loadTransactions, upsertSnapshot, ... } from './db';
 */

export {
  loadTransactions,
  mergeTransactions,
  restoreTransactions,
  txKey,
} from './repositories/transactions';

export { loadSnapshots, upsertSnapshot, saveSnapshots } from './repositories/snapshots';

export {
  loadAccounts,
  saveAccounts,
  loadHoldings,
  saveHoldings,
  loadSettings,
  setSetting,
  deleteSetting,
  replaceAllSettings,
  logConfigChange,
} from './repositories/config';

export {
  getMeta,
  setMeta,
  deleteMeta,
  saveImportMeta,
  loadImportMeta,
  getLastSyncTimestamp,
  setLastSyncTimestamp,
  getDriveVersion,
  setDriveVersion,
} from './repositories/meta';

export { getDb, persistDb, exportDb, importDb, destroyDb } from './connection';
