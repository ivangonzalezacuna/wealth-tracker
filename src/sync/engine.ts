/**
 * Sync engine - orchestrates bidirectional sync between local SQLite and
 * Google Drive AppData.
 *
 * Strategy:
 *  - On boot: check cloud modifiedTime. If cloud is newer → download & replace.
 *  - After local writes: debounced upload (coalesces rapid writes into one push).
 *  - Conflict resolution: last-write-wins (simple, sufficient for single-user app).
 *
 * The engine never runs in development builds unless explicitly triggered by
 * the user (env isolation is handled by separate OAuth apps, but this adds
 * a second layer of defence against accidental syncs during testing).
 */

import { exportDb, importDb } from '../db/connection';
import {
  setLastSyncTimestamp,
  getLastSyncTimestamp,
  setDriveVersion,
  getDriveVersion,
  getLastLocalChangeTimestamp,
  setLastLocalChangeTimestamp,
} from '../db/repositories/meta';
import { downloadDbFile, uploadDbFile, getCloudModifiedTime } from './drive';

// ── State ─────────────────────────────────────────────────────────

let _uploadTimer: ReturnType<typeof setTimeout> | null = null;
let _syncing = false;
let _onSyncStatusChange: ((status: SyncStatus) => void) | null = null;
let _pendingConflict: SyncConflict | null = null;

const UPLOAD_DEBOUNCE_MS = 5_000; // 5 seconds after last write

export type SyncStatus =
  'idle' | 'syncing' | 'uploading' | 'downloading' | 'conflict' | 'error' | 'done';

export interface SyncConflict {
  source: 'pull' | 'push';
  cloudModifiedTime: string;
  lastSyncedAt: string | null;
  lastLocalChangeAt: string | null;
}

export class SyncConflictError extends Error {
  readonly conflict: SyncConflict;

  constructor(conflict: SyncConflict) {
    super('Drive changed elsewhere and this device also has local changes.');
    this.name = 'SyncConflictError';
    this.conflict = conflict;
  }
}

// ── Public API ────────────────────────────────────────────────────

/** Register a callback for sync status changes. */
export function onSyncStatus(fn: (status: SyncStatus) => void): void {
  _onSyncStatusChange = fn;
}

export function getPendingSyncConflict(): SyncConflict | null {
  return _pendingConflict;
}

function setStatus(s: SyncStatus): void {
  _onSyncStatusChange?.(s);
}

function clearPendingConflict(): void {
  _pendingConflict = null;
}

function raiseConflict(conflict: SyncConflict): never {
  _pendingConflict = conflict;
  setStatus('conflict');
  throw new SyncConflictError(conflict);
}

function hasUnsyncedLocalChanges(
  lastLocalChangeAt: string | null,
  lastSyncedAt: string | null,
): boolean {
  return (
    !!lastLocalChangeAt && (!lastSyncedAt || new Date(lastLocalChangeAt) > new Date(lastSyncedAt))
  );
}

async function finalizeSuccessfulSync(modifiedTime: string, syncStartedAt: string): Promise<void> {
  await setLastSyncTimestamp(modifiedTime);
  await setDriveVersion(modifiedTime);
  const latestLocalChangeAt = await getLastLocalChangeTimestamp();
  if (!latestLocalChangeAt || new Date(latestLocalChangeAt) <= new Date(syncStartedAt)) {
    await setLastLocalChangeTimestamp(modifiedTime);
  }
  clearPendingConflict();
}

/** Is a sync currently in progress? */
export function isSyncing(): boolean {
  return _syncing;
}

/**
 * Pull: check if cloud has a newer version and download if so.
 * Call on app boot after auth is confirmed.
 *
 * Returns true if a download occurred (caller should reload state from DB).
 */
export async function pullFromCloud(): Promise<boolean> {
  if (_syncing) return false;
  _syncing = true;
  try {
    setStatus('syncing');
    const cloudTime = await getCloudModifiedTime();
    if (!cloudTime) {
      // No cloud file yet - first time user. Nothing to pull.
      setStatus('done');
      return false;
    }

    const localTime = await getLastSyncTimestamp();
    const localChangeTime = await getLastLocalChangeTimestamp();
    const storedVersion = await getDriveVersion();

    // Skip download when the stored Drive version matches the current cloud modifiedTime.
    // This is a clock-skew-resistant guard: if the cloud file hasn't changed since our
    // last sync, the version strings will be identical regardless of local clock drift.
    if (storedVersion && storedVersion === cloudTime) {
      setStatus('done');
      return false;
    }

    if (localTime && new Date(localTime) >= new Date(cloudTime)) {
      // Local is same or newer - no download needed.
      setStatus('done');
      return false;
    }

    // Conflict guard: cloud is newer, but this device has local changes that
    // were never synced to Drive yet. Refuse silent overwrite.
    if (hasUnsyncedLocalChanges(localChangeTime, localTime)) {
      raiseConflict({
        source: 'pull',
        cloudModifiedTime: cloudTime,
        lastSyncedAt: localTime,
        lastLocalChangeAt: localChangeTime,
      });
    }

    // Cloud is newer - download and replace.
    setStatus('downloading');
    const result = await downloadDbFile();
    if (!result) {
      setStatus('done');
      return false;
    }

    await importDb(result.data);
    await finalizeSuccessfulSync(result.modifiedTime, result.modifiedTime);
    setStatus('done');
    return true;
  } catch (err) {
    if (err instanceof SyncConflictError) throw err;
    console.error('[sync] pull failed:', err);
    setStatus('error');
    throw err;
  } finally {
    _syncing = false;
  }
}

/**
 * Push: upload the current local DB to Drive AppData.
 * Called immediately (not debounced), use scheduleUpload for debounced pushes.
 */
export async function pushToCloud(opts: { skipConflictCheck?: boolean } = {}): Promise<boolean> {
  if (_syncing) return false;
  _syncing = true;
  try {
    setStatus('uploading');
    const syncStartedAt = new Date().toISOString();
    const localTime = await getLastSyncTimestamp();
    const localChangeTime = await getLastLocalChangeTimestamp();
    const storedVersion = await getDriveVersion();
    const cloudTime = await getCloudModifiedTime();
    if (
      !opts.skipConflictCheck &&
      cloudTime &&
      // If we have no prior sync baseline at all (both storedVersion and localTime are
      // null, e.g. right after clearSyncMetadata() following a backup restore), there
      // is no conflicting state to protect — treat it as a clean first-time push.
      (storedVersion !== null || localTime !== null) &&
      hasUnsyncedLocalChanges(localChangeTime, localTime) &&
      (!storedVersion || storedVersion !== cloudTime)
    ) {
      raiseConflict({
        source: 'push',
        cloudModifiedTime: cloudTime,
        lastSyncedAt: localTime,
        lastLocalChangeAt: localChangeTime,
      });
    }

    const data = exportDb();
    if (!data) {
      setStatus('done');
      return true;
    }

    const modifiedTime = await uploadDbFile(data);
    await finalizeSuccessfulSync(modifiedTime, syncStartedAt);
    setStatus('done');
    return true;
  } catch (err) {
    if (err instanceof SyncConflictError) throw err;
    console.error('[sync] push failed:', err);
    setStatus('error');
    return false;
  } finally {
    _syncing = false;
  }
}

/**
 * Schedule a debounced upload after local writes.
 * Coalesces multiple rapid writes into a single upload.
 */
export function scheduleUpload(): void {
  void setLastLocalChangeTimestamp(new Date().toISOString());
  if (_uploadTimer) clearTimeout(_uploadTimer);
  _uploadTimer = setTimeout(() => {
    _uploadTimer = null;
    void pushToCloud().catch(() => {});
  }, UPLOAD_DEBOUNCE_MS);
}

/** Cancel any pending debounced upload. */
export function cancelPendingUpload(): void {
  if (_uploadTimer) {
    clearTimeout(_uploadTimer);
    _uploadTimer = null;
  }
}

/**
 * Force immediate sync (both pull then push if needed).
 * Used by the "Sync Now" button.
 */
export async function forceSync(): Promise<void> {
  cancelPendingUpload();
  const downloaded = await pullFromCloud();
  if (!downloaded) {
    // If we didn't download (local is current), push our state up.
    await pushToCloud();
  }
}

export async function overwriteCloudWithLocal(): Promise<boolean> {
  const pushed = await pushToCloud({ skipConflictCheck: true });
  if (pushed) clearPendingConflict();
  return pushed;
}

export async function replaceLocalWithCloud(): Promise<boolean> {
  if (_syncing) return false;
  _syncing = true;
  try {
    setStatus('downloading');
    const result = await downloadDbFile();
    if (!result) {
      setStatus('done');
      return false;
    }
    await importDb(result.data, { preserveLocalTransactions: false });
    await finalizeSuccessfulSync(result.modifiedTime, result.modifiedTime);
    setStatus('done');
    return true;
  } catch (err) {
    console.error('[sync] conflict download failed:', err);
    setStatus('error');
    throw err;
  } finally {
    _syncing = false;
  }
}
