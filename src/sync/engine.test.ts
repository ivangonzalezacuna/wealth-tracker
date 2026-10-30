import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/connection', () => ({
  exportDb: vi.fn(() => new Uint8Array([1, 2, 3])),
  importDb: vi.fn(async () => {}),
}));

vi.mock('../db/repositories/meta', () => ({
  setLastSyncTimestamp: vi.fn(async () => {}),
  getLastSyncTimestamp: vi.fn(async () => null),
  setDriveVersion: vi.fn(async () => {}),
  getDriveVersion: vi.fn(async () => null),
  getLastLocalChangeTimestamp: vi.fn(async () => null),
  setLastLocalChangeTimestamp: vi.fn(async () => {}),
  clearSyncMetadata: vi.fn(async () => {}),
}));

vi.mock('./drive', () => ({
  downloadDbFile: vi.fn(async () => null),
  uploadDbFile: vi.fn(async () => '2026-01-01T00:00:00.000Z'),
  getCloudModifiedTime: vi.fn(async () => null),
}));

describe('sync engine conflict handling', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
  });
  afterEach(async () => {
    (await import('./engine')).cancelPendingUpload();
    vi.useRealTimers();
  });

  it('publishes pending as soon as an upload is queued', async () => {
    vi.useFakeTimers();
    const engine = await import('./engine');
    const status = vi.fn();
    engine.onSyncStatus(status);
    engine.scheduleUpload();
    expect(status).toHaveBeenLastCalledWith('pending');
    expect(engine.getSyncStatus()).toBe('pending');
  });

  it('does not report success when the local database cannot be exported', async () => {
    const connection = await import('../db/connection');
    vi.mocked(connection.exportDb).mockReturnValueOnce(null);
    const engine = await import('./engine');
    const status = vi.fn();
    engine.onSyncStatus(status);
    expect(await engine.pushToCloud()).toBe(false);
    expect(status).toHaveBeenLastCalledWith('error', expect.stringContaining('exported'));
    expect(status).not.toHaveBeenCalledWith('done');
  });

  it('missing cloud data during explicit replacement is an error, not success', async () => {
    const engine = await import('./engine');
    const status = vi.fn();
    engine.onSyncStatus(status);
    await expect(engine.replaceLocalWithCloud()).rejects.toThrow(/Drive/i);
    expect(status).toHaveBeenLastCalledWith('error', expect.stringContaining('Drive'));
    expect(status).not.toHaveBeenCalledWith('done');
  });

  it('pauses ordinary pulls and pushes until the pending conflict is explicitly resolved', async () => {
    const meta = await import('../db/repositories/meta');
    const drive = await import('./drive');
    vi.mocked(meta.getLastSyncTimestamp).mockResolvedValue('2026-01-01');
    vi.mocked(meta.getLastLocalChangeTimestamp).mockResolvedValue('2026-01-02');
    vi.mocked(drive.getCloudModifiedTime).mockResolvedValue('2026-01-03');
    const engine = await import('./engine');
    await expect(engine.pullFromCloud()).rejects.toBeInstanceOf(engine.SyncConflictError);
    vi.mocked(drive.getCloudModifiedTime).mockClear();
    await expect(engine.pullFromCloud()).rejects.toBeInstanceOf(engine.SyncConflictError);
    await expect(engine.pushToCloud()).rejects.toBeInstanceOf(engine.SyncConflictError);
    expect(drive.getCloudModifiedTime).not.toHaveBeenCalled();
    vi.useFakeTimers();
    engine.scheduleUpload();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(engine.getSyncStatus()).toBe('conflict');
    expect(drive.uploadDbFile).not.toHaveBeenCalled();
    expect(await engine.overwriteCloudWithLocal()).toBe(true);
    expect(engine.getPendingSyncConflict()).toBeNull();
  });

  it('retains the conflict after upload or replacement failure', async () => {
    const meta = await import('../db/repositories/meta');
    const drive = await import('./drive');
    vi.mocked(meta.getLastSyncTimestamp).mockResolvedValue('2026-01-01');
    vi.mocked(meta.getLastLocalChangeTimestamp).mockResolvedValue('2026-01-02');
    vi.mocked(drive.getCloudModifiedTime).mockResolvedValue('2026-01-03');
    const engine = await import('./engine');
    await expect(engine.pullFromCloud()).rejects.toBeInstanceOf(engine.SyncConflictError);
    vi.mocked(drive.uploadDbFile).mockRejectedValueOnce(new Error('Upload failed'));
    expect(await engine.overwriteCloudWithLocal()).toBe(false);
    expect(engine.getPendingSyncConflict()).not.toBeNull();
    await expect(engine.replaceLocalWithCloud()).rejects.toThrow(/Drive/i);
    expect(engine.getPendingSyncConflict()).not.toBeNull();
    expect(engine.getSyncStatus()).toBe('error');
  });

  it('publishes checking then uploading and waits for metadata persistence before done', async () => {
    const meta = await import('../db/repositories/meta');
    let finish!: () => void;
    vi.mocked(meta.setDriveVersion).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const engine = await import('./engine');
    const status = vi.fn();
    engine.onSyncStatus(status);
    const push = engine.pushToCloud();
    await vi.waitFor(() => expect(meta.setDriveVersion).toHaveBeenCalledOnce());
    expect(status.mock.calls.map(([value]) => value)).toEqual(['syncing', 'uploading']);
    finish();
    expect(await push).toBe(true);
    expect(status).toHaveBeenLastCalledWith('done');
    expect(engine.isSyncing()).toBe(false);
  });

  it('keeps new edits pending if their debounce expires during a slow upload', async () => {
    vi.useFakeTimers();
    const drive = await import('./drive');
    let finish!: (value: string) => void;
    vi.mocked(drive.uploadDbFile).mockReturnValueOnce(
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
    );
    const engine = await import('./engine');
    const pushing = engine.pushToCloud();
    await vi.advanceTimersByTimeAsync(0);
    expect(drive.uploadDbFile).toHaveBeenCalledOnce();
    engine.scheduleUpload();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(drive.uploadDbFile).toHaveBeenCalledOnce();
    finish(new Date().toISOString());
    expect(await pushing).toBe(true);
    expect(engine.getSyncStatus()).toBe('pending');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(drive.uploadDbFile).toHaveBeenCalledTimes(2);
    expect(engine.getSyncStatus()).toBe('done');
  });

  it('surfaces local marker persistence errors instead of uploading untracked changes', async () => {
    const meta = await import('../db/repositories/meta');
    const drive = await import('./drive');
    vi.mocked(meta.setLastLocalChangeTimestamp).mockRejectedValueOnce(
      new Error('Persistence failed'),
    );
    const engine = await import('./engine');
    engine.scheduleUpload();
    expect(await engine.pushToCloud()).toBe(false);
    expect(drive.uploadDbFile).not.toHaveBeenCalled();
    expect(engine.getSyncStatus()).toBe('error');
    expect(engine.getSyncError()).toBe('Persistence failed');
  });

  it('keeps edits made during final metadata persistence pending', async () => {
    const meta = await import('../db/repositories/meta');
    let finish!: () => void;
    vi.mocked(meta.setLastLocalChangeTimestamp).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const engine = await import('./engine');
    const pushing = engine.pushToCloud();
    await vi.waitFor(() => expect(meta.setLastLocalChangeTimestamp).toHaveBeenCalledOnce());
    engine.scheduleUpload();
    finish();
    expect(await pushing).toBe(true);
    expect(engine.getSyncStatus()).toBe('pending');
  });

  it('does not call an absent Drive backup synced when a local baseline exists', async () => {
    const meta = await import('../db/repositories/meta');
    vi.mocked(meta.getLastSyncTimestamp).mockResolvedValue('2026-01-01');
    const engine = await import('./engine');
    expect(await engine.pullFromCloud()).toBe(false);
    expect(engine.getSyncStatus()).toBe('pending');
    expect(await engine.hasPendingLocalChanges()).toBe(true);
  });

  it('protects queued edits even when the local clock is behind the stored Drive timestamp', async () => {
    vi.useFakeTimers();
    const meta = await import('../db/repositories/meta');
    const drive = await import('./drive');
    vi.mocked(meta.getLastSyncTimestamp).mockResolvedValue('9999-01-01');
    vi.mocked(meta.getDriveVersion).mockResolvedValue('9999-01-01');
    vi.mocked(meta.getLastLocalChangeTimestamp).mockResolvedValue('2026-01-01');
    vi.mocked(drive.getCloudModifiedTime).mockResolvedValue('9999-01-03');
    const engine = await import('./engine');
    engine.scheduleUpload();
    await expect(engine.pushToCloud()).rejects.toBeInstanceOf(engine.SyncConflictError);
    expect(drive.uploadDbFile).not.toHaveBeenCalled();
  });

  it('defers scheduled uploads until a Settings write releases the shared lock', async () => {
    vi.useFakeTimers();
    const drive = await import('./drive');
    const lock = await import('./lock');
    const engine = await import('./engine');
    lock.setBusy(true);
    try {
      engine.scheduleUpload();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(drive.uploadDbFile).not.toHaveBeenCalled();
      lock.setBusy(false);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(drive.uploadDbFile).toHaveBeenCalledOnce();
    } finally {
      lock.setBusy(false);
    }
  });

  it('throws when cloud is newer and local has unsynced changes on pull', async () => {
    const meta = await import('../db/repositories/meta');
    const drive = await import('./drive');
    const connection = await import('../db/connection');
    (meta.getLastSyncTimestamp as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      '2026-01-01T00:00:00.000Z',
    );
    (meta.getLastLocalChangeTimestamp as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      '2026-01-02T00:00:00.000Z',
    );
    (meta.getDriveVersion as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    (drive.getCloudModifiedTime as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      '2026-01-03T00:00:00.000Z',
    );

    const { pullFromCloud, SyncConflictError, getPendingSyncConflict } = await import('./engine');

    await expect(pullFromCloud()).rejects.toBeInstanceOf(SyncConflictError);
    expect(getPendingSyncConflict()).toEqual({
      source: 'pull',
      cloudModifiedTime: '2026-01-03T00:00:00.000Z',
      lastSyncedAt: '2026-01-01T00:00:00.000Z',
      lastLocalChangeAt: '2026-01-02T00:00:00.000Z',
    });
    expect(drive.downloadDbFile as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    expect(connection.importDb as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it('downloads and replaces local DB when cloud is newer and no unsynced local changes exist', async () => {
    const meta = await import('../db/repositories/meta');
    const drive = await import('./drive');
    const connection = await import('../db/connection');
    (meta.getLastSyncTimestamp as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      '2026-01-01T00:00:00.000Z',
    );
    (meta.getLastLocalChangeTimestamp as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      '2026-01-01T00:00:00.000Z',
    );
    (meta.getDriveVersion as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    (drive.getCloudModifiedTime as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      '2026-01-03T00:00:00.000Z',
    );
    (drive.downloadDbFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: new Uint8Array([7, 7, 7]),
      modifiedTime: '2026-01-03T00:00:00.000Z',
    });

    const { pullFromCloud, getPendingSyncConflict } = await import('./engine');

    await expect(pullFromCloud()).resolves.toBe(true);
    expect(connection.importDb as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      new Uint8Array([7, 7, 7]),
      { preserveLocalConfig: true },
    );
    expect(meta.setLastSyncTimestamp as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      '2026-01-03T00:00:00.000Z',
    );
    expect(meta.setDriveVersion as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      '2026-01-03T00:00:00.000Z',
    );
    // The downloaded file's own sync state never counts as a change here.
    expect(meta.setLastLocalChangeTimestamp as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      '2026-01-03T00:00:00.000Z',
    );
    expect(getPendingSyncConflict()).toBeNull();
  });

  it('a device that never synced downloads Drive instead of raising a conflict', async () => {
    vi.useFakeTimers();
    const meta = await import('../db/repositories/meta');
    const drive = await import('./drive');
    const connection = await import('../db/connection');
    (meta.getLastLocalChangeTimestamp as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      '2026-01-02T00:00:00.000Z',
    );
    (drive.getCloudModifiedTime as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      '2026-01-03T00:00:00.000Z',
    );
    (drive.downloadDbFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: new Uint8Array([5]),
      modifiedTime: '2026-01-03T00:00:00.000Z',
    });

    const { pullFromCloud, getPendingSyncConflict, hasPendingChanges, cancelPendingUpload } =
      await import('./engine');

    await expect(pullFromCloud()).resolves.toBe(true);
    expect(connection.importDb as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      new Uint8Array([5]),
      { preserveLocalConfig: false },
    );
    expect(getPendingSyncConflict()).toBeNull();
    // Its local-only snapshots/transactions were merged in and still need uploading.
    expect(hasPendingChanges()).toBe(true);
    cancelPendingUpload();
    vi.useRealTimers();
  });

  it('throws when cloud changed since last sync and local has unsynced changes on push', async () => {
    const meta = await import('../db/repositories/meta');
    const drive = await import('./drive');
    (meta.getLastSyncTimestamp as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      '2026-01-01T00:00:00.000Z',
    );
    (meta.getLastLocalChangeTimestamp as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      '2026-01-02T00:00:00.000Z',
    );
    (meta.getDriveVersion as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      '2026-01-01T00:00:00.000Z',
    );
    (drive.getCloudModifiedTime as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      '2026-01-03T00:00:00.000Z',
    );

    const { pushToCloud, SyncConflictError, getPendingSyncConflict } = await import('./engine');

    await expect(pushToCloud()).rejects.toBeInstanceOf(SyncConflictError);
    expect(getPendingSyncConflict()).toEqual({
      source: 'push',
      cloudModifiedTime: '2026-01-03T00:00:00.000Z',
      lastSyncedAt: '2026-01-01T00:00:00.000Z',
      lastLocalChangeAt: '2026-01-02T00:00:00.000Z',
    });
    expect(drive.uploadDbFile as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it('does not clear unsynced-local marker when a newer edit happens during upload', async () => {
    const meta = await import('../db/repositories/meta');
    const drive = await import('./drive');
    (meta.getLastSyncTimestamp as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      '2026-01-01T00:00:00.000Z',
    );
    (meta.getLastLocalChangeTimestamp as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('2026-01-02T00:00:00.000Z')
      .mockResolvedValueOnce('9999-01-01T00:00:00.000Z');
    (meta.getDriveVersion as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      '2026-01-01T00:00:00.000Z',
    );
    (drive.getCloudModifiedTime as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      '2026-01-01T00:00:00.000Z',
    );

    const { pushToCloud } = await import('./engine');

    await expect(pushToCloud()).resolves.toBe(true);
    expect(meta.setLastSyncTimestamp as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      '2026-01-01T00:00:00.000Z',
    );
    expect(meta.setDriveVersion as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      '2026-01-01T00:00:00.000Z',
    );
    expect(meta.setLastLocalChangeTimestamp as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it('allows explicit keep-local resolution to overwrite Drive', async () => {
    const meta = await import('../db/repositories/meta');
    const drive = await import('./drive');
    (meta.getLastSyncTimestamp as ReturnType<typeof vi.fn>).mockResolvedValue(
      '2026-01-01T00:00:00.000Z',
    );
    (meta.getLastLocalChangeTimestamp as ReturnType<typeof vi.fn>).mockResolvedValue(
      '2026-01-02T00:00:00.000Z',
    );
    (meta.getDriveVersion as ReturnType<typeof vi.fn>).mockResolvedValue(
      '2026-01-01T00:00:00.000Z',
    );
    (drive.getCloudModifiedTime as ReturnType<typeof vi.fn>).mockResolvedValue(
      '2026-01-03T00:00:00.000Z',
    );

    const { overwriteCloudWithLocal } = await import('./engine');

    await expect(overwriteCloudWithLocal()).resolves.toBe(true);
    expect(drive.uploadDbFile as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
  });

  it('does not raise a false conflict when adding a second transaction after the first synced successfully', async () => {
    // Reproduces the latent bug: uploadDbFile previously fell back to new Date().toISOString()
    // when Drive omitted modifiedTime from the upload response (Drive v3 returns only basic
    // fields by default). The stored driveVersion then differed from what getCloudModifiedTime()
    // returned on the next push, causing storedVersion !== cloudTime and a spurious conflict.
    const DRIVE_ACTUAL_TIME = '2026-01-01T00:00:05.000Z'; // server-assigned time
    const meta = await import('../db/repositories/meta');
    const drive = await import('./drive');

    // State after first successful push: everything stamped with Drive's actual time
    (meta.getLastSyncTimestamp as ReturnType<typeof vi.fn>).mockResolvedValue(DRIVE_ACTUAL_TIME);
    (meta.getDriveVersion as ReturnType<typeof vi.fn>).mockResolvedValue(DRIVE_ACTUAL_TIME);
    // scheduleUpload() set a newer local change for the second transaction
    (meta.getLastLocalChangeTimestamp as ReturnType<typeof vi.fn>).mockResolvedValue(
      '2026-01-01T00:00:10.000Z',
    );
    // Cloud still at the time of our last upload (no external changes)
    (drive.getCloudModifiedTime as ReturnType<typeof vi.fn>).mockResolvedValue(DRIVE_ACTUAL_TIME);

    const { pushToCloud, SyncConflictError } = await import('./engine');

    await expect(pushToCloud()).resolves.not.toThrow();
    await expect(pushToCloud()).resolves.toBe(true);
  });

  it('uses true replacement when explicitly keeping the cloud copy', async () => {
    const meta = await import('../db/repositories/meta');
    const drive = await import('./drive');
    const connection = await import('../db/connection');
    (drive.downloadDbFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: new Uint8Array([9, 9, 9]),
      modifiedTime: '2026-01-03T00:00:00.000Z',
    });

    (meta.getLastLocalChangeTimestamp as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const { replaceLocalWithCloud } = await import('./engine');

    await expect(replaceLocalWithCloud()).resolves.toBe(true);
    expect(connection.importDb as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      new Uint8Array([9, 9, 9]),
      { preserveLocalTransactions: false },
    );
    expect(meta.setLastLocalChangeTimestamp as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      '2026-01-03T00:00:00.000Z',
    );
  });

  it('does not upload again because the chosen cloud database contains an old device dirty marker', async () => {
    const meta = await import('../db/repositories/meta');
    const drive = await import('./drive');
    vi.mocked(meta.getLastLocalChangeTimestamp).mockResolvedValue('9999-01-01T00:00:00.000Z');
    vi.mocked(drive.downloadDbFile).mockResolvedValue({
      data: new Uint8Array([9]),
      modifiedTime: '2026-01-03T00:00:00.000Z',
    });
    const engine = await import('./engine');
    expect(await engine.replaceLocalWithCloud()).toBe(true);
    expect(meta.setLastLocalChangeTimestamp).toHaveBeenCalledWith('2026-01-03T00:00:00.000Z');
    expect(engine.getSyncStatus()).toBe('done');
    expect(drive.uploadDbFile).not.toHaveBeenCalled();
  });

  it('never overwrites a Drive copy this device has not synced with', async () => {
    const meta = await import('../db/repositories/meta');
    const drive = await import('./drive');
    (meta.getLastLocalChangeTimestamp as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('2026-01-03T00:00:00.000Z')
      .mockResolvedValueOnce('2026-01-03T00:00:00.000Z');
    (drive.getCloudModifiedTime as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('2025-12-01T00:00:00.000Z')
      .mockResolvedValueOnce('2025-12-01T00:00:00.000Z');

    const { pushToCloud, overwriteCloudWithLocal, SyncConflictError } = await import('./engine');

    await expect(pushToCloud()).rejects.toBeInstanceOf(SyncConflictError);
    expect(drive.uploadDbFile as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    // Restoring a backup overwrites Drive explicitly.
    await expect(overwriteCloudWithLocal()).resolves.toBe(true);
    expect(drive.uploadDbFile as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
  });
});
describe('sync engine pending changes', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('scheduleUpload marks changes pending and notifies listeners', async () => {
    vi.useFakeTimers();
    const { scheduleUpload, hasPendingChanges, onPendingChange, cancelPendingUpload } =
      await import('./engine');
    const seen: boolean[] = [];
    onPendingChange((p) => seen.push(p));

    expect(hasPendingChanges()).toBe(false);
    scheduleUpload();
    expect(hasPendingChanges()).toBe(true);
    expect(seen).toEqual([true]);
    cancelPendingUpload();
    vi.useRealTimers();
  });

  it('pushToCloud without a token returns false quietly and keeps changes pending', async () => {
    vi.useFakeTimers();
    const drive = await import('./drive');
    const { NeedsAuthError } = await import('../auth/errors');
    (drive.getCloudModifiedTime as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new NeedsAuthError(),
    );
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { scheduleUpload, cancelPendingUpload, pushToCloud, hasPendingChanges } =
      await import('./engine');
    scheduleUpload();
    cancelPendingUpload();
    vi.useRealTimers();

    await expect(pushToCloud()).resolves.toBe(false);
    expect(hasPendingChanges()).toBe(true);
    expect(drive.uploadDbFile as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('a successful push clears pending changes', async () => {
    vi.useFakeTimers();
    const { scheduleUpload, cancelPendingUpload, pushToCloud, hasPendingChanges } =
      await import('./engine');
    scheduleUpload();
    cancelPendingUpload();
    vi.useRealTimers();

    await expect(pushToCloud()).resolves.toBe(true);
    expect(hasPendingChanges()).toBe(false);
  });

  it('a failed push reports the error, keeps changes pending, and throws only on request', async () => {
    vi.useFakeTimers();
    const drive = await import('./drive');
    const upload = drive.uploadDbFile as ReturnType<typeof vi.fn>;
    upload.mockRejectedValue(new Error('Drive API 500'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { scheduleUpload, cancelPendingUpload, pushToCloud, hasPendingChanges, onSyncStatus } =
      await import('./engine');
    const seen: [string, string | undefined][] = [];
    onSyncStatus((s, detail) => seen.push([s, detail]));
    scheduleUpload();
    cancelPendingUpload();
    vi.useRealTimers();

    await expect(pushToCloud()).resolves.toBe(false);
    expect(seen.at(-1)).toEqual(['error', 'Drive API 500']);
    expect(hasPendingChanges()).toBe(true);
    await expect(pushToCloud({ throwOnError: true })).rejects.toThrow('Drive API 500');
    expect(hasPendingChanges()).toBe(true);
    upload.mockReset();
    upload.mockResolvedValue('2026-01-01T00:00:00.000Z');
    errSpy.mockRestore();
  });

  it('loadPendingState reads stored sync metadata', async () => {
    const meta = await import('../db/repositories/meta');
    (meta.getLastSyncTimestamp as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      '2026-01-01T00:00:00.000Z',
    );
    (meta.getLastLocalChangeTimestamp as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      '2026-01-02T00:00:00.000Z',
    );
    const { loadPendingState, hasPendingChanges } = await import('./engine');
    await expect(loadPendingState()).resolves.toBe(true);
    expect(hasPendingChanges()).toBe(true);
  });

  it('pullFromCloud rethrows NeedsAuthError without logging', async () => {
    const drive = await import('./drive');
    const { NeedsAuthError } = await import('../auth/errors');
    (drive.getCloudModifiedTime as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new NeedsAuthError(),
    );
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { pullFromCloud } = await import('./engine');
    await expect(pullFromCloud()).rejects.toBeInstanceOf(NeedsAuthError);
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
