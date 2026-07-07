/** IndexedDB cache for offline-first boot. CACHE_VERSION mismatch forces full resync. */

import { createStore, get, set, del, clear } from 'idb-keyval';
import type { Transaction, Snapshot, PortfolioData, Settings } from '../types';
import type { Account, Holding } from '../types';

// ── Schema version - bump when cached shapes change ──────────────
export const CACHE_VERSION = 1;

// ── Custom idb-keyval store (separate DB for our data) ───────────
const cacheStore = createStore('wealth-tracker-cache', 'kv-store');

// ── Deduplication: skip IDB writes when value hasn't changed ─────
// IndexedDB (Chrome's LevelDB backend) grows its on-disk log on every put(),
// even when the value is identical. Tracking lightweight fingerprints and
// skipping redundant writes prevents ~100KB/refresh storage bloat.
const _lastWritten = new Map<string, string>();

/** Compute a cheap fingerprint for dedup (not cryptographic). */
function _fingerprint(value: unknown): string {
  if (Array.isArray(value)) {
    // For arrays: length + first/last element identity is sufficient.
    const len = value.length;
    if (len === 0) return 'arr:0';
    const first = JSON.stringify(value[0]);
    const last = len > 1 ? JSON.stringify(value[len - 1]) : first;
    return `arr:${len}:${first.length}:${last.length}`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    return `obj:${keys.length}:${keys.join(',')}`;
  }
  return String(value);
}

/** set() wrapper that skips the write if the fingerprint hasn't changed. */
async function setIfChanged(key: string, value: unknown): Promise<void> {
  const fp = _fingerprint(value);
  if (_lastWritten.get(key) === fp) return;
  await set(key, value, cacheStore);
  _lastWritten.set(key, fp);
}

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
    if (version === CACHE_VERSION) {
      _lastWritten.set(KEYS.SCHEMA_VERSION, _fingerprint(version));
      return true;
    }
    return false;
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
    // Seed fingerprints so subsequent writes of the same data are skipped
    _lastWritten.set(KEYS.CONFIG_ACCOUNTS, _fingerprint(accounts));
    _lastWritten.set(KEYS.CONFIG_HOLDINGS, _fingerprint(holdings));
    _lastWritten.set(KEYS.CONFIG_SETTINGS, _fingerprint(settings));
    return { accounts, holdings, settings };
  } catch {
    return null;
  }
}

export async function setCachedConfig(config: CachedConfig): Promise<void> {
  try {
    await Promise.all([
      setIfChanged(KEYS.CONFIG_ACCOUNTS, config.accounts),
      setIfChanged(KEYS.CONFIG_HOLDINGS, config.holdings),
      setIfChanged(KEYS.CONFIG_SETTINGS, config.settings),
      setIfChanged(KEYS.SCHEMA_VERSION, CACHE_VERSION),
    ]);
  } catch {
    // Quota or other IDB error - degrade gracefully
  }
}

// ── Snapshots ────────────────────────────────────────────────────

export async function getCachedSnapshots(): Promise<Snapshot[] | null> {
  try {
    if (!(await isCacheValid())) return null;
    const val = await get<Snapshot[]>(KEYS.SNAPSHOTS, cacheStore);
    if (val) _lastWritten.set(KEYS.SNAPSHOTS, _fingerprint(val));
    return val ?? null;
  } catch {
    return null;
  }
}

export async function setCachedSnapshots(snaps: Snapshot[]): Promise<void> {
  try {
    await setIfChanged(KEYS.SNAPSHOTS, snaps);
  } catch {
    /* degrade */
  }
}

// ── Transactions ─────────────────────────────────────────────────

export async function getCachedTransactions(): Promise<Transaction[] | null> {
  try {
    if (!(await isCacheValid())) return null;
    const val = await get<Transaction[]>(KEYS.TRANSACTIONS, cacheStore);
    if (val) _lastWritten.set(KEYS.TRANSACTIONS, _fingerprint(val));
    return val ?? null;
  } catch {
    return null;
  }
}

export async function setCachedTransactions(txs: Transaction[]): Promise<void> {
  try {
    await setIfChanged(KEYS.TRANSACTIONS, txs);
  } catch {
    /* degrade */
  }
}

// ── Aggregates (computePD output) ────────────────────────────────

export async function getCachedAggregates(): Promise<PortfolioData | null> {
  try {
    if (!(await isCacheValid())) return null;
    const val = await get<PortfolioData>(KEYS.AGGREGATES, cacheStore);
    if (val) _lastWritten.set(KEYS.AGGREGATES, _fingerprint(val));
    return val ?? null;
  } catch {
    return null;
  }
}

export async function setCachedAggregates(pd: PortfolioData): Promise<void> {
  try {
    await setIfChanged(KEYS.AGGREGATES, pd);
  } catch {
    /* degrade */
  }
}

// ── Import metadata ──────────────────────────────────────────────

export async function getCachedImportMeta(): Promise<Record<string, string> | null> {
  try {
    if (!(await isCacheValid())) return null;
    const val = await get<Record<string, string>>(KEYS.IMPORT_META, cacheStore);
    if (val) _lastWritten.set(KEYS.IMPORT_META, _fingerprint(val));
    return val ?? null;
  } catch {
    return null;
  }
}

export async function setCachedImportMeta(meta: Record<string, string>): Promise<void> {
  try {
    await setIfChanged(KEYS.IMPORT_META, meta);
  } catch {
    /* degrade */
  }
}

// ── Sync cursor ──────────────────────────────────────────────────

export async function getSyncCursor(): Promise<SyncCursor | null> {
  try {
    if (!(await isCacheValid())) return null;
    const val = await get<SyncCursor>(KEYS.SYNC_CURSOR, cacheStore);
    if (val) _lastWritten.set(KEYS.SYNC_CURSOR, _fingerprint(val));
    return val ?? null;
  } catch {
    return null;
  }
}

export async function setSyncCursor(cursor: SyncCursor): Promise<void> {
  try {
    await setIfChanged(KEYS.SYNC_CURSOR, cursor);
  } catch {
    /* degrade */
  }
}

// ── Inputs hash (for aggregate invalidation) ─────────────────────

export async function getInputsHash(): Promise<string | null> {
  try {
    if (!(await isCacheValid())) return null;
    const val = await get<string>(KEYS.INPUTS_HASH, cacheStore);
    if (val) _lastWritten.set(KEYS.INPUTS_HASH, _fingerprint(val));
    return val ?? null;
  } catch {
    return null;
  }
}

export async function setInputsHash(hash: string): Promise<void> {
  try {
    await setIfChanged(KEYS.INPUTS_HASH, hash);
  } catch {
    /* degrade */
  }
}

// ── Compute inputs hash ──────────────────────────────────────────

/** Deterministic hash of aggregate computation inputs. */
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
 * Includes every field computePD()'s output reflects (ticker/color come from
 * getMETAMap()/getISIN(), both derived from holdings). Omitting any field here
 * means editing it in Settings won't refresh Portfolio/Net Worth until an
 * unrelated change invalidates the hash.
 */
export function holdingsSignature(holdings: Holding[]): string {
  return holdings
    .map((h) => `${h.isin}:${h.active}:${h.acc}:${h.foldInto}:${h.ticker}:${h.color}:${h.name}`)
    .sort()
    .join(',');
}

// ── UI collapse state ─────────────────────────────────────────────

/** Record of section/key → true (collapsed) or absent (expanded). */
export type CollapseState = Record<string, boolean>;

/**
 * Get persisted UI collapse state.
 * NOTE: intentionally does NOT gate on isCacheValid() - UI preferences
 * should survive a CACHE_VERSION bump that invalidates financial data.
 */
export async function getCollapseState(): Promise<CollapseState | null> {
  try {
    const val = await get<CollapseState>(KEYS.UI_COLLAPSE_STATE, cacheStore);
    if (val) _lastWritten.set(KEYS.UI_COLLAPSE_STATE, _fingerprint(val));
    return val ?? null;
  } catch {
    return null;
  }
}

export async function setCollapseState(state: CollapseState): Promise<void> {
  try {
    await setIfChanged(KEYS.UI_COLLAPSE_STATE, state);
  } catch {
    /* degrade */
  }
}

// ── Clear all cache (force full resync) ──────────────────────────

export async function clearCache(): Promise<void> {
  try {
    await clear(cacheStore);
    _lastWritten.clear();
  } catch {
    /* degrade */
  }
}
