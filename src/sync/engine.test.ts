import { beforeEach, describe, expect, it, vi } from 'vitest';

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
}));

vi.mock('./drive', () => ({
  downloadDbFile: vi.fn(async () => null),
  uploadDbFile: vi.fn(async () => '2026-01-01T00:00:00.000Z'),
  getCloudModifiedTime: vi.fn(async () => null),
}));

describe('sync engine conflict handling', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
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
});
