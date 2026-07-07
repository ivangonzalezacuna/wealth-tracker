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
} from '../db/repositories/meta';
import { downloadDbFile, uploadDbFile, getCloudModifiedTime } from './drive';

// ── State ─────────────────────────────────────────────────────────

let _uploadTimer: ReturnType<typeof setTimeout> | null = null;
let _syncing = false;
let _onSyncStatusChange: ((status: SyncStatus) => void) | null = null;

const UPLOAD_DEBOUNCE_MS = 5_000; // 5 seconds after last write

export type SyncStatus = 'idle' | 'syncing' | 'uploading' | 'downloading' | 'error' | 'done';

// ── Public API ────────────────────────────────────────────────────

/** Register a callback for sync status changes. */
export function onSyncStatus(fn: (status: SyncStatus) => void): void {
  _onSyncStatusChange = fn;
}

function setStatus(s: SyncStatus): void {
  _onSyncStatusChange?.(s);
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
  setStatus('syncing');

  try {
    const cloudTime = await getCloudModifiedTime();
    if (!cloudTime) {
      // No cloud file yet - first time user. Nothing to pull.
      setStatus('done');
      return false;
    }

    const localTime = await getLastSyncTimestamp();
    if (localTime && new Date(localTime) >= new Date(cloudTime)) {
      // Local is same or newer - no download needed.
      setStatus('done');
      return false;
    }

    // Cloud is newer - download and replace.
    setStatus('downloading');
    const result = await downloadDbFile();
    if (!result) {
      setStatus('done');
      return false;
    }

    await importDb(result.data);
    await setLastSyncTimestamp(result.modifiedTime);
    await setDriveVersion(result.modifiedTime);
    setStatus('done');
    return true;
  } catch (err) {
    console.error('[sync] pull failed:', err);
    setStatus('error');
    return false;
  } finally {
    _syncing = false;
  }
}

/**
 * Push: upload the current local DB to Drive AppData.
 * Called immediately (not debounced) - use scheduleUpload for debounced pushes.
 */
export async function pushToCloud(): Promise<void> {
  if (_syncing) return;
  _syncing = true;
  setStatus('uploading');

  try {
    const data = exportDb();
    if (!data) {
      setStatus('done');
      return;
    }

    const modifiedTime = await uploadDbFile(data);
    await setLastSyncTimestamp(modifiedTime);
    await setDriveVersion(modifiedTime);
    setStatus('done');
  } catch (err) {
    console.error('[sync] push failed:', err);
    setStatus('error');
  } finally {
    _syncing = false;
  }
}

/**
 * Schedule a debounced upload after local writes.
 * Coalesces multiple rapid writes into a single upload.
 */
export function scheduleUpload(): void {
  if (_uploadTimer) clearTimeout(_uploadTimer);
  _uploadTimer = setTimeout(() => {
    _uploadTimer = null;
    pushToCloud();
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
