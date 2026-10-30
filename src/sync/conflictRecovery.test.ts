// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createConflictRecovery } from './conflictRecovery';
import * as engine from './engine';
import { conflictDialog } from '../ui/conflictDialog';
import { confirmDialog } from '../ui/confirmDialog';
import { isBusy, setBusy } from './lock';

vi.mock('./engine', () => ({
  getPendingSyncConflict: vi.fn(),
  getSyncError: vi.fn(() => 'Transfer did not complete'),
  isSyncing: vi.fn(() => false),
  overwriteCloudWithLocal: vi.fn(async () => true),
  replaceLocalWithCloud: vi.fn(async () => true),
}));
vi.mock('../ui/conflictDialog', () => ({ conflictDialog: vi.fn() }));
vi.mock('../ui/confirmDialog', () => ({ confirmDialog: vi.fn(async () => true) }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('conflict recovery orchestration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setBusy(false);
    vi.mocked(engine.getPendingSyncConflict).mockReturnValue({
      source: 'push',
      cloudModifiedTime: '2026-01-03',
      lastSyncedAt: '2026-01-01',
      lastLocalChangeAt: '2026-01-02',
    });
    vi.mocked(conflictDialog).mockResolvedValue('cancel');
  });

  function setup() {
    const refresh = vi.fn(async () => {});
    const status = vi.fn();
    const failure = vi.fn();
    const completed = vi.fn();
    const backup = vi.fn(async () => {});
    const recovery = createConflictRecovery({
      localIsEmpty: async () => false,
      refresh,
      setBusy,
      setStatus: status,
      onError: failure,
      onComplete: completed,
      backup,
    });
    return { recovery, refresh, status, failure, completed, backup };
  }

  it('closing leaves the conflict pending and changes neither copy', async () => {
    const { recovery, completed } = setup();
    await recovery.open();
    expect(engine.overwriteCloudWithLocal).not.toHaveBeenCalled();
    expect(engine.replaceLocalWithCloud).not.toHaveBeenCalled();
    expect(engine.getPendingSyncConflict()).not.toBeNull();
    expect(completed).not.toHaveBeenCalled();
    expect(isBusy()).toBe(false);
  });

  it.each(['keep-local', 'keep-cloud'] as const)(
    'does not report success for a false %s result',
    async (choice) => {
      vi.mocked(conflictDialog).mockResolvedValue(choice);
      vi.mocked(engine.overwriteCloudWithLocal).mockResolvedValue(false);
      vi.mocked(engine.replaceLocalWithCloud).mockResolvedValue(false);
      const { recovery, refresh, status, failure, completed } = setup();
      await recovery.open();
      expect(refresh).not.toHaveBeenCalled();
      expect(completed).not.toHaveBeenCalled();
      expect(status).toHaveBeenLastCalledWith('error', 'Transfer did not complete');
      expect(failure).toHaveBeenCalledOnce();
      expect(engine.getPendingSyncConflict()).not.toBeNull();
      expect(isBusy()).toBe(false);
    },
  );

  it('deduplicates openings and waits for transfer and refresh before completing', async () => {
    vi.mocked(conflictDialog).mockResolvedValue('keep-local');
    const transfer = deferred<boolean>();
    vi.mocked(engine.overwriteCloudWithLocal).mockReturnValue(transfer.promise);
    const { recovery, refresh, status, completed } = setup();
    const refreshed = deferred<void>();
    refresh.mockReturnValue(refreshed.promise);
    const first = recovery.open();
    expect(recovery.open()).toBe(first);
    await vi.waitFor(() => expect(engine.overwriteCloudWithLocal).toHaveBeenCalledOnce());
    expect(isBusy()).toBe(true);
    expect(completed).not.toHaveBeenCalled();
    transfer.resolve(true);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(status).toHaveBeenLastCalledWith('refreshing');
    expect(completed).not.toHaveBeenCalled();
    refreshed.resolve();
    await first;
    expect(completed).toHaveBeenCalledOnce();
    expect(isBusy()).toBe(false);
  });

  it('retries only refresh after transfer succeeded', async () => {
    vi.mocked(conflictDialog).mockResolvedValue('keep-cloud');
    const { recovery, refresh, completed, failure } = setup();
    refresh.mockRejectedValueOnce(new Error('Cache unavailable'));
    await recovery.open();
    expect(recovery.needsRefresh()).toBe(true);
    expect(completed).not.toHaveBeenCalled();
    expect(failure).toHaveBeenCalledWith('Cache unavailable');
    vi.mocked(engine.getPendingSyncConflict).mockReturnValue(null);
    await recovery.open();
    expect(recovery.needsRefresh()).toBe(false);
    expect(engine.replaceLocalWithCloud).toHaveBeenCalledOnce();
    expect(conflictDialog).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(completed).toHaveBeenCalledOnce();
  });

  it('returns to the choice dialog after cancelling the destructive confirmation', async () => {
    vi.mocked(conflictDialog).mockResolvedValueOnce('keep-local').mockResolvedValueOnce('cancel');
    vi.mocked(confirmDialog).mockResolvedValue(false);
    const { recovery } = setup();
    await recovery.open();
    expect(engine.overwriteCloudWithLocal).not.toHaveBeenCalled();
    expect(conflictDialog).toHaveBeenCalledTimes(2);
  });

  it('exports a backup and returns to the unresolved choice', async () => {
    vi.mocked(conflictDialog).mockResolvedValueOnce('backup').mockResolvedValueOnce('cancel');
    const { recovery, backup } = setup();
    await recovery.open();
    expect(backup).toHaveBeenCalledOnce();
    expect(engine.overwriteCloudWithLocal).not.toHaveBeenCalled();
    expect(conflictDialog).toHaveBeenCalledTimes(2);
  });

  it('surfaces backup and transfer exceptions without unhandled rejections', async () => {
    vi.mocked(conflictDialog).mockResolvedValue('backup');
    const { recovery, backup, failure } = setup();
    backup.mockRejectedValueOnce(new Error('Backup failed'));
    await expect(recovery.open()).resolves.toBeUndefined();
    expect(failure).toHaveBeenLastCalledWith('Backup failed');
    vi.mocked(conflictDialog).mockResolvedValue('keep-cloud');
    vi.mocked(engine.replaceLocalWithCloud).mockRejectedValueOnce(new Error('Import failed'));
    await expect(recovery.open()).resolves.toBeUndefined();
    expect(failure).toHaveBeenLastCalledWith('Import failed');
    expect(isBusy()).toBe(false);
  });

  it('does not steal the lock from an existing write or engine transfer', async () => {
    const { recovery } = setup();
    setBusy(true);
    await recovery.open();
    expect(isBusy()).toBe(true);
    expect(conflictDialog).not.toHaveBeenCalled();
    setBusy(false);
    vi.mocked(engine.isSyncing).mockReturnValue(true);
    await recovery.open();
    expect(conflictDialog).not.toHaveBeenCalled();
  });
});
