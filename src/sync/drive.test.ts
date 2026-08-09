import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../auth/google', () => ({
  getToken: vi.fn(async () => 'test-token'),
}));

describe('findDbFile', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('picks the most recently modified db file deterministically', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          files: [
            {
              id: 'b',
              name: 'wealth-tracker.db',
              modifiedTime: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'a',
              name: 'wealth-tracker.db',
              modifiedTime: '2026-02-01T00:00:00.000Z',
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const { findDbFile } = await import('./drive');
    const file = await findDbFile();

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('fields=files(id,name,modifiedTime)'),
      expect.any(Object),
    );
    expect(file?.id).toBe('a');
  });

  it('breaks modifiedTime ties by id', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          files: [
            {
              id: 'z',
              name: 'wealth-tracker.db',
              modifiedTime: '2026-02-01T00:00:00.000Z',
            },
            {
              id: 'a',
              name: 'wealth-tracker.db',
              modifiedTime: '2026-02-01T00:00:00.000Z',
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const { findDbFile } = await import('./drive');
    const file = await findDbFile();

    expect(file?.id).toBe('a');
  });
});
