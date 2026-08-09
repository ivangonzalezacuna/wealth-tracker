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

describe('pullFromCloud conflict guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when cloud is newer and local has unsynced changes', async () => {
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

    const { pullFromCloud, SyncConflictError } = await import('./engine');

    await expect(pullFromCloud()).rejects.toBeInstanceOf(SyncConflictError);
    expect(drive.downloadDbFile as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    expect(connection.importDb as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });
});
