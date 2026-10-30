/**
 * Sync engine - orchestrates bidirectional sync between local SQLite and
 * Google Drive AppData.
 *
 * Strategy:
 *  - On boot: check cloud modifiedTime. If cloud is newer → download & replace.
 *  - After local writes: debounced upload (coalesces rapid writes into one push).
 *  - Conflicting changes pause sync until the user explicitly chooses a copy.
 *
 * The engine never runs in development builds unless explicitly triggered by
 * the user (env isolation is handled by separate OAuth apps, but this adds
 * a second layer of defence against accidental syncs during testing).
 */

import { exportDb, importDb } from '../db/connection';
import { NeedsAuthError } from '../auth/errors';
import {
  setLastSyncTimestamp,
  getLastSyncTimestamp,
  setDriveVersion,
  getDriveVersion,
  getLastLocalChangeTimestamp,
  setLastLocalChangeTimestamp,
} from '../db/repositories/meta';
import { downloadDbFile, uploadDbFile, getCloudModifiedTime } from './drive';
import { isBusy } from './lock';

// ── State ─────────────────────────────────────────────────────────

let _uploadTimer: ReturnType<typeof setTimeout> | null = null;
let _syncing = false;
let _onSyncStatusChange: ((status: SyncStatus, detail?: string) => void) | null = null;
let _pendingConflict: SyncConflict | null = null;
let _onPendingChange: ((pending: boolean) => void) | null = null;
let _status: SyncStatus = 'idle';
let _error = '';
let _localChangeWrite: Promise<void> = Promise.resolve();
let _changeGeneration = 0;
let _uploadRequested = false;

const UPLOAD_DEBOUNCE_MS = 5_000; // 5 seconds after last write

export type SyncStatus =
  'idle' | 'pending' | 'syncing' | 'uploading' | 'downloading' | 'conflict' | 'error' | 'done';

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

/** Register a callback for sync status changes ('error' carries the error message). */
export function onSyncStatus(fn: (status: SyncStatus, detail?: string) => void): void {
  _onSyncStatusChange = fn;
}

export function getPendingSyncConflict(): SyncConflict | null {
  return _pendingConflict;
}

/** True when this device has local changes that are not in Drive yet. */
export function hasPendingChanges(): boolean {
  return _uploadRequested;
}

/** Register a callback fired whenever hasPendingChanges() flips. */
export function onPendingChange(fn: (pending: boolean) => void): void {
  _onPendingChange = fn;
}

function setPending(pending: boolean): void {
  if (_uploadRequested === pending) return;
  _uploadRequested = pending;
  _onPendingChange?.(pending);
}

/** Initialise hasPendingChanges() from the stored sync metadata (call on boot). */
export async function loadPendingState(): Promise<boolean> {
  setPending(
    hasUnsyncedLocalChanges(await getLastLocalChangeTimestamp(), await getLastSyncTimestamp()),
  );
  return _uploadRequested;
}

export function getSyncStatus(): SyncStatus {
  return _status;
}

export function getSyncError(): string {
  return _error;
}

function setStatus(s: SyncStatus, detail?: string): void {
  _status = s;
  _error = s === 'error' ? (detail ?? _error) : '';
  if (s === 'error') _onSyncStatusChange?.(s, _error);
  else _onSyncStatusChange?.(s);
}

function reportError(context: string, err: unknown): void {
  console.error(context, err);
  _error = err instanceof Error ? err.message : String(err);
  setStatus('error');
}

function clearPendingConflict(): void {
  _pendingConflict = null;
}

function raiseConflict(conflict: SyncConflict): never {
  _pendingConflict = conflict;
  cancelPendingUpload();
  setStatus('conflict');
  throw new SyncConflictError(conflict);
}

export async function hasPendingLocalChanges(): Promise<boolean> {
  await _localChangeWrite;
  return (
    _uploadRequested ||
    hasUnsyncedLocalChanges(await getLastLocalChangeTimestamp(), await getLastSyncTimestamp())
  );
}

function hasUnsyncedLocalChanges(
  lastLocalChangeAt: string | null,
  lastSyncedAt: string | null,
): boolean {
  return (
    !!lastLocalChangeAt && (!lastSyncedAt || new Date(lastLocalChangeAt) > new Date(lastSyncedAt))
  );
}

async function finalizeSuccessfulSync(
  modifiedTime: string,
  syncStartedAt: string,
  generation: number,
  opts: { discardLocalChanges?: boolean } = {},
): Promise<void> {
  await _localChangeWrite;
  await setLastSyncTimestamp(modifiedTime);
  await setDriveVersion(modifiedTime);
  const latestLocalChangeAt = await getLastLocalChangeTimestamp();
  const unchanged =
    generation === _changeGeneration &&
    (opts.discardLocalChanges ||
      !latestLocalChangeAt ||
      new Date(latestLocalChangeAt) <= new Date(syncStartedAt));
  if (unchanged) {
    await setLastLocalChangeTimestamp(modifiedTime);
  }
  const settled = unchanged && generation === _changeGeneration;
  setPending(!settled);
  clearPendingConflict();
  setStatus(settled ? 'done' : 'pending');
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
  if (_pendingConflict) throw new SyncConflictError(_pendingConflict);
  _syncing = true;
  try {
    setStatus('syncing');
    await _localChangeWrite;
    const cloudTime = await getCloudModifiedTime();
    if (!cloudTime) {
      // Recreate a missing backup if this device previously had one.
      if (await getLastSyncTimestamp()) setPending(true);
      setStatus((await hasPendingLocalChanges()) ? 'pending' : 'done');
      return false;
    }

    const localTime = await getLastSyncTimestamp();
    const localChangeTime = await getLastLocalChangeTimestamp();
    const storedVersion = await getDriveVersion();

    // Skip download when the stored Drive version matches the current cloud modifiedTime.
    // This is a clock-skew-resistant guard: if the cloud file hasn't changed since our
    // last sync, the version strings will be identical regardless of local clock drift.
    if (storedVersion && storedVersion === cloudTime) {
      setStatus((await hasPendingLocalChanges()) ? 'pending' : 'done');
      return false;
    }

    if (localTime && new Date(localTime) >= new Date(cloudTime)) {
      // Local is same or newer - no download needed.
      setStatus((await hasPendingLocalChanges()) ? 'pending' : 'done');
      return false;
    }

    // A device that never synced has nothing Drive could overwrite: Drive wins,
    // and only its local-only snapshots and transactions are kept.
    const neverSynced = !localTime && !storedVersion;
    const hadLocalChanges = _uploadRequested || hasUnsyncedLocalChanges(localChangeTime, localTime);

    // Conflict guard: cloud is newer, but this device has local changes that
    // were never synced to Drive yet. Refuse silent overwrite.
    if (!neverSynced && hadLocalChanges) {
      raiseConflict({
        source: 'pull',
        cloudModifiedTime: cloudTime,
        lastSyncedAt: localTime,
        lastLocalChangeAt: localChangeTime,
      });
    }

    // Cloud is newer - download and replace.
    setStatus('downloading');
    const generation = _changeGeneration;
    const result = await downloadDbFile();
    if (!result) {
      throw new Error('The Google Drive copy disappeared before it could be downloaded.');
    }

    await importDb(result.data, { preserveLocalConfig: !neverSynced });
    await finalizeSuccessfulSync(result.modifiedTime, result.modifiedTime, generation, {
      discardLocalChanges: true,
    });
    if (neverSynced && hadLocalChanges) scheduleUpload();
    return true;
  } catch (err) {
    if (err instanceof SyncConflictError) throw err;
    if (err instanceof NeedsAuthError) {
      setStatus('idle');
      throw err;
    }
    reportError('[sync] pull failed:', err);
    throw err;
  } finally {
    _syncing = false;
    setStatus(_status);
    resumeQueuedUpload();
  }
}

/**
 * Push: upload the current local DB to Drive AppData.
 * Called immediately (not debounced), use scheduleUpload for debounced pushes.
 */
export async function pushToCloud(
  opts: { skipConflictCheck?: boolean; throwOnError?: boolean } = {},
): Promise<boolean> {
  if (_syncing) return false;
  if (_pendingConflict && !opts.skipConflictCheck) throw new SyncConflictError(_pendingConflict);
  cancelPendingUpload();
  _syncing = true;
  try {
    setStatus('syncing');
    await _localChangeWrite;
    const syncStartedAt = new Date().toISOString();
    const localTime = await getLastSyncTimestamp();
    const localChangeTime = await getLastLocalChangeTimestamp();
    const storedVersion = await getDriveVersion();
    const cloudTime = await getCloudModifiedTime();
    const neverSynced = !storedVersion && !localTime;
    if (
      !opts.skipConflictCheck &&
      cloudTime &&
      // Never overwrite a Drive copy this device has not seen yet.
      (neverSynced ||
        ((_uploadRequested || hasUnsyncedLocalChanges(localChangeTime, localTime)) &&
          storedVersion !== cloudTime))
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
      throw new Error('The local database could not be exported for sync.');
    }

    const generation = _changeGeneration;
    setStatus('uploading');
    const modifiedTime = await uploadDbFile(data);
    await finalizeSuccessfulSync(modifiedTime, syncStartedAt, generation);
    return true;
  } catch (err) {
    if (err instanceof SyncConflictError) throw err;
    if (err instanceof NeedsAuthError) {
      // Not connected: keep the change pending until the user connects.
      setStatus('idle');
      return false;
    }
    reportError('[sync] push failed:', err);
    if (opts.throwOnError) throw err;
    return false;
  } finally {
    _syncing = false;
    setStatus(_status);
    resumeQueuedUpload();
  }
}

/**
 * Schedule a debounced upload after local writes.
 * Coalesces multiple rapid writes into a single upload.
 */
export function scheduleUpload(): void {
  markLocalChange();
  if (_pendingConflict) {
    setStatus('conflict');
    return;
  }
  if (!_syncing) setStatus('pending');
  armUpload();
}

function armUpload(): void {
  if (_uploadTimer) clearTimeout(_uploadTimer);
  _uploadTimer = setTimeout(() => {
    _uploadTimer = null;
    if (_pendingConflict) return;
    if (_syncing || isBusy()) {
      armUpload();
      return;
    }
    void pushToCloud().catch((err: unknown) => {
      if (!(err instanceof SyncConflictError)) reportError('[sync] scheduled upload failed:', err);
    });
  }, UPLOAD_DEBOUNCE_MS);
}

/** Record a local change that is not in Drive yet, without scheduling a push. */
export function markLocalChange(): void {
  _changeGeneration++;
  setPending(true);
  const changedAt = new Date().toISOString();
  const write = () => setLastLocalChangeTimestamp(changedAt);
  _localChangeWrite = _localChangeWrite.then(write, write);
  void _localChangeWrite.catch((err: unknown) =>
    reportError('[sync] local change marker failed:', err),
  );
}

function resumeQueuedUpload(): void {
  if (_uploadRequested && !_uploadTimer && !_pendingConflict && _status === 'pending') armUpload();
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
    if (!(await pushToCloud())) throw new Error(_error || 'Sync could not start. Try again.');
  }
}

export async function overwriteCloudWithLocal(): Promise<boolean> {
  cancelPendingUpload();
  return pushToCloud({ skipConflictCheck: true });
}

export async function replaceLocalWithCloud(): Promise<boolean> {
  if (_syncing) return false;
  cancelPendingUpload();
  _syncing = true;
  try {
    await _localChangeWrite;
    setStatus('downloading');
    const generation = _changeGeneration;
    const result = await downloadDbFile();
    if (!result) {
      throw new Error(
        'The Google Drive copy is no longer available. Choose another recovery action.',
      );
    }
    await importDb(result.data, { preserveLocalTransactions: false });
    await finalizeSuccessfulSync(result.modifiedTime, result.modifiedTime, generation, {
      discardLocalChanges: true,
    });
    return true;
  } catch (err) {
    reportError('[sync] conflict download failed:', err);
    throw err;
  } finally {
    _syncing = false;
    setStatus(_status);
    resumeQueuedUpload();
  }
}
