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
  insertTransaction,
  updateTransaction,
  deleteTransaction,
  deleteTransactions,
  txKey,
  countAmendedRows,
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
  restoreAllData,
  logConfigChange,
  loadConfigHistory,
} from './repositories/config';
export type { ConfigHistoryEntry } from './repositories/config';

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
  clearSyncMetadata,
} from './repositories/meta';

export { getDb, persistDb, exportDb, importDb, destroyDb } from './connection';

export {
  getFxRate,
  upsertFxRate,
  loadFxRates,
  restoreFxRates,
  clearFxRates,
} from './repositories/fxRates';
export type { FxRateRecord } from '../types';
