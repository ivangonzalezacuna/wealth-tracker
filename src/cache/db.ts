/**
 * IndexedDB cache layer for offline-first PWA behaviour.
 *
 * Uses idb-keyval for a thin key/value API on top of IndexedDB.
 * Stores: config, snapshots, transactions, aggregates, and sync metadata.
 *
 * On CACHE_VERSION mismatch the cache is treated as empty (forces full resync).
 */

import { createStore, get, set, del, clear } from 'idb-keyval';
import type { Transaction, Snapshot, PortfolioData, Settings } from '../types';
import type { Account, Holding } from '../types';

// ── Schema version — bump when cached shapes change ──────────────
export const CACHE_VERSION = 1;

// ── Custom idb-keyval store (separate DB for our data) ───────────
const cacheStore = createStore('finance-dashboard-cache', 'kv-store');

// ── Key constants ────────────────────────────────────────────────
const KEYS = {
  CONFIG_ACCOUNTS: 'config:accounts',
  CONFIG_HOLDINGS: 'config:holdings',
  CONFIG_SETTINGS: 'config:settings',
  SNAPSHOTS: 'snapshots',
  TRANSACTIONS: 'transactions',
  AGGREGATES: 'aggregates',
  IMPORT_META: 'importMeta',
  SYNC_CURSOR: 'meta:syncCursor',
  SCHEMA_VERSION: 'meta:schemaVersion',
  INPUTS_HASH: 'meta:inputsHash',
  UI_COLLAPSE_STATE: 'ui:collapseState',
} as const;

// ── Sync cursor type ─────────────────────────────────────────────
export interface SyncCursor {
  /** Date of last synced transaction (YYYY-MM-DD) */
  lastDate: string;
  /** Total row count at last sync */
  rowCount: number;
}

// ── Config cache shape ───────────────────────────────────────────
export interface CachedConfig {
  accounts: Account[];
  holdings: Holding[];
  settings: Settings;
}

// ── Version check ────────────────────────────────────────────────

/**
 * Check if the cache is valid (schema version matches).
 * Returns false if cache should be treated as empty.
 */
export async function isCacheValid(): Promise<boolean> {
  try {
    const version = await get<number>(KEYS.SCHEMA_VERSION, cacheStore);
    return version === CACHE_VERSION;
  } catch {
    return false;
  }
}

// ── Config ───────────────────────────────────────────────────────

export async function getCachedConfig(): Promise<CachedConfig | null> {
  try {
    if (!(await isCacheValid())) return null;
    const [accounts, holdings, settings] = await Promise.all([
      get<Account[]>(KEYS.CONFIG_ACCOUNTS, cacheStore),
      get<Holding[]>(KEYS.CONFIG_HOLDINGS, cacheStore),
      get<Settings>(KEYS.CONFIG_SETTINGS, cacheStore),
    ]);
    if (!accounts || !holdings || !settings) return null;
    return { accounts, holdings, settings };
  } catch {
    return null;
  }
}

export async function setCachedConfig(config: CachedConfig): Promise<void> {
  try {
    await Promise.all([
      set(KEYS.CONFIG_ACCOUNTS, config.accounts, cacheStore),
      set(KEYS.CONFIG_HOLDINGS, config.holdings, cacheStore),
      set(KEYS.CONFIG_SETTINGS, config.settings, cacheStore),
      set(KEYS.SCHEMA_VERSION, CACHE_VERSION, cacheStore),
    ]);
  } catch {
    // Quota or other IDB error — degrade gracefully
  }
}

// ── Snapshots ────────────────────────────────────────────────────

export async function getCachedSnapshots(): Promise<Snapshot[] | null> {
  try {
    if (!(await isCacheValid())) return null;
    return (await get<Snapshot[]>(KEYS.SNAPSHOTS, cacheStore)) ?? null;
  } catch {
    return null;
  }
}

export async function setCachedSnapshots(snaps: Snapshot[]): Promise<void> {
  try {
    await set(KEYS.SNAPSHOTS, snaps, cacheStore);
  } catch {
    /* degrade */
  }
}

// ── Transactions ─────────────────────────────────────────────────

export async function getCachedTransactions(): Promise<Transaction[] | null> {
  try {
    if (!(await isCacheValid())) return null;
    return (await get<Transaction[]>(KEYS.TRANSACTIONS, cacheStore)) ?? null;
  } catch {
    return null;
  }
}

export async function setCachedTransactions(txs: Transaction[]): Promise<void> {
  try {
    await set(KEYS.TRANSACTIONS, txs, cacheStore);
  } catch {
    /* degrade */
  }
}

// ── Aggregates (computePD output) ────────────────────────────────

export async function getCachedAggregates(): Promise<PortfolioData | null> {
  try {
    if (!(await isCacheValid())) return null;
    return (await get<PortfolioData>(KEYS.AGGREGATES, cacheStore)) ?? null;
  } catch {
    return null;
  }
}

export async function setCachedAggregates(pd: PortfolioData): Promise<void> {
  try {
    await set(KEYS.AGGREGATES, pd, cacheStore);
  } catch {
    /* degrade */
  }
}

// ── Import metadata ──────────────────────────────────────────────

export async function getCachedImportMeta(): Promise<Record<string, string> | null> {
  try {
    if (!(await isCacheValid())) return null;
    return (await get<Record<string, string>>(KEYS.IMPORT_META, cacheStore)) ?? null;
  } catch {
    return null;
  }
}

export async function setCachedImportMeta(meta: Record<string, string>): Promise<void> {
  try {
    await set(KEYS.IMPORT_META, meta, cacheStore);
  } catch {
    /* degrade */
  }
}

// ── Sync cursor ──────────────────────────────────────────────────

export async function getSyncCursor(): Promise<SyncCursor | null> {
  try {
    if (!(await isCacheValid())) return null;
    return (await get<SyncCursor>(KEYS.SYNC_CURSOR, cacheStore)) ?? null;
  } catch {
    return null;
  }
}

export async function setSyncCursor(cursor: SyncCursor): Promise<void> {
  try {
    await set(KEYS.SYNC_CURSOR, cursor, cacheStore);
  } catch {
    /* degrade */
  }
}

// ── Inputs hash (for aggregate invalidation) ─────────────────────

export async function getInputsHash(): Promise<string | null> {
  try {
    if (!(await isCacheValid())) return null;
    return (await get<string>(KEYS.INPUTS_HASH, cacheStore)) ?? null;
  } catch {
    return null;
  }
}

export async function setInputsHash(hash: string): Promise<void> {
  try {
    await set(KEYS.INPUTS_HASH, hash, cacheStore);
  } catch {
    /* degrade */
  }
}

// ── Compute inputs hash ──────────────────────────────────────────

/**
 * Compute a deterministic hash from the inputs that affect aggregates.
 * If any of these change, cached aggregates must be recomputed.
 */
export function computeInputsHash(
  txCount: number,
  lastTxDate: string,
  costBasisMethod: string,
  holdingsSignature: string,
): string {
  return `${txCount}|${lastTxDate}|${costBasisMethod}|${holdingsSignature}`;
}

/**
 * Build a stable signature string from holdings that affects computePD output.
 */
export function holdingsSignature(holdings: Holding[]): string {
  return holdings
    .map((h) => `${h.isin}:${h.active}:${h.acc}:${h.foldInto}`)
    .sort()
    .join(',');
}

// ── UI collapse state ─────────────────────────────────────────────

/** Record of section/key → true (collapsed) or absent (expanded). */
export type CollapseState = Record<string, boolean>;

/**
 * Get persisted UI collapse state.
 * NOTE: intentionally does NOT gate on isCacheValid() — UI preferences
 * should survive a CACHE_VERSION bump that invalidates financial data.
 */
export async function getCollapseState(): Promise<CollapseState | null> {
  try {
    return (await get<CollapseState>(KEYS.UI_COLLAPSE_STATE, cacheStore)) ?? null;
  } catch {
    return null;
  }
}

export async function setCollapseState(state: CollapseState): Promise<void> {
  try {
    await set(KEYS.UI_COLLAPSE_STATE, state, cacheStore);
  } catch {
    /* degrade */
  }
}

// ── Clear all cache (force full resync) ──────────────────────────

export async function clearCache(): Promise<void> {
  try {
    await clear(cacheStore);
  } catch {
    /* degrade */
  }
}
